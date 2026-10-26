'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),{spawnSync}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-fingerprint-contexts-'));
// The external CDP phase needs a port the gateway can bind. A random fixed port is often taken or
// reserved on Windows (listen fails with EADDRINUSE although nothing answers), so ask the OS for one.
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const {port}=s.address();s.close(()=>resolve(port));});});
(async()=>{
 for(const args of [[],['--resume'],['--test-cdp='+await freePort(),'--resume']]){
  const r=spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/launch-electron.cjs'),path.resolve(__dirname,'fingerprint-contexts-electron.cjs'),'--test-profile='+root,...args],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',timeout:170000,windowsHide:true});
  process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');
  if(r.error||r.status!==0){console.error(r.error?.message||'Context Electron test exit: '+r.status);process.exit(1);}
 }
})().catch(error=>{console.error(error);process.exit(1);});
