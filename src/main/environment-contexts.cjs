'use strict';

// Attach only to descendants of this webContents. Browser-wide discovery would
// mix instance sessions and extension workers, so it must never be used here.
const states=new WeakMap();
const filters=[
 {type:'iframe',exclude:false},
 {type:'worker',exclude:false},
 {exclude:true},
];

function targetCommand(wc,method,params,sessionId){
 const command=wc.debugger.sendCommand(method,params,sessionId);
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('环境命令超时：'+method)),5000);timer.unref?.();
  command.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
 });
}

async function installContextEnvironment(wc,{source,applyNative}){
 if(states.has(wc))throw Error('实例环境已安装，不能重复注册目标监听');
 const debug=wc.debugger,children=new Map(),pending=new Set(),errors=[];
 let disposed=false;
 const send=(method,params,sessionId)=>targetCommand(wc,method,params,sessionId);
 const autoAttach={autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:filters};
 const report=error=>{
  if(disposed||wc.isDestroyed())return;
  const message='子页面/Worker 环境应用失败：'+String(error?.message||error);
  errors.push(message);
  wc.emit('facet-environment-error',new Error(message));
 };
 async function configure(params){
  const {sessionId,targetInfo}=params;
  children.set(sessionId,targetInfo.type);
  try{
   // Every descendant recursively attaches its own children before it resumes.
   await send('Target.setAutoAttach',autoAttach,sessionId);
   await applyNative(sessionId,targetInfo.type);
   if(targetInfo.type==='iframe'){
    await send('Page.enable',{},sessionId);
    if(source)await send('Page.addScriptToEvaluateOnNewDocument',{source,runImmediately:true},sessionId);
   }else if(source){
    await send('Runtime.enable',{},sessionId);
    const result=await send('Runtime.evaluate',{expression:source},sessionId);
    if(result.exceptionDetails)throw Error('Worker 指纹脚本未能执行');
   }
  }catch(error){
   if(children.has(sessionId))report(error);
  }finally{
   // Never leave a failed/closing target paused indefinitely.
   try{await send('Runtime.runIfWaitingForDebugger',{},sessionId);}catch(error){
    if(children.has(sessionId))report(error);
   }
  }
 }
 function onMessage(_event,method,params){
  if(disposed)return;
  if(method==='Target.attachedToTarget'){
   const job=configure(params);pending.add(job);job.finally(()=>pending.delete(job)).catch(report);
  }else if(method==='Target.detachedFromTarget')children.delete(params.sessionId);
 }
 function dispose(){
  if(disposed)return;
  disposed=true;debug.removeListener('message',onMessage);
  debug.removeListener('detach',dispose);wc.removeListener('destroyed',dispose);
  children.clear();states.delete(wc);
 }
 const state={children,pending,errors,dispose};
 states.set(wc,state);debug.on('message',onMessage);debug.once('detach',dispose);wc.once('destroyed',dispose);
 try{await send('Target.setAutoAttach',autoAttach);}catch(error){dispose();throw error;}
 return state;
}

function contextEnvironmentState(wc){return states.get(wc);}
module.exports={installContextEnvironment,contextEnvironmentState,targetCommand};
