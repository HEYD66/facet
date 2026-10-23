'use strict';
const {app,BrowserWindow,desktopCapturer}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'arena-grid-live-stress-'));
const count=Number(process.env.FACET_GRID_COUNT||15);
assert(Number.isInteger(count)&&count>=9&&count<=50,'test count: 9..50');
app.setPath('userData',root);app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
const {Controller}=require('../src/main/controller.cjs'),{installIPC}=require('../src/main/ipc.cjs'),{Store}=require('../src/main/store.cjs');
let win,c,server;const results=[],errors=[],measurements={count};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,label,n=400){for(let i=0;i<n;i++){if(await fn())return;await sleep(25);}throw Error('Timeout '+label);}
const ok=name=>{results.push(name);console.log('PASS '+name);};
setTimeout(()=>app.exit(2),180000).unref();
const page=n=>'<!doctype html><title>Live '+n+'</title><style>html,body{margin:0;height:100%;background:rgb(220,40,80)}#ticker{position:fixed;right:16px;bottom:16px;background:#fff;color:#111;padding:8px;font:14px system-ui}</style><div id="ticker">0</div><script>window.ticks=0;window.resizes=0;addEventListener("resize",()=>window.resizes++);function frame(){window.ticks++;document.querySelector("#ticker").textContent="'+n+': "+window.ticks;requestAnimationFrame(frame)}frame();</script>';
app.whenReady().then(async()=>{
 try{
  server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page(Number(req.url.slice(1))||0));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/';
  win=new BrowserWindow({width:1400,height:900,show:true,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'../src/main/preload.cjs'),sandbox:true,contextIsolation:true}});
  c=new Controller(win,root,path.join(__dirname,'../resources/mihomo',process.platform==='win32'?'mihomo.exe':'mihomo'));installIPC(win,c);
  const ids=[];
  for(let i=0;i<count;i++){
   // Exercise the production creation path at every count, without seeded fixtures.
   const x=i===0?c.store.list()[0]:c.store.create('Live '+(i+1));
   c.store.update(x.id,{name:'Live '+(i+1),url:base+(i+1)});ids.push(x.id);
  }
  assert.equal(new Store(root).list().length,count);
  await win.loadFile(path.join(__dirname,'../src/renderer/index.html'));const ui=code=>win.webContents.executeJavaScript(code);
  await wait(()=>ui('typeof current==="function"&&!!current()'),'renderer');
  await Promise.all(ids.map(id=>c.start(id)));
  await wait(()=>ids.every((id,i)=>c.runtimes.get(id)?.view?.webContents.getURL()===base+(i+1)&&!c.runtimes.get(id).view.webContents.isLoading()),'all pages loaded',1600);
  await ui("gridPrefs.mode='live';gridPrefs.cols=3;route('grid')");
  await wait(()=>c.gridCanvas&&ids.every(id=>c.runtimes.get(id)?.gridApplied?.visible),'native live views');
  await sleep(400);
  assert.equal(await ui('document.querySelectorAll(".grid-tile").length'),count);
  assert.equal(await ui('document.querySelectorAll(".grid-thumb").length'),0);assert.equal(await ui('gridTimer'),null);
  assert(ids.every(id=>c.runtimes.get(id).view.webContents.getOSProcessId()>0));
  ok(count+' real pages loaded from HTTP and persisted configurations; no thumbnails or polling');
  const probe=()=>Promise.all(ids.map(id=>c.runtimes.get(id).view.webContents.executeJavaScript('({ticks:window.ticks,resizes:window.resizes,w:innerWidth,h:innerHeight})')));
  const before=await probe();let viewMoves=0,metricsWrites=0,canvasMoves=0,fullLayouts=0,scrollMessages=0,maxScrollBytes=0,runtimeIterations=0;
  const setGrid=c.setGrid.bind(c),scrollGrid=c.scrollGrid.bind(c),iterate=c.runtimes[Symbol.iterator].bind(c.runtimes);
  c.setGrid=g=>{fullLayouts++;return setGrid(g);};c.scrollGrid=message=>{scrollMessages++;maxScrollBytes=Math.max(maxScrollBytes,Buffer.byteLength(JSON.stringify(message)));return scrollGrid(message);};
  c.runtimes[Symbol.iterator]=function(){runtimeIterations++;return iterate();};
  await ui('(()=>{window.gridTileReads=0;window.gridPositionSends=0;const queue=gridQueue;gridQueue=function(action,payload){if(action==="grid-scroll")window.gridPositionSends++;return queue(action,payload);};const read=Element.prototype.getBoundingClientRect;Element.prototype.getBoundingClientRect=function(){if(this.classList.contains("grid-body"))window.gridTileReads++;return read.call(this);};})()');
  for(const id of ids){const v=c.runtimes.get(id).view,original=v.setBounds.bind(v);v.setBounds=b=>{viewMoves++;return original(b);};const dbg=v.webContents.debugger,send=dbg.sendCommand.bind(dbg);dbg.sendCommand=(method,...args)=>{if(method==='Emulation.setDeviceMetricsOverride')metricsWrites++;return send(method,...args);};}
  const move=c.gridCanvas.setBounds.bind(c.gridCanvas);c.gridCanvas.setBounds=b=>{canvasMoves++;return move(b);};
  const timing=await ui('(async()=>{const e=document.querySelector("#content"),max=e.scrollHeight-e.clientHeight;if(max<=0)throw Error("No scroll range");const intervals=[];let last=performance.now();for(let i=0;i<90;i++){await new Promise(requestAnimationFrame);const now=performance.now();intervals.push(now-last);last=now;e.scrollTop=Math.round(max*(i<45?i/44:(89-i)/44));e.dispatchEvent(new Event("scroll"));}return {max,intervals};})()');
  await wait(()=>c.grid.scrollTop===0,'scroll returned');await sleep(300);
  const after=await probe();
  const tileReads=await ui('window.gridTileReads');c.runtimes[Symbol.iterator]=iterate;
  measurements.scroll={fullLayouts,positionSends:await ui('window.gridPositionSends'),scrollMessages,maxScrollBytes,runtimeIterations,tileReads,viewMoves,metricsWrites,canvasMoves,max:timing.max,rafP50:timing.intervals.toSorted((a,b)=>a-b)[45],rafP95:timing.intervals.toSorted((a,b)=>a-b)[85],before,after,tickDeltas:after.map((v,i)=>v.ticks-before[i].ticks)};
  assert.equal(fullLayouts,0,'scroll must not resend the instance layout');assert.equal(tileReads,0,'scroll must not read per-tile DOM geometry');assert.equal(runtimeIterations,0,'scroll must not iterate runtime instances');assert(scrollMessages>20&&maxScrollBytes<100,'constant size position messages');
  assert.equal(viewMoves,0,'scroll must not move/resize individual native pages');assert.equal(metricsWrites,0,'scroll must not change webpage viewport');assert(canvasMoves>20,'real native scroll updates');
  assert(after.every((v,i)=>v.w===before[i].w&&v.h===before[i].h&&v.resizes===before[i].resizes),'stable page layout while scrolling');
  assert(after.every((v,i)=>v.ticks>before[i].ticks),'all pages continue animating');
  ok('Scroll performs no tile DOM reads, full layouts, runtime iteration, page bounds writes or viewport overrides; messages stay under 100 bytes');
  const stable=c.grid.scrollTop;assert.equal(c.scrollGrid({revision:c.grid.revision-1,scrollTop:10}),false);assert.equal(c.scrollGrid({revision:c.grid.revision,scrollTop:NaN}),false);assert.equal(c.grid.scrollTop,stable);
  await ui('(async()=>{while(gridInFlight)await new Promise(requestAnimationFrame);gridInFlight=true;const e=document.querySelector("#content");for(let i=1;i<=30;i++){e.scrollTop=i;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);}if(gridPending?.action!=="grid-scroll"||gridPending.payload.scrollTop!==30)throw Error("Latest scroll not retained");gridInFlight=false;gridFlush();})()');
  await wait(()=>c.grid.scrollTop===30,'coalesced latest scroll');
  await ui('(()=>{gridInFlight=true;gridSendLayout(true);})()');await ui('new Promise(requestAnimationFrame)');await ui('new Promise(requestAnimationFrame)');
  await ui('(()=>{gridQueue("grid-scroll",{revision:gridRevision,scrollTop:40});if(gridPending?.action!=="grid-layout"||gridPending.payload.grid.scrollTop!==40)throw Error("Pending full layout lost");gridInFlight=false;gridFlush();})()');await wait(()=>c.grid.scrollTop===40,'scroll merged into pending full layout');
  ok('Stale/invalid scrolls do not move pages; a busy channel keeps one latest position and preserves pending full layouts');
  const revision=c.grid.revision;c.grid.revision--;
  await ui('document.querySelector("#content").scrollTop=45;document.querySelector("#content").dispatchEvent(new Event("scroll"))');
  await wait(()=>c.grid.revision>revision&&c.grid.scrollTop===45,'out-of-sync layout rebuilt through real IPC');
  ok('An out-of-sync layout triggers a full resync through the real IPC channel');
  const partial=Math.min(170,timing.max-1);
  await ui("document.querySelector('#content').scrollTop="+partial);await wait(()=>c.grid.scrollTop===partial,'partial row');await sleep(250);
  const bounds=await ui('(()=>{const e=document.querySelector("#content"),r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:e.clientWidth,height:e.clientHeight}})()');
  assert.deepEqual(c.gridClip.getBounds(),Object.fromEntries(Object.entries(bounds).map(([k,v])=>[k,Math.round(v)])));
  const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:2800,height:1800}}),source=sources.find(s=>s.id===win.getMediaSourceId());assert(source&&!source.thumbnail.isEmpty(),'composited native window screenshot');
  const shot=source.thumbnail,shotFile=path.join(root,'partial-scroll.png');fs.writeFileSync(shotFile,shot.toPNG());measurements.screenshot=shotFile;
  // Windows source excludes invisible resize borders and includes the title bar.
  const size=shot.getSize(),content=win.getContentBounds(),outer=win.getBounds(),scale=size.width/content.width,top=size.height-content.height*scale;
  const bitmap=shot.toBitmap();
  const pixel=(x,y)=>{const px=Math.round(x*scale),py=Math.round(top+y*scale),at=(py*size.width+px)*4;return [...bitmap.subarray(at,at+3)];};
  const red=p=>p[2]>170&&p[1]<100&&p[0]<130;
  measurements.clipping={above:pixel(bounds.x+50,bounds.y-5),inside:pixel(bounds.x+50,bounds.y+20),below:pixel(bounds.x+50,bounds.y+bounds.height+5),outer,content,size};
  assert(!red(measurements.clipping.above),'native webpage must not cover the header');assert(red(measurements.clipping.inside),'partially visible native page must render');assert(!red(measurements.clipping.below),'native webpage must not cover footer');
  ok('Composited screenshot confirms partial live pages render and clip at both content boundaries');
  win.setSize(1200,800);await wait(()=>c.grid.viewport.width<bounds.width,'window resized');
  await wait(async()=>{const rects=await ui('[...document.querySelectorAll(".grid-tile")].map(e=>{const b=e.querySelector(".grid-body").getBoundingClientRect();return {id:e.dataset.gridId,x:b.x,y:b.y,width:b.width,height:b.height}})');const clip=c.gridClip.getBounds(),canvas=c.gridCanvas.getBounds();return rects.every(t=>{const b=c.runtimes.get(t.id).view.getBounds();return Math.abs(b.x+clip.x+canvas.x-t.x)<=2&&Math.abs(b.y+clip.y+canvas.y-t.y)<=2&&Math.abs(b.width-t.width)<=2&&Math.abs(b.height-t.height)<=2;});},'resized native grid matches DOM');
  ok('Resizing the window keeps all native pages aligned with their grid bodies');
  await ui("document.querySelector('#content').scrollTop=0");await wait(()=>c.grid.scrollTop===0,'top before saver');
  await ui("document.querySelector('[data-grid-mode=saver]').click()");await wait(()=>ids.filter(id=>c.runtimes.get(id).view.getVisible()).length===1,'saver focus');
  assert(ids.every(id=>c.runtimes.get(id).view.webContents.getBackgroundThrottling()));assert.equal(await ui('document.querySelectorAll(".grid-thumb").length'),count);
  await ui("document.querySelector('[data-grid-mode=live]').click()");await wait(()=>ids.every(id=>c.runtimes.get(id).view.getVisible()&&!c.runtimes.get(id).view.webContents.getBackgroundThrottling()),'live restored');
  ok('Saver retains thumbnails and background throttling; live restores every native page');
  await ui('(async()=>{while(gridInFlight)await new Promise(requestAnimationFrame);gridInFlight=true;gridSendLayout(true);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);route("browser",'+JSON.stringify(ids[0])+');if(gridPending!==null)throw Error("Old grid layout retained after leaving");gridInFlight=false;gridFlush();})()');
  await wait(()=>!c.grid&&c.runtimes.get(ids[0]).view.getVisible(),'return to browser');assert.equal(c.gridCanvas,null);assert(!c.runtimes.get(ids[0]).gridParent);
  // 普通浏览页默认关闭后台节流（见 docs/NAVIGATION-BACKGROUND.md）；离开宫格不得保留省资源模式的节流。
  assert(ids.every(id=>!c.runtimes.get(id).view.webContents.getBackgroundThrottling()));
  await ui("route('grid')");await wait(()=>c.gridCanvas&&ids.every(id=>c.runtimes.get(id).gridApplied?.visible),'return to grid');
  ok('Leaving cancels queued old layouts; returning reparents native pages correctly');
 }catch(e){errors.push(e.stack||String(e));console.error(e);}
 finally{
  try{await c?.closeAll();}catch(e){errors.push(e.message);}win?.destroy();server?.close();
  const report={platform:process.platform,electron:process.versions.electron,passed:results.length,results,measurements,errors};
  const file=path.join(root,'report.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');console.log('REPORT '+file);console.log(JSON.stringify(report,null,2));app.exit(errors.length?1:0);
 }
});
