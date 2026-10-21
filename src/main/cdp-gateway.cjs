'use strict';
// External clients have separate Browser sessions over the private pipe. The
// configured public port is the only TCP listener; Chromium has no bypass port.
const http=require('node:http'),crypto=require('node:crypto');
const {WebSocketServer,WebSocket}=require('ws');
class CdpGateway{
 constructor(channel,{port,waitForEnvironment}){this.channel=channel;this.port=port;this.waitForEnvironment=waitForEnvironment;this.browserId=crypto.randomUUID();this.clients=new Set();this.sockets=new Set();}
 async start(){
  this.version=await this.channel.send('Browser.getVersion');
  this.server=http.createServer((req,res)=>{this.http(req,res).catch(()=>{if(!res.headersSent)res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'CDP 请求失败'}));});});
  this.server.on('connection',socket=>{this.sockets.add(socket);socket.once('close',()=>this.sockets.delete(socket));});
  this.ws=new WebSocketServer({noServer:true,perMessageDeflate:false,maxPayload:8*1024*1024});
  this.server.on('upgrade',(req,socket,head)=>{
   const pathname=(req.url||'').split('?')[0],browser=pathname===`/devtools/browser/${this.browserId}`,match=pathname.match(/^\/devtools\/page\/([A-Za-z0-9-]+)$/);
   const origin=req.headers.origin;
   if(!this.local(req)||(origin&&origin!==`http://127.0.0.1:${this.port}`&&origin!==`http://localhost:${this.port}`&&origin!=='devtools://devtools')||(!browser&&!match)){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
   this.ws.handleUpgrade(req,socket,head,client=>this.connect(client,match?.[1]));
  });
  await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(this.port,'127.0.0.1',()=>{this.server.removeListener('error',reject);resolve();});});
  this.port=this.server.address().port;
  return this;
 }
 local(req){const host=req.headers.host||'';return /^127\.0\.0\.1(?::\d+)?$/.test(host)||/^localhost(?::\d+)?$/.test(host);}
 url(type,id){return `ws://127.0.0.1:${this.port}/devtools/${type}/${id}`;}
 async http(req,res){
  if(!this.local(req)){res.writeHead(403);res.end();return;}
  const url=new URL(req.url,'http://127.0.0.1'),pathname=url.pathname.replace(/\/$/,'');let result;
  if(pathname==='/json/version')result={Browser:this.version.product,'Protocol-Version':this.version.protocolVersion,'User-Agent':this.version.userAgent,'V8-Version':this.version.jsVersion,webSocketDebuggerUrl:this.url('browser',this.browserId)};
  else if(pathname==='/json'||pathname==='/json/list'){
   const {targetInfos=[]}=await this.channel.send('Target.getTargets');
   result=targetInfos.filter(x=>x.type!=='browser'&&x.type!=='tab').map(x=>({id:x.targetId,type:x.type,title:x.title,url:x.url,description:'',webSocketDebuggerUrl:this.url('page',x.targetId),devtoolsFrontendUrl:'https://chrome-devtools-frontend.appspot.com/serve_rev/'+this.version.revision+'/inspector.html?ws=127.0.0.1:'+this.port+'/devtools/page/'+x.targetId}));
  }else if(pathname.startsWith('/json/close/')){await this.channel.send('Target.closeTarget',{targetId:pathname.slice(12)});result={success:true};}
  else if(pathname.startsWith('/json/activate/')){await this.channel.send('Target.activateTarget',{targetId:pathname.slice(15)});result={success:true};}
  else if(pathname==='/json/new'&&req.method==='PUT'){const {targetId}=await this.channel.send('Target.createTarget',{url:decodeURIComponent(url.search.slice(1))||'about:blank'});result={id:targetId,type:'page',webSocketDebuggerUrl:this.url('page',targetId)};}
  else{res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':'application/json; charset=UTF-8','cache-control':'no-store'});res.end(JSON.stringify(result));
 }
 connect(socket,targetId){
  const channel=this.channel,sessions=new Map(),client={socket},abort=new AbortController();require('node:events').setMaxListeners(0,abort.signal);this.clients.add(client);let rootId,browserSession,closed=false,inFlight=0,pageAttaching=false;
  const emit=value=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(value));};
  const gate=info=>this.waitForEnvironment(info);
  const detached=new Set();
  const onEvent=(method,params,parentId)=>{
   const parent=sessions.get(parentId);if(!parent)return;
   if(pageAttaching&&parentId===browserSession)return;
   let ready=parent.ready;
   if(method==='Target.attachedToTarget'){
    const child={info:params.targetInfo,ready:Promise.resolve(ready).then(()=>gate(params.targetInfo))};
    // Register immediately so events arriving before initialization are queued.
    child.ready.catch(()=>{});sessions.set(params.sessionId,child);ready=child.ready;
   }else if(method==='Target.detachedFromTarget'){
    const child=sessions.get(params.sessionId);if(child)ready=child.ready;detached.add(params.sessionId);
   }else if(method==='Target.receivedMessageFromTarget')ready=sessions.get(params.sessionId)?.ready||ready;
   Promise.resolve(ready).then(()=>{
    if(closed)return;
    emit({method,params,...(parentId===rootId?{}:{sessionId:parentId})});
    if(method==='Target.detachedFromTarget'){sessions.delete(params.sessionId);detached.delete(params.sessionId);}
   }).catch(()=>socket.close(1011,'环境初始化未完成'));
  };
  const dispose=()=>{
   if(closed)return;closed=true;abort.abort();channel.removeListener('message',onEvent);
   client.disposed=(async()=>{await initialized.catch(()=>{});await Promise.allSettled([...sessions.values()].map(x=>x.ready));if(browserSession&&!channel.closed)await channel.send('Target.detachFromTarget',{sessionId:browserSession}).catch(()=>{});sessions.clear();this.clients.delete(client);})();
  };
  const initialized=(async()=>{
   const result=await channel.send('Target.attachToBrowserTarget');browserSession=result.sessionId;
   rootId=browserSession;sessions.set(rootId,{info:{type:'browser'},ready:Promise.resolve()});channel.on('message',onEvent);
   if(targetId){const {targetInfo}=await channel.send('Target.getTargetInfo',{targetId},browserSession);await gate(targetInfo);pageAttaching=true;const {sessionId}=await channel.send('Target.attachToTarget',{targetId,flatten:true},browserSession);sessions.delete(rootId);rootId=sessionId;sessions.set(rootId,{info:targetInfo,ready:Promise.resolve()});pageAttaching=false;}
  })();
  initialized.catch(()=>socket.close(1011,'CDP 连接失败'));
  socket.on('message',async(data,binary)=>{
   let message,counted=false;try{
    if(binary)throw Error('CDP 只接受 JSON 消息');message=JSON.parse(data.toString());
    if(!Number.isSafeInteger(message.id)||typeof message.method!=='string')throw Error('CDP 消息格式无效');
    ++inFlight;counted=true;if(inFlight>2048)throw Error('CDP 未完成命令过多');
    await initialized;if(closed)return;
    const sid=message.sessionId||rootId,entry=sessions.get(sid);if(!entry||detached.has(sid))throw Error('CDP 会话不存在');
    await entry.ready;const params=message.params||{};
    if(params.sessionId&&['Target.detachFromTarget','Target.sendMessageToTarget'].includes(message.method)){
     const child=sessions.get(params.sessionId);if(!child)throw Error('CDP 会话不属于当前连接');await child.ready;
    }
    // Updating auto-attach filters or detaching a parent can implicitly resume
    // every child. Legacy nested messages can contain these same commands.
    if(['Target.setAutoAttach','Target.detachFromTarget','Target.sendMessageToTarget'].includes(message.method))await Promise.all([...sessions.values()].map(x=>x.ready));
    if(params.targetId&&['Target.attachToTarget','Target.closeTarget','Target.autoAttachRelated'].includes(message.method)){
     const {targetInfo}=await channel.send('Target.getTargetInfo',{targetId:params.targetId},browserSession);await gate(targetInfo);
    }
    // External evaluations/debugger commands can legitimately outlive the
    // short internal setup timeout. Abort their pending promises on disconnect.
    const result=await channel.send(message.method,params,sid,0,abort.signal);
    if(message.method==='Target.attachToBrowserTarget'&&result.sessionId)sessions.set(result.sessionId,{info:{type:'browser'},ready:Promise.resolve()});
    emit({id:message.id,result,...(message.sessionId?{sessionId:message.sessionId}:{})});
   }catch(error){emit({id:message?.id??null,error:{code:error.code||-32000,message:String(error.message||error)},...(message?.sessionId?{sessionId:message.sessionId}:{})});}
   finally{if(counted)--inFlight;}
  });
  socket.on('error',dispose);socket.on('close',dispose);client.dispose=dispose;
 }
 async stop(){for(const client of [...this.clients]){client.dispose();client.socket.terminate();await client.disposed;}for(const socket of this.sockets)socket.destroy();this.ws?.close();if(this.server?.listening)await new Promise(r=>this.server.close(r));}
}
module.exports={CdpGateway};
