'use strict';
const crypto=require('node:crypto'),path=require('node:path');
const {environment,atomic}=require('./store.cjs'),{preset}=require('./fingerprint.cjs');
const {createInstance}=require('./operations.cjs'),{redact}=require('./workspace.cjs');
function options(controller){
 const live=[...controller.diagnostics.results.values()],history=controller.diagnostics.history.list();
 return controller.library.summaries().flatMap(source=>source.nodes.filter(n=>!n.hint).map(node=>{
  const saved=history.find(h=>h.sourceId===source.id&&h.name===node.name);
  const results=['latency','ip','speed'].map(kind=>live.find(r=>r.sourceId===source.id&&r.name===node.name&&r.kind===kind)||saved?.[kind]?.last).filter(r=>r&&r.at>=source.updatedAt).sort((a,b)=>String(b.at).localeCompare(String(a.at)));
  const latest=results[0],ip=live.find(r=>r.sourceId===source.id&&r.name===node.name&&r.kind==='ip')||saved?.ip?.last;
  return {sourceId:source.id,sourceName:source.name,name:node.name,available:latest?.ok===true,tested:!!latest,at:latest?.at||null,ip:ip?.ok&&ip.at>=source.updatedAt?ip.ip:'',country:ip?.ok?ip.country||'':''};
 }));
}
function prepare(controller,message){
 if(controller.batchCreation?.running)throw Error('已有批量创建任务，请稍候');
 const count=Number(message.count),prefix=String(message.prefix||'').trim();
 if(!Number.isSafeInteger(count)||count<1)throw Error('创建数量必须是正整数');
 if(!prefix||prefix.length>30)throw Error('名称前缀需要 1–30 个字符');
 if(!['direct','mihomo'].includes(message.mode))throw Error('请选择连接方式');
 if(!['cycle','unique'].includes(message.allocation))throw Error('请选择节点分配方式');
 const nodes=message.mode==='mihomo'?(Array.isArray(message.nodes)?message.nodes:[]):[];
 if(message.mode==='mihomo'&&!nodes.length)throw Error('请至少选择一个代理节点');
 const keys=new Set(),sources=nodes.map(x=>{
  const key=JSON.stringify([x?.sourceId,x?.name]);if(keys.has(key))throw Error('不能重复选择同一节点');keys.add(key);
  const source=controller.library.get(x.sourceId);controller.library.node(x.sourceId,x.name);
  return {sourceId:source.id,nodeName:x.name,sourceVersion:source.updatedAt};
 });
 if(message.mode==='mihomo'&&message.allocation==='unique'&&count>sources.length)throw Error('独占节点模式下，创建数量不能超过所选节点数；可减少数量或选择循环分配');
 const used=new Set(controller.store.list().map(x=>x.name)),base=environment(message.environment||{}),items=[];
 let sequence=1,bytes=0;
 for(let i=0;i<count;i++){
  let name;do{name=prefix+' '+sequence++;}while(used.has(name));if(name.length>40)throw Error('实例名称过长，请缩短前缀');used.add(name);
  const node=sources.length?sources[i%sources.length]:null;
  const item={name,...node,environment:message.random===true?environment(preset('library-v1',base)):base};
  bytes+=Buffer.byteLength(JSON.stringify(item));if(bytes>2*1024*1024)throw Error('单批环境草稿超过 2MB，请减少本次数量后分批创建；实例总数不限');items.push(item);
 }
 const plan={token:crypto.randomUUID(),items,start:message.start===true,random:message.random===true,syncLocale:message.syncLocale===true};
 controller.instanceBatchPlan=plan;return plan;
}
async function execute(controller,token){
 const plan=controller.instanceBatchPlan;if(!plan||plan.token!==token)throw Error('创建草稿已失效，请重新生成');
 if(controller.disposing)throw Error('应用正在退出');
 // Validate every name and node before writing the first instance.
 for(const item of plan.items){controller.store.name(item.name);if(item.sourceId){const source=controller.library.get(item.sourceId);if(source.updatedAt!==item.sourceVersion)throw Error('所选节点源已经更新，请重新生成草稿');controller.library.node(item.sourceId,item.nodeName);}}
 controller.instanceBatchPlan=null;
 const job={id:crypto.randomUUID(),running:true,cancelling:false,total:plan.items.length,done:0,created:0,failed:0,results:[]};controller.batchCreation=job;controller.emit();
 const file=path.join(controller.dir,'instance-create-batches',job.id+'.json');
 const save=()=>atomic(file,{...job,updatedAt:new Date().toISOString()});
 try{
  save();for(const item of plan.items){
   if(job.cancelling||controller.disposing)break;
   try{if(item.localeError)throw Error('此草稿出口地区查询失败，未创建；请重新生成草稿重试。'+item.localeError);if(item.sourceId&&controller.library.get(item.sourceId).updatedAt!==item.sourceVersion)throw Error('节点源已更新，未创建此实例；请重新生成草稿');const value=await createInstance(controller,{...item,start:plan.start,syncTimezone:false,syncLocale:plan.syncLocale});job.created+=Number(value.created);const error=[value.configurationError,value.startError].filter(Boolean).join('；');if(error)job.failed++;job.results.push({name:item.name,...value,status:error?'warning':'success'});}
   catch(error){job.failed++;job.results.push({name:item.name,created:false,status:'failed',error:redact(error.message)});}
   job.done++;save();controller.emit();await new Promise(resolve=>setImmediate(resolve));
  }
 }finally{job.running=false;job.cancelled=job.done<job.total;save();controller.emit();}
 controller.workspace.log('application',`批量创建：已创建 ${job.created} 个，处理 ${job.done}/${job.total}，异常 ${job.failed} 个${job.cancelled?'，已停止继续创建':''}`);
 return {...job};
}
function cancel(controller){if(controller.batchCreation?.running){controller.batchCreation.cancelling=true;controller.emit();}return {requested:controller.batchCreation?.running===true};}
async function prepareLocale(controller,message){
 if(controller.instanceBatchPlanning)throw Error('正在查询出口地区，请稍候');
 const plan=prepare(controller,message);if(!plan.syncLocale)return plan;
 controller.instanceBatchPlan=null;controller.instanceBatchPlanning=true;
 try{
  const locales=new Map();
  for(const item of plan.items){
   if(controller.disposing)throw Error('应用正在退出，未创建实例');
   const key=JSON.stringify([item.sourceId||null,item.nodeName||null]);
   if(!locales.has(key)){
    try{locales.set(key,{value:await require('./exit-locale.cjs').lookup(controller,item.sourceId?controller.library.node(item.sourceId,item.nodeName):null)});}
    catch(error){if(controller.disposing)throw error;locales.set(key,{error:redact(error.message)});}
   }
   if(item.sourceId&&controller.library.get(item.sourceId).updatedAt!==item.sourceVersion)throw Error('节点源已更新，请重新生成草稿');
   const locale=locales.get(key);
   if(locale.error){item.localeError=locale.error;continue;}
   item.exitLocale=locale.value;item.environment=environment({...item.environment,timezone:item.exitLocale.timezone,language:item.exitLocale.language});
  }
  if(plan.items.every(item=>item.localeError))throw Error('所有所选出口地区查询失败，未生成可创建草稿：'+[...locales.values()].map(item=>item.error).filter(Boolean).join('；'));
  controller.instanceBatchPlan=plan;return plan;
 }finally{controller.instanceBatchPlanning=false;}
}
module.exports={options,prepare,prepareLocale,execute,cancel};
