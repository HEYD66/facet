'use strict';
// Exercise the real renderer, IPC, diagnostics, Mihomo and persisted instances with loopback-only upstreams.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=process.env.FACET_NEW_NODE_ROOT;if(!root)throw Error('Use new-instance-node-runner.cjs');
app.setPath('userData',root);app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-background-networking');
const {Controller}=require('../src/main/controller.cjs'),{installIPC}=require('../src/main/ipc.cjs'),{TARGETS}=require('../src/main/diagnostics.cjs');
const {Store}=require('../src/main/store.cjs'),{Library}=require('../src/main/library.cjs'),{DiagnosticHistory}=require('../src/main/diagnostic-history.cjs'),{selectForNewInstance}=require('../src/main/node-evidence.cjs');
const servers=[],sockets=new Set(),failed=new Set(),passes=[];
let c,win,dispose;
const wait=async(fn,label)=>{for(let i=0;i<600;i++){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,30));}throw Error('Timeout: '+label);};
const pass=label=>{passes.push(label);console.log('PASS '+label);};
setTimeout(()=>app.exit(2),120000).unref();
app.whenReady().then(async()=>{let error;try{
 const nodes=[];
 for(let index=0;index<3;index++){
  const respond=(req,res)=>{
   const probe=req.url.includes('/latency')||req.url.includes('/fallback');
   if(probe&&failed.has(index)){res.statusCode=503;res.end('Unavailable');return;}
   const body=req.url.includes('/ip')?JSON.stringify({success:true,ip:'203.0.113.'+(10+index),country:'Japan',country_code:'JP',timezone:{id:'Asia/Tokyo'}}):probe?'ip=203.0.113.'+(10+index)+'\n':'<!doctype html><title>Selected '+index+'</title><h1>Selected '+index+'</h1>';
   const reply=()=>{res.setHeader('Content-Type',req.url.includes('/ip')?'application/json':'text/html');res.end(body);};
   if(probe)setTimeout(reply,[20,250,500][index]);else reply();
  };
  const server=http.createServer(respond);
  server.on('connect',(_request,socket)=>{
   socket.on('error',()=>{});socket.write('HTTP/1.1 200 Connection established\r\n\r\n');
   let raw='';const receive=chunk=>{raw+=chunk.toString();if(!raw.includes('\r\n\r\n'))return;socket.removeListener('data',receive);respond({url:raw.split(' ')[1]},{statusCode:200,setHeader(){},end(body){body=String(body);socket.end('HTTP/1.1 '+this.statusCode+' Result\r\nContent-Type: text/html\r\nContent-Length: '+Buffer.byteLength(body)+'\r\nConnection: close\r\n\r\n'+body);}});};
   socket.on('data',receive);
  });
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(server);
  nodes.push({name:'JP Node '+String.fromCharCode(65+index),type:'http',server:'127.0.0.1',port:server.address().port});
 }
 TARGETS.latency='http://new-node.invalid/latency';TARGETS.fallback='http://new-node.invalid/fallback';TARGETS.ip='http://new-node.invalid/ip';
 win=new BrowserWindow({show:false,width:1400,height:1040,webPreferences:{preload:path.resolve('src/main/preload.cjs'),sandbox:true,nodeIntegration:false,contextIsolation:true}});
 c=new Controller(win,root,path.resolve('resources/mihomo/mihomo.exe'));dispose=installIPC(win,c);await win.loadFile(path.resolve('src/renderer/index.html'));
 const ui=code=>win.webContents.executeJavaScript(code);
 await wait(()=>ui('!!window.facet && state.instances.length>0'),'renderer initial state');
 const sourceId=await c.library.save({name:'本地验证订阅',text:JSON.stringify({proxies:nodes})});
 const measure=async(indices,kind='latency')=>{c.diagnostics.run(indices.map(index=>({sourceId,name:nodes[index].name})),kind,1);await c.diagnostics.work;c.emit();};
 await measure([0,1,2]);await measure([0,1,2],'ip');
 const measurements=nodes.map(node=>[...c.diagnostics.results.values()].find(row=>row.name===node.name&&row.kind==='latency'));
 assert(measurements.every(row=>row.ok));assert(measurements[0].latencyMs<measurements[1].latencyMs);assert(measurements[1].latencyMs<measurements[2].latencyMs);
 pass('Three real proxy paths produce successful diagnostics with distinct measured latency');
 const assign=index=>{const instance=c.store.create('已分配 '+index+' '+c.store.list().length,{mode:'mihomo',nodeName:nodes[index].name});c.store.saveNodes(instance.id,[nodes[index]],null,{sourceId,name:nodes[index].name});c.emit();return instance;};
 assign(0);
 const random=async expected=>{await ui("document.querySelector('[data-new-env=random]').click()");await wait(()=>ui('!modal.newEnvironmentBusy && !!modal.newEnvironment'),'random plan');if(expected!==null){assert.equal(await ui('document.querySelector("#newSource").value'),sourceId);assert.equal(await ui('document.querySelector("#newNode").value'),nodes[expected].name);}return ui('document.querySelector("#newNodeChoice").textContent');};
 const open=async()=>{await ui("openModal('new')");await wait(()=>ui('!!document.querySelector("[data-new-env=random]")'),'new instance dialog');};
 await open();let notice=await random(1);assert(notice.includes('尚未分配'));
 assert.equal(await ui('document.querySelector("#newNodeField").hidden'),false);assert.equal(await ui('document.querySelector("#newNodeEvidence").hidden'),false);
 if(process.env.FACET_NEW_NODE_ARTIFACTS){fs.mkdirSync(process.env.FACET_NEW_NODE_ARTIFACTS,{recursive:true});win.show();await new Promise(resolve=>setTimeout(resolve,500));fs.writeFileSync(path.join(process.env.FACET_NEW_NODE_ARTIFACTS,'new-instance-node.png'),(await win.webContents.capturePage()).toPNG());}
 const create=async name=>{await ui(`document.querySelector('#nameInput').value=${JSON.stringify(name)};document.querySelector('#startNew').checked=false;document.querySelector('#modal [data-action=confirm]').click()`);await wait(()=>c.store.list().some(row=>row.name===name)&&!c.creationProgress,'creation persisted');await wait(()=>ui('!modal'),'creation dialog closed');return c.store.list().find(row=>row.name===name);};
 const first=await create('自动选择实例 B');assert.equal(first.network.nodeName,nodes[1].name);assert.equal(first.environment.language,'ja-JP');assert.equal(first.environment.timezone,'Asia/Tokyo');assert(first.environment.fingerprint.enabled);
 assert.equal(c.store.source(first.id).assignment.sourceId,sourceId);assert.deepEqual(new Store(root).get(first.id),first);
 pass('The visible random button selects the fastest unused node; confirmation persists proxy, fingerprint and saved IP locale');
 c.store.update(first.id,{url:'http://new-node.invalid/page'});await c.start(first.id);
 await wait(()=>c.runtimes.get(first.id).view.webContents.getTitle()==='Selected 1','selected proxy webpage');
 assert.equal(await c.runtimes.get(first.id).view.webContents.executeJavaScript('navigator.hardwareConcurrency'),first.environment.cpu);
 await c.stop(first.id);await c.start(first.id);await wait(()=>c.runtimes.get(first.id).view.webContents.getTitle()==='Selected 1','selected proxy after restart');await c.stop(first.id);
 pass('The created instance really loads through the chosen proxy, applies its environment and keeps both after instance restart');
 await open();await random(2);const second=await create('自动选择实例 C');assert.equal(second.network.nodeName,nodes[2].name);assert.notEqual(second.environment.fingerprint.seed,first.environment.fingerprint.seed);
 await open();notice=await random(0);assert(notice.includes('已被 1 个实例分配'));assign(0);notice=await random(1);assert(notice.includes('已被 1 个实例分配'));
 pass('Subsequent creation avoids stopped assigned instances; when all are assigned it prioritizes fewer assignments, then lower latency');
 const selectedSeed=await ui('modal.newEnvironment.fingerprint.seed');
 await ui(`document.querySelector('#newNode').value=${JSON.stringify(nodes[2].name)};document.querySelector('#newNode').dispatchEvent(new Event('change',{bubbles:true}))`);
 assert.equal(await ui('document.querySelector("#newNodeChoice").hidden'),true);assert.equal(await ui('modal.newEnvironment.fingerprint.seed'),selectedSeed);
 await ui("document.querySelector('[data-new-env=native]').click()");await wait(()=>ui('!modal.newEnvironmentBusy'),'native environment');assert.equal(await ui('modal.newEnvironment'),null);assert.equal(await ui('document.querySelector("#newNode").value'),nodes[2].name);
 pass('Manual node changes clear automatic hints and native environment mode keeps the selected network');
 failed.add(1);await measure([1]);assert.equal(measurements[1].ok,true);assert.equal([...c.diagnostics.results.values()].find(row=>row.name===nodes[1].name&&row.kind==='latency').ok,false);await random(2);
 pass('An actual failed latest connectivity check excludes a previously successful node');
 failed.add(0);failed.add(2);await measure([0,2]);const count=c.store.list().length;notice=await random(null);assert(notice.includes('没有最近检测连通'));assert.equal(await ui('document.querySelector("#newNode").value'),nodes[2].name);assert.equal(await ui('document.querySelector("#newSource").value'),sourceId);assert.equal(c.store.list().length,count);
 pass('With no eligible node the UI gives an explicit notice and preserves the network selection without creating an instance');
 failed.delete(2);await measure([2]);c.diagnostics.history.flush();
 const stored=new Store(root),reloaded={store:stored,library:new Library(root,stored),diagnostics:{results:new Map(),history:new DiagnosticHistory(root)}};
 assert.equal(selectForNewInstance(reloaded).name,nodes[2].name);
 pass('Reloading saved diagnostics and instance assignments preserves the selection result');
 await ui('closeModal()');await c.closeAll();assert.equal(c.diagnostics.cores.size,0);assert([...c.runtimes.values()].every(row=>!row.core?.child));
 pass('All owned diagnostic and instance proxy processes are reclaimed');
}catch(caught){error=caught;console.error(caught.stack);}finally{
 try{await c?.closeAll();}catch(caught){error=error||caught;}dispose?.();if(win&&!win.isDestroyed())win.destroy();
 for(const socket of sockets)socket.destroy();for(const server of servers)await new Promise(resolve=>server.close(resolve));
 if(process.env.FACET_NEW_NODE_ARTIFACTS)fs.writeFileSync(path.join(process.env.FACET_NEW_NODE_ARTIFACTS,'result.json'),JSON.stringify({passes,error:error?.stack||null},null,2));
 if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('facet-new-node-')||fs.lstatSync(root).isSymbolicLink())throw Error('Unsafe cleanup path');
 app.exit(error?1:0);
}});
