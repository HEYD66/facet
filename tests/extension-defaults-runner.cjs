'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-extension-defaults-')),artifacts=path.resolve('.local-dev/extension-defaults-20261023');fs.mkdirSync(artifacts,{recursive:true});
(async()=>{try{for(const phase of ['write','reload']){
 const env={...process.env,FACET_EXTENSION_DEFAULTS_ROOT:root,FACET_EXTENSION_DEFAULTS_PHASE:phase,FACET_EXTENSION_DEFAULTS_ARTIFACTS:artifacts};delete env.ELECTRON_RUN_AS_NODE;
 await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.resolve('scripts/launch-electron.cjs'),path.resolve('tests/extension-defaults-electron.cjs')],{env,stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(phase+' failed: '+code)));});
 }console.log('PASS default extension real UI, loading and complete process restart; artifacts '+artifacts);
 }finally{const resolved=path.resolve(root);if(path.dirname(resolved)!==os.tmpdir()||!path.basename(resolved).startsWith('facet-extension-defaults-')||fs.lstatSync(resolved).isSymbolicLink())throw Error('Unsafe cleanup path');fs.rmSync(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
})().catch(error=>{console.error(error);process.exitCode=1;});
