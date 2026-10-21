'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-fingerprint-contexts-'));
for(const args of [[],['--resume'],['--test-cdp='+String(40000+Math.floor(Math.random()*20000)), '--resume']]){
 const r=spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/launch-electron.cjs'),path.resolve(__dirname,'fingerprint-contexts-electron.cjs'),'--test-profile='+root,...args],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',timeout:170000,windowsHide:true});
 process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');
 if(r.error||r.status!==0){console.error(r.error?.message||'Context Electron test exit: '+r.status);process.exit(1);}
}
