'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-proxy-scroll-'));
(async()=>{try{
 const env={...process.env,FACET_SCROLL_ROOT:root};delete env.ELECTRON_RUN_AS_NODE;
 await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.resolve('scripts/launch-electron.cjs'),path.resolve('tests/proxy-scroll-electron.cjs')],{env,stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Proxy scroll integration failed: '+code)));});
}finally{
 const resolved=path.resolve(root);if(path.dirname(resolved)!==os.tmpdir()||!path.basename(resolved).startsWith('facet-proxy-scroll-')||fs.lstatSync(resolved).isSymbolicLink())throw Error('Unsafe cleanup path');
 fs.rmSync(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}})().catch(error=>{console.error(error);process.exitCode=1;});
