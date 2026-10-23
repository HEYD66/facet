'use strict';
// A temporary encrypted profile key permits Chromium safeStorage to read the
// existing provider secret. The original profile is read only. No plaintext
// key is exported; borrowed key material is removed after the child exits.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const settings=process.argv.find(x=>x.startsWith('--settings='))?.slice(11);if(!settings)throw Error('Pass --settings=<existing encrypted ai-settings.json> to opt into a live model test');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-ai-live-verified-')),localState=path.join(root,'Local State');
let result;
try{
 const source=JSON.parse(fs.readFileSync(path.join(path.dirname(settings),'Local State'),'utf8'));
 if(!source.os_crypt)throw Error('Existing profile has no safeStorage key material');
 fs.writeFileSync(localState,JSON.stringify({os_crypt:source.os_crypt}));
 result=spawnSync(process.execPath,[path.join(__dirname,'../scripts/launch-electron.cjs'),path.join(__dirname,'ai-live-electron.cjs'),'--settings='+settings,'--test-profile='+root,...process.argv.filter(x=>['--history-greeting','--capabilities'].includes(x))],{stdio:'inherit',windowsHide:true,timeout:240000});
}finally{
 for(const name of ['Local State','Local State.bak','Local State.tmp'])fs.rmSync(path.join(root,name),{force:true});
}
if(result?.status!==0){console.error(result?.error?.message||'Live model verification failed');process.exit(1);}
console.log(JSON.stringify({passed:true,root,borrowedEncryptedKeyRemoved:true}));
