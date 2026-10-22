'use strict';
// Export only quiesced selected sessions. The controls and unrelated sessions stay alive.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{isDeepStrictEqual}=require('node:util');
const {app,session,webContents}=require('electron'),archive=require('./instance-archive.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function fileDigest(file){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function publishExclusive(source,destination){
 let created=false;try{await fs.promises.copyFile(source,destination,fs.constants.COPYFILE_EXCL);created=true;if(await fileDigest(source)!==await fileDigest(destination))throw Error('备份保存校验失败');const fd=fs.openSync(destination,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 catch(e){if(created)fs.rmSync(destination,{force:true});throw e;}
}
async function fingerprint(root){const rows=[];for(const entry of archive.files(root).sort((a,b)=>a.path.localeCompare(b.path))){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(entry.file))hash.update(chunk);rows.push([entry.path,entry.size,hash.digest('hex')]);}return rows;}
function checkCachePath(root,entries){if(process.platform==='win32'&&entries.some(x=>x.path.toLowerCase().includes('service worker/cachestorage/')&&path.join(root,...x.path.split('/')).length>=260))throw Error('实例数据目录过长，无法可靠读写网站缓存；请使用更短的数据目录后重试，原实例保留');}
async function quiesce(ses,withCookies){
 // A service worker may survive its last page. Never clear registrations or site data.
 await withCookies(ses,async debug=>{await debug.sendCommand('ServiceWorker.enable');await debug.sendCommand('ServiceWorker.stopAllWorkers');});
 for(let i=0;i<100;i++){if(!Object.keys(ses.serviceWorkers.getAllRunning()).length)break;if(i===99)throw Error('实例后台任务尚未停止，未执行删除');await delay(50);}
 if(webContents.getAllWebContents().some(w=>!w.isDestroyed()&&w.session===ses))throw Error('实例仍有打开的页面，无法完整备份');
 await ses.cookies.flushStore();ses.flushStorageData();await ses.closeAllConnections();
}
async function exportSelected(transfer,ids,destination,{deleteAfterExport=false,mode='combined'}={}){
 const c=transfer.c,{profile,withCookies,cookieDetails,previousExit,validateMetadata}=require('./instance-transfer.cjs');
 if(!Array.isArray(ids)||!ids.length||ids.length>1000||new Set(ids).size!==ids.length)throw Error('请选择 1–1000 个不同实例');
 for(const id of ids)c.store.get(id);
 if(typeof destination!=='string'||!path.isAbsolute(destination))throw Error('请选择有效的备份保存位置');
 if(!['separate','combined'].includes(mode))throw Error('导出方式无效');
 if(mode==='separate'&&!fs.statSync(destination).isDirectory())throw Error('请选择备份保存文件夹');
 const relative=path.relative(c.dir,destination);if(!relative||!relative.startsWith('..')&&!path.isAbsolute(relative))throw Error('请将备份保存到应用数据目录之外');
 if(fs.existsSync(path.join(c.dir,'instance-export.pending')))throw Error('还有旧版本未完成的备份任务，请先重启完成旧任务');
 if(c.disposing)throw Error('应用正在退出');
 const active={running:true,ids:[...ids],phase:'准备导出',done:0,total:ids.length};transfer.progress=active;c.emit();
 const progress=(phase,done=active.done)=>{active.phase=phase;active.done=done;c.emit();};
 // Existing operations finish first; these per-instance queues hold through resume/deletion.
 let run=async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fe-')),temporaries=[];
  const originals=ids.map(id=>structuredClone(c.store.get(id))),running=ids.filter(id=>c.runtimes.get(id)?.status==='running'),instances=[],guards=[],restored=[],restoreFailed=[];
  let result,committed=false,error;
  try{
   progress('正在保存所选实例');
   for(const id of ids){await c.stopInner(id);const ses=session.fromPartition('persist:arena-core-'+id);
    // No page can make new requests while this selected session is being copied.
    ses.webRequest.onBeforeRequest((_details,callback)=>callback({cancel:true}));guards.push(ses);
    await quiesce(ses,withCookies);const x=c.store.get(id),cookies=await withCookies(ses,async d=>(await d.sendCommand('Network.getAllCookies')).cookies);cookies.forEach(cookieDetails);
    instances.push({id,name:x.name,url:x.url,...(x.browserTabs?{browserTabs:structuredClone(x.browserTabs)}:{}),environment:x.environment,notes:x.notes||'',muted:x.muted===true,volume:x.volume??100,previousExit:previousExit(c,id),cookies});
   }
   const metadata={format:'facet-instance-backup',version:1,platform:process.platform,electron:process.versions.electron,app:require('./application-version.cjs').applicationVersion(app),createdAt:new Date().toISOString(),instances};validateMetadata(metadata);
   for(let i=0;i<ids.length;i++){
    const source=profile(c.dir,ids[i]),target=path.join(root,'profiles',String(i));checkCachePath(source,archive.files(source));let stable=false;
    for(let attempt=0;attempt<3&&!stable;attempt++){
     if(fs.existsSync(target))fs.rmSync(target,{recursive:true,force:true});fs.mkdirSync(target,{recursive:true,mode:0o700});
     const before=await fingerprint(source);for(const entry of archive.files(source)){const out=path.join(target,...entry.path.split('/'));fs.mkdirSync(path.dirname(out),{recursive:true,mode:0o700});await fs.promises.copyFile(entry.file,out);}
     await delay(200);const after=await fingerprint(source),copy=await fingerprint(target);stable=isDeepStrictEqual(before,after)&&isDeepStrictEqual(after,copy);
     if(Object.keys(session.fromPartition('persist:arena-core-'+ids[i]).serviceWorkers.getAllRunning()).length)throw Error('后台任务重新运行，备份已取消，原实例保留');
    }
    if(!stable)throw Error('实例数据仍在变化，未生成完整备份；原实例保留，请稍后重试');progress('正在复制实例数据',i+1);
   }
   const destinations=mode==='separate'?require('./instance-backup-names.cjs').separateDestinations(destination,instances):[destination],outputs=[];
   for(let outputIndex=0;outputIndex<destinations.length;outputIndex++){
    const indices=mode==='separate'?[outputIndex]:ids.map((_,i)=>i),outputMetadata={...metadata,instances:indices.map(i=>instances[i])},file=destinations[outputIndex],temporary=file+'.'+crypto.randomUUID()+'.exporting';temporaries.push(temporary);
    progress('正在生成备份 '+(outputIndex+1)+' / '+destinations.length);
    const written=await archive.writeArchive(temporary,outputMetadata,indices.map(i=>path.join(root,'profiles',String(i))));
    progress('正在校验备份 '+(outputIndex+1)+' / '+destinations.length);const verifyRoot=path.join(root,'verify'),verified=await archive.readArchive(temporary,verifyRoot);validateMetadata(verified.metadata);
    if(!isDeepStrictEqual(verified.metadata,outputMetadata))throw Error('备份实例信息不一致，原实例保留');
    for(let j=0;j<indices.length;j++)if(!isDeepStrictEqual(await fingerprint(path.join(root,'profiles',String(indices[j]))),await fingerprint(path.join(verified.unpacked,'profiles',String(j)))))throw Error('备份数据校验失败，原实例保留');
    fs.rmSync(verifyRoot,{recursive:true,force:true});outputs.push({temporary,destination:file,...written});
   }
   // No original is deleted until every archive is verified and committed.
   const published=[];
   try{for(const output of outputs){
    if(mode==='separate'){await publishExclusive(output.temporary,output.destination);published.push(output.destination);fs.unlinkSync(output.temporary);}
    else{if(fs.existsSync(output.destination))fs.copyFileSync(output.destination,output.destination+'.bak');fs.renameSync(output.temporary,output.destination);published.push(output.destination);}
   }}catch(e){if(published.length)e.message+='；已有 '+published.length+' 个已校验文件保存到所选位置，原实例全部保留';throw e;}
   committed=true;result={status:'success',mode,destination:destinations[0],destinations,count:ids.length,bytes:outputs.reduce((sum,x)=>sum+x.bytes,0),files:outputs.reduce((sum,x)=>sum+x.files,0),restarting:false,deletion:null};
   if(deleteAfterExport){
    progress('正在删除已备份的原实例');const deletion={deleted:0,deleteFailed:0,cleanupPending:0,items:[]};result.deletion=deletion;
    for(let i=0;i<ids.length;i++){const id=ids[i],item={id,name:instances[i].name,status:'retained'};deletion.items.push(item);
     try{if(!isDeepStrictEqual(c.store.get(id),originals[i]))throw Error('实例配置已改变');await c.removeInner(id);}
     catch{item.warning='原实例保留或数据清理待重试';}
     if(c.store.list().some(x=>x.id===id)){deletion.deleteFailed++;}else{deletion.deleted++;item.status='deleted';if(require('./cleanup.cjs').journalResiduals(c.dir,id).length){deletion.cleanupPending++;item.status='cleanup-pending';}}
    }
   }
  }catch(e){error=e;}
  finally{
   for(const ses of guards)ses.webRequest.onBeforeRequest(null);
   progress('正在恢复原运行实例');
   for(const id of running)if(c.store.list().some(x=>x.id===id)){try{const task=c.startTail.catch(()=>{}).then(()=>c.startInner(id));c.startTail=task;await task;restored.push(id);}catch{restoreFailed.push(id);}}
   try{for(const temporary of temporaries)fs.rmSync(temporary,{force:true});fs.rmSync(root,{recursive:true,force:true});}catch{c.workspace.log('application','导出临时目录尚未清理，请妥善保管临时资料','WARN');}
  }
  if(error&&!committed){if(restoreFailed.length)error.message+='；部分原实例未恢复，请手动启动';throw error;}
  result.restoreFailed=restoreFailed;result.restored=restored.length;result.at=new Date().toISOString();
  result.message='已导出并校验 '+ids.length+' 个实例，生成 '+result.destinations.length+' 个文件'+(result.deletion?'；已删除 '+result.deletion.deleted+' 个原实例':'')+(result.deletion?.deleteFailed?'；部分原实例保留':'')+(result.deletion?.cleanupPending?'；残留目录将在下次启动时清理':'')+(restoreFailed.length?'；部分实例恢复失败，请手动启动':'');
  c.transferOutcome=result;c.workspace.log('application',result.message);c.emit();return result;
 };
 for(const id of [...ids].sort().reverse()){const inside=run;run=()=>c.queue(id,inside);}
 try{return await run();}finally{active.running=false;transfer.progress=null;c.emit();}
}
module.exports={exportSelected,fingerprint,checkCachePath};
