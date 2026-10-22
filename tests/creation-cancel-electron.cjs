'use strict';
// Real IPC, loopback HTTP proxy, Mihomo and on-disk state; never use the user's instances.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-create-cancel-'));app.setPath('userData',root);app.disableHardwareAcceleration();
const {Controller}=require('../src/main/controller.cjs'),{TARGETS}=require('../src/main/diagnostics.cjs'),{Store}=require('../src/main/store.cjs');
const checks=[],sockets=new Set(),held=[];let c,win,server,dispose,holdWhen=()=>false,error;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(fn,label){for(let i=0;i<800;i++){if(await fn())return;await sleep(20);}throw Error('Timeout: '+label);}
function release(){for(const reply of held.splice(0))reply();}
setTimeout(()=>app.exit(2),120000).unref();
app.whenReady().then(async()=>{try{
 const respond=(url,end)=>{const reply=()=>end(url.includes('/ip')?JSON.stringify({success:true,ip:'203.0.113.90',country_code:'JP',timezone:{id:'Asia/Tokyo'}}):'ip=203.0.113.90\n');if(url.includes('/ip')&&holdWhen())held.push(reply);else reply();};
 server=http.createServer((req,res)=>respond(req.url,body=>res.end(body)));
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 server.on('connect',(_req,socket)=>{socket.on('error',()=>{});socket.write('HTTP/1.1 200 Connection established\r\n\r\n');socket.once('data',chunk=>respond(chunk.toString(),body=>socket.end('HTTP/1.1 200 OK\r\nContent-Length: '+Buffer.byteLength(body)+'\r\nConnection: close\r\n\r\n'+body)));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 TARGETS.ip='http://cancel-check.invalid/ip';TARGETS.latency='http://cancel-check.invalid/latency';
 win=new BrowserWindow({show:false,webPreferences:{preload:path.resolve('src/main/preload.cjs'),contextIsolation:true,sandbox:true}});c=new Controller(win,root,path.resolve('resources/mihomo/mihomo.exe'));dispose=require('../src/main/ipc.cjs').installIPC(win,c);
 const sourceId=await c.library.save({name:'Cancellation test proxy',text:JSON.stringify({proxies:[{name:'JP',type:'http',server:'127.0.0.1',port:server.address().port}]})});
 const call=async(action,payload={})=>{const reply=await c.externalRequest({action,...payload});assert(reply.ok,reply.error);return reply.value;};
 const plan=async(prefix,count)=>call('instance-batch-plan',{prefix,count,mode:'mihomo',allocation:'cycle',nodes:[{sourceId,name:'JP'}],random:true,syncLocale:true});
 const before=c.store.list().length;
 let draft=await plan('Cancel before write',1);holdWhen=()=>true;
 let pending=call('instance-batch-create',{token:draft.token});await wait(()=>held.length,'held first exit query');
 const cancel=await call('instance-batch-cancel');assert(cancel.requested);setTimeout(release,100);
 let result=await pending;holdWhen=()=>false;release();
 assert.equal(result.created,0,'Cancel during exit lookup must not persist a late instance');assert.equal(result.failed,0);assert(result.cancelled);assert.equal(new Store(root).list().length,before);assert.equal(c.creationProgress,null);
 assert.equal(c.diagnostics.cores.size,0);assert.equal(c.diagnostics.standalone.size,0);
 checks.push('Cancellation during an actual proxy exit query writes no late instance and reclaims the query core');
 draft=await plan('Keep completed',3);holdWhen=()=>c.batchCreation?.running&&c.batchCreation.created>=1;
 pending=call('instance-batch-create',{token:draft.token});await wait(()=>held.length,'held second exit query');await call('instance-batch-cancel');setTimeout(release,100);result=await pending;holdWhen=()=>false;release();
 assert.equal(result.created,1);assert.equal(result.done,1);assert.equal(result.failed,0);assert(result.cancelled);assert.equal(new Store(root).list().length,before+1);
 const journal=JSON.parse(fs.readFileSync(path.join(root,'instance-create-batches',result.id+'.json'),'utf8'));assert.equal(journal.created,1);assert(journal.cancelled);assert.equal(journal.running,false);
 checks.push('Cancellation preserves completed instances and persists correct final batch counts');
 const next=await call('create',{name:'Create after cancellation',sourceId,nodeName:'JP',syncLocale:true,detailed:true,background:true});assert(next.created);assert.equal(new Store(root).get(next.id).environment.timezone,'Asia/Tokyo');
 checks.push('A new ordinary creation with live locale matching succeeds after cancellation');
 const beforeSourceUpdate=c.store.list().length;holdWhen=()=>true;
 const staleCreate=c.externalRequest({action:'create',name:'Stale manual source',sourceId,nodeName:'JP',syncLocale:true,detailed:true,background:true});await wait(()=>held.length,'held source update query');
 await c.library.save({id:sourceId,text:JSON.stringify({proxies:[{name:'JP',type:'http',server:'127.0.0.1',port:server.address().port,username:'updated-fixture-user'}]})});holdWhen=()=>false;release();
 const staleReply=await staleCreate;assert.equal(staleReply.ok,false,'An updated source must invalidate an in-flight ordinary creation without caller-provided sourceVersion');assert.equal(c.store.list().length,beforeSourceUpdate);
 await c.library.save({id:sourceId,text:JSON.stringify({proxies:[{name:'JP',type:'http',server:'127.0.0.1',port:server.address().port}]})});
 checks.push('A node source update during ordinary locale lookup cannot save the old node under the new source');
 const countBeforeShutdown=c.store.list().length;holdWhen=()=>true;
 const shuttingCreate=c.externalRequest({action:'create',name:'Must not write during exit',sourceId,nodeName:'JP',syncLocale:true,detailed:true,background:true});await wait(()=>held.length,'held shutdown query');
 const closing=c.closeAll();setTimeout(release,100);const reply=await shuttingCreate;await closing;release();assert.equal(reply.ok,false);assert.equal(new Store(root).list().length,countBeforeShutdown);assert.equal(c.creationProgress,null);
 checks.push('Actual application shutdown during locale lookup cannot persist a late instance');
}catch(caught){error=caught.stack;console.error(error);}finally{
 holdWhen=()=>false;release();try{await c?.closeAll();}catch(caught){error=error||caught.stack;}dispose?.();win?.destroy();for(const socket of sockets)socket.destroy();server?.close();
 const report={root,checks,error:error||null};fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(error?1:0);
}});
