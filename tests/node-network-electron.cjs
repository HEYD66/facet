'use strict';
// Real Electron UI and bundled Mihomo integration. Optional authenticated node
// is read from an existing library at runtime; never print or retain credentials.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=process.env.FACET_NETWORK_TEST_DATA||fs.mkdtempSync(path.join(os.tmpdir(),'facet-network-electron-'));
app.setPath('userData',root);
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
const {Controller}=require('../src/main/controller.cjs'),{installIPC}=require('../src/main/ipc.cjs');
const {NodeNetwork}=require('../src/main/node-network.cjs');
const results=[];let win,c,server;
const report=process.env.FACET_NETWORK_TEST_REPORT;
const pass=name=>{results.push({name,passed:true});console.log('PASS '+name);};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(fn,label){for(let i=0;i<900;i++){if(await fn())return;await sleep(50);}throw Error('Timeout: '+label);}
function externalNode(){
 if(!process.env.FACET_NETWORK_TEST_LIBRARY)return null;
 const data=JSON.parse(fs.readFileSync(process.env.FACET_NETWORK_TEST_LIBRARY,'utf8'));
 const node=data.sources.flatMap(s=>s.nodes)[Number(process.env.FACET_NETWORK_TEST_NODE_INDEX)];
 assert(node&&node.server&&node.type,'Selected test node unavailable');
 return {...node,name:'Network compatibility test node'};
}
setTimeout(()=>app.exit(2),180000).unref();
app.whenReady().then(async()=>{let failed=false;try{
 server=http.createServer((_req,res)=>res.end('<!doctype html><title>Preserved direct instance</title><h1>Local page</h1>'));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 win=new BrowserWindow({width:1320,height:940,show:true,webPreferences:{preload:path.join(__dirname,'../src/main/preload.cjs'),sandbox:true,nodeIntegration:false,contextIsolation:true}});
 c=new Controller(win,root,path.resolve('resources/mihomo/mihomo.exe'));installIPC(win,c);
 await win.loadFile(path.resolve('src/renderer/index.html'));
 const ui=code=>win.webContents.executeJavaScript(code);
 await wait(()=>ui('typeof route==="function"&&state.instances.length>0'),'UI initialization');
 const click=async selector=>{const quoted=JSON.stringify(selector);if(await ui(`!!document.querySelector(${quoted})?.closest('[hidden]')`)){await ui(`document.querySelector(${quoted}).click()`);return;}win.focus();win.webContents.focus();await ui('document.querySelector('+quoted+').scrollIntoView({block:"center",behavior:"instant"})');await sleep(80);const pos=await ui('(el=>{const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})(document.querySelector('+quoted+'))');assert.equal(await ui('document.elementFromPoint('+pos.x+','+pos.y+').closest("button")?.id'),selector.slice(1),'Button is not visible at click position');win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...pos});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...pos});};
 const selected=externalNode();
 if(process.env.FACET_NETWORK_TEST_PHASE==='restart'){
  assert.equal(c.nodeNetwork.settings.dnsMode,'secure');assert.equal(c.nodeNetwork.settings.routeMode,'physical');
  await ui("route('settings')");assert.equal(await ui('document.querySelector("#nodeRouteMode").value'),'physical');
  pass('Application restart restores saved DNS and route choices in real UI');
  if(selected){const result=await c.diagnostics.probe(selected,'ip',new AbortController().signal,'restart');assert(result.countryCode&&result.timezone);assert.equal(c.diagnostics.cores.size,0);pass('After application restart a fresh core obtains real exit location with saved policy');}
 }else{
  assert.equal(c.nodeNetwork.settings.routeMode,'system');assert.equal(c.nodeNetwork.settings.dnsMode,'system');
  const direct=c.store.list()[0];c.store.update(direct.id,{url:'http://127.0.0.1:'+server.address().port});await c.start(direct.id);
  const original=c.runtimes.get(direct.id).view.webContents;
  await wait(()=>original.getTitle()==='Preserved direct instance','direct page');
  await ui("route('settings')");assert.equal(await ui('document.querySelector("#nodeNetworkCard").hidden'),false);
  assert(await ui('document.querySelector("#nodeDnsMode").getBoundingClientRect().height>0'));
  assert.deepEqual(await ui('[...document.querySelector("#nodeDnsMode").options].map(x=>x.value)'),['auto','system','secure','strict']);
  assert.equal(await ui('!!document.querySelector("#nodeNetworkReset")'),false);pass('DNS panel is visible with all four modes and default policy unchanged');
  await click('#nodeNetworkRefresh');await wait(()=>ui('!networkBusy&&networkRows.length>0'),'real network inventory');
  assert(await ui('networkRows.some(row=>row.physical&&row.defaultRoute)'));pass('Refresh button reads real physical and virtual interfaces');
  await ui('document.querySelector("#nodeRouteMode").value="physical";document.querySelector("#nodeRouteMode").dispatchEvent(new Event("change",{bubbles:true}));document.querySelector("#nodeDnsMode").value="secure";document.querySelector("#nodeDnsMode").dispatchEvent(new Event("change",{bubbles:true}))');
  await click('#nodeNetworkSave');await wait(()=>ui('!networkBusy&&networkMessage.startsWith("已保存")'),'persist settings via UI');
  assert.equal(new NodeNetwork(root).settings.routeMode,'physical');assert.equal(c.runtimes.get(direct.id).view.webContents,original);assert.equal(c.runtimes.get(direct.id).status,'running');pass('Save persists policy without restarting or changing an existing direct view');
  const physical=(await c.nodeNetwork.interfaces()).filter(r=>r.physical&&r.defaultRoute).sort((a,b)=>a.metric-b.metric||a.index-b.index)[0];
  await ui('document.querySelector("#nodeRouteMode").value="interface";document.querySelector("#nodeRouteMode").dispatchEvent(new Event("change",{bubbles:true}))');
  await ui('document.querySelector("#nodeInterfaceName").value='+JSON.stringify(physical.name));await click('#nodeNetworkSave');await wait(()=>!networkBusyVia(c)&&c.nodeNetwork.settings.routeMode==='interface','manual selection saved');pass('Manual interface selection saves actual interface identity');
  await assert.rejects(c.nodeNetwork.save({dnsMode:'secure',routeMode:'interface',interfaceName:'Facet nonexistent interface'}),/未回退/);assert.equal(c.nodeNetwork.settings.routeMode,'interface');pass('Unavailable interface refuses save and preserves prior policy');
  await c.nodeNetwork.save({dnsMode:'secure',routeMode:'physical'});c.emit();
  await ui("route('settings')");await ui('document.querySelector("#nodeNetworkCard").scrollIntoView({block:"center",behavior:"instant"})');await sleep(100);
  if(report)fs.writeFileSync(report+'.png',(await win.webContents.capturePage()).toPNG());
  if(selected){
   const target=c.store.create('DNS compatibility instance',{mode:'mihomo',nodeName:selected.name});c.store.saveNodes(target.id,[selected],null);c.store.update(target.id,{url:'https://www.cloudflare.com/cdn-cgi/trace'});
   await c.start(target.id);const r=c.runtimes.get(target.id),config=JSON.parse(fs.readFileSync(r.core.config,'utf8'));
   assert.equal(config.proxies[0].server,selected.server);assert.equal(config['interface-name'],physical.name);assert.equal(config.dns.enable,false);assert.equal(Object.keys(config.hosts).length,1);assert.deepEqual(config.rules,['MATCH,arena-upstream']);
   await wait(async()=>/\bip=/.test(await r.view.webContents.executeJavaScript('document.body.innerText').catch(()=>'')),'real instance HTTPS page');
   assert.equal(await r.session.resolveProxy('https://www.cloudflare.com/'),'PROXY 127.0.0.1:'+r.core.proxyPort);pass('Authenticated node loads a real HTTPS page through bundled core with scoped DNS and physical routing');
   const live=r.view.webContents;
   for(const kind of ['latency','ip','speed']){let row;for(let attempt=0;attempt<(kind==='speed'?2:1);attempt++){c.diagnostics.run([{instanceId:target.id,name:selected.name}],kind,1);const taskId=c.diagnostics.job.id;await wait(()=>!c.diagnostics.work,kind+' result');row=[...c.diagnostics.results.values()].find(x=>x.taskId===taskId);assert.equal(c.diagnostics.cores.size,0);if(row?.ok)break;if(attempt===0&&kind==='speed')console.log('Public speed target did not finish; retrying once with a fresh detection core');}assert(row?.ok,kind+' failed: '+(row?.error||'no result'));if(kind==='ip'){assert(row.countryCode);assert(row.timezone);}if(kind==='speed')assert.equal(row.bytes,5000000);assert.equal(r.view.webContents,live);assert.equal(c.diagnostics.cores.size,0);pass('Real '+kind+' detection uses selected node and leaves running views unchanged');}
   const before=fs.readFileSync(c.store.file);c.store.saveNodes(target.id,[{...selected,port:1}],null);
   c.diagnostics.run([{instanceId:target.id,name:selected.name}],'ip',1);const failedTask=c.diagnostics.job.id;await wait(()=>!c.diagnostics.work,'bad node failure');assert.equal([...c.diagnostics.results.values()].find(x=>x.taskId===failedTask).ok,false);assert.equal(r.view.webContents,live);assert.equal(c.diagnostics.cores.size,0);assert.deepEqual(fs.readFileSync(c.store.file),before);pass('Failed upstream stays failed without direct fallback or stopping active instance');
   c.store.saveNodes(target.id,[selected],null);c.diagnostics.run([{instanceId:target.id,name:selected.name}],'speed',1);const cancelledTask=c.diagnostics.job.id;await wait(()=>c.diagnostics.cores.size>0,'cancellable core preparation');c.diagnostics.cancel();await wait(()=>!c.diagnostics.work,'cancel cleanup');assert.equal(c.diagnostics.lastJob.cancelled,true);assert.equal([...c.diagnostics.results.values()].find(x=>x.taskId===cancelledTask).error,'已取消');assert.equal(c.diagnostics.cores.size,0);assert.equal(r.view.webContents,live);pass('Cancelling detection during preparation removes its core and leaves active views running');
   await c.stop(target.id);assert(!fs.existsSync(r.core?.config||path.join(root,'core-runtime',target.id,'runtime.json')));
  }
 }
}catch(error){failed=true;console.error('FAIL '+(error.safeDiagnostic||String(error.message).replace(/https?:\/\/\S+/g,'[URL]').slice(0,240)));if(win&&!win.isDestroyed()){console.error('UI status: '+await win.webContents.executeJavaScript('JSON.stringify({busy:networkBusy,message:networkMessage,error:networkListError,count:networkRows.length})').catch(()=>''));if(report)fs.writeFileSync(report+'.png',(await win.webContents.capturePage()).toPNG());}}
finally{
 try{if(c)await c.closeAll();if(win&&!win.isDestroyed())win.destroy();if(server)await new Promise(resolve=>server.close(resolve));}catch{failed=true;}
 const output={at:new Date().toISOString(),phase:process.env.FACET_NETWORK_TEST_PHASE||'first',passed:!failed,results};if(report)fs.writeFileSync(report,JSON.stringify(output,null,2));
 if(!process.env.FACET_NETWORK_TEST_DATA)console.log('Isolated test profile retained until Electron exits; use node-network-runner.cjs for cleanup');app.exit(failed?1:0);
}});
function networkBusyVia(controller){return controller.queues.has('node-network');}
