'use strict';
// Shared by the private environment clients and the public CDP gateway. A
// client's runIfWaitingForDebugger must not release another client's setup.
const targets=new Map();
function record(id){let entry=targets.get(id);if(!entry){let resolve;const promise=new Promise(r=>{resolve=r;});entry={promise,resolve,started:false,pending:0};targets.set(id,entry);}return entry;}
function beginTarget(id){let entry=record(id);if(entry.started&&!entry.pending){targets.delete(id);entry=record(id);}entry.started=true;entry.pending++;let finished=false;return ()=>{if(finished)return;finished=true;if(--entry.pending===0)entry.resolve();};}
async function waitForTarget(id){const entry=record(id);let timer;try{await Promise.race([entry.promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('等待网页/Worker 环境初始化超时')),15000);timer.unref?.();})]);}finally{clearTimeout(timer);if(!entry.started&&targets.get(id)===entry)targets.delete(id);}}
function forgetTarget(id){const entry=targets.get(id);if(entry)entry.resolve();targets.delete(id);}
module.exports={beginTarget,waitForTarget,forgetTarget};
