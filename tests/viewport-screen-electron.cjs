'use strict';
// Adaptive viewport with a configured screen: the page is presented 1:1 (never
// scaled, issue #10). The native view is limited to the configured screen and
// centred; every edge of the page must paint and native input must land at the
// unscaled position across window sizes, aspect ratios and DPRs.
const {app,BrowserWindow,WebContentsView,desktopCapturer,screen}=require('electron');
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
  server=http.createServer((_req,res)=>res.end('<!doctype html><title>Viewport bounds</title><style>html,body{margin:0;background:rgb(25,130,75)}button{position:fixed;right:0;bottom:0;width:100px;height:50px;background:rgb(200,51,68);border:0}.edge{position:fixed;width:40px;height:40px}.top{right:0;top:0;background:rgb(31,80,201)}.bottom{left:0;bottom:0;background:rgb(230,180,30)}</style><input id="draft"><div class="edge top"></div><div class="edge bottom"></div><button id="corner" onclick="window.clicks=(window.clicks||0)+1">Click</button><script>window.identity=Math.random()</script>'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  win=new BrowserWindow({show:true,width:1600,height:1000,backgroundColor:'#202020',webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
  win.setPosition(0,0);win.setAlwaysOnTop(true);
  const view=new WebContentsView({webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});win.contentView.addChildView(view);
  const wc=view.webContents;
  const [cw,ch]=win.getContentSize();view.setBounds({x:0,y:0,width:cw,height:ch});
  await wc.loadURL(`http://127.0.0.1:${server.address().port}`);
  await wait(()=>wc.getTitle()==='Viewport bounds'&&!wc.isLoading());
  wc.debugger.attach('1.3');
  wc.on('console-message',(_event,level,message)=>console.log('PAGE',level,message));
  const env={width:0,height:0,scale:1.25,fingerprint:{enabled:true,hardware:true,screenWidth:1280,screenHeight:720}};
  assert.deepEqual(viewport.presentedBounds(env,{x:0,y:0,width:1600,height:600}),{x:160,y:0,width:1280,height:600});
  assert.deepEqual(viewport.presentedBounds(env,{x:0,y:0,width:800,height:900}),{x:0,y:90,width:800,height:720});
  assert.equal(viewport.deviceMetrics(env,{width:1600,height:600}).scale,1);
  results.push({name:'adaptive viewport is limited to the configured screen and centred; metrics never scale'});
  const identity=await wc.executeJavaScript('window.identity');
  await wc.executeJavaScript('document.querySelector("#draft").value="preserved"');
  const assertPaint=(image,label)=>{
   const {width,height}=image.getSize(),bitmap=image.toBitmap();
   const pixel=(x,y)=>{const at=(y*width+x)*4;return [bitmap[at+2],bitmap[at+1],bitmap[at]];};
   for(const [x,y,rgb,corner] of [[width-8,height-8,[200,51,68],'bottom-right'],[width-8,8,[31,80,201],'top-right'],[8,height-8,[230,180,30],'bottom-left']]){
    // Desktop capture is color managed; the primary corner colors remain far
    // from the green page background even with the display profile applied.
    const actual=pixel(x,y);if(!actual.every((v,i)=>Math.abs(v-rgb[i])<=32))fs.writeFileSync(path.join(root,label+'-failed.png'),image.toPNG());
    assert(actual.every((v,i)=>Math.abs(v-rgb[i])<=32),label+': '+corner+' must paint the native view edge: '+actual);
   }
  };
  const checkPaint=async(label,save=false)=>{
   const image=await wc.capturePage();assertPaint(image,label);
   if(save){
    fs.writeFileSync(path.join(root,label+'.png'),image.toPNG());
    // Check actual desktop composition too: a WebContents capture alone can
    // hide a backing-surface size mismatch when emulated DPR differs from OS.
    const display=screen.getDisplayMatching(win.getBounds()),sf=display.scaleFactor;
    const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(display.size.width*sf),height:Math.round(display.size.height*sf)}}),source=sources.find(s=>s.display_id===String(display.id));
    assert(source,'native test display capture available');
    const cb=win.getContentBounds(),vb=view.getBounds(),rect={x:Math.round((cb.x+vb.x-display.bounds.x)*sf),y:Math.round((cb.y+vb.y-display.bounds.y)*sf),width:Math.round(vb.width*sf),height:Math.round(vb.height*sf)};
    const native=source.thumbnail.crop(rect);fs.writeFileSync(path.join(root,label+'-native.png'),native.toPNG());assertPaint(native,label+' native');
   }
  };
  const apply=async()=>{
   const [width,height]=win.getContentSize();
   const host={x:0,y:0,width,height},bounds=viewport.presentedBounds(env,host);
   view.setBounds(bounds);
   const metrics=viewport.deviceMetrics(env,bounds);
   await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride',metrics);
   await new Promise(resolve=>setTimeout(resolve,300));
   await wc.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
   return {host,bounds,metrics,actual:await wc.executeJavaScript('({width:innerWidth,height:innerHeight,screen:[screen.width,screen.height],dpr:devicePixelRatio,zoom:visualViewport.scale})')};
  };
  const clickCorner=async sample=>{
   // 1:1 presentation: CSS px are view DIP, no scale conversion.
   const point={x:sample.actual.width-50,y:sample.actual.height-25};
   wc.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
   wc.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
   await new Promise(resolve=>setTimeout(resolve,80));
   return wc.executeJavaScript('window.clicks||0');
  };
  const oneToOne=sample=>{
   assert.equal(sample.metrics.scale,1);
   assert(Math.abs(sample.actual.width-sample.bounds.width)<=1&&Math.abs(sample.actual.height-sample.bounds.height)<=1,'layout viewport equals the native view');
   assert(sample.actual.width<=env.fingerprint.screenWidth&&sample.actual.height<=env.fingerprint.screenHeight,'logical viewport stays within configured screen');
  };
  const large=await apply();
  await checkPaint('large',true);
  oneToOne(large);
  assert.equal(large.bounds.width,1280);assert(large.bounds.x>0,'wider host leaves a centred margin');
  assert.deepEqual(large.actual.screen,[1280,720]);
  assert(Math.abs(large.actual.dpr-1.25)<1e-5);
  assert.equal(wc.getZoomFactor(),1);
  assert.equal(await clickCorner(large),1,'bottom-right page control must receive native mouse input');
  results.push({name:'large window limits the 1:1 view to the configured screen and keeps bottom-right control clickable',...large});

  win.setSize(900,650);
  const small=await apply();
  oneToOne(small);
  assert(small.actual.width<=small.host.width&&small.actual.height<=small.host.height);
  assert.equal(await clickCorner(small),2);
  results.push({name:'small window remains adaptive, unscaled and clickable',...small});

  const tiled=viewport.tileMetrics(env,{width:420,height:300},{width:1600,height:900},{width:2048,height:1152});
  assert(tiled.width<=env.fingerprint.screenWidth&&tiled.height<=env.fingerprint.screenHeight);
  assert.equal(tiled.deviceScaleFactor,1.25);
  results.push({name:'grid preview respects configured screen while retaining DPR',metrics:tiled});

  win.setSize(1500,950);
  const restored=await apply();
  oneToOne(restored);
  assert.equal(await wc.executeJavaScript('document.querySelector("#draft").value'),'preserved');
  assert.equal(await wc.executeJavaScript('window.identity'),identity);
  assert.equal(wc.getZoomFactor(),1);
  assert.equal(await clickCorner(restored),3);
  results.push({name:'resize restoration preserves page state, zoom and interaction',...restored});
  const original=structuredClone(env);
  for(const dpr of [1,1.25,2])for(const [width,height] of [[1600,900],[1600,600],[800,900],[900,600],[1357,947]]){
   env.scale=dpr;win.setContentSize(width,height);const sample=await apply();
   oneToOne(sample);
   assert(Math.abs(sample.actual.dpr-dpr)<1e-5);assert.equal(wc.getZoomFactor(),1);
   await checkPaint('dpr-'+dpr+'-'+width+'x'+height,width===1357);
   const before=await wc.executeJavaScript('window.clicks');assert.equal(await clickCorner(sample),before+1);
   results.push({name:'paint and native corner input across aspect ratio / DPR',...sample});
  }
  env.scale=original.scale;
  assert.equal(await wc.executeJavaScript('document.querySelector("#draft").value'),'preserved');
  assert.equal(await wc.executeJavaScript('window.identity'),identity);
  assert.deepEqual(env,original);
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
