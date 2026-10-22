'use strict';
const crypto=require('node:crypto'),path=require('node:path');
const {environment,atomic}=require('./store.cjs'),{preset}=require('./fingerprint.cjs');
const {createInstance}=require('./operations.cjs'),{redact}=require('./workspace.cjs');
const {selectionOptions,assignmentUsage}=require('./node-evidence.cjs'),{nodeKey}=require('./node-port-registry.cjs');
function options(controller){
 const live=[...controller.diagnostics.results.values()],history=controller.diagnostics.history.list();
 return selectionOptions(controller).map(row=>{
  const source=controller.library.get(row.sourceId),saved=history.find(h=>h.sourceId===row.sourceId&&h.name===row.name);
  const ip=[live.find(r=>r.sourceId===row.sourceId&&r.name===row.name&&r.kind==='ip'),saved?.ip?.last].filter(r=>r&&Number.isFinite(Date.parse(r.at))&&r.at>=source.updatedAt&&r.error!=='已取消').sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];
  return {...row,at:row.checkedAt,ip:ip?.ok?ip.ip:'',country:ip?.ok?ip.country||'':''};
 });
}
function prepare(controller,message){
 if(controller.batchCreation?.running)throw Error('已有批量创建任务，请稍候');
 const count=Number(message.count),prefix=String(message.prefix||'').trim();
 if(!Number.isSafeInteger(count)||count<1)throw Error('创建数量必须是正整数');
 if(!prefix||prefix.length>30)throw Error('名称前缀需要 1–30 个字符');
 if(!['direct','mihomo'].includes(message.mode))throw Error('请选择连接方式');
 if(!['cycle','unique'].includes(message.allocation))throw Error('请选择节点分配方式');
 const exclusive=message.mode==='mihomo'&&message.allocation==='unique',choices=exclusive?options(controller):[];
 const requested=message.mode==='mihomo'?(Array.isArray(message.nodes)?message.nodes:[]):[];
 const nodes=exclusive&&!requested.length?choices.filter(row=>row.available&&!row.usage):requested;
 if(message.mode==='mihomo'&&!nodes.length)throw Error(exclusive?'没有未分配的可用节点，请先检测节点或释放已有实例的节点分配':'请至少选择一个代理节点');
 const eligible=new Set(choices.filter(row=>row.available&&!row.usage).map(row=>JSON.stringify([row.sourceId,row.name]))),configurations=new Set();
 const keys=new Set();let sources=nodes.map(x=>{
  const key=JSON.stringify([x?.sourceId,x?.name]);if(keys.has(key))throw Error('不能重复选择同一节点');keys.add(key);
  const source=controller.library.get(x.sourceId),node=controller.library.node(x.sourceId,x.name);
  if(exclusive){const identity=nodeKey(node);if(!eligible.has(key)||configurations.has(identity))return null;configurations.add(identity);}
  return {sourceId:source.id,nodeName:x.name,sourceVersion:source.updatedAt};
 }).filter(Boolean);
 if(exclusive&&count>sources.length)throw Error(`未分配的可用节点不足：需要 ${count} 个，当前范围内仅 ${sources.length} 个（已排除已分配、检测不可用和重复配置）；请减少数量或补充节点，不会自动复用`);
 if(exclusive)for(let i=sources.length-1;i>0;i--){const j=crypto.randomInt(i+1);[sources[i],sources[j]]=[sources[j],sources[i]];}
 const used=new Set(controller.store.list().map(x=>x.name)),base=environment(message.environment||{}),items=[];
 let sequence=1,bytes=0;
 for(let i=0;i<count;i++){
  let name;do{name=prefix+' '+sequence++;}while(used.has(name));if(name.length>40)throw Error('实例名称过长，请缩短前缀');used.add(name);
  const node=sources.length?sources[i%sources.length]:null;
  const item={name,...node,environment:message.random===true?environment(preset('library-v1',base)):base};
  bytes+=Buffer.byteLength(JSON.stringify(item));if(bytes>2*1024*1024)throw Error('单批环境草稿超过 2MB，请减少本次数量后分批创建；实例总数不限');items.push(item);
 }
 const plan={token:crypto.randomUUID(),items,allocation:message.allocation,start:message.start===true,random:message.random===true,syncLocale:message.syncLocale===true};
 controller.instanceBatchPlan=plan;return plan;
}
async function execute(controller,token){
 const plan=controller.instanceBatchPlan;if(!plan||plan.token!==token)throw Error('创建草稿已失效，请重新生成');
 if(controller.disposing)throw Error('应用正在退出');
 // Validate every name and node before writing the first instance.
 const exclusive=plan.allocation==='unique',eligible=new Set(exclusive?selectionOptions(controller).filter(row=>row.available&&!row.usage).map(row=>JSON.stringify([row.sourceId,row.name])):[]),reserved=new Set();
 for(const item of plan.items){controller.store.name(item.name);if(item.sourceId){const source=controller.library.get(item.sourceId);if(source.updatedAt!==item.sourceVersion)throw Error('所选节点源已经更新，请重新生成草稿');const key=nodeKey(controller.library.node(item.sourceId,item.nodeName));if(exclusive){if(!eligible.has(JSON.stringify([item.sourceId,item.nodeName]))||reserved.has(key))throw Error('草稿节点已被分配、检测不可用或配置重复，请重新生成草稿；未创建实例');reserved.add(key);}}}
 controller.instanceBatchPlan=null;
 const job={id:crypto.randomUUID(),running:true,cancelling:false,total:plan.items.length,done:0,created:0,failed:0,results:[]};controller.batchCreation=job;controller.emit();
 const file=path.join(controller.dir,'instance-create-batches',job.id+'.json');
 const save=()=>atomic(file,{...job,updatedAt:new Date().toISOString()});
 try{
  save();for(const item of plan.items){
   if(job.cancelling||controller.disposing)break;
   try{if(item.localeError)throw Error('此草稿出口地区查询失败，未创建；请重新生成草稿重试。'+item.localeError);if(item.sourceId&&controller.library.get(item.sourceId).updatedAt!==item.sourceVersion)throw Error('节点源已更新，未创建此实例；请重新生成草稿');if(exclusive&&item.sourceId&&assignmentUsage(controller).has(nodeKey(controller.library.node(item.sourceId,item.nodeName))))throw Error('节点已被其他实例分配，未创建；请重新生成草稿');const value=await createInstance(controller,{...item,start:plan.start,syncTimezone:false,syncLocale:plan.syncLocale,requireUnusedNode:exclusive});job.created+=Number(value.created);const error=[value.configurationError,value.startError].filter(Boolean).join('；');if(error)job.failed++;job.results.push({name:item.name,...value,status:error?'warning':'success'});}
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
