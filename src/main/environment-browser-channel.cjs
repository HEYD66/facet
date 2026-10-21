'use strict';
// Browser-level CDP is necessary to pause a SharedWorker before its first
// instruction. The public external-control switch is not enabled by this file.
const {EventEmitter}=require('node:events'),{StringDecoder}=require('node:string_decoder');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
let active;
class BrowserChannel extends EventEmitter{
 constructor(){super();this.pending=new Map();this.sequence=0;this.closed=false;this.mode='';}
 receive(text){let value;try{value=JSON.parse(text);}catch{this.fail(Error('环境控制通道返回无效消息'));return;}
  if(value.id){const p=this.pending.get(value.id);if(!p)return;this.pending.delete(value.id);p.cleanup();value.error?p.reject(Object.assign(Error(String(value.error.message||'环境命令失败')),value.error)):p.resolve(value.result||{});}
  else if(value.method)this.emit('message',value.method,value.params||{},value.sessionId||'');
 }
 fail(error){if(this.closed)return;this.closed=true;this.failure=error;for(const p of this.pending.values()){p.cleanup();p.reject(error);}this.pending.clear();this.emit('failure',error);}
 send(method,params={},sessionId,timeout=5000,signal){if(this.closed)return Promise.reject(this.failure||Error('环境控制通道已关闭'));
  if(signal?.aborted)return Promise.reject(Error('CDP 客户端已断开'));
  return new Promise((resolve,reject)=>{const id=++this.sequence;
   const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
   const abort=()=>{this.pending.delete(id);cleanup();reject(Error('CDP 客户端已断开'));};
   const timer=timeout?setTimeout(()=>{this.pending.delete(id);cleanup();reject(Error('环境命令超时：'+method));},timeout):null;timer?.unref?.();
   signal?.addEventListener('abort',abort,{once:true});
   this.pending.set(id,{resolve,reject,cleanup});try{this.write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));}catch(error){this.pending.delete(id);cleanup();reject(error);}
  });
 }
}
function pipeChannel(app,channel){
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('SharedWorker 私有环境通道目前支持 Windows x64');
 const dir=require('./app-paths.cjs').resourcePath(app,'environment-pipe'),manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
 const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 const binary=path.join(dir,'environment-pipe.node');
 if(manifest.platform!=='win32'||manifest.architecture!=='x64'||manifest.nodeApiVersion!==8||hash(binary)!==manifest.binarySHA256||hash(path.join(dir,'environment-pipe.cc'))!==manifest.sourceSHA256)
  throw Error('SharedWorker 私有通道组件校验失败，请重新构建环境管道组件');
 const native=require(binary),name='facet-environment-'+crypto.randomUUID();
 let writer,reader;
 try{const handles=native.create(name);
  writer=net.connect('\\\\.\\pipe\\'+name+'-in');reader=net.connect('\\\\.\\pipe\\'+name+'-out');
  const decoder=new StringDecoder('utf8');let buffer='';
  reader.on('data',chunk=>{buffer+=decoder.write(chunk);for(;;){const i=buffer.indexOf('\0');if(i<0)break;const message=buffer.slice(0,i);buffer=buffer.slice(i+1);channel.receive(message);}if(buffer.length>8*1024*1024)channel.fail(Error('环境控制通道消息超出上限'));});
  for(const socket of [reader,writer]){socket.on('error',()=>channel.fail(Error('SharedWorker 私有环境通道连接中断')));socket.on('close',()=>channel.fail(Error('SharedWorker 私有环境通道已关闭')));}
  channel.mode='private-pipe';channel.write=text=>writer.write(text+'\0');
  app.commandLine.appendSwitch('remote-debugging-pipe');app.commandLine.appendSwitch('remote-debugging-io-pipes',handles);
  app.once('ready',()=>native.adopt());
  // Chromium owns the server handles; closing the client while the app runs
  // would intentionally shut down its debugging pipe. Keep it until process exit.
 }catch(error){reader?.destroy();writer?.destroy();native.cancel();throw error;}
}
function prepareBrowserChannel(app){
 if(active)return active;
 const channel=new BrowserChannel();active=channel;
 try{
  if(app.isReady())throw Error('私有环境通道必须在 Electron ready 之前准备');
  if(app.commandLine.hasSwitch('remote-debugging-port'))throw Error('请通过千面外部控制设置开放 CDP，不能绕过环境初始化协调');
  if(app.commandLine.hasSwitch('remote-debugging-pipe'))throw Error('启动参数中的 CDP 管道已由其他工具占用');
  pipeChannel(app,channel);channel.ready=app.whenReady();
  channel.ready=channel.ready.then(()=>channel.send('Browser.getVersion')).then(()=>channel);
 }catch(error){channel.ready=Promise.reject(error);}
 channel.ready.catch(error=>channel.fail(error));return channel;
}
function browserChannel(){if(!active)throw Error('SharedWorker 环境入口未在应用启动时准备');return active;}
module.exports={prepareBrowserChannel,browserChannel};
