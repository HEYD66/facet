'use strict';
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),https=require('node:https'),assert=require('node:assert/strict');
const {Controller}=require('../src/main/controller.cjs');
const {environment}=require('../src/main/environment.cjs');
const {preset}=require('../src/main/fingerprint.cjs');
const {contextEnvironmentState}=require('../src/main/environment-contexts.cjs');
const root=process.argv.find(x=>x.startsWith('--test-profile='))?.slice(15)||fs.mkdtempSync(path.join(os.tmpdir(),'facet-fingerprint-contexts-'));
const resume=process.argv.includes('--resume');
app.setPath('userData',root);app.on('window-all-closed',()=>{});
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('site-per-process');
app.commandLine.appendSwitch('host-resolver-rules','MAP *.test 127.0.0.1');
app.commandLine.appendSwitch('disable-gpu');
const testCdp=process.argv.find(x=>x.startsWith('--test-cdp='));
const browserEnvironmentReady=require('../src/main/environment-shared-worker.cjs').prepareSharedWorkerEnvironment(app,{externalPort:testCdp?Number(testCdp.slice('--test-cdp='.length)):null});

async function sample(){
 const nav=navigator;
 const canvas=typeof document==='undefined'?new OffscreenCanvas(64,64):document.createElement('canvas');
 const gl=canvas.getContext('webgl');
 const ext=gl&&gl.getExtension('WEBGL_debug_renderer_info');
 const drawing=new OffscreenCanvas(32,32),context=drawing.getContext('2d');context.fillStyle='#7296be';context.fillRect(0,0,32,32);
 const blob=await drawing.convertToBlob(),encoded=Array.from(new Uint8Array(await blob.arrayBuffer()),x=>x.toString(16).padStart(2,'0')).join('');
 return {patched:!!globalThis.__arenaFingerprintV3Applied,webdriver:typeof document==='undefined'?null:nav.webdriver,ua:nav.userAgent,platform:nav.platform,cpu:nav.hardwareConcurrency,memory:nav.deviceMemory,
  language:nav.language,languages:Array.from(nav.languages),tz:Intl.DateTimeFormat().resolvedOptions().timeZone,
  vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):null,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,
  screen:typeof screen==='undefined'?null:[screen.width,screen.height,screen.availHeight,screen.colorDepth],
  canvasPng:encoded,
  hints:nav.userAgentData?await nav.userAgentData.getHighEntropyValues(['architecture','bitness','platformVersion','fullVersionList']):null};
}
const sampleSource='('+sample.toString()+')()';
const checks=[],observed={},boundaries=[];let win,controller,server,externalBrowser;
function verify(value,env,label){
 const expected={ua:env.userAgent,platform:env.platform,cpu:env.cpu,memory:env.fingerprint.memory,language:env.language,
  languages:[env.language],tz:env.timezone,vendor:env.fingerprint.vendor,renderer:env.fingerprint.renderer};
 observed[label]=value;
 for(const [key,v]of Object.entries(expected))assert.deepEqual(value[key],v,label+': '+key);
 if(observed[label.split(':')[0]+': main first script']?.hints)assert.deepEqual(value.hints,observed[label.split(':')[0]+': main first script'].hints,label+': UA-CH');
 if(observed[label.split(':')[0]+': main first script']?.canvasPng)assert.equal(value.canvasPng,observed[label.split(':')[0]+': main first script'].canvasPng,label+': Offscreen export');
 if(value.screen){assert.equal(value.webdriver,false,label+': internal environment pipe does not enable WebDriver');assert.deepEqual(value.screen,[env.fingerprint.screenWidth,env.fingerprint.screenHeight,env.fingerprint.availHeight,env.fingerprint.colorDepth],label+': screen');}
 checks.push(label);
}
async function wait(fn,label){
 const end=Date.now()+20000;
 while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,30));}
 throw Error('Timeout: '+label);
}
async function loaded(wc,url){await wait(()=>!wc.isDestroyed()&&!wc.isLoading()&&wc.getURL()===url,'load '+url);}
async function worker(wc,kind){
 const code=kind==='blob'?
  'const u=URL.createObjectURL(new Blob(['+JSON.stringify('('+sample.toString()+')().then(value=>postMessage(value));')+'],{type:"text/javascript"}));const w=new Worker(u);':
  'const w=new Worker('+JSON.stringify(kind==='nested'?'/nested-worker.js':'/worker.js')+','+JSON.stringify(kind==='module'?{type:'module'}:{})+');';
 return wc.executeJavaScript('new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("Worker timeout")),15000);'+code+
  'w.onmessage=e=>{clearTimeout(timer);w.terminate();'+(kind==='blob'?'URL.revokeObjectURL(u);':'')+'resolve(e.data)};w.onerror=e=>{clearTimeout(timer);w.terminate();reject(Error(e.message||"Worker error"))};})');
}
async function sharedWorker(wc,suffix=''){
 return wc.executeJavaScript('new Promise((resolve,reject)=>{const w=new SharedWorker('+JSON.stringify('/shared-worker.js'+suffix)+'),timer=setTimeout(()=>reject(Error("SharedWorker timeout")),15000);w.port.onmessage=e=>{clearTimeout(timer);w.port.close();resolve(e.data)};w.onerror=e=>{clearTimeout(timer);reject(Error(e.message||"SharedWorker error"))};w.port.start();})');
}
async function serviceWorker(wc){
 return wc.executeJavaScript('Promise.race([(async()=>{await navigator.serviceWorker.register("/service-worker.js");const r=await navigator.serviceWorker.ready;return new Promise((resolve,reject)=>{const c=new MessageChannel(),timer=setTimeout(()=>reject(Error("ServiceWorker message timeout")),10000);c.port1.onmessage=e=>{clearTimeout(timer);c.port1.close();resolve(e.data)};r.active.postMessage("sample",[c.port2]);});})(),new Promise((_,reject)=>setTimeout(()=>reject(Error("ServiceWorker ready timeout")),15000))])');
}
async function behavior(){
 const fail=fn=>{try{fn();return null;}catch(e){return e.name;}};
 const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;
 const ctx=canvas.getContext('2d');
 const blank=Array.from(ctx.getImageData(0,0,32,32).data).every(x=>x===0);
 const buffer=new AudioBuffer({numberOfChannels:1,length:256,sampleRate:48000});
 const empty=buffer.getChannelData(0),silence=Array.from(empty).every(x=>x===0);
 empty[17]=0.125;empty[42]=-0.25;
 const before=Array.from(empty),same=buffer.getChannelData(0),copy=new Float32Array(256);buffer.copyFromChannel(copy,0);
 const audio={silence,sameReference:same===empty,readUnchanged:JSON.stringify(before)===JSON.stringify(Array.from(same)),copyMatches:JSON.stringify(before)===JSON.stringify(Array.from(copy))};
 const c=document.createElement('canvas'),gl=c.getContext('webgl');
 while(gl.getError()){}
 const withoutExtension=gl.getParameter(37445),error=gl.getError();
 const badReceiver=fail(()=>WebGLRenderingContext.prototype.getParameter.call({},37445));
 let conversions=0;gl.getExtension('WEBGL_debug_renderer_info');
 const vendor=gl.getParameter({valueOf(){conversions++;return 37445;}});
 let mimeConversions=0;const mimeError=fail(()=>canvas.toDataURL({toString(){mimeConversions++;throw new TypeError('fixture');}}));
 let invalidReads=0;const invalidCanvas=fail(()=>HTMLCanvasElement.prototype.toDataURL.call({get width(){invalidReads++;return 1;},get height(){invalidReads++;return 1;}}));
 const owned=document.createElement('canvas').transferControlToOffscreen();let ownedError;try{await owned.convertToBlob();}catch(e){ownedError=e.name;}
 const zero=document.createElement('canvas');zero.width=0;
 const detached=document.createElement('div').getBoundingClientRect();
 const render=async silent=>{
  const context=new OfflineAudioContext(1,2048,48000);
  if(!silent){const osc=context.createOscillator();osc.type='triangle';osc.frequency.value=430;osc.connect(context.destination);osc.start();}
  let eventSamples;const completed=new Promise(resolve=>{context.oncomplete=e=>{eventSamples=Array.from(e.renderedBuffer.getChannelData(0));resolve();};});
  const output=await context.startRendering();await completed;
  const a=Array.from(output.getChannelData(0)),b=new Float32Array(output.length);output.copyFromChannel(b,0);
  return {samples:a,eventMatches:JSON.stringify(eventSamples)===JSON.stringify(a),copyMatches:JSON.stringify(Array.from(b))===JSON.stringify(a)};
 };
 const a=await render(false),b=await render(false),quiet=await render(true);
 return {blank,audio,withoutExtension,error,badReceiver,vendor,conversions,mimeConversions,mimeError,invalidReads,invalidCanvas,ownedError,zeroURL:zero.toDataURL(),
  detached:[detached.x,detached.y,detached.width,detached.height],
  offline:{stable:JSON.stringify(a.samples)===JSON.stringify(b.samples),eventMatches:a.eventMatches,copyMatches:a.copyMatches,silence:quiet.samples.every(x=>x===0)}};
}
const deadline=setTimeout(()=>app.exit(2),150000);deadline.unref();
app.whenReady().then(async()=>{let error;try{
 await browserEnvironmentReady;
 if(testCdp)externalBrowser=await require('playwright').chromium.connectOverCDP('http://127.0.0.1:'+testCdp.slice('--test-cdp='.length));
 const cert=fs.readFileSync(path.join(__dirname,'fixtures/dns/cert.pem'),'utf8');
 server=https.createServer({key:fs.readFileSync(path.join(__dirname,'fixtures/dns/key.pem')),cert},(req,res)=>{
  const url=new URL(req.url,'https://fixture.test');
  res.setHeader('Cache-Control','no-store');
  if(url.pathname.endsWith('.js')){
   res.setHeader('Content-Type','text/javascript');
   if(url.pathname==='/worker.js')return res.end(sampleSource+'.then(value=>postMessage(value));');
   if(url.pathname==='/nested-worker.js')return res.end('const w=new Worker("/worker.js");w.onmessage=e=>{postMessage(e.data);w.terminate()};');
   if(url.pathname==='/shared-worker.js')return res.end('const entry={patched:!!globalThis.__arenaFingerprintV3Applied,entryUA:navigator.userAgent,entryCPU:navigator.hardwareConcurrency,entryLanguage:navigator.language};const first=('+sample.toString()+')().then(value=>({...value,...entry}));onconnect=e=>first.then(value=>e.ports[0].postMessage(value));');
   if(url.pathname==='/service-worker.js')return res.end('const first='+sampleSource+';self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("activate",e=>e.waitUntil(clients.claim()));self.addEventListener("message",e=>e.waitUntil(first.then(value=>e.ports[0].postMessage(value))));');
  }
  res.setHeader('Content-Type','text/html');
  res.end('<!doctype html><title>Fingerprint contexts fixture</title><script>globalThis.firstSample='+sampleSource+';</script><p>Context fixture</p>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port,mainURL='https://main.alpha.test:'+port+'/',frameURL='https://frame.beta.test:'+port+'/frame';
 win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 controller=new Controller(win,root,path.join(root,'unused-core'));
 const marker=path.join(root,'contexts-expected.json');let ids,expected;
 if(resume){({ids,expected}=JSON.parse(fs.readFileSync(marker,'utf8')));for(let i=0;i<ids.length;i++)assert.deepEqual(controller.store.get(ids[i]).environment,expected[i]);}
 else{
  ids=[controller.store.list()[0].id,controller.store.create('Context isolation B').id];
  expected=[environment({...preset('library-v1',{language:'en-US',timezone:'America/New_York'},'context-alpha'),cpu:7,
   fingerprint:{...preset('library-v1',{},'context-alpha').fingerprint,memory:4,rects:true}}),
   environment({...preset('library-v1',{language:'ja-JP',timezone:'Asia/Tokyo'},'context-beta'),cpu:12,
    fingerprint:{...preset('library-v1',{},'context-beta').fingerprint,memory:8,rects:true}})];
  for(let i=0;i<ids.length;i++)controller.store.update(ids[i],{environment:expected[i]});
  fs.writeFileSync(marker,JSON.stringify({ids,expected},null,2));
 }
 for(let i=0;i<ids.length;i++){
  const ses=session.fromPartition('persist:arena-core-'+ids[i]);
  ses.setCertificateVerifyProc((req,cb)=>cb(req.hostname.endsWith('.test')&&req.certificate.data.trim()===cert.trim()?0:-3));
  // A fresh-process phase serves on a new port; saved browser tabs would reopen the previous one.
  controller.store.update(ids[i],{url:mainURL,browserTabs:{activeId:'fixture',items:[{id:'fixture',url:mainURL}]}});await controller.start(ids[i]);
  const wc=controller.runtimes.get(ids[i]).view.webContents;
  await loaded(wc,mainURL);
  verify(await wc.executeJavaScript('firstSample'),expected[i],i+': main first script');
  for(const kind of ['dedicated','blob','module','nested'])verify(await worker(wc,kind),expected[i],i+': '+kind+' worker first script');
  verify(await serviceWorker(wc),expected[i],i+': service worker first script');
  for(const [label,run]of [['shared worker',sharedWorker]]){
   let value;try{value=await run(wc);}catch(error){boundaries.push({instance:i,type:label,error:error.message});continue;}observed[i+': '+label]=value;
   const differences=['patched','entryUA','entryCPU','entryLanguage'].filter((key)=>value[key]!==({patched:true,entryUA:expected[i].userAgent,entryCPU:expected[i].cpu,entryLanguage:expected[i].language})[key]);
   differences.push(...['ua','cpu','memory','language','tz','vendor','renderer'].filter(key=>value[key]!==({ua:expected[i].userAgent,cpu:expected[i].cpu,memory:expected[i].fingerprint.memory,language:expected[i].language,tz:expected[i].timezone,vendor:expected[i].fingerprint.vendor,renderer:expected[i].fingerprint.renderer})[key]));
   if(value.canvasPng!==observed[i+': main first script'].canvasPng)differences.push('Offscreen export');
   if(differences.length)boundaries.push({instance:i,type:label,differences});else checks.push(i+': '+label);
  }
  observed[i+': targets']={children:[...contextEnvironmentState(wc).children],pending:contextEnvironmentState(wc).pending.size,serviceWorkers:ses.serviceWorkers.getAllRunning()};
  await wc.executeJavaScript('(()=>{const f=document.createElement("iframe");f.id="cross";f.src='+JSON.stringify(frameURL)+';document.body.append(f);})()');
  await wait(()=>wc.mainFrame.framesInSubtree.some(f=>f.url===frameURL),'cross-site iframe');
  const frame=wc.mainFrame.framesInSubtree.find(f=>f.url===frameURL);
  await wait(()=>frame.executeJavaScript('typeof firstSample!=="undefined"').catch(()=>false),'cross-site first script ready');
  assert.notEqual(frame.processId,wc.mainFrame.processId,'Fixture must use a separate renderer process');
  verify(await frame.executeJavaScript('firstSample'),expected[i],i+': OOPIF first script');
  verify(await frame.executeJavaScript(sampleSource),expected[i],i+': OOPIF later read');
  // A worker created inside an OOPIF must inherit the same instance settings.
  verify(await frame.executeJavaScript('new Promise((resolve,reject)=>{const w=new Worker("/worker.js");w.onmessage=e=>{w.terminate();resolve(e.data)};w.onerror=e=>reject(Error(e.message));})'),expected[i],i+': OOPIF worker');
  const navigatedURL=frameURL.replace('frame.beta.test','next.gamma.test')+'?navigate=1';
  await wc.executeJavaScript('document.querySelector("#cross").src='+JSON.stringify(navigatedURL));
  await wait(()=>wc.mainFrame.framesInSubtree.some(f=>f.url===navigatedURL),'iframe navigation');
  const navigated=wc.mainFrame.framesInSubtree.find(f=>f.url===navigatedURL);
  await wait(()=>navigated.executeJavaScript('typeof firstSample!=="undefined"').catch(()=>false),'navigated first script ready');
  verify(await navigated.executeJavaScript('firstSample'),expected[i],i+': OOPIF navigation first script');
  const v=await wc.executeJavaScript('('+behavior.toString()+')()');observed[i+': API behavior']=v;
  assert.equal(v.blank,true,'Empty Canvas must remain zero');
  assert.deepEqual(v.audio,{silence:true,sameReference:true,readUnchanged:true,copyMatches:true});
  assert.equal(v.withoutExtension,null);assert.equal(v.error,1280);
  assert.equal(v.badReceiver,'TypeError');assert.equal(v.vendor,expected[i].fingerprint.vendor);assert.equal(v.conversions,1);
  assert.equal(v.mimeError,'TypeError');assert.equal(v.mimeConversions,1);assert.equal(v.zeroURL,'data:,');
  assert.equal(v.invalidCanvas,'TypeError');assert.equal(v.invalidReads,0);assert.equal(v.ownedError,'InvalidStateError');
  assert.deepEqual(v.detached,[0,0,0,0]);assert.deepEqual(v.offline,{stable:true,eventMatches:true,copyMatches:true,silence:true});
  assert.deepEqual(contextEnvironmentState(wc).errors,[]);
  checks.push(i+': native API semantics, Canvas/Audio stability, target error list');
 }
 const first=controller.runtimes.get(ids[0]).view.webContents;
 await controller.stop(ids[0]);assert.equal(contextEnvironmentState(first),undefined);
 await controller.start(ids[0]);const restarted=controller.runtimes.get(ids[0]).view.webContents;await loaded(restarted,mainURL);
 verify(await restarted.executeJavaScript('firstSample'),expected[0],'instance restart: first script');
 verify(await worker(restarted,'dedicated'),expected[0],'instance restart: worker');
 verify(await sharedWorker(restarted),expected[0],'instance restart: shared worker');
 verify(await serviceWorker(restarted),expected[0],'instance restart: service worker');
 verify(await worker(controller.runtimes.get(ids[1]).view.webContents,'dedicated'),expected[1],'other instance remains isolated');
 let changed=environment({...expected[0],cpu:9,fingerprint:{...expected[0].fingerprint,memory:4}});
 await controller.settings(ids[0],{environment:changed});await controller.start(ids[0]);
 const changedWC=controller.runtimes.get(ids[0]).view.webContents;await loaded(changedWC,mainURL);
 verify(await sharedWorker(changedWC),changed,'changed environment: shared worker');
 verify(await serviceWorker(changedWC),changed,'changed environment: existing service worker');
 changed=environment({...changed,timezone:'Europe/Paris'});
 await controller.settings(ids[0],{environment:changed});await controller.start(ids[0]);
 const timezoneWC=controller.runtimes.get(ids[0]).view.webContents;await loaded(timezoneWC,mainURL);
 verify(await sharedWorker(timezoneWC),changed,'timezone-only change: shared worker');
 verify(await serviceWorker(timezoneWC),changed,'timezone-only change: existing service worker');
 await controller.settings(ids[0],{environment:{...changed,fingerprint:{...changed.fingerprint,enabled:false}}});await controller.start(ids[0]);
 const disabledWC=controller.runtimes.get(ids[0]).view.webContents;await loaded(disabledWC,mainURL);
 assert.equal((await serviceWorker(disabledWC)).patched,false,'Disabling must not leave the previous service-worker injection running');
 assert.equal((await sharedWorker(disabledWC)).patched,false,'Disabling must not leave the previous shared-worker injection running');
 checks.push('disabled environment: service-worker preload removed');
 await controller.settings(ids[0],{environment:expected[0]});await controller.start(ids[0]);
 const enabledWC=controller.runtimes.get(ids[0]).view.webContents;await loaded(enabledWC,mainURL);
 verify(await serviceWorker(enabledWC),expected[0],'re-enabled environment: existing service worker');
 verify(await sharedWorker(enabledWC),expected[0],'re-enabled environment: shared worker');
 const swState=require('../src/main/environment-shared-worker.cjs').sharedWorkerEnvironmentState(enabledWC),nativeApply=swState.applyNative;
 const previousErrors=swState.errors.length;
 try{
  swState.applyNative=async()=>{throw Error('expected SharedWorker fixture failure');};
  const failed=await sharedWorker(enabledWC,'?failure=1');assert.equal(typeof failed.cpu,'number');
  await wait(()=>swState.pending.size===0,'failed SharedWorker setup resumes');
  assert.equal(swState.errors.length,previousErrors+1);assert.match(swState.errors.at(-1),/expected SharedWorker fixture failure/);
 }finally{swState.applyNative=nativeApply;}
 verify(await sharedWorker(enabledWC,'?recovered=1'),expected[0],'SharedWorker setup recovers after explicit failure');
 checks.push('failed SharedWorker setup reports error and resumes with external CDP attached when enabled');
 // Real worker lifecycle under a deliberate configuration failure: it must
 // report the error and resume, rather than remain paused in the debugger.
 await win.webContents.loadURL('data:text/html,Environment%20failure%20fixture');win.webContents.debugger.attach('1.3');
 const failing=await require('../src/main/environment-contexts.cjs').installContextEnvironment(win.webContents,{source:'',applyNative:async()=>{throw Error('expected fixture failure');}});
 assert.equal(typeof (await worker(win.webContents,'blob')).cpu,'number');
 await wait(()=>failing.pending.size===0,'failed worker configuration settles');
 assert.equal(failing.errors.length,1);assert.match(failing.errors[0],/expected fixture failure/);
 failing.dispose();assert.equal(contextEnvironmentState(win.webContents),undefined);
 checks.push('failed child configuration resumes real worker and disposes listeners');
 const {sharedWorkerEnvironmentSnapshot}=require('../src/main/environment-shared-worker.cjs');
 const channel=sharedWorkerEnvironmentSnapshot(),expectedMode=testCdp?'private-pipe-gateway':'private-pipe';
 if(channel.mode!==expectedMode)boundaries.push({type:'browser control channel',expected:expectedMode,actual:channel.mode});
 checks.push('browser control channel: '+channel.mode);
 }catch(e){error=e.stack||String(e);console.error(error);}
 finally{
  await externalBrowser?.close().catch(()=>{});
  try{await controller?.closeAll();}catch(e){error=error||e.stack;}
  if(win&&!win.isDestroyed())win.destroy();server?.close();
  const report=path.join(root,testCdp?'contexts-cdp-report.json':resume?'contexts-restart-report.json':'contexts-report.json');
  const passed=!error&&!boundaries.length,phase=testCdp?'private-pipe-gateway':resume?'fresh-process-restart':'initial';
  fs.writeFileSync(report,JSON.stringify({passed,complete:passed,phase,checks,boundaries,observed,error},null,2));
  console.log(JSON.stringify({passed,complete:passed,phase,checks,boundaries,report},null,2));
  app.exit(passed?0:1);
 }
});
