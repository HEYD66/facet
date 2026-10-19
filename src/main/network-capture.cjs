'use strict';
// Observe failed HTTP(S) page requests only. Do not intercept requests or collect URL paths/bodies.
// Uses each page's existing CDP connection (Network domain), never session.webRequest: any Electron
// session.webRequest listener (even onCompleted/onErrorOccurred) makes Electron bypass Chromium's
// extension request proxy, which silently disables extension declarativeNetRequest rules
// (block/redirect/modifyHeaders). Do not add session.webRequest listeners to instance sessions.
const NETWORK_PARAMS=Object.freeze({maxTotalBufferSize:1024*1024,maxResourceBufferSize:256*1024});
const TRACK_LIMIT=4000;
const IGNORED=new Set(['net::ERR_ABORTED','net::ERR_BLOCKED_BY_CLIENT']);
const TYPES={XHR:'xhr',Fetch:'xhr',EventSource:'xhr',Script:'script',Stylesheet:'stylesheet',Image:'image',Font:'font',Media:'media',TextTrack:'media',WebSocket:'webSocket',Ping:'ping',CSPViolationReport:'cspReport'};
const owners=new WeakMap(),watchers=new WeakMap(),captures=new Set();
let hook=null,hookedApp=null;
function resourceType(type,frameId,root){if(type==='Document')return root&&frameId&&frameId!==root?'subFrame':'mainFrame';return TYPES[type]||'other';}
function sameSession(a,b){if(!a||!b)return false;if(a===b)return true;try{const p=a.getStoragePath?.();return !!p&&p===b.getStoragePath?.();}catch{return false;}}
function watchPage(wc,journal,context,onGone){
  watchers.get(wc)?.unwatch();
  const requests=new Map();let armed=false,root='';
  const record=(entry,httpError,data)=>{
    try{
      const current=context();if(!current)return;
      const id=journal.begin({operation:'page-request',...current,host:entry.host});
      journal.record(id,{stage:httpError?'http-error':'request-error',method:entry.method,resourceType:entry.resourceType,webContentsId:wc.id,...data});
      journal.finish(id,{result:'failed'});
    }catch{/* Diagnostics must never change request handling. */}
  };
  const onMessage=(_event,method,params,sessionId)=>{
    if(sessionId||!params||typeof method!=='string'||!method.startsWith('Network.'))return;
    try{
      const key=params.requestId;
      if(method==='Network.requestWillBeSent'){
        let url;try{url=new URL(params.request?.url);}catch{requests.delete(key);return;}
        if(!['http:','https:'].includes(url.protocol)||params.type==='Preflight'){requests.delete(key);return;}
        if(!requests.has(key)&&requests.size>=TRACK_LIMIT)requests.delete(requests.keys().next().value);
        requests.set(key,{host:url.hostname,method:String(params.request.method||'GET').slice(0,16),resourceType:resourceType(params.type,params.frameId,root),recorded:false});
      }else if(method==='Network.responseReceived'){
        const entry=requests.get(key),status=params.response?.status;
        if(entry&&!entry.recorded&&Number.isFinite(status)&&status>=400){entry.recorded=true;record(entry,true,{status});}
      }else if(method==='Network.loadingFailed'){
        const entry=requests.get(key);requests.delete(key);
        if(!entry||entry.recorded||params.canceled||params.corsErrorStatus)return;
        const error=String(params.errorText||'');if(!error||IGNORED.has(error))return;
        record(entry,false,{code:error.replace(/^net::/,''),reason:error});
      }else if(method==='Network.loadingFinished')requests.delete(key);
    }catch{/* Diagnostics must never change request handling. */}
  };
  const arm=()=>{
    try{
      if(armed||wc.isDestroyed()||!wc.debugger.isAttached())return;armed=true;
      wc.debugger.sendCommand('Network.enable',{...NETWORK_PARAMS}).catch(()=>{armed=false;});
      wc.debugger.sendCommand('Page.getFrameTree').then(x=>{root=x?.frameTree?.frame?.id||'';},()=>{});
    }catch{armed=false;}
  };
  const onDetach=()=>{armed=false;requests.clear();};
  const watcher={
    get armed(){return armed;},arm,
    unwatch(){
      if(watchers.get(wc)!==watcher)return;watchers.delete(wc);requests.clear();armed=false;onGone?.(watcher);
      try{if(wc.isDestroyed())return;wc.debugger.removeListener('message',onMessage);wc.debugger.removeListener('detach',onDetach);wc.removeListener('did-start-navigation',arm);wc.removeListener('destroyed',watcher.unwatch);}catch{}
    }
  };
  watcher.unwatch=watcher.unwatch.bind(watcher);
  watchers.set(wc,watcher);
  wc.debugger.on('message',onMessage);wc.debugger.on('detach',onDetach);wc.on('did-start-navigation',arm);wc.once('destroyed',watcher.unwatch);
  arm();
  return watcher;
}
function syncHook(app){
  if(captures.size&&!hook){hook=(_event,wc)=>{for(const capture of [...captures])capture.offer(wc);};hookedApp=app;app.on('web-contents-created',hook);}
  else if(!captures.size&&hook){hookedApp.removeListener('web-contents-created',hook);hook=null;hookedApp=null;}
}
function captureFailures(session,journal,context,deps){
  const electron=deps||require('electron');
  const owner={};owners.set(session,owner);
  const pages=new Set();
  const capture={offer(wc){try{if(!wc||wc.isDestroyed()||!sameSession(wc.session,session))return;pages.add(watchPage(wc,journal,context,w=>pages.delete(w)));}catch{}}};
  captures.add(capture);syncHook(electron.app);
  for(const wc of electron.webContents.getAllWebContents())capture.offer(wc);
  const dispose=()=>{
    captures.delete(capture);syncHook(electron.app);
    for(const w of [...pages])w.unwatch();pages.clear();
    if(owners.get(session)===owner)owners.delete(session);
  };
  return dispose;
}
// Extension debugger adapters share Facet's page CDP connection. When an extension disables or
// releases the Network domain, keep diagnostics armed with the small buffer limits instead.
async function releaseNetwork(wc){
  if(watchers.get(wc)?.armed){await wc.debugger.sendCommand('Network.enable',{...NETWORK_PARAMS});return {};}
  return wc.debugger.sendCommand('Network.disable',{});
}
function watching(wc){return !!watchers.get(wc)?.armed;}
module.exports={captureFailures,releaseNetwork,watching,NETWORK_PARAMS};
