'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os'),net=require('node:net');
const {app,session,BrowserWindow,safeStorage}=require('electron');
const archive=require('./instance-archive.cjs'),{environment,safeURL,atomic,notes}=require('./store.cjs');
const JOB='instance-export.pending',REPORT='instance-export-result.json';
function writePending(dir,job){
 const destination=path.join(dir,JOB),temp=destination+'.'+crypto.randomUUID()+'.tmp';
 try{fs.writeFileSync(temp,safeStorage.encryptString(JSON.stringify(job)),{flag:'wx',mode:0o600});const fd=fs.openSync(temp,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,destination);}finally{fs.rmSync(temp,{force:true});}
}
async function backupDigest(file){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function verifyExport(job){
 const root=path.join(os.tmpdir(),'facet-export-check-'+crypto.randomUUID());
 try{const checked=await archive.readArchive(job.destination,root);validateMetadata(checked.metadata);if(!require('node:util').isDeepStrictEqual(checked.metadata,job.metadata))throw Error('备份实例信息不一致');const digest=await backupDigest(job.destination);if(job.verifiedDigest&&digest!==job.verifiedDigest)throw Error('备份已变化，原实例保留');return digest;}
 finally{fs.rmSync(root,{recursive:true,force:true});}
}
function profile(dir,id){if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id))throw Error('实例 ID 无效');return path.join(dir,'Partitions','arena-core-'+id);}
async function withCookies(ses,callback){
 const window=new BrowserWindow({show:false,webPreferences:{session:ses,sandbox:true,contextIsolation:true,nodeIntegration:false}});
 try{await window.loadURL('about:blank');window.webContents.debugger.attach('1.3');return await callback(window.webContents.debugger);}
 finally{const wc=window.webContents;if(!wc.isDestroyed()){await new Promise(resolve=>{wc.once('destroyed',resolve);window.destroy();});}}
}
function cookieDetails(cookie){
 if(!cookie||typeof cookie.name!=='string'||typeof cookie.value!=='string'||typeof cookie.domain!=='string'||cookie.domain.length>253||!cookie.domain||/[\s/:\\@]/.test(cookie.domain)||typeof cookie.path!=='string'||!cookie.path.startsWith('/'))throw Error('备份 Cookie 格式无效');
 const host=cookie.domain.replace(/^\./,''),url=(cookie.secure?'https://':'http://')+(net.isIP(host)===6?'['+host+']':host)+cookie.path;
 const out={url,name:cookie.name,value:cookie.value,path:cookie.path,secure:cookie.secure===true,httpOnly:cookie.httpOnly===true};
 if(cookie.domain.startsWith('.'))out.domain=cookie.domain;
 if(cookie.expires>0)out.expires=cookie.expires;
 if(cookie.sameSite!==undefined){if(!['Strict','Lax','None'].includes(cookie.sameSite))throw Error('备份 Cookie SameSite 无效');out.sameSite=cookie.sameSite;}
 if(cookie.priority!==undefined){if(!['Low','Medium','High'].includes(cookie.priority))throw Error('备份 Cookie 优先级无效');out.priority=cookie.priority;}
 if(cookie.partitionKey){const site=cookie.partitionKey.topLevelSite;const u=new URL(site);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||typeof cookie.partitionKey.hasCrossSiteAncestor!=='boolean')throw Error('备份分区 Cookie 无效');out.partitionKey={topLevelSite:u.origin,hasCrossSiteAncestor:cookie.partitionKey.hasCrossSiteAncestor};}
 if(cookie.partitionKeyOpaque)throw Error('不支持不透明分区 Cookie，未生成不完整备份');
 return out;
}
function validateMetadata(raw){
 if(raw?.format!=='facet-instance-backup'||raw.version!==1||raw.platform!==process.platform||!Array.isArray(raw.instances)||!raw.instances.length||raw.instances.length>1000)throw Error('备份格式或系统平台不兼容');
 if(raw.electron!==process.versions.electron)throw Error('浏览器数据版本不一致，请在两台设备安装相同版本的千面后导入');
 const ids=new Set();return {...raw,instances:raw.instances.map(row=>{
  if(!row||typeof row.name!=='string'||!row.name.trim()||row.name.length>40||!Array.isArray(row.cookies)||row.cookies.length>200000||ids.has(row.id))throw Error('备份实例信息无效');profile('',row.id);ids.add(row.id);
  row.cookies.forEach(cookieDetails);
  const previousExit=row.previousExit||{};
  return {id:row.id,name:row.name,url:safeURL(row.url),...(row.browserTabs?{browserTabs:require('./browser-tabs-state.cjs').normalize(row.browserTabs)}:{}),environment:environment(row.environment),notes:notes(row.notes||''),muted:row.muted===true,volume:Number.isInteger(row.volume)&&row.volume>=0&&row.volume<=100?row.volume:100,cookies:row.cookies,previousExit:{country:String(previousExit.country||'').slice(0,120),countryCode:/^[A-Z]{2}$/.test(previousExit.countryCode)?previousExit.countryCode:'',ip:net.isIP(previousExit.ip)?previousExit.ip:'',queriedAt:String(previousExit.queriedAt||'').slice(0,40)}};
 })};
}
function previousExit(c,id){
 const x=c.store.get(id);if(x.network.mode!=='mihomo')return {};
 const node=c.store.nodes(id).find(n=>n.name===x.network.nodeName);if(!node)return {};
 const own=require('./instance-node.cjs').nodeDiagnosticKey(id,node),source=c.store.source(id),assignment=source.assignment;
 const keys=[own];if(assignment&&c.assignment(id).status==='配置已同步')keys.push(assignment.sourceId);
 const rows=[...c.diagnostics.results.values(),...c.diagnostics.history.list().filter(r=>keys.includes(r.sourceId)&&r.name===node.name).map(r=>r.ip?.last).filter(Boolean)];
 const hit=rows.filter(r=>r.kind==='ip'&&keys.includes(r.sourceId)&&r.name===node.name||!r.kind).filter(r=>r.ok).sort((a,b)=>String(b.queriedAt||b.at).localeCompare(String(a.queriedAt||a.at)))[0];
 return hit?{country:hit.country||'',countryCode:hit.countryCode||'',ip:hit.ip||'',queriedAt:hit.queriedAt||hit.at||''}:{};
}
async function finalizePending(dir){
 const file=path.join(dir,JOB);if(!fs.existsSync(file))return null;
 let job;const outcome={status:'failed',at:new Date().toISOString(),message:'实例备份未完成，原实例保留'};
 try{
  job=JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));validateMetadata(job.metadata);
  let result;
  if(job.phase==='exported'){
   if(!/^[a-f0-9]{64}$/.test(job.verifiedDigest||''))throw Error('缺少备份验证记录');
   await verifyExport(job);result=job.exportResult;
  }else{
   result=await archive.writeArchive(job.destination,job.metadata,job.metadata.instances.map(row=>profile(dir,row.id)));
   if(job.deleteAfterExport===true){job.verifiedDigest=await verifyExport(job);job.phase='exported';job.exportResult=result;writePending(dir,job);}
  }
  Object.assign(outcome,{status:'success',message:'实例备份已导出',destination:job.destination,count:job.metadata.instances.length,...result});
  if(job.deleteAfterExport===true){
   try{outcome.deletion=require('./instance-export-cleanup.cjs').deleteExportedInstances(dir,job.metadata.instances,job.originalRows);const d=outcome.deletion;outcome.message=`备份已导出并校验，已删除 ${d.deleted}/${job.metadata.instances.length} 个原实例`+(d.deleteFailed?`；${d.deleteFailed} 个原实例保留`:'')+(d.cleanupPending?`；${d.cleanupPending} 个实例的数据清理待重试`:'');}
   catch{outcome.message='备份已导出并校验，原实例删除未完成；请保留备份并手动处理';}
  }
  fs.unlinkSync(file);
 }catch{outcome.message=outcome.status==='success'?outcome.message+'；任务记录未清理，重启时会重新校验并重试。':'备份未完成或校验失败，本次未执行删除；现有实例保留，待处理任务已加密保留，重启应用会重试。';}
 atomic(path.join(dir,REPORT),outcome);return {outcome,runningIds:Array.isArray(job?.runningIds)?job.runningIds:[]};
}
class InstanceTransfer{
 constructor(c){this.c=c;this.drafts=new Map();}
 cookieFile(id){profile('',id);return path.join(this.c.dir,'instance-import-cookies',id+'.bin');}
 async hydrateCookies(id){const file=this.cookieFile(id);if(!fs.existsSync(file))return;
  let cookies;try{cookies=JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));if(!Array.isArray(cookies))throw Error();cookies.forEach(cookieDetails);}catch{throw Error('导入 Cookie 恢复任务无法读取，原数据已保留');}
  const ses=session.fromPartition('persist:arena-core-'+id);await withCookies(ses,async debug=>{const list=cookies.filter(c=>c.expires<=0||c.expires>Date.now()/1000).map(cookieDetails);for(let i=0;i<list.length;i+=200)await debug.sendCommand('Network.setCookies',{cookies:list.slice(i,i+200)});});await ses.cookies.flushStore();
 }
 consumeCookies(id){const file=this.cookieFile(id);if(fs.existsSync(file))fs.unlinkSync(file);}
 async prepareExport(ids,destination,options={}){
  if(this.exportTask)throw Error('已有导出任务正在进行');
  const task=require('./instance-live-export.cjs').exportSelected(this,ids,destination,options);this.exportTask=task;
  try{return await task;}finally{if(this.exportTask===task)this.exportTask=null;}
 }
 async inspect(file){
  if(this.drafts.size>=3)throw Error('请关闭已有导入窗口后再试');
  const files=Array.isArray(file)?file:[file];if(!files.length||files.length>1000||files.some(x=>typeof x!=='string'||!path.isAbsolute(x)))throw Error('请选择 1–1000 个备份文件');
  if(new Set(files.map(x=>process.platform==='win32'?x.toLowerCase():x)).size!==files.length)throw Error('请勿重复选择同一个备份文件');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fi-'));
  try{let metadata;const instances=[],sources=[],sourceFiles=[];
   for(let fileIndex=0;fileIndex<files.length;fileIndex++){
    let data,checked;try{data=await archive.readArchive(files[fileIndex],path.join(root,String(fileIndex)));checked=validateMetadata(data.metadata);}catch(e){throw Error('第 '+(fileIndex+1)+' 个文件（'+path.basename(files[fileIndex])+'）无法读取：'+e.message);}
    metadata||={...checked};if(instances.length+checked.instances.length>1000)throw Error('单次最多导入 1000 个实例，请减少所选文件');
    const top=path.join(data.unpacked,'profiles');if(fs.existsSync(top))for(const name of fs.readdirSync(top))if(!/^(0|[1-9]\d*)$/.test(name)||Number(name)>=checked.instances.length)throw Error('备份包含未声明的实例目录');
    // Keep each archive's profile mapping separate, including repeated source IDs.
    for(let i=0;i<checked.instances.length;i++){const folder=path.join(top,String(i));if(fs.existsSync(folder))for(const entry of archive.files(folder)){if(archive.excluded(entry.path))throw Error('备份包含插件或不支持的数据');}instances.push(checked.instances[i]);sources.push(folder);sourceFiles.push(path.basename(files[fileIndex]));}
   }
   metadata.instances=instances;const token=crypto.randomUUID(),timer=setTimeout(()=>this.cancel(token),15*60*1000);timer.unref();this.drafts.set(token,{root,metadata,sources,timer});
   return {token,fileCount:files.length,createdAt:metadata.createdAt,instances:instances.map(({cookies,...row},i)=>({...row,sourceFile:sourceFiles[i],cookieCount:cookies.length})),nodes:require('./instance-batch.cjs').options(this.c)};
  }catch(error){fs.rmSync(root,{recursive:true,force:true});throw error;}
 }
 cancel(token){const draft=this.drafts.get(token);if(draft){clearTimeout(draft.timer);fs.rmSync(draft.root,{recursive:true,force:true});this.drafts.delete(token);}return {cancelled:true};}
 dispose(){for(const token of this.drafts.keys())this.cancel(token);}
 async import(token,selections){
  const draft=this.drafts.get(token);if(!draft)throw Error('导入草稿已失效，请重新选择备份文件');
  if(!Array.isArray(selections)||selections.length!==draft.metadata.instances.length)throw Error('请为每个实例选择连接方式');
  const used=new Set(this.c.store.list().map(x=>x.name)),plans=[];
  for(let i=0;i<selections.length;i++){
   const value=selections[i],row=draft.metadata.instances[i];if(!value||!['direct','mihomo'].includes(value.mode))throw Error('请选择代理或明确选择本机 IP 直连');
   const node=value.mode==='mihomo'?structuredClone(this.c.library.node(value.sourceId,value.nodeName)):null;
   let name=row.name,n=1;while(used.has(name))name=row.name.slice(0,30)+'（导入 '+n+++'）';used.add(name);
   const id=crypto.randomUUID();plans.push({id,name,url:row.url,...(row.browserTabs?{browserTabs:structuredClone(row.browserTabs)}:{}),environment:row.environment,notes:row.notes,muted:row.muted,volume:row.volume,autoStart:false,network:{mode:node?'mihomo':'direct',nodeName:node?.name||''},node,sourceId:value.sourceId,index:i,cookies:row.cookies,syncLocale:value.syncLocale===true});
  }
  if(this.c.disposing)throw Error('应用正在退出');
  const installed=[];let committed=false;
  try{
   for(const p of plans){const target=profile(this.c.dir,p.id),source=draft.sources[p.index];if(fs.existsSync(target))throw Error('实例目录冲突');fs.mkdirSync(target,{recursive:true});installed.push(p.id);if(fs.existsSync(source)){require("./instance-live-export.cjs").checkCachePath(target,archive.files(source));fs.cpSync(source,target,{recursive:true,errorOnExist:true,force:false});}
    const ses=session.fromPartition('persist:arena-core-'+p.id);
    await withCookies(ses,async debug=>{const list=p.cookies.filter(c=>c.expires<=0||c.expires>Date.now()/1000).map(cookieDetails);for(let i=0;i<list.length;i+=200)await debug.sendCommand('Network.setCookies',{cookies:list.slice(i,i+200)});
     const restored=(await debug.sendCommand('Network.getAllCookies')).cookies;if(restored.length!==list.length)throw Error('Cookie 恢复数量不一致，导入已取消');});
    await ses.cookies.flushStore();ses.flushStorageData();
    if(p.node){const proxy=path.join(this.c.dir,'proxy-sources',p.id+'.json');atomic(proxy,{version:1,nodes:[p.node],subscription:null,assignment:{sourceId:p.sourceId,name:p.node.name}});}
   }
   for(const p of plans){if(p.cookies.some(c=>c.session||c.expires<=0)){
    if(!safeStorage.isEncryptionAvailable())throw Error('系统加密不可用，无法保留首次启动前的会话 Cookie');
    const file=this.cookieFile(p.id);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,safeStorage.encryptString(JSON.stringify(p.cookies)),{flag:'wx',mode:0o600});
   }}
   const rows=plans.map(({node,sourceId,index,cookies,syncLocale,...p})=>p),data={...this.c.store.data,instances:[...this.c.store.list(),...rows]};
   let warning='';try{this.c.store.commit(data);committed=true;}catch(error){if(!error.atomicWriteCommitted)throw error;committed=true;warning='实例已导入，但目录持久化尚未确认，请保留备份';}
   this.c.workspace.log('application',`已导入 ${rows.length} 个实例，备注和网站存储已恢复；请手动启动`);this.c.emit();
   // Persist the complete import first. Optional IP lookup never rolls back imported data.
   const localeWarnings=[];let localeSynced=0;
   for(const p of plans.filter(p=>p.syncLocale)){
    try{await this.c.queue(p.id,async()=>{
     const locale=await require('./exit-locale.cjs').lookup(this.c,p.node,{force:true});
     if(this.c.disposing||this.c.runtimes.get(p.id)?.status==='running')throw Error('实例状态已变化');
     const current=this.c.store.get(p.id);this.c.store.update(p.id,{environment:{...current.environment,language:locale.language,timezone:locale.timezone}});localeSynced++;
    });}catch{const message='时区和语言未同步，已保留原设置，可在环境配置中重新同步';localeWarnings.push({id:p.id,name:p.name,message});this.c.workspace.log('instance',message,'WARN',p.id);}
   }
   this.c.emit();return {ids:rows.map(r=>r.id),count:rows.length,warning,localeSynced,localeWarnings};
  }finally{
   if(!committed)for(const id of installed){try{await session.fromPartition('persist:arena-core-'+id).clearStorageData();}catch{}fs.rmSync(this.cookieFile(id),{force:true});fs.rmSync(path.join(this.c.dir,'proxy-sources',id+'.json'),{force:true});/* Locked browser directories are cleaned as orphans at next startup. */}
   this.cancel(token);
  }
 }
}
module.exports={InstanceTransfer,finalizePending,withCookies,cookieDetails,validateMetadata,previousExit,profile};
