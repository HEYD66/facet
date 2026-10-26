'use strict';
// Simulated GPU coherence in real Electron instances:
// - WebGPU GPUAdapterInfo (page, Dedicated Worker, cross-site iframe) follows the WebGL renderer,
//   for new plans and for renderers saved before device IDs were stored;
// - a simulated GPU without Direct3D 12 has no WebGPU adapter;
// - new plans report Chrome's renderer format, up to 32 GB device memory and the Windows 11 taskbar.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-fp-gpu-'));app.setPath('userData',root);
const {Controller}=require('../src/main/controller.cjs'),{installIPC}=require('../src/main/ipc.cjs'),{environment}=require('../src/main/environment.cjs'),{preset}=require('../src/main/fingerprint.cjs');
const identity=require('../src/main/gpu-identity.cjs'),catalog=require('../src/main/fingerprint-catalog.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(fn,label,n=400)=>{let last;for(let i=0;i<n;i++){try{if(last=await fn())return last;}catch{}await sleep(50);}throw Error('Timeout '+label);};
const ok=name=>console.log('PASS '+name);setTimeout(()=>{console.error('WATCHDOG');app.exit(2);},240000).unref();
const ADAPTER='async()=>{if(!navigator.gpu)return "no navigator.gpu";const a=await navigator.gpu.requestAdapter();return a?{vendor:a.info.vendor,architecture:a.info.architecture,device:a.info.device,description:a.info.description}:"none";}';
const WORKER=`(${ADAPTER})().then(gpu=>postMessage({memory:navigator.deviceMemory,gpu,patched:!!globalThis.__arenaFingerprintV3Applied,info:typeof GPUAdapterInfo,getter:String(Object.getOwnPropertyDescriptor(GPUAdapterInfo.prototype,'vendor')?.get).slice(0,60)}),e=>postMessage({error:String(e)}));`;
const READ=`(async()=>{const c=document.createElement('canvas'),g=c.getContext('webgl'),d=g&&g.getExtension('WEBGL_debug_renderer_info');
 const worker=await new Promise((res,rej)=>{const u=URL.createObjectURL(new Blob([${JSON.stringify(WORKER)}],{type:'text/javascript'})),w=new Worker(u);w.onmessage=e=>{w.terminate();res(e.data);};w.onerror=e=>rej(e.message);setTimeout(()=>rej('worker timeout'),15000);});
 return {renderer:d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):null,memory:navigator.deviceMemory,screen:[screen.height,screen.availHeight],gpu:await (${ADAPTER})(),worker,
  native:[Object.getOwnPropertyDescriptor(GPUAdapterInfo.prototype,'vendor').get.toString(),Object.getOwnPropertyDescriptor(GPUAdapterInfo.prototype,'architecture').get.toString(),GPU.prototype.requestAdapter.toString(),GPU.prototype.requestAdapter.name,GPU.prototype.requestAdapter.length]};})()`;
let win,c,server;
app.whenReady().then(async()=>{try{
 const hints=[];
 server=http.createServer((q,res)=>{const port=server.address().port;res.setHeader('Content-Type','text/html; charset=utf-8');
  if(q.url.startsWith('/frame'))return res.end('<!doctype html><title>frame</title>frame');
  hints.push({memory:q.headers['sec-ch-device-memory']??q.headers['device-memory']??null});
  res.setHeader('Accept-CH','Sec-CH-Device-Memory, Device-Memory');
  res.end('<!doctype html><title>gpu</title><iframe src="http://localhost:'+port+'/frame"></iframe>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/';
 win=new BrowserWindow({width:1280,height:860,show:true,webPreferences:{preload:path.join(__dirname,'../src/main/preload.cjs'),sandbox:true,contextIsolation:true}});
 c=new Controller(win,root,path.join(root,'no-core'));installIPC(win,c);
 await win.loadFile(path.join(__dirname,'../src/renderer/index.html'));const ui=code=>win.webContents.executeJavaScript(code);await wait(()=>ui('typeof current==="function"&&!!current()'),'UI');
 const base=environment({language:'en-US',timezone:'America/New_York'});
 // A library plan with a WebGPU-capable GPU and 32 GB, so the new memory ceiling is exercised.
 let seedA;for(let i=0;i<5000&&!seedA;i++){const p=preset('library-v1',base,'gpu-a-'+i),info=identity.webgpuInfo(p.fingerprint.renderer);if(p.fingerprint.memory===32&&info.supported&&info.architecture)seedA='gpu-a-'+i;}
 assert(seedA,'seed with a 32 GB WebGPU-capable plan');
 const planA=environment(preset('library-v1',base,seedA));
 const planB=environment({...planA,fingerprint:{...planA.fingerprint,seed:'gpu-b',vendor:'Google Inc. (NVIDIA)',renderer:'ANGLE (NVIDIA, NVIDIA GeForce GT 430 (0x00000DE1) Direct3D11 vs_5_0 ps_5_0, D3D11)'}});
 // Saved before this change: no device ID, 8 GB, Windows 10 taskbar height. Kept as saved.
 const planC=environment({...planA,fingerprint:{...planA.fingerprint,seed:'gpu-c',vendor:'Google Inc. (Intel)',renderer:'ANGLE (Intel, Intel(R) Iris(R) Xe MAX 100 Graphics Direct3D11 vs_5_0 ps_5_0)',memory:8,availHeight:planA.fingerprint.screenHeight-40}});
 const id=c.store.list()[0].id,frameOf=wc=>wc.mainFrame.framesInSubtree.find(f=>f.url.startsWith('http://localhost:'));
 const run=async(label,env)=>{
  c.store.update(id,{url,browserTabs:{activeId:'t',items:[{id:'t',url}]},environment:env});await c.start(id);await ui(`localOpen.add(${JSON.stringify(id)});route('browser',${JSON.stringify(id)})`);
  const wc=()=>c.runtimes.get(id).view.webContents;await wait(()=>wc().getTitle()==='gpu'&&frameOf(wc()),label+' page');
  hints.length=0;wc().reload();await wait(()=>wc().getTitle()==='gpu'&&!wc().isLoading()&&frameOf(wc()),label+' reload');await sleep(400);
  const page=await wc().executeJavaScript(READ),frame=await frameOf(wc()).executeJavaScript(`(${ADAPTER})()`);
  assert.notEqual(frameOf(wc()).processId,wc().mainFrame.processId,'the iframe is out of process');
  await c.stop(id);return {page,frame,hint:hints.at(-1)?.memory??null};
 };
 const native=v=>/\{ \[native code\] \}$/.test(v);

 const a=await run('new plan',planA),wantA=identity.webgpuInfo(planA.fingerprint.renderer);
 assert.match(a.page.renderer,/^ANGLE \((NVIDIA|AMD|Intel), .+ \(0x[0-9A-F]{8}\) Direct3D11 vs_5_0 ps_5_0, D3D11\)$/);assert.equal(a.page.renderer,planA.fingerprint.renderer);
 const adapterA={vendor:wantA.vendor,architecture:wantA.architecture,device:'',description:''};
 assert.deepEqual(a.page.gpu,adapterA,'page adapter');assert.deepEqual(a.page.worker.gpu,adapterA,'worker adapter '+JSON.stringify(a.page.worker));assert.deepEqual(a.frame,adapterA,'cross-site iframe adapter');
 assert.equal(a.page.memory,32);assert.equal(a.page.worker.memory,32);assert.deepEqual(a.page.screen,[planA.fingerprint.screenHeight,planA.fingerprint.screenHeight-48]);
 assert(a.page.native.slice(0,3).every(native),'patched getters keep native toString');assert.deepEqual(a.page.native.slice(3),['requestAdapter',0]);
 ok(`New plan: WebGL ${a.page.renderer}; WebGPU ${wantA.vendor}/${wantA.architecture} in page, worker and cross-site iframe; 32 GB; availHeight = height - 48`);

 const b=await run('no D3D12',planB);
 assert.equal(b.page.gpu,'none');assert.equal(b.page.worker.gpu,'none');assert.equal(b.frame,'none');assert(b.page.native.slice(0,3).every(native));
 ok('Simulated GT 430 (Fermi, no Direct3D 12): requestAdapter() resolves null in page, worker and iframe');

 const cc=await run('saved renderer',planC);
 const adapterC={vendor:'intel',architecture:'gen-12lp',device:'',description:''};
 assert.equal(cc.page.renderer,planC.fingerprint.renderer,'a saved renderer is not rewritten');assert.deepEqual(cc.page.gpu,adapterC);assert.deepEqual(cc.page.worker.gpu,adapterC);assert.deepEqual(cc.frame,adapterC);
 assert.equal(cc.page.memory,8);assert.deepEqual(cc.page.screen,[planC.fingerprint.screenHeight,planC.fingerprint.screenHeight-40]);
 ok('Saved instance (old renderer format, 8 GB, 40 px taskbar) keeps its values; WebGPU now reports intel/gen-12lp instead of the real GPU');

 // HTTP Device-Memory client hint, when a site asks for it (not overridden by Facet).
 console.log('NOTE Device-Memory client hint after Accept-CH: new plan '+a.hint+', saved '+cc.hint+', navigator '+a.page.memory+'/'+cc.page.memory);
 console.log('ALL FINGERPRINT GPU TESTS PASSED');
}catch(e){console.error(e.stack||e);process.exitCode=1;}finally{try{await c?.closeAll();}catch{}server?.close();try{fs.rmSync(root,{recursive:true,force:true});}catch{}app.exit(process.exitCode||0);}});
