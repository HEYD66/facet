'use strict';
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {script,preset}=require('../src/main/fingerprint.cjs');
const {intrinsicsProbe}=require('./fixtures/injection-intrinsics.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-tostring-'));
app.setPath('userData',root);app.on('window-all-closed',()=>{});
let win,server;const checks=[],compatibility={};
const probe=()=>{
  const ts=Function.prototype.toString;
  const failure=f=>{try{f();return null;}catch(e){return e.name;}};
  const funcs={toString:ts,canvas:HTMLCanvasElement.prototype.toDataURL,blob:HTMLCanvasElement.prototype.toBlob,image:CanvasRenderingContext2D.prototype.getImageData,audio:AudioBuffer.prototype.getChannelData,rect:Element.prototype.getBoundingClientRect,range:Range.prototype.getBoundingClientRect,gl:WebGLRenderingContext.prototype.getParameter,gl2:WebGL2RenderingContext.prototype.getParameter};
  funcs.offlineConstructor=OfflineAudioContext;funcs.offlineRender=OfflineAudioContext.prototype.startRendering;
  funcs.offscreenContext=OffscreenCanvas.prototype.getContext;funcs.offscreenImage=OffscreenCanvasRenderingContext2D.prototype.getImageData;
  for(const [proto,keys] of [[Navigator.prototype,['deviceMemory','maxTouchPoints']],[Screen.prototype,['width','height','availWidth','availHeight','colorDepth','pixelDepth']]])for(const key of keys){const d=Object.getOwnPropertyDescriptor(proto,key);if(d?.get)funcs[key]=d.get;}
  const rows={};for(const [key,f]of Object.entries(funcs))rows[key]={source:ts.call(f),direct:f.toString(),name:f.name,length:f.length,keys:Reflect.ownKeys(f).map(String),prototype:Object.hasOwn(f,'prototype'),construct:failure(()=>Reflect.construct(f,[])),badReceiver:failure(()=>Reflect.apply(f,{},[]))};
  const d=Object.getOwnPropertyDescriptor(Function.prototype,'toString');
  function regular(a){return a+1;}
  return {rows,descriptor:{writable:d.writable,configurable:d.configurable,enumerable:d.enumerable},regular:ts.call(regular),arrow:ts.call(x=>x),bound:ts.call(regular.bind(null)),proxy:ts.call(new Proxy(regular,{})),invalid:[null,undefined,1,'x',{},Symbol('x')].map(x=>failure(()=>ts.call(x))),nested:ts.call(ts),json:JSON.stringify({x:1}),math:Math.max(1,3)};
};
const read=wc=>wc.executeJavaScript('('+probe.toString()+')()');
function workerIntrinsics(wc,source=''){
 const code=source+';('+intrinsicsProbe.toString()+')().then(value=>postMessage(value));';
 return wc.executeJavaScript('new Promise((resolve,reject)=>{const u=URL.createObjectURL(new Blob(['+JSON.stringify(code)+'],{type:"text/javascript"})),w=new Worker(u);const timer=setTimeout(()=>{w.terminate();URL.revokeObjectURL(u);reject(Error("Worker compatibility timeout"))},15000);w.onmessage=e=>{clearTimeout(timer);w.terminate();URL.revokeObjectURL(u);resolve(e.data)};w.onerror=e=>{clearTimeout(timer);w.terminate();URL.revokeObjectURL(u);reject(Error(e.message))};})');
}
const wait=async f=>{for(let i=0;i<100;i++){if(await f())return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out waiting for frame');};
setTimeout(()=>app.exit(2),60000).unref();
app.whenReady().then(async()=>{let error;try{
  server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>toString compatibility</title><canvas width="20" height="20"></canvas><button onclick="this.textContent=\'clicked\'">click</button>'+(req.url==='/frame'?'':'<iframe src="/frame"></iframe>'));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
  win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});const wc=win.webContents;
  await wc.loadURL(url);const baseline=await read(wc);
  const nativeIntrinsics=await wc.executeJavaScript('('+intrinsicsProbe.toString()+')()');
  assert(nativeIntrinsics.every(row=>row.calls===0&&!row.value?.error),'Native APIs do not call website helper hooks');
  const nativeWorker=await workerIntrinsics(wc);compatibility.nativePage=nativeIntrinsics;compatibility.nativeWorker=nativeWorker;
  assert(nativeWorker.every(row=>row.calls===0&&!row.value?.error),'Native Worker APIs do not call website helper hooks');
  const env=preset('library-v1',{},'tostring-compatibility');env.fingerprint={...env.fingerprint,hardware:true,canvas:true,webgl:true,audio:true,rects:true};const source=script(env);
  wc.debugger.attach('1.3');await wc.debugger.sendCommand('Page.enable');const {identifier}=await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source});
  await wc.loadURL(url);const actual=await read(wc);assert.deepEqual(actual,baseline);checks.push('All patched methods/getters retain native source, name, length, descriptors, constructability and receiver errors; normal functions unchanged');
  const actualIntrinsics=await wc.executeJavaScript('('+intrinsicsProbe.toString()+')()');
  compatibility.injectedPage=actualIntrinsics;
  assert.deepEqual(actualIntrinsics,nativeIntrinsics,'Website helper hooks do not break production injection');checks.push('Native versus injected helper instrumentation: '+actualIntrinsics.length+' API cases');
  const actualWorker=await workerIntrinsics(wc,source);compatibility.injectedWorker=actualWorker;
  assert.deepEqual(actualWorker,nativeWorker,'Worker APIs preserve native behavior with website helper hooks');checks.push('Native versus injected Worker helper instrumentation: '+actualWorker.length+' API cases');
  await wait(()=>wc.mainFrame.framesInSubtree.some(f=>f.url===url+'/frame'));const frame=wc.mainFrame.framesInSubtree.find(f=>f.url===url+'/frame');assert.deepEqual(await frame.executeJavaScript('('+probe.toString()+')()'),baseline);compatibility.injectedIframe=await frame.executeJavaScript('('+intrinsicsProbe.toString()+')()');assert.deepEqual(compatibility.injectedIframe,nativeIntrinsics);checks.push('Navigated same-origin iframe has the same compatibility');
  const cross=await wc.executeJavaScript(`(()=>{const f=document.querySelector('iframe').contentWindow;return {fromChild:f.Function.prototype.toString.call(HTMLCanvasElement.prototype.toDataURL),fromParent:Function.prototype.toString.call(f.HTMLCanvasElement.prototype.toDataURL),getter:f.Function.prototype.toString.call(Object.getOwnPropertyDescriptor(Screen.prototype,'width').get)};})()`);
  assert(Object.values(cross).every(s=>s.includes('[native code]')));checks.push('Cross-realm borrowed toString stays callable (native Proxy spelling may differ)');
  const behavior=await wc.executeJavaScript(`(async()=>{const c=document.querySelector('canvas'),ctx=c.getContext('2d');ctx.fillRect(0,0,20,20);const a=c.toDataURL(),b=c.toDataURL(),blob=await new Promise(r=>c.toBlob(r));const audio=new AudioBuffer({length:64,sampleRate:48000,numberOfChannels:1});const x=Array.from(audio.getChannelData(0)),y=Array.from(audio.getChannelData(0));document.querySelector('button').click();return {stableCanvas:a===b,png:a.startsWith('data:image/png;base64,'),blob:blob.type,stableAudio:JSON.stringify(x)===JSON.stringify(y),rect:document.body.getBoundingClientRect().width>0,click:document.querySelector('button').textContent,touch:navigator.maxTouchPoints};})()`);
  assert.deepEqual(behavior,{stableCanvas:true,png:true,blob:'image/png',stableAudio:true,rect:true,click:'clicked',touch:0});checks.push('Real Canvas PNG/Blob, audio stability, layout, click and hardware values work');
  await wc.executeJavaScript(source);assert.deepEqual(await read(wc),baseline);checks.push('Repeated injection is idempotent');
  await wc.loadURL(url+'/reload');assert.deepEqual(await read(wc),baseline);checks.push('Navigation re-injects correctly');
  await wc.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument',{identifier});await wc.loadURL(url);assert.deepEqual(await read(wc),baseline);assert.equal(script({fingerprint:{enabled:false}}),null);checks.push('Disabled injection leaves native behavior intact');
}catch(e){error=e.stack;}finally{win?.destroy();server?.close();fs.writeFileSync(path.join(root,'report.json'),JSON.stringify({checks,compatibility,error},null,2));console.log(JSON.stringify({root,checks,error},null,2));app.exit(error?1:0);}});
