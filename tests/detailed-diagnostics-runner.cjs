'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-diagnostic-electron-'));
for(const phase of [[],['--resume']]){const result=spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/launch-electron.cjs'),path.resolve(__dirname,'detailed-diagnostics-electron.cjs'),'--test-profile='+root,...phase],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',windowsHide:true,timeout:110000});process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');if(result.error||result.status!==0){console.error(result.error?.message||'Detailed diagnostics test exit '+result.status);process.exit(1);}}
