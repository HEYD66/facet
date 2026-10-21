'use strict';
// Browser-level CDP is necessary to pause a SharedWorker before its first
// instruction. The public external-control switch is not enabled by this file.
const {EventEmitter}=require('node:events'),{StringDecoder}=require('node:string_decoder');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net'),http=require('node:http');
let active;
class BrowserChannel extends EventEmitter{
 constructor(){super();this.pending=new Map();this.sequence=0;this.closed=false;this.mode='';}
 receive(text){let value;try{value=JSON.parse(text);}catch{this.fail(Error('环境控制通道返回无效消息'));return;}
  if(value.id){const p=this.pending.get(value.id);if(!p)return;this.pending.delete(value.id);clearTimeout(p.timer);value.error?p.reject(Error(String(value.error.message||'环境命令失败'))):p.resolve(value.result||{});}
  else if(value.method)this.emit('message',value.method,value.params||{},value.sessionId||'');
 }
 fail(error){if(this.closed)return;this.closed=true;this.failure=error;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.emit('failure',error);}
 send(method,params={},sessionId){if(this.closed)return Promise.reject(this.failure||Error('环境控制通道已关闭'));
  return new Promise((resolve,reject)=>{const id=++this.sequence,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('环境命令超时：'+method));},5000);timer.unref?.();
   this.pending.set(id,{resolve,reject,timer});try{this.write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));}catch(error){this.pending.delete(id);clearTimeout(timer);reject(error);}
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
function versionAddress(port){return new Promise((resolve,reject)=>{
 const request=http.get({hostname:'127.0.0.1',port,path:'/json/version',timeout:1000},response=>{let body='';response.setEncoding('utf8');response.on('data',chunk=>{body+=chunk;if(body.length>65536)request.destroy(Error('环境控制地址响应超出上限'));});response.on('end',()=>{try{const url=new URL(JSON.parse(body).webSocketDebuggerUrl);if(url.protocol!=='ws:'||url.hostname!=='127.0.0.1'||Number(url.port)!==port||!url.pathname.startsWith('/devtools/browser/')||url.username||url.password)throw Error('环境控制地址无效');resolve(url.href);}catch{reject(Error('不能读取现有 CDP 浏览器入口'));}});});
 request.on('timeout',()=>request.destroy(Error('环境控制地址读取超时')));request.on('error',reject);
});}
async function existingChannel(port,channel){
 let address,error;const deadline=Date.now()+5000;
 while(Date.now()<deadline){try{address=await versionAddress(port);break;}catch(e){error=e;await new Promise(r=>setTimeout(r,60));}}
 if(!address)throw error;
 const socket=new WebSocket(address);channel.mode='existing-cdp';
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.close();reject(Error('现有 CDP 环境通道连接超时'));},5000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('现有 CDP 环境通道连接失败'));},{once:true});});
 channel.write=text=>socket.send(text);socket.addEventListener('message',event=>channel.receive(String(event.data)));
 socket.addEventListener('close',()=>channel.fail(Error('现有 CDP 环境通道已关闭')));socket.addEventListener('error',()=>channel.fail(Error('现有 CDP 环境通道连接中断')));
}
function prepareBrowserChannel(app){
 if(active)return active;
 const channel=new BrowserChannel();active=channel;
 try{
  const value=app.commandLine.getSwitchValue('remote-debugging-port');
  if(value){const port=Number(value);if(!Number.isInteger(port)||port<1||port>65535)throw Error('现有 CDP 端口无效');channel.ready=app.whenReady().then(()=>existingChannel(port,channel));}
  else{if(app.isReady())throw Error('私有环境通道必须在 Electron ready 之前准备');if(app.commandLine.hasSwitch('remote-debugging-pipe'))throw Error('启动参数中的 CDP 管道已由其他工具占用');pipeChannel(app,channel);channel.ready=app.whenReady();}
  channel.ready=channel.ready.then(()=>channel.send('Browser.getVersion')).then(()=>channel);
 }catch(error){channel.ready=Promise.reject(error);}
 channel.ready.catch(error=>channel.fail(error));return channel;
}
function browserChannel(){if(!active)throw Error('SharedWorker 环境入口未在应用启动时准备');return active;}
module.exports={prepareBrowserChannel,browserChannel};
