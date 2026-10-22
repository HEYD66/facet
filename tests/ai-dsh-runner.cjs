'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-dsh-verified-'));
for(const phase of [[],['--resume']]){
 const result=spawnSync(process.execPath,[path.join(__dirname,'../scripts/launch-electron.cjs'),path.join(__dirname,'ai-dsh-electron.cjs'),'--test-profile='+root,...phase],{stdio:'inherit',windowsHide:true,timeout:180000});
 if(result.status!==0){console.error(result.error?.message||'DSH phase failed');process.exit(1);}
}
console.log(JSON.stringify({passed:true,root,phases:['execution','fresh-process-restore']}));
