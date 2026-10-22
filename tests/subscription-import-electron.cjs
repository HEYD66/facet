'use strict';
// Real Electron renderer/IPC/downloader, disk and Mihomo. DNS public candidates
// are mapped to loopback only in this isolated test process; production code
// still validates the complete DNS answer and uses its normal request path.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),dns=require('node:dns').promises,assert=require('node:assert/strict');
const root=process.env.FACET_SUBSCRIPTION_ROOT,phase=process.env.FACET_SUBSCRIPTION_PHASE,artifacts=process.env.FACET_SUBSCRIPTION_ARTIFACTS;
if(!root||!artifacts||!['write','reload'].includes(phase))throw Error('Use subscription-import-runner.cjs');
app.setPath('userData',root);app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-background-networking');
const {Controller}=require('../src/main/controller.cjs'),{installIPC}=require('../src/main/ipc.cjs');
const {isPublicAddress}=require('../src/main/subscription-policy.cjs');
const originalLookup=dns.lookup,originalRequest=http.request;
dns.lookup=(host,options)=>host==='subscription.example.test'||host==='refused.example.test'
 ?Promise.resolve([{address:'2606:4700:4700::1111',family:6},{address:host==='refused.example.test'?'1.1.1.1':'93.184.216.34',family:4}])
 :originalLookup(host,options);
