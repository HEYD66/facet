'use strict';
const crypto=require('node:crypto');
const {environment}=require('./environment.cjs');
const {preset}=require('./fingerprint.cjs');
const {fromProbe}=require('./exit-locale.cjs');
const {createInstance}=require('./operations.cjs');

function probe(c,node,kind,signal,slot,fallback,options){
 const abort=new AbortController(),task={abort,promise:null};
 task.promise=c.diagnostics.probe(node,kind,AbortSignal.any([signal,abort.signal]),slot,fallback,options).finally(()=>c.diagnostics.standalone.delete(task));
 c.diagnostics.standalone.add(task);return task.promise;
}

// Used only by the AI random-create contract. Manual/native creation keeps its existing semantics.
async function createRandom(agent,params){
 const c=agent.c,signal=agent.run.abort.signal;
 c.store.name(params.name);
 if(params.start!==undefined&&typeof params.start!=='boolean')throw Error('start 必须为布尔值');
 if(params.environment||params.nodeName||params.syncLocale===false||params.regionMode)throw Error('随机实例由宿主生成环境并按实测出口同步地区，请勿传入自定义环境、指定节点或关闭地区同步');
 if(params.sourceId)c.library.get(params.sourceId);
 const candidates=c.library.summaries().filter(s=>!params.sourceId||s.id===params.sourceId).flatMap(s=>s.nodes.filter(n=>!n.hint).map(n=>({sourceId:s.id,name:n.name})));
 if(!candidates.length)throw Error('没有可随机分配的代理节点，请先导入节点；未创建实例，不会回退直连');
 // Shuffle without replacement; cached success is never treated as a fresh connectivity check.
 for(let i=candidates.length-1;i>0;i--){const j=crypto.randomInt(i+1);[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
 return c.queue('instance-create',async()=>{
  let attempted=0,lastReason='';
  for(const candidate of candidates.slice(0,5)){
   signal.throwIfAborted();if(c.disposing)throw Error('应用正在退出，未创建实例');
   attempted++;
   let node,version,latency,locale;
   try{
    version=c.library.get(candidate.sourceId).updatedAt;node=structuredClone(c.library.node(candidate.sourceId,candidate.name));
    agent.run.status='正在检测随机节点（'+attempted+'/'+Math.min(5,candidates.length)+'）';
    const slot='ai-create-'+crypto.randomUUID(),options={force:true,requireLocale:true,context:{sourceId:candidate.sourceId,nodeName:candidate.name}};
    try{latency=await probe(c,node,'latency',signal,slot,false,options);}catch(e){signal.throwIfAborted();latency=await probe(c,node,'latency',signal,slot,true,options);}
    signal.throwIfAborted();
    locale=fromProbe(await probe(c,node,'ip',signal,slot,false,options));
    signal.throwIfAborted();
    if(c.library.get(candidate.sourceId).updatedAt!==version||JSON.stringify(c.library.node(candidate.sourceId,candidate.name))!==JSON.stringify(node))throw Error('节点源已变化');
   }catch(e){signal.throwIfAborted();lastReason=e.safeDiagnostic?'节点检测未通过':e.message==='节点源已变化'?'节点源已变化':'未取得可用链路及完整出口地区';continue;}
   if(c.disposing)throw Error('应用正在退出，未创建实例');
   const checkedAt=new Date().toISOString();
   for(const [kind,value]of [['latency',latency],['ip',locale]]){
    const result={...value,kind,ok:true,sourceId:candidate.sourceId,name:candidate.name,at:checkedAt};
    const key=JSON.stringify([candidate.sourceId,candidate.name,kind]);c.diagnostics.results.delete(key);c.diagnostics.results.set(key,result);c.diagnostics.history.record(result);
    if(c.diagnostics.results.size>500)c.diagnostics.results.delete(c.diagnostics.results.keys().next().value);
   }
   const planned=environment(preset('library-v1',{language:locale.language,timezone:locale.timezone}));
   agent.run.status='正在创建随机实例';
   const result=await createInstance(c,{name:params.name,sourceId:candidate.sourceId,nodeName:candidate.name,environment:planned,start:params.start===true,background:true});
   // A partially created instance is returned once for inspection, never retried/duplicated.
   const stored=c.store.get(result.id);
   return {...result,randomized:true,exitLocale:locale,connectivity:{ok:true,latencyMs:latency.latencyMs,checkedAt,attempted},assignment:{sourceId:candidate.sourceId,nodeName:candidate.name},environment:{language:stored.environment.language,timezone:stored.environment.timezone,fingerprintEnabled:stored.environment.fingerprint.enabled,seed:stored.environment.fingerprint.seed},verified:!result.configurationError&&!result.startError&&stored.network.mode==='mihomo'&&stored.environment.language===locale.language&&stored.environment.timezone===locale.timezone};
  }
  throw Error('已尝试 '+attempted+' 个随机节点，均未通过连通性和出口地区验证；'+lastReason+'。未创建实例，不会回退直连。');
 });
}
module.exports={createRandom};
