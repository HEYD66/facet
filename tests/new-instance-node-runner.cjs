'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-new-node-'));
(async()=>{try{
 const env={...process.env,FACET_NEW_NODE_ROOT:root};delete env.ELECTRON_RUN_AS_NODE;
 await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.resolve('scripts/launch-electron.cjs'),path.resolve('tests/new-instance-node-electron.cjs')],{env,stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('New instance node integration failed: '+code)));});
 console.log('PASS new instance random node application integration');
}finally{
 const resolved=path.resolve(root);if(path.dirname(resolved)!==os.tmpdir()||!path.basename(resolved).startsWith('facet-new-node-')||fs.lstatSync(resolved).isSymbolicLink())throw Error('Unsafe cleanup path');
 fs.rmSync(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}})().catch(error=>{console.error(error);process.exitCode=1;});