http.request=function(url,options,callback){
 if(!(url instanceof URL)||!['subscription.example.test','refused.example.test'].includes(url.hostname))return originalRequest.apply(this,arguments);
 const lookup=(host,settings,done)=>options.lookup(host,settings,(error,rows,family)=>{
  if(error)return done(error);
  const map=address=>{assert(isPublicAddress(address));if(address==='2606:4700:4700::1111')return '::1';if(address==='93.184.216.34')return '127.0.0.1';if(address==='1.1.1.1')return '127.0.0.2';throw Error('Unexpected destination');};
  if(Array.isArray(rows))done(null,rows.map(row=>({...row,address:map(row.address)})));else done(null,map(rows),family);
 });
 return originalRequest(url,{...options,lookup},callback);
};
const passes=[],pass=label=>{passes.push(label);console.log('PASS '+label);};
const wait=async(fn,label)=>{for(let i=0;i<700;i++){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('Timeout: '+label);};
let c,win,dispose,error;
setTimeout(()=>app.exit(2),120000).unref();
app.whenReady().then(async()=>{try{
 win=new BrowserWindow({show:false,width:1400,height:850,webPreferences:{preload:path.resolve('src/main/preload.cjs'),sandbox:true,nodeIntegration:false,contextIsolation:true}});
 c=new Controller(win,root,path.resolve('resources/mihomo/mihomo.exe'));dispose=installIPC(win,c);
 await win.loadFile(path.resolve('src/renderer/index.html'));const ui=code=>win.webContents.executeJavaScript(code);
 await wait(()=>ui('typeof openProxyEntry==="function"&&state.instances.length>0'),'renderer');await ui("route('proxies')");
 const click=selector=>ui(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const base='http://subscription.example.test:'+Number(process.env.FACET_SUBSCRIPTION_PORT);
 if(phase==='write'){
  const add=async(name,url)=>{
   await click('[data-lib=add-source]');
   await ui(`document.querySelector('#proxyEntryName').value=${JSON.stringify(name)};document.querySelector('#proxyEntryURL').value=${JSON.stringify(url)};document.querySelector('#proxyEntryForm').requestSubmit()`);
   assert.equal(await ui('document.querySelector("[data-proxy-entry=save]").disabled'),true);
   await wait(()=>!c.library.data.sources.every(source=>source.name!==name),'source persisted');
   await wait(()=>ui('!modal'),'import dialog closes');
   return c.library.data.sources.find(source=>source.name===name).id;
  };
  const a=await add('订阅导入验证 A',base+'/sub-a'),b=await add('订阅导入验证 B',base+'/sub-b');
  assert.equal(c.library.get(a).nodes.length,1);assert.equal(await ui('document.querySelectorAll("[data-library-node]").length'),1);
  pass('UI imports two subscriptions over real TCP after the unavailable first address; busy state and node list are correct');
  const beforeSingle=c.library.get(b).updatedAt;
  await click(`[data-lib=refresh][data-source="${b}"]`);await wait(()=>c.library.get(b).updatedAt!==beforeSingle,'single refresh');await wait(()=>ui('!libraryBusy'),'single refresh busy');
  pass('Single-source update downloads again and persists its timestamp');
  const beforeAll=[a,b].map(id=>c.library.get(id).updatedAt);
  await ui('Array.from(document.querySelectorAll("[data-source-group]")).find(element=>element.dataset.sourceGroup===LIBRARY_ALL).querySelector("summary").click()');
  await click('[data-lib=refresh-all]');await wait(()=>[a,b].every((id,index)=>c.library.get(id).updatedAt!==beforeAll[index]),'all refresh');await wait(()=>ui('!libraryBusy'),'all refresh busy');
  pass('Update-all refreshes both subscriptions through the same downloader');
  const original=fs.readFileSync(c.library.file);
  for(const [label,url,expected]of [['HTML',base+'/html','网页'],['private','http://127.0.0.1:'+Number(process.env.FACET_SUBSCRIPTION_PORT)+'/sub-a','本机或内网'],['refused',base.replace('subscription.example.test','refused.example.test')+'/sub-a','ECONNREFUSED']]){
   await ui(`openProxyEntry(state.library.find(source=>source.id===${JSON.stringify(a)}));document.querySelector('#proxyEntryURL').value=${JSON.stringify(url)};document.querySelector('#proxyEntryForm').requestSubmit()`);
   await wait(()=>ui('!!modal&&!modal.busy&&!document.querySelector("#proxyEntryError").hidden'),'failed '+label);
   assert((await ui('document.querySelector("#proxyEntryError").textContent')).includes(expected));
   assert.equal(await ui('document.querySelector("#proxyEntryURL").value'),url);
   assert.deepEqual(fs.readFileSync(c.library.file),original);await ui('closeModal(true)');
  }
  pass('Invalid HTML, private destinations and refused connections report errors, retain retry input and preserve the original source byte for byte');
  const instance=c.store.list()[0];
  const assigned=await ui(`request('library-assign',{id:${JSON.stringify(instance.id)},sourceId:${JSON.stringify(a)},name:'导入验证节点'})`);assert.equal(assigned.status,'success');
  c.store.update(instance.id,{url:'http://import-page.facet.invalid/page'});
  await c.start(instance.id);await wait(()=>c.runtimes.get(instance.id)?.view?.webContents.getTitle()==='Imported subscription page','independent proxied page');
  assert.equal(c.runtimes.get(instance.id).status,'running');assert.equal(await c.runtimes.get(instance.id).session.resolveProxy('http://import-page.facet.invalid/page').then(value=>value.startsWith('PROXY 127.0.0.1:')),true);
  pass('An imported node is assigned and opens a real instance page through the independent Mihomo process');
  const switched=await c.setProxyMode('node',{confirmed:true});assert.equal(switched.mode,'node');
  await wait(()=>c.runtimes.get(instance.id)?.status==='running'&&c.runtimes.get(instance.id).view?.webContents.getTitle()==='Imported subscription page','shared proxied page');
  await c.syncNodePorts();assert.equal(c.proxyPool.lookup(c.library.node(a,'导入验证节点')).running,true);
  const port=c.proxyPool.lookup(c.library.node(a,'导入验证节点')).port;
  assert.equal(c.runtimes.get(instance.id).core.proxyPort,port);
  fs.writeFileSync(path.join(root,'import-expectations.json'),JSON.stringify({a,b,instanceId:instance.id,port}));
  pass('Shared-port mode publishes the imported node and restores the running instance with an actually loaded page');
  await ui("route('proxies')");win.show();await new Promise(resolve=>setTimeout(resolve,150));fs.writeFileSync(path.join(artifacts,'imported-nodes.png'),(await win.webContents.capturePage()).toPNG());
 }else{
  const expected=JSON.parse(fs.readFileSync(path.join(root,'import-expectations.json')));
  assert.equal(c.library.get(expected.a).url,base+'/sub-a');assert.equal(c.library.get(expected.b).url,base+'/sub-b');
  assert.equal(c.store.source(expected.instanceId).assignment.sourceId,expected.a);
  assert.equal(c.proxyPool.registry.data.enabled,true);await c.restoreNodePorts();
  assert.equal(c.proxyPool.lookup(c.library.node(expected.a,'导入验证节点')).port,expected.port);
  await c.start(expected.instanceId);await wait(()=>c.runtimes.get(expected.instanceId)?.view?.webContents.getTitle()==='Imported subscription page','restarted page');
  pass('A fresh Electron process restores sources, assignment, shared-mode preference, stable port and actual page access');
  const before=c.library.get(expected.a).updatedAt;
  await ui(`request('library-save',{sourceId:${JSON.stringify(expected.a)}})`);assert.notEqual(c.library.get(expected.a).updatedAt,before);
  assert.equal(c.runtimes.get(expected.instanceId).status,'running');
  pass('Subscription update still works after restart without replacing the running instance node copy');
  c.networkTrace.flush();const rows=JSON.parse(fs.readFileSync(c.networkTrace.file)).rows.filter(row=>row.operation==='subscription');
  assert(rows.some(row=>row.result==='failed'&&row.steps.some(step=>step.code==='ECONNREFUSED')));
  assert(rows.some(row=>row.result==='success'&&row.steps.some(step=>step.stage==='tcp-attempt-error')));
  pass('Persisted diagnostics contain both address attempts and failure codes from the previous process');
 }
 await c.closeAll();assert.equal(c.proxyPool.groups.size,0);assert([...c.runtimes.values()].every(runtime=>!runtime.core?.child));
 pass('All test-owned instances and proxy processes are stopped');
}catch(caught){error=caught;console.error(caught.stack);}finally{
 try{await c?.closeAll();}catch(caught){error=error||caught;}dispose?.();if(win&&!win.isDestroyed())win.destroy();dns.lookup=originalLookup;http.request=originalRequest;
 fs.writeFileSync(path.join(artifacts,phase+'-result.json'),JSON.stringify({phase,passes,error:error?.stack||null,runtime:{electron:process.versions.electron,node:process.versions.node,chrome:process.versions.chrome},entry:__filename},null,2));app.exit(error?1:0);
}});
