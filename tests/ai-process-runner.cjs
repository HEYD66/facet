'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const fixtures={sessions:'ai-sessions-electron.cjs',stop:'ai-stop-electron.cjs',recovery:'ai-recovery-electron.cjs'};
const name=process.argv[2];if(!fixtures[name])throw Error('Choose sessions, stop or recovery');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-ai-'+name+'-verified-'));
for(const phase of [[],['--resume']]){
 const result=spawnSync(process.execPath,[path.join(__dirname,'../scripts/launch-electron.cjs'),path.join(__dirname,fixtures[name]),'--test-profile='+root,...phase],{stdio:'inherit',windowsHide:true,timeout:190000});
 if(result.status!==0){console.error(result.error?.message||'AI '+name+' phase failed');process.exit(1);}
}
console.log(JSON.stringify({passed:true,root,phases:['execution','fresh-process-restore']}));
