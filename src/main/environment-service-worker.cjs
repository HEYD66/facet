'use strict';
// Service workers have no ready Runtime agent while their CDP startup target is
// paused. A session preload reaches their main world before the first script.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const registrations=new WeakMap(),directories=new Set();let cleanupInstalled=false;
function removeDirectory(dir){try{fs.rmSync(dir,{recursive:true,force:true});directories.delete(dir);}catch{}}
async function installServiceWorkerEnvironment(wc,source,nativeKey){
 const ses=wc.session;
 const previous=registrations.get(ses);
 if(previous?.source===source&&previous?.nativeKey===nativeKey)return;
 const send=(method,params)=>require('./environment-contexts.cjs').targetCommand(wc,method,params);
 const stopOldWorkers=async()=>{
  // Stop (not unregister) website workers in this session before changing
  // configuration. Otherwise a still-running worker retains the old getters.
  const running=Object.entries(ses.serviceWorkers.getAllRunning()).filter(([,info])=>/^https?:/i.test(info.scriptUrl));
  if(!running.length)return;
  await send('ServiceWorker.enable');
  try{for(const [versionId]of running)await send('ServiceWorker.stopWorker',{versionId});}
  finally{await send('ServiceWorker.disable');}
 };
 if(!source){if(previous){await stopOldWorkers();if(previous.id){ses.unregisterPreloadScript(previous.id);removeDirectory(previous.dir);}}registrations.set(ses,{source,nativeKey});return;}
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'facet-environment-preload-')),file=path.join(dir,'service-worker.cjs');
 directories.add(dir);
 let id;
 try{
  // No IPC, eval, credentials or webRequest handler; never inject into extension workers.
  fs.writeFileSync(file,"'use strict';\nrequire('electron').contextBridge.executeInMainWorld({func:()=>{if(!/^https?:$/.test(globalThis.location?.protocol||''))return;\n"+source+'\n}});\n',{flag:'wx'});
  id=ses.registerPreloadScript({type:'service-worker',filePath:file});
  await stopOldWorkers();
  if(previous?.id){ses.unregisterPreloadScript(previous.id);removeDirectory(previous.dir);}
  registrations.set(ses,{source,nativeKey,id,dir});
 }catch(error){if(id)try{ses.unregisterPreloadScript(id);}catch{}removeDirectory(dir);throw error;}
 if(!cleanupInstalled){cleanupInstalled=true;require('electron').app.once('will-quit',()=>{for(const item of directories)removeDirectory(item);});}
}
module.exports={installServiceWorkerEnvironment};
