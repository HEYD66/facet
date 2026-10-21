'use strict';
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-viewport-screen-'));
app.setPath('userData',root);
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
app.on('window-all-closed',()=>{});
const viewport=require('../src/main/viewport.cjs');
const wait=async fn=>{for(let i=0;i<120;i++){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Timed out waiting for browser state');};
let win,server;
app.whenReady().then(async()=>{
 let failure;
 const results=[];
 try{
  server=http.createServer((_req,res)=>res.end('<!doctype html><title>Viewport bounds</title><style>html,body{margin:0}button{position:fixed;right:0;bottom:0;width:100px;height:50px}</style><input id="draft"><button id="corner" onclick="window.clicks=(window.clicks||0)+1">Click</button><script>window.identity=Math.random()</script>'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  win=new BrowserWindow({show:true,width:1600,height:1000,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);
  const wc=win.webContents;
  await wait(()=>wc.getTitle()==='Viewport bounds'&&!wc.isLoading());
  wc.debugger.attach('1.3');
  wc.on('console-message',(_event,level,message)=>console.log('PAGE',level,message));
  const env={width:0,height:0,scale:1.25,fingerprint:{enabled:true,hardware:true,screenWidth:1280,screenHeight:720}};
  assert.deepEqual([viewport.deviceMetrics(env,{width:1600,height:600}).width,viewport.deviceMetrics(env,{width:1600,height:600}).height],[1280,0]);
  assert.deepEqual([viewport.deviceMetrics(env,{width:800,height:900}).width,viewport.deviceMetrics(env,{width:800,height:900}).height],[0,720]);
  assert.deepEqual([viewport.deviceMetrics({...env,fingerprint:{...env.fingerprint,hardware:false}},{width:1600,height:900}).width,viewport.deviceMetrics({...env,fingerprint:{...env.fingerprint,hardware:false}},{width:1600,height:900}).height],[0,0]);
  assert.deepEqual([viewport.deviceMetrics({...env,width:800,height:600},{width:1600,height:900}).width,viewport.deviceMetrics({...env,width:800,height:600},{width:1600,height:900}).height],[800,600]);
  results.push({name:'width and height cap independently; disabled and fixed modes are unchanged'});
  const identity=await wc.executeJavaScript('window.identity');
  await wc.executeJavaScript('document.querySelector("#draft").value="preserved"');
  const apply=async()=>{
   const [width,height]=win.getContentSize();
   const bounds={width,height};
   const metrics=viewport.deviceMetrics(env,bounds);
   await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride',metrics);
   await new Promise(resolve=>setTimeout(resolve,300));
   await wc.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
   return {bounds,metrics,actual:await wc.executeJavaScript('({width:innerWidth,height:innerHeight,screen:[screen.width,screen.height],dpr:devicePixelRatio,zoom:visualViewport.scale})')};
  };
  const clickCorner=async sample=>{
   const point={x:sample.actual.width-50,y:sample.actual.height-25};
   wc.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
   wc.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
   await new Promise(resolve=>setTimeout(resolve,80));
   return wc.executeJavaScript('window.clicks||0');
  };
  const large=await apply();
  await wc.executeJavaScript('window.pointerEvents=[];document.addEventListener("pointerdown",event=>pointerEvents.push({x:event.clientX,y:event.clientY,target:event.target.id||event.target.tagName}),true)');
  assert(large.actual.width<=env.fingerprint.screenWidth);
  assert(large.actual.height<=env.fingerprint.screenHeight);
  assert.deepEqual(large.actual.screen,[1280,720]);
  assert(Math.abs(large.actual.dpr-1.25)<1e-5);
  assert.equal(wc.getZoomFactor(),1);
  assert.equal(await clickCorner(large),1,'bottom-right page control must receive native mouse input');
  results.push({name:'large window caps adaptive viewport and keeps bottom-right control clickable',...large});

  win.setSize(900,650);
  const small=await apply();
  assert(small.actual.width<=small.bounds.width);
  assert(small.actual.height<=small.bounds.height);
  assert(small.actual.width<=env.fingerprint.screenWidth);
  assert(small.actual.height<=env.fingerprint.screenHeight);
  assert.equal(await clickCorner(small),2);
  results.push({name:'small window remains adaptive and clickable',...small});

  const tiled=viewport.tileMetrics(env,{width:420,height:300},{width:1600,height:900},{width:2048,height:1152});
  assert(tiled.width<=env.fingerprint.screenWidth&&tiled.height<=env.fingerprint.screenHeight);
  assert.equal(tiled.deviceScaleFactor,1.25);
  results.push({name:'grid viewport respects configured screen while retaining DPR',metrics:tiled});

  win.setSize(1500,950);
  const restored=await apply();
  assert(restored.actual.width<=env.fingerprint.screenWidth&&restored.actual.height<=env.fingerprint.screenHeight);
  assert.equal(await wc.executeJavaScript('document.querySelector("#draft").value'),'preserved');
  assert.equal(await wc.executeJavaScript('window.identity'),identity);
  assert.equal(wc.getZoomFactor(),1);
  assert.equal(await clickCorner(restored),3);
  results.push({name:'resize restoration preserves page state, zoom and interaction',...restored});
 }catch(error){failure=error;console.error(error);}
 finally{
  try{if(win&&!win.isDestroyed())win.destroy();}catch{}
  server?.close();
  const report={electron:process.versions.electron,results,error:failure?.stack||null};
  fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({root,...report},null,2));
  app.exit(failure?1:0);
 }
});
