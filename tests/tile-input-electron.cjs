'use strict';
// Live grid tiles: clicks, hover, drags and wheel over cross-site (out-of-process) iframes reach
// those iframes. Input the tile's outer page receives with an <iframe> as its target (Chromium did
// not route it into the frame) is delivered to the frame instead; covered and pointer-events:none
// iframes keep the outer page's behaviour; normal browsing and the outer page itself are unchanged.
// The input is synthesized with webContents.sendInputEvent, which goes to the tile's own widget the
// way misrouted OS input does (measured on arena.ai: 0 of 1 clicks and 0 of 3 wheel notches reached
// the preview in a 0.31 tile before this fix).
const {app,BrowserWindow,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
app.commandLine.appendSwitch('host-resolver-rules','MAP *.test 127.0.0.1');app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');if(process.platform==='linux')app.commandLine.appendSwitch('disable-gpu');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-tile-input-'));app.setPath('userData',root);
const {Controller}=require('../src/main/controller.cjs'),{installIPC}=require('../src/main/ipc.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(fn,label,n=300)=>{let last;for(let i=0;i<n;i++){try{if(last=await fn())return last;}catch{}await sleep(50);}throw Error('Timeout '+label);};
const ok=name=>console.log('PASS '+name);setTimeout(()=>{console.error('WATCHDOG');app.exit(2);},180000).unref();
// Each frame counts what reaches it; the outer page counts what reaches it, per target.
const COUNT='<script>window.got={down:0,up:0,click:0,move:0,over:0,out:0,wheel:0,last:null};for(const t of ["mousedown","mouseup","click","mousemove","mouseover","mouseout","wheel"])addEventListener(t,e=>{const k={mousedown:"down",mouseup:"up",mousemove:"move",mouseover:"over",mouseout:"out"}[t]||t;got[k]++;if(t==="mousedown"||t==="click")got.last=[Math.round(e.clientX),Math.round(e.clientY)];},{capture:true,passive:true});</script>';
const FRAME='<!doctype html><title>frame</title><style>html,body{margin:0;background:#9ab}</style><div style="height:4000px"></div>'+COUNT;
const OUTER='<!doctype html><style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block}</style>';
let win,c,server;
app.whenReady().then(async()=>{try{
 server=http.createServer((q,res)=>{const port=server.address().port;res.setHeader('Content-Type','text/html; charset=utf-8');
  if(q.url.startsWith('/frame'))return res.end(FRAME);
  if(q.url.startsWith('/outer'))return res.end(OUTER+'<iframe src="http://c.test:'+port+'/frame"></iframe>'+COUNT);
  const box=(id,x,y,inner)=>'<div id='+id+' class=box style="left:'+x+'px;top:'+y+'px">'+inner+'</div>';
  // Everything sits inside the top-left 960x600 so it is within the tile's layout viewport.
  res.end('<!doctype html><title>main</title><style>body{margin:0;height:3000px;background:#222}.box{position:absolute;width:300px;height:200px}.box iframe{border:4px solid #555;padding:6px;width:280px;height:180px;box-sizing:border-box}#cover{position:absolute;left:660px;top:40px;width:300px;height:200px;background:rgba(0,0,0,.2)}#main{position:absolute;left:20px;top:540px;width:200px;height:60px}</style>'
   +box('crossSite',20,40,'<iframe src="http://a.test:'+port+'/frame"></iframe>')
   +box('nested',340,40,'<iframe style="border:0;padding:0;width:300px;height:200px" src="http://b.test:'+port+'/outer"></iframe>')
   +box('covered',660,40,'<iframe src="http://e.test:'+port+'/frame"></iframe>')+'<div id=cover></div>'
   +box('transformed',20,300,'<div style="transform:scale(0.8);transform-origin:0 0"><iframe style="width:350px;height:250px" src="http://d.test:'+port+'/frame"></iframe></div>')
   +box('noPointer',340,300,'<iframe style="pointer-events:none" src="http://f.test:'+port+'/frame"></iframe>')
   +'<button id=main onclick="window.mainClicks=(window.mainClicks||0)+1">MAIN</button>'+COUNT
   +'<script>window.targets=[];for(const t of ["mousedown","wheel","mousemove"])addEventListener(t,e=>{targets.push(t+":"+(e.target.id||e.target.tagName));if(targets.length>200)targets.shift();},{capture:true,passive:true});</script>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://main.test:'+server.address().port+'/';
 win=new BrowserWindow({width:1400,height:900,show:true,webPreferences:{preload:path.join(__dirname,'../src/main/preload.cjs'),sandbox:true,contextIsolation:true}});
 c=new Controller(win,root,path.join(__dirname,'../resources/mihomo',process.platform==='win32'?'mihomo.exe':'mihomo'));installIPC(win,c);
 const a=c.store.list()[0]||c.store.create('A');c.store.update(a.id,{url});for(const name of ['B','C','D'])c.store.create(name);
 await win.loadFile(path.join(__dirname,'../src/renderer/index.html'));const ui=code=>win.webContents.executeJavaScript(code);await wait(()=>ui('typeof current==="function"&&!!current()'),'initialize');
 await c.start(a.id);const r=()=>c.runtimes.get(a.id),wc=()=>r().view.webContents;
 await ui(`localOpen.add(${JSON.stringify(a.id)});route('browser',${JSON.stringify(a.id)})`);
 const find={crossSite:/^http:\/\/a\.test/,nested:/^http:\/\/c\.test/,covered:/^http:\/\/e\.test/,transformed:/^http:\/\/d\.test/,noPointer:/^http:\/\/f\.test/};
 const frame=id=>wc().mainFrame.framesInSubtree.find(f=>find[id].test(f.url));
 await wait(()=>wc().getTitle()==='main'&&Object.keys(find).every(id=>frame(id)&&!frame(id).isDestroyed?.()),'page and frames');await sleep(800);
 for(const id of Object.keys(find))assert.notEqual(frame(id).processId,wc().mainFrame.processId,id+' must be out of process');
 // Messages the tile preload reports (the misrouted events this fix delivers).
 let reported=[];const spy=(event,data)=>{if(event.sender===wc())reported.push(data?.kind);};ipcMain.on('facet:tile-pointer',spy);
 const reset=async()=>{reported=[];const z='window.got&&Object.keys(got).forEach(k=>got[k]=k==="last"?null:0);window.mainClicks=0;window.targets=[];scrollTo(0,0);true';await wc().mainFrame.executeJavaScript(z);for(const id of Object.keys(find))await frame(id).executeJavaScript(z);};
 const got=id=>(id==='page'?wc().mainFrame:frame(id)).executeJavaScript('({...got,scroll:Math.round(scrollY),mainClicks:window.mainClicks||0})');
 const rect=sel=>wc().executeJavaScript(`(r=>({x:r.x,y:r.y,w:r.width,h:r.height}))(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect())`);
 // Page CSS point -> tile view point.
 let scale=1;const at=p=>({x:p.x*scale,y:p.y*scale});
 // sendInputEvent takes whole view pixels, so in a ~0.45 tile a point lands within about 1/scale CSS
 // pixels of the target, and inside a scale(0.8) container a little more.
 const near=(got,want)=>Math.abs(got[0]-want[0])<=3&&Math.abs(got[1]-want[1])<=3;
 const move=p=>wc().sendInputEvent({type:'mouseMove',...at(p)});
 const click=async p=>{move({x:p.x-3,y:p.y-3});await sleep(40);move(p);await sleep(60);wc().sendInputEvent({type:'mouseDown',...at(p),button:'left',clickCount:1});await sleep(40);wc().sendInputEvent({type:'mouseUp',...at(p),button:'left',clickCount:1});await sleep(250);};
 const wheel=async p=>{move(p);await sleep(60);for(let i=0;i<3;i++){wc().sendInputEvent({type:'mouseWheel',...at(p),deltaX:0,deltaY:-120});await sleep(80);}await sleep(500);};

 // ---- Live grid tile ----
 await ui(`gridPrefs.mode='live';route('grid')`);await wait(()=>ui(`document.querySelectorAll('.grid-tile').length===4`),'tiles');
 scale=await wait(()=>{const k=r().viewportKey||'';if(!r().viewportTiled||!k.startsWith('tile:')||!r().view.getVisible())return 0;const s=JSON.parse(k.slice(5)).scale;return s>0&&s<1?s:0;},'tile mode');
 assert.ok(scale<0.7,'a 2x2 grid shrinks the page: '+scale);await sleep(500);
 const inner=async id=>{const b=await rect('#'+id+' iframe');return {x:b.x+10+60,y:b.y+10+50};};// inside border 4 + padding 6
 // Without the tile preload active the same input reaches the outer page with the <iframe> as
 // target and the frame gets nothing (the failure being fixed).
 wc().send('facet:tile-input',false);await sleep(200);await reset();
 const p0=await inner('crossSite');await click(p0);await wheel(p0);
 const before={frame:await got('crossSite'),page:await got('page'),targets:await wc().executeJavaScript('targets')};
 assert.equal(before.frame.click,0);assert.equal(before.frame.wheel,0);assert.ok(before.page.down>=1&&before.targets.includes('mousedown:IFRAME'),'misrouted input reaches the outer page: '+JSON.stringify(before.targets.slice(-4)));
 wc().send('facet:tile-input',true);await sleep(200);
 ok('Control: in a tile, synthesized input over a cross-site iframe lands on the outer page with the <iframe> as target');

 await reset();await click(p0);
 await wait(async()=>(await got('crossSite')).click===1,'click delivered');let f=await got('crossSite'),pg=await got('page');
 assert.deepEqual([f.down,f.up,f.click],[1,1,1]);assert.ok(near(f.last,[60,50]),'frame-local click point '+f.last);
 assert.equal(pg.down+pg.click,0,'the outer page sees no press over the iframe');assert.ok(f.over>=1&&f.move>=1,'hover reached the frame');assert.ok(reported.includes('down')&&reported.includes('up'));
 ok('Tile: a click over a cross-site iframe reaches it at the right frame coordinates; the outer page sees nothing');
 await reset();await wheel(p0);
 await wait(async()=>(await got('crossSite')).scroll>0,'wheel scrolls the frame');f=await got('crossSite');pg=await got('page');
 assert.equal(f.wheel,3);assert.equal(pg.wheel,0);assert.equal(pg.scroll,0,'the outer page does not scroll');
 ok('Tile: wheel over a cross-site iframe scrolls it (3 of 3 notches) and not the outer page');
 // Hover leaves the frame when the pointer moves to the outer page.
 // The gap between the two rows of boxes is outer page.
 await reset();move(p0);await sleep(150);move({x:p0.x,y:270});await sleep(300);f=await got('crossSite');
 assert.ok(f.out>=1,'the frame gets mouseout when the pointer leaves');assert.ok(reported.includes('leave'));
 // Drag: press inside, release outside; the frame still gets the release.
 await reset();move(p0);await sleep(80);wc().sendInputEvent({type:'mouseDown',...at(p0),button:'left',clickCount:1});await sleep(60);
 for(const y of [130,160,220,270]){wc().sendInputEvent({type:'mouseMove',...at({x:p0.x,y}),button:'left',modifiers:['leftButtonDown']});await sleep(50);}
 wc().sendInputEvent({type:'mouseUp',...at({x:p0.x,y:270}),button:'left',clickCount:1});await sleep(300);f=await got('crossSite');pg=await got('page');
 assert.equal(f.down,1);assert.equal(f.up,1,'release after a drag out of the frame');assert.equal(pg.down+pg.up,0);
 ok('Tile: hover ends when leaving the iframe; a press keeps the moves and the release while dragging out');
 for(const id of ['nested','transformed']){
  await reset();const b=await rect('#'+id+' iframe'),p=id==='nested'?{x:b.x+50,y:b.y+40}:{x:b.x+(10+50)*0.8,y:b.y+(10+40)*0.8};
  await click(p);await wheel(p);await wait(async()=>(await got(id)).click===1,id+' click');f=await got(id);
  assert.ok(near(f.last,[50,40]),id+' frame-local point '+f.last);assert.equal(f.wheel,3);assert.ok(f.scroll>0);
  if(id==='nested'){const b2=await frame('nested').parent.executeJavaScript('({...got})');assert.equal(b2.down,0,'the middle frame does not see the press');}
  assert.equal((await got('page')).down,0);
 }
 ok('Tile: nested cross-site iframes and iframes inside a transform: scale() container get the click and wheel at the right point');
 await reset();const pc=await inner('covered');await click(pc);await wheel(pc);f=await got('covered');pg=await got('page');
 assert.deepEqual([f.click,f.wheel],[0,0]);assert.ok(pg.down===1&&pg.wheel===3,'the overlay keeps the input');
 await reset();const pn=await inner('noPointer');await click(pn);await wheel(pn);f=await got('noPointer');pg=await got('page');
 assert.deepEqual([f.click,f.wheel],[0,0]);assert.ok(pg.down===1&&pg.wheel===3,'pointer-events:none passes through to the outer page');
 assert.ok(!reported.includes('down')&&!reported.includes('wheel'));
 ok('Tile: a covered iframe and a pointer-events:none iframe keep the outer page behaviour');
 await reset();const m=await rect('#main');await click({x:m.x+20,y:m.y+20});assert.equal((await got('page')).mainClicks,1);
 await wheel({x:m.x+20,y:m.y+90});await wait(async()=>(await got('page')).scroll>0,'outer page wheel');assert.equal(reported.length,0,'nothing reported for the outer page');
 ok('Tile: clicks and wheel on the outer page itself are unchanged');

 // ---- Zoom dialog (1:1) and normal browsing: the preload is inactive ----
 await ui(`gridSetZoom(${JSON.stringify(a.id)})`);await wait(()=>r().gridApplied?.zoom===true&&!(r().viewportKey||'').startsWith('tile:'),'zoom');await sleep(400);
 await reset();scale=1;const pz=await inner('crossSite');await wc().debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:pz.x,y:pz.y});
 for(const type of ['mousePressed','mouseReleased'])await wc().debugger.sendCommand('Input.dispatchMouseEvent',{type,x:pz.x,y:pz.y,button:'left',clickCount:1});
 await wait(async()=>(await got('crossSite')).click===1,'zoom click');assert.equal(reported.length,0,'zoom uses Chromium routing only');
 await ui('gridSetZoom(null)');await ui(`route('browser',${JSON.stringify(a.id)})`);await wait(()=>!r().viewportTiled&&r().view.getVisible(),'normal browsing');await sleep(400);
 await reset();const pb=await inner('crossSite');await wc().debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:pb.x,y:pb.y});
 for(const type of ['mousePressed','mouseReleased'])await wc().debugger.sendCommand('Input.dispatchMouseEvent',{type,x:pb.x,y:pb.y,button:'left',clickCount:1});
 await wc().debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseWheel',x:pb.x,y:pb.y,deltaX:0,deltaY:300});
 await wait(async()=>{const x=await got('crossSite');return x.click===1&&x.scroll>0;},'normal click and wheel');
 // The same synthesized widget input as in the tile now stays with the outer page: nothing is redirected.
 await reset();await click(pb);assert.equal((await got('crossSite')).click,0);assert.equal(reported.length,0);
 ok('Zoom and normal browsing: iframes get input through Chromium routing; the preload redirects nothing');
 ipcMain.removeListener('facet:tile-pointer',spy);
 console.log('ALL TILE INPUT TESTS PASSED');
}catch(e){console.error(e.stack||e);process.exitCode=1;}finally{try{await c?.closeAll();}catch{}server?.close();try{fs.rmSync(root,{recursive:true,force:true});}catch{}app.exit(process.exitCode||0);}});
