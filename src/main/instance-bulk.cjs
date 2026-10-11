'use strict';
const crypto=require('node:crypto'),path=require('node:path');
const {atomic}=require('./store.cjs'),{redact}=require('./workspace.cjs');
function plan(controller,ids){
 if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw Error('请选择有效且不重复的实例');
 return ids.map(id=>({id,name:controller.store.get(id).name,status:'queued',error:''}));
}
async function removeMany(controller,ids){
 if(controller.disposing)throw Error('应用正在退出，未删除实例');
 const items=plan(controller,ids),job={id:crypto.randomUUID(),running:true,total:items.length,done:0,removed:0,failed:0,cleanupPending:0,items};
 const file=path.join(controller.dir,'instance-delete-batches',job.id+'.json');
 const save=()=>atomic(file,{...job,updatedAt:new Date().toISOString()});
 // Persist the complete, validated scope before the first destructive operation.
 save();controller.batchDeletion=job;controller.emit();
 try{
  for(const item of items){
   if(controller.disposing)break;
   item.status='running';save();controller.emit();
   try{await controller.remove(item.id);item.status='removed';job.removed++;}
   catch(error){item.error=redact(error.message);if(controller.store.list().some(x=>x.id===item.id)){item.status='failed';job.failed++;}else{item.status='cleanup-pending';job.removed++;job.cleanupPending++;}}
   job.done++;save();controller.emit();await new Promise(resolve=>setImmediate(resolve));
  }
 }finally{job.running=false;job.cancelled=job.done<job.total;save();controller.emit();}
 controller.workspace.log('application',`批量删除：已删除 ${job.removed}/${job.total} 个，失败 ${job.failed} 个，清理待重试 ${job.cleanupPending} 个${job.cancelled?'；剩余实例未删除':''}`,job.failed||job.cleanupPending||job.cancelled?'WARN':'INFO');
 return job;
}
async function resetMany(controller,ids){
 if(controller.disposing)throw Error('应用正在退出，未重置实例');
 const items=plan(controller,ids),job={id:crypto.randomUUID(),running:true,total:items.length,done:0,reset:0,failed:0,items};
 controller.batchReset=job;controller.emit();
 try{
  for(const item of items){
   if(controller.disposing)break;
   item.status='running';controller.emit();
   try{await controller.resetEnvironment(item.id);item.status='reset';job.reset++;}
   catch(error){item.status='failed';item.error=redact(error.message);job.failed++;}
   job.done++;controller.emit();await new Promise(resolve=>setImmediate(resolve));
  }
 }finally{job.running=false;job.cancelled=job.done<job.total;controller.emit();}
 controller.workspace.log('application',`批量重置环境：已完成 ${job.reset}/${job.total} 个，失败 ${job.failed} 个${job.cancelled?'；剩余实例未执行':''}`,job.failed||job.cancelled?'WARN':'INFO');
 return job;
}
module.exports={plan,removeMany,resetMany};
