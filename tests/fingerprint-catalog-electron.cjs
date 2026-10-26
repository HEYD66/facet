'use strict';
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),assert=require('node:assert/strict');
const {Controller}=require('../src/main/controller.cjs'),{installIPC}=require('../src/main/ipc.cjs');
const {environment}=require('../src/main/environment.cjs'),{preset}=require('../src/main/fingerprint.cjs');
const root=process.argv.find(x=>x.startsWith('--test-profile='))?.slice(15),resume=process.argv.includes('--resume');
if(!root)throw Error('Isolated test profile required');
app.setPath('userData',root);app.commandLine.appendSwitch('disable-gpu');app.commandLine.appendSwitch('disable-background-networking');app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
const wait=async(fn,label)=>{const end=Date.now()+20000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Timeout: '+label);};
const read=`(async()=>{const c=document.createElement('canvas'),g=c.getContext('webgl'),d=g?.getExtension('WEBGL_debug_renderer_info');const a=new AudioBuffer({length:64,sampleRate:48000,numberOfChannels:1});return {ua:navigator.userAgent,platform:navigator.platform,cpu:navigator.hardwareConcurrency,memory:navigator.deviceMemory,touch:navigator.maxTouchPoints,screen:[screen.width,screen.height,screen.availHeight,screen.colorDepth],dpr:devicePixelRatio,viewport:[innerWidth,innerHeight],language:navigator.language,tz:Intl.DateTimeFormat().resolvedOptions().timeZone,vendor:d?g.getParameter(d.UNMASKED_VENDOR_WEBGL):null,renderer:d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):null,canvas:c.toDataURL(),audio:Array.from(a.getChannelData(0)),uaData:navigator.userAgentData?await navigator.userAgentData.getHighEntropyValues(['fullVersionList','platformVersion','architecture','bitness']):null};})()`;
function check(v,e){assert.equal(v.ua,e.userAgent);assert.equal(v.platform,e.platform);assert.equal(v.cpu,e.cpu);assert.equal(v.memory,e.fingerprint.memory);assert.equal(v.touch,0);assert.deepEqual(v.screen,[e.fingerprint.screenWidth,e.fingerprint.screenHeight,e.fingerprint.availHeight,24]);assert(Math.abs(v.dpr-e.scale)<1e-6,`DPR ${v.dpr} / ${e.scale}`);assert.equal(v.language,e.language);assert.equal(v.tz,e.timezone);assert.equal(v.vendor,e.fingerprint.vendor);assert.equal(v.renderer,e.fingerprint.renderer);assert(v.uaData?.brands.length);assert.equal(v.uaData.platform,'Windows');assert(v.uaData.fullVersionList.some(b=>b.brand==='Chromium'&&b.version===process.versions.chrome));}
let win,c,server;
setTimeout(()=>app.exit(2),90000).unref();
app.whenReady().then(async()=>{try{
 const headers=[];server=https.createServer({key:fs.readFileSync(path.join(__dirname,'fixtures/dns/key.pem')),cert:fs.readFileSync(path.join(__dirname,'fixtures/dns/cert.pem'))},(req,res)=>{headers.push(req.headers);if(req.url==='/worker.js'){res.setHeader('Content-Type','text/javascript');res.end('postMessage({cpu:navigator.hardwareConcurrency,memory:navigator.deviceMemory,platform:navigator.platform});');return;}res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Catalog verification</title><h1>Catalog verification</h1>'+(req.url==='/frame'?'':'<iframe src="/frame"></iframe>'));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='https://127.0.0.1:'+server.address().port+'/';
 // Each phase serves on a new port. Instances restore their saved browser tabs on start, so the address alone would
 // reopen the previous phase's (closed) port; point the saved tabs at this phase's fixture as well.
 const retarget=address=>({url:address,browserTabs:{activeId:'fixture',items:[{id:'fixture',url:address}]}});
 win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload:path.resolve(__dirname,'../src/main/preload.cjs'),sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
 c=new Controller(win,root,path.join(root,'not-required'));installIPC(win,c);await win.loadFile(path.resolve(__dirname,'../src/renderer/index.html'));const ui=s=>win.webContents.executeJavaScript(s);await wait(()=>ui('!!current()'),'UI');
 const marker=path.join(root,'catalog-expected.json');let ids,expected;
 if(resume){({ids,expected}=JSON.parse(fs.readFileSync(marker,'utf8')));for(let i=0;i<ids.length;i++)assert.deepEqual(c.store.get(ids[i]).environment,expected[i]);}
 else{
  const id=c.store.list()[0].id;await ui(`route('environment',${JSON.stringify(id)})`);await wait(()=>ui('!!document.querySelector("#fingerprintPreset")'),'form');
  const original=structuredClone(c.store.get(id).environment);await ui(`$('#fingerprintPreset').value='library-v1';document.querySelector('[data-fp="preset"]').click()`);await wait(()=>ui('!!$("#fpSeed").value'),'draft');assert.deepEqual(c.store.get(id).environment,original);
  assert.equal(await ui('$("#environmentForm").checkValidity()'),true);await ui(`document.querySelector('[data-ux="save-environment"]').click()`);await wait(()=>c.store.get(id).environment.fingerprint.template==='library-v1','save');
  await ui(`document.querySelector('#newTab').click();document.querySelector('[data-new-env="random"]').click()`);await wait(()=>ui('!!modal?.newEnvironment&&!modal.newEnvironmentBusy'),'new instance draft');
  const newPlan=await ui('modal.newEnvironment');assert.equal(newPlan.fingerprint.template,'library-v1');assert.equal(newPlan.fingerprint.hardware,true);
  await ui(`$('#nameInput').value='Catalog isolation';$('#startNew').checked=false;$('#timezoneNew').checked=false;document.querySelector('#modal [data-action="confirm"]').click()`);await wait(()=>c.store.list().some(x=>x.name==='Catalog isolation'),'new instance created');
  const second=c.store.list().find(x=>x.name==='Catalog isolation');assert.deepEqual(second.environment,newPlan);
  let plan;for(let i=0;i<200;i++){plan=environment(preset('library-v1',{language:'ja-JP',timezone:'Asia/Tokyo'},'isolation-'+i));if(plan.fingerprint.renderer!==c.store.get(id).environment.fingerprint.renderer&&plan.cpu!==c.store.get(id).environment.cpu&&plan.fingerprint.memory===4)break;}
  assert.equal(plan.fingerprint.memory,4);c.store.update(second.id,{environment:plan});ids=[id,second.id];expected=ids.map(x=>c.store.get(x).environment);fs.writeFileSync(marker,JSON.stringify({ids,expected},null,2));
  await ui(`route('environment',${JSON.stringify(id)})`);win.showInactive();await ui('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await new Promise(r=>setTimeout(r,200));
  const shot=path.join(root,'catalog-environment.png');fs.writeFileSync(shot,(await win.webContents.capturePage()).toPNG());assert(fs.statSync(shot).size>1000);win.hide();
 }
 const nativeControl=c.store.list().find(x=>x.name==='Native control')||c.store.create('Native control');c.store.update(nativeControl.id,retarget(url));require('electron').session.fromPartition('persist:arena-core-'+nativeControl.id).setCertificateVerifyProc((req,cb)=>cb(req.hostname==='127.0.0.1'&&req.certificate.data.trim()===fs.readFileSync(path.join(__dirname,'fixtures/dns/cert.pem'),'utf8').trim()?0:-3));await c.start(nativeControl.id);await wait(()=>!c.runtimes.get(nativeControl.id).view.webContents.isLoading()&&c.runtimes.get(nativeControl.id).view.webContents.getTitle()==='Catalog verification','native control');const nativeHints=headers.some(h=>h['sec-ch-ua']);await c.stop(nativeControl.id);const firstCatalogHeader=headers.length;
 const samples=[];for(let i=0;i<ids.length;i++){
  c.store.update(ids[i],retarget(url));require('electron').session.fromPartition('persist:arena-core-'+ids[i]).setCertificateVerifyProc((req,cb)=>cb(req.hostname==='127.0.0.1'&&req.certificate.data.trim()===fs.readFileSync(path.join(__dirname,'fixtures/dns/cert.pem'),'utf8').trim()?0:-3));await c.start(ids[i]);const wc=c.runtimes.get(ids[i]).view.webContents;await wait(()=>!wc.isLoading()&&wc.getTitle()==='Catalog verification','page');const v=await wc.executeJavaScript(read);check(v,expected[i]);samples.push(v);
  const frame=wc.mainFrame.framesInSubtree.find(f=>f.url.endsWith('/frame'));assert(frame);check(await frame.executeJavaScript(read),expected[i]);
 }
 assert.notEqual(samples[0].renderer,samples[1].renderer);assert.notEqual(samples[0].cpu,samples[1].cpu);
 const first=c.runtimes.get(ids[0]).view.webContents;const worker=await first.executeJavaScript(`new Promise(resolve=>{const w=new Worker('/worker.js');w.onmessage=e=>{resolve(e.data);w.terminate()};})`);
 assert.deepEqual(worker,{cpu:expected[0].cpu,memory:expected[0].fingerprint.memory,platform:expected[0].platform});
 await c.stop(ids[0]);await c.start(ids[0]);const restarted=c.runtimes.get(ids[0]).view.webContents;await wait(()=>!restarted.isLoading()&&restarted.getTitle()==='Catalog verification','restart');const again=await restarted.executeJavaScript(read);check(again,expected[0]);assert.equal(again.canvas,samples[0].canvas);assert.deepEqual(again.audio,samples[0].audio);
 const live=await c.runtimes.get(ids[1]).view.webContents.executeJavaScript(read);check(live,expected[1]);
 const catalogHeaders=headers.slice(firstCatalogHeader);assert(catalogHeaders.some(h=>h['user-agent']===expected[0].userAgent));
 if(nativeHints)assert(catalogHeaders.some(h=>h['sec-ch-ua-platform']==='"Windows"'&&h['sec-ch-ua']?.includes('Chromium')));
 else assert(catalogHeaders.every(h=>!h['sec-ch-ua']),'Current Electron native baseline omits Client Hint headers; catalog must not invent them');
 console.log(JSON.stringify({passed:true,phase:resume?'fresh-process-restart':'UI-save-and-isolation',gpuCandidates:require('../src/main/fingerprint-catalog.cjs').GPUS.length,mainAndIframe:true,stableCanvasAndAudio:true,nativeClientHintHeaders:nativeHints,workerReport:worker,workerBoundary:'Dedicated Worker verified; SharedWorker remains a documented limitation',profile:root,screenshot:resume?undefined:path.join(root,'catalog-environment.png')},null,2));
 }catch(e){console.error(e.stack||String(e));process.exitCode=1;}finally{try{await c?.closeAll();}catch{}win?.destroy();server?.close();app.exit(process.exitCode||0);}});
