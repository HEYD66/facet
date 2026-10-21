'use strict';
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {script,preset}=require('../src/main/fingerprint.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-offscreen-'));
app.setPath('userData',root);app.on('window-all-closed',()=>{});
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-gpu');
const checks=[],observed={};let win,server,imageServer;
function saveNative(){
 globalThis.fixtureNative={convert:OffscreenCanvas.prototype.convertToBlob,image:OffscreenCanvasRenderingContext2D.prototype.getImageData};
}
async function probe(crossImageURL){
 const N=fixtureNative,convert=OffscreenCanvas.prototype.convertToBlob;
 const canvas=()=>{const c=new OffscreenCanvas(32,32),x=c.getContext('2d');x.fillStyle='#7296be';x.fillRect(0,0,32,32);return c;};
 const bytes=async b=>Array.from(new Uint8Array(await b.arrayBuffer()));
 const pixels=async b=>{const image=await createImageBitmap(b),c=new OffscreenCanvas(image.width,image.height),x=c.getContext('2d');x.drawImage(image,0,0);image.close();return Array.from(Reflect.apply(N.image,x,[0,0,c.width,c.height]).data);};
 const outcome=async fn=>{let value;try{value=fn();}catch(e){return {sync:true,name:e.name};}try{await value;return {sync:false,name:null};}catch(e){return {sync:false,name:e.name};}};
 const c=canvas(),x=c.getContext('2d'),rawBefore=Array.from(Reflect.apply(N.image,x,[0,0,32,32]).data);
 const expected=x.getImageData(0,0,32,32),reference=new OffscreenCanvas(32,32);reference.getContext('2d').putImageData(expected,0,0);
 const blob=await c.convertToBlob(),again=await c.convertToBlob(),exported=await pixels(blob);
 const stable=JSON.stringify(await bytes(blob))===JSON.stringify(await bytes(again));
 const unchanged=JSON.stringify(rawBefore)===JSON.stringify(Array.from(Reflect.apply(N.image,x,[0,0,32,32]).data));
 const matchesRead=JSON.stringify(exported)===JSON.stringify(Array.from(expected.data));
 const formats={};for(const type of ['image/png','image/jpeg','image/webp','invalid/type'])for(const quality of [0.1,0.92]){
  const a=await c.convertToBlob({type,quality}),b=await Reflect.apply(N.convert,reference,[{type,quality}]);
  formats[type+quality]={type:a.type,same:JSON.stringify(await bytes(a))===JSON.stringify(await bytes(b)),size:a.size};
 }
 const snapshotCanvas=canvas(),snapshot=snapshotCanvas.convertToBlob();snapshotCanvas.getContext('2d').clearRect(0,0,32,32);
 const snapshotMatches=JSON.stringify(await pixels(await snapshot))===JSON.stringify(exported);
 const events=[],options={get quality(){events.push('get quality');return {valueOf(){events.push('convert quality');return 0.72;}};},get type(){events.push('get type');return {toString(){events.push('convert type');return 'image/jpeg';}};}};
 await c.convertToBlob(options);
 const frozenEvents=[],frozenOptions=Object.freeze({quality:Object.freeze({valueOf(){frozenEvents.push('quality');return 0.5;}}),type:Object.freeze({toString(){frozenEvents.push('type');return 'image/png';}})});
 const frozen=await outcome(()=>c.convertToBlob(frozenOptions));
 const revoked=Proxy.revocable({},{});revoked.revoke();const revokedResult=await outcome(()=>c.convertToBlob(revoked.proxy));
 const during=canvas(),duringEvents=[];
 const duringBlob=await during.convertToBlob({get quality(){duringEvents.push('quality');during.getContext('2d').fillStyle='#abcdef';during.getContext('2d').fillRect(0,0,32,32);return 0.5;},get type(){duringEvents.push('type');return 'image/png';}});
 const duringExpected=during.getContext('2d').getImageData(0,0,32,32).data;
 const getterSnapshot=JSON.stringify(await pixels(duringBlob))===JSON.stringify(Array.from(duringExpected));
 let reads=0;const errors={};
 errors.receiver=await outcome(()=>Reflect.apply(convert,{},[{get type(){reads++;return 'image/png';}}]));
 errors.zero=await outcome(()=>new OffscreenCanvas(0,4).convertToBlob());
 const detached=new OffscreenCanvas(32,32);structuredClone(detached,{transfer:[detached]});errors.detached=await outcome(()=>detached.convertToBlob());
 if(typeof document!=='undefined')errors.owned=await outcome(()=>document.createElement('canvas').transferControlToOffscreen().convertToBlob());
 if(crossImageURL){
  const image=new Image();image.src=crossImageURL;await image.decode();
  const tainted=new OffscreenCanvas(32,32);tainted.getContext('2d').drawImage(image,0,0);
  errors.tainted=await outcome(()=>tainted.convertToBlob());
 }
 for(const [label,value]of [['null',null],['number',2],['string','png'],['symbol',Symbol('x')],['quality bigint',{quality:1n}],['quality symbol',{quality:Symbol('x')}],['type symbol',{type:Symbol('x')}],['quality NaN',{quality:NaN}],['quality null',{quality:null}]])errors[label]=await outcome(()=>c.convertToBlob(value));
 const sentinel={sentinel:true};let sameError=false;try{await c.convertToBlob({get quality(){throw sentinel;}});}catch(e){sameError=e===sentinel;}
 const blank=new OffscreenCanvas(32,32);blank.getContext('2d');const blankZero=(await pixels(await blank.convertToBlob())).every(v=>v===0);
 const noContextCanvas=new OffscreenCanvas(4,4),noContext=await outcome(()=>noContextCanvas.convertToBlob());
 const modePreserved=!!noContextCanvas.getContext('webgl');
 const glCanvas=new OffscreenCanvas(32,32),gl=glCanvas.getContext('webgl',{preserveDrawingBuffer:true});gl.clearColor(0.4,0.6,0.8,1);gl.clear(gl.COLOR_BUFFER_BIT);
 const glBlob=await glCanvas.convertToBlob();const glPixels=await pixels(glBlob);
 const glCases={};for(const kind of ['webgl','webgl2'])for(const preserveDrawingBuffer of [false,true]){
  const c=new OffscreenCanvas(32,32),g=c.getContext(kind,{preserveDrawingBuffer});if(!g)throw Error('Missing native '+kind+' context');
  g.clearColor(0.4,0.6,0.8,1);g.clear(g.COLOR_BUFFER_BIT);
  const ref=new OffscreenCanvas(32,32),x=ref.getContext('2d');x.drawImage(c,0,0);x.putImageData(x.getImageData(0,0,32,32),0,0);
  const a=await c.convertToBlob(),b=await Reflect.apply(N.convert,ref,[]);
  glCases[kind+'/'+preserveDrawingBuffer]=JSON.stringify(await bytes(a))===JSON.stringify(await bytes(b));
 }
 const colorSpaces={};for(const colorSpace of ['srgb','display-p3'])for(const colorType of ['unorm8','float16']){
  const wide=new OffscreenCanvas(32,32),context=wide.getContext('2d',{colorSpace,colorType});context.fillStyle='color(display-p3 0.75 0.4 0.6)';context.fillRect(0,0,32,32);
  const attributes=context.getContextAttributes(),settings={colorSpace:attributes.colorSpace,pixelFormat:attributes.colorType==='float16'?'rgba-float16':'rgba-unorm8'};
  const image=context.getImageData(0,0,32,32,settings),ref=new OffscreenCanvas(32,32);ref.getContext('2d',attributes).putImageData(image,0,0);
  const a=await wide.convertToBlob(),b=await Reflect.apply(N.convert,ref,[]);
  colorSpaces[colorSpace+'/'+colorType]={attributes,same:JSON.stringify(await bytes(a))===JSON.stringify(await bytes(b)),normalized:Array.from(image.data).every(v=>v>=0&&v<=1)};
 }
 const large=new OffscreenCanvas(512,512),largeContext=large.getContext('2d');largeContext.fillStyle='#7296be';largeContext.fillRect(0,0,512,512);
 const started=performance.now();await large.convertToBlob();const exportMs=performance.now()-started;
 let helperCalls=0;const OriginalCanvas=globalThis.OffscreenCanvas,contextMethod=OriginalCanvas.prototype.getContext,draw=OffscreenCanvasRenderingContext2D.prototype.drawImage,put=OffscreenCanvasRenderingContext2D.prototype.putImageData;
 const trap=()=>{helperCalls++;throw Error('Website helper should not be called by export');};
 try{globalThis.OffscreenCanvas=trap;OriginalCanvas.prototype.getContext=trap;OffscreenCanvasRenderingContext2D.prototype.drawImage=trap;OffscreenCanvasRenderingContext2D.prototype.putImageData=trap;await Reflect.apply(convert,c,[]);}
 finally{globalThis.OffscreenCanvas=OriginalCanvas;OriginalCanvas.prototype.getContext=contextMethod;OffscreenCanvasRenderingContext2D.prototype.drawImage=draw;OffscreenCanvasRenderingContext2D.prototype.putImageData=put;}
 let sizeReads=0;Object.defineProperties(c,{width:{configurable:true,get(){sizeReads++;return 99;}},height:{configurable:true,get(){sizeReads++;return 99;}}});
 await c.convertToBlob();
 const descriptor=Object.getOwnPropertyDescriptor(OffscreenCanvas.prototype,'convertToBlob');
 const shape={name:convert.name,length:convert.length,source:convert.toString(),keys:Reflect.ownKeys(convert).map(String),writable:descriptor.writable,enumerable:descriptor.enumerable,configurable:descriptor.configurable};
 return {patched:!!globalThis.__arenaFingerprintV3Applied,shape,helperCalls,sizeReads,stable,unchanged,matchesRead,snapshotMatches,events,frozenEvents,frozen,revokedResult,duringEvents,getterSnapshot,errors,reads,sameError,blankZero,noContext,modePreserved,colorSpaces,glCases,exportMs,formats,gl:{type:glBlob.type,opaque:glPixels.filter((_,i)=>i%4===3).every(v=>v===255)},exported};
}
const nativeSource='('+saveNative.toString()+')();';
setTimeout(()=>app.exit(2),100000).unref();
app.whenReady().then(async()=>{let error;try{
 server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Offscreen export compatibility</title>');});
 imageServer=http.createServer((req,res)=>{res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#7296be"/></svg>');});
 await new Promise(r=>imageServer.listen(0,'127.0.0.1',r));const imageURL='http://127.0.0.1:'+imageServer.address().port+'/image.svg';
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});const wc=win.webContents;
 await wc.loadURL(url);
 wc.debugger.attach('1.3');await wc.debugger.sendCommand('Page.enable');
 await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:nativeSource});
 const pageProbe='('+probe.toString()+')('+JSON.stringify(imageURL)+')';
 await wc.loadURL(url);const baseline=await wc.executeJavaScript(pageProbe);observed.baseline=baseline;
 const env=preset('library-v1',{},'offscreen-compatibility');env.fingerprint={...env.fingerprint,canvas:true};
 const source=script(env);await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source});
 await wc.loadURL(url);const actual=await wc.executeJavaScript(pageProbe);observed.patched=actual;
 for(const key of ['shape','helperCalls','sizeReads','errors','events','frozenEvents','frozen','revokedResult','duringEvents','reads','sameError','noContext','modePreserved','gl'])assert.deepEqual(actual[key],baseline[key],key+' retains native behavior');
 assert.deepEqual(actual.errors.tainted,{sync:false,name:'SecurityError'});assert.equal(actual.helperCalls,0);assert.equal(actual.sizeReads,0);
 checks.push('Native validation, conversion order/count, rejection identity, detached and DOM-associated canvas errors');
 for(const key of ['stable','unchanged','matchesRead','snapshotMatches','getterSnapshot','blankZero'])assert.equal(actual[key],true,key);
 for(const [format,value]of Object.entries(actual.formats))assert.equal(value.same,true,format+' matches native encoding of the noisy snapshot');
 for(const [format,value]of Object.entries(actual.colorSpaces)){assert.equal(value.same,true,format+' retains native color space/precision');if(value.attributes.colorType==='float16')assert.equal(value.normalized,true,format+' does not add byte-sized noise to float pixels');}
 for(const [mode,same]of Object.entries(actual.glCases))assert.equal(same,true,mode+' export contains the expected noise');
 assert.notDeepEqual(actual.exported,baseline.exported,'The exported PNG must actually contain the configured noise');
 checks.push('PNG/JPEG/WebP, quality, snapshot timing, unchanged source, sRGB/P3 and unorm8/float16 encoding');
 const {installContextEnvironment}=require('../src/main/environment-contexts.cjs');
 const state=await installContextEnvironment(wc,{source:nativeSource+source,applyNative:async()=>{}});
 const worker=await wc.executeJavaScript('new Promise((resolve,reject)=>{const u=URL.createObjectURL(new Blob(['+JSON.stringify('('+probe.toString()+')().then(value=>postMessage(value));')+'],{type:"text/javascript"}));const w=new Worker(u);w.onmessage=e=>{w.terminate();URL.revokeObjectURL(u);resolve(e.data)};w.onerror=e=>reject(Error(e.message));})');
 observed.worker=worker;assert.equal(worker.patched,true);assert.deepEqual(worker.exported,actual.exported);assert.equal(worker.matchesRead,true);assert.equal(worker.snapshotMatches,true);assert.equal(worker.unchanged,true);
 const expectedErrors={...baseline.errors};delete expectedErrors.owned;delete expectedErrors.tainted;assert.deepEqual(worker.errors,expectedErrors);assert.deepEqual(worker.events,baseline.events);assert.deepEqual(worker.frozen,baseline.frozen);assert.deepEqual(worker.frozenEvents,baseline.frozenEvents);assert.deepEqual(worker.revokedResult,baseline.revokedResult);assert.deepEqual(state.errors,[]);
 checks.push('Dedicated Worker first-script export matches the page and preserves native error/option behavior');
 const transferred=await wc.executeJavaScript('new Promise((resolve,reject)=>{const u=URL.createObjectURL(new Blob(['+JSON.stringify('onmessage=async e=>{try{const c=e.data,x=c.getContext("2d");x.fillStyle="#7296be";x.fillRect(0,0,32,32);const blob=await c.convertToBlob();postMessage(Array.from(new Uint8Array(await blob.arrayBuffer())));}catch(error){postMessage({error:error.name+": "+error.message});}};')+'],{type:"text/javascript"}));const w=new Worker(u),html=document.createElement("canvas");html.width=32;html.height=32;const offscreen=html.transferControlToOffscreen();w.onmessage=e=>{w.terminate();URL.revokeObjectURL(u);resolve(e.data)};w.onerror=e=>reject(Error(e.message));w.postMessage(offscreen,[offscreen]);})');
 const pageBytes=await wc.executeJavaScript('(async()=>{const c=new OffscreenCanvas(32,32),x=c.getContext("2d");x.fillStyle="#7296be";x.fillRect(0,0,32,32);return Array.from(new Uint8Array(await(await c.convertToBlob()).arrayBuffer()));})()');
 assert.deepEqual(transferred,pageBytes);assert.deepEqual(state.errors,[]);checks.push('DOM canvas transferred to Worker exports successfully with the same noise');
 }catch(e){error=e.stack||String(e);console.error(error);}finally{
  win?.destroy();server?.close();imageServer?.close();const report=path.join(root,'offscreen-report.json');fs.writeFileSync(report,JSON.stringify({passed:!error,checks,observed,error},null,2));console.log(JSON.stringify({passed:!error,checks,report,error},null,2));app.exit(error?1:0);
 }
});
