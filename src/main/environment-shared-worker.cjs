'use strict';
const {prepareBrowserChannel,browserChannel}=require('./environment-browser-channel.cjs');
const sessions=new WeakMap(),contexts=new Map(),targets=new Map();let ready;
const website=info=>/^(https?:|blob:https?:)/i.test(info.url||'');
const filters=[{type:'shared_worker',exclude:false},{exclude:true}];
function report(state,error){const text='SharedWorker 环境应用失败：'+String(error?.message||error);state.errors.push(text);if(state.errors.length>100)state.errors.shift();for(const wc of state.owners)if(!wc.isDestroyed())wc.emit('facet-environment-error',Error(text));}
function prepareSharedWorkerEnvironment(app){
 if(ready)return;
 const channel=prepareBrowserChannel(app);
 channel.on('message',(method,params,parentId)=>{
  if(method==='Target.detachedFromTarget'){targets.delete(params.sessionId);return;}
  if(method!=='Target.attachedToTarget')return;
  const info=params.targetInfo,parent=targets.get(parentId),state=info.type==='shared_worker'?contexts.get(info.browserContextId):contexts.get(info.browserContextId)||parent?.state;
  const managed=!!(state?.owners.size&&(['page','tab','worker'].includes(info.type)||info.type==='shared_worker'&&website(info)));
  const entry={state:managed?state:null,targetId:info.targetId,type:info.type};targets.set(params.sessionId,entry);
  const task=(async()=>{
   const send=(method,data)=>channel.send(method,data,params.sessionId);
   try{if(managed){
     await send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:[{type:'worker',exclude:false},{exclude:true}]});
     if(info.type==='shared_worker'||info.type==='worker'){
      await state.applyNative(params.sessionId,info.type,send);
      if(state.source){await send('Runtime.enable');const result=await send('Runtime.evaluate',{expression:state.source});if(result.exceptionDetails)throw Error('指纹脚本执行失败');}
     }
    }}catch(error){if(managed&&targets.has(params.sessionId))report(state,error);}
   finally{
    try{await send('Runtime.runIfWaitingForDebugger');}
    catch(error){if(managed&&targets.has(params.sessionId))report(state,error);try{await channel.send('Target.detachFromTarget',{sessionId:params.sessionId});}catch{}}
    if(!managed){try{await channel.send('Target.detachFromTarget',{sessionId:params.sessionId});}catch{}targets.delete(params.sessionId);}
   }
  })();
  if(managed){state.pending.add(task);task.finally(()=>state.pending.delete(task)).catch(error=>report(state,error));}else task.catch(()=>{});
 });
 channel.on('failure',error=>{for(const state of contexts.values())report(state,error);targets.clear();});
 ready=channel.ready.then(()=>channel.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:filters}));
 ready.catch(()=>{});
}
async function closeWorkers(state){
 const channel=browserChannel();if(channel.closed)return;
 const {targetInfos=[]}=await channel.send('Target.getTargets',{filter:filters});
 for(const info of targetInfos)if(info.browserContextId===state.contextId&&website(info))await channel.send('Target.closeTarget',{targetId:info.targetId});
}
async function installSharedWorkerEnvironment(wc,{source,applyNative,nativeKey}){
 // Alternative test entrypoints must explicitly prepare before app.ready.
 // Keep their existing page/worker behavior when they do not exercise this path.
 if(!ready)return;
 await ready;
 const {targetInfo}=await require('./environment-contexts.cjs').targetCommand(wc,'Target.getTargetInfo',{});
 const contextId=targetInfo?.browserContextId;if(!contextId)throw Error('不能确认 SharedWorker 所属实例分区');
 let state=sessions.get(wc.session);
 if(state){await state.retiring;if(state.contextId!==contextId)throw Error('实例浏览分区标识发生变化');}
 else{state={contextId,source:null,nativeKey:null,owners:new Set(),pending:new Set(),errors:[],retiring:Promise.resolve()};sessions.set(wc.session,state);}
 if(!state.owners.size||state.source!==source||state.nativeKey!==nativeKey){await closeWorkers(state);state.source=source;state.nativeKey=nativeKey;state.applyNative=applyNative;}
 contexts.set(contextId,state);
 if(!state.owners.has(wc)){
  state.owners.add(wc);
  wc.once('destroyed',()=>{state.owners.delete(wc);if(state.owners.size)return;contexts.delete(contextId);state.retiring=closeWorkers(state).catch(error=>report(state,error));});
 }
 return state;
}
function sharedWorkerEnvironmentState(wc){return sessions.get(wc.session);}
function sharedWorkerEnvironmentSnapshot(){const channel=browserChannel();return {mode:channel.mode,contexts:contexts.size,targets:targets.size,pending:[...contexts.values()].reduce((n,x)=>n+x.pending.size,0),errors:[...contexts.values()].flatMap(x=>x.errors)};}
module.exports={prepareSharedWorkerEnvironment,installSharedWorkerEnvironment,sharedWorkerEnvironmentState,sharedWorkerEnvironmentSnapshot};
