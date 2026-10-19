'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {atomic,environment,DEFAULT_INSTANCE_URL}=require('./store.cjs');
const journal=require('./deletion-journal.cjs');
async function replace(c,id){
 const old=c.store.get(id),source={version:1,...c.store.source(id)};await c.stopInner(id);
 const generated=require('./fingerprint.cjs').preset('library-v1',environment());generated.fingerprint.hardware=true;
 const next={id:crypto.randomUUID(),name:old.name,network:{...old.network},environment:environment(generated),url:DEFAULT_INSTANCE_URL,notes:'',autoStart:false};
 const target=path.join(c.dir,'proxy-sources',next.id+'.json');
 try{
  atomic(target,source,{backup:false});
  if(JSON.stringify(JSON.parse(fs.readFileSync(target,'utf8')))!==JSON.stringify(source))throw Error('代理副本校验失败');
  journal.begin(c.dir,id);
  c.store.commit({...c.store.data,instances:c.store.list().map(x=>x.id===id?next:x)});
 }catch(error){
  if(!error.atomicWriteCommitted){fs.rmSync(target,{force:true});journal.finish(c.dir,id);throw Error('新实例创建失败，旧实例及数据保留：'+error.message);}
  // Atomic rename succeeded; never roll back to a potentially deleted identity.
 }
 let cleanupWarning='';try{await c.removeInner(id,{metadataRemoved:true});}catch(e){cleanupWarning=e.message;}
 c.log(next.id,'环境已重建：使用全新实例 ID，仅保留名称与代理'+(cleanupWarning?'；旧数据清理待重试':''),cleanupWarning?'WARN':'INFO');
 c.emit();return {id:next.id,oldId:id,environment:next.environment,network:next.network,cleanupPending:!!cleanupWarning,cleanupWarning};
}
module.exports={replace};
