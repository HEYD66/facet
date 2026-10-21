'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-extension-resume-'));
for(const phase of ['configure','persist']){
 const result=spawnSync(process.execPath,['scripts/launch-electron.cjs','tests/extension-configure-electron.cjs',root,phase],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',timeout:180000,windowsHide:true});
 if(result.error)throw result.error;
 if(result.status!==0){process.stderr.write(result.stdout||'');process.stderr.write(result.stderr||'');throw Error(`Extension ${phase} verification failed: ${result.status}`);}
 const report=JSON.parse(fs.readFileSync(path.join(root,phase+'.json'),'utf8'));assert.equal(report.passed,true);for(const item of report.checks)console.log('PASS '+item);
}
console.log(JSON.stringify({root,passed:true,phases:['configure','persist']}));
