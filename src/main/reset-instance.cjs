'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {atomic,environment,DEFAULT_INSTANCE_URL}=require('./store.cjs');
const journal=require('./deletion-journal.cjs');
async function replace(c,id){
 const old=c.store.get(id),source={version:1,...c.store.source(id)};
 const node=old.network.mode==='mihomo'?source.nodes?.find(x=>x.name===old.network.nodeName):null;
 if(old.network.mode==='mihomo'&&!node)throw Error('重置失败：当前代理节点不存在，旧环境及数据保留');
 let locale;try{locale=await require('./exit-locale.cjs').lookup(c,node,{force:true});}catch{throw Error('重置失败：无法查询当前出口的国家和时区，旧环境及数据保留，请检查节点后重试');}
 if(c.disposing)throw Error('应用正在退出，未重置环境');
 if(JSON.stringify(c.store.get(id))!==JSON.stringify(old)||JSON.stringify({version:1,...c.store.source(id)})!==JSON.stringify(source))throw Error('实例配置已变化，未重置，请重试');
 await c.stopInner(id);
 const generated=require('./fingerprint.cjs').preset('library-v1',environment({language:locale.language,timezone:locale.timezone}));generated.fingerprint.hardware=true;
 const next={id:crypto.randomUUID(),name:old.name,network:{...old.network},environment:environment(generated),url:DEFAULT_INSTANCE_URL,notes:'',autoStart:false};
 const target=path.join(c.dir,'proxy-sources',next.id+'.json');
 const catalog=c.extensions.catalog,enabled=[...catalog.enabled(id)];
 // Persist the new binding before replacing identity; never copy extension storage.
 try{catalog.commit({...catalog.data,enabled:{...catalog.data.enabled,[next.id]:enabled}});}catch(error){
  try{catalog.forget(next.id);}catch{}
  throw Error('扩展启用关系保存失败，旧实例及数据保留');
 }
 try{
  atomic(target,source,{backup:false});
  if(JSON.stringify(JSON.parse(fs.readFileSync(target,'utf8')))!==JSON.stringify(source))throw Error('代理副本校验失败');
  journal.begin(c.dir,id);
  c.store.commit({...c.store.data,instances:c.store.list().map(x=>x.id===id?next:x)});
 }catch(error){
  if(!error.atomicWriteCommitted){fs.rmSync(target,{force:true});journal.finish(c.dir,id);catalog.forget(next.id);throw Error('新实例创建失败，旧实例及数据保留：'+error.message);}
  // Atomic rename succeeded; never roll back to a potentially deleted identity.
 }
 let cleanupWarning='';try{await c.removeInner(id,{metadataRemoved:true});}catch(e){cleanupWarning=e.message;}
 c.log(next.id,'环境已重建：使用全新实例 ID，保留名称、代理与扩展启用列表，语言时区已按出口同步'+(cleanupWarning?'；旧数据清理待重试':''),cleanupWarning?'WARN':'INFO');
 c.emit();return {id:next.id,oldId:id,exitLocale:locale,environment:next.environment,network:next.network,cleanupPending:!!cleanupWarning,cleanupWarning};
}
module.exports={replace};
