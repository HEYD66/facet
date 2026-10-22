'use strict';
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const baseline=process.argv.includes('--baseline'),root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-navigation-background-'));
app.setPath('userData',root);app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-background-networking');
const {Controller}=require('../src/main/controller.cjs'),{installIPC}=require('../src/main/ipc.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label)=>{for(let i=0;i<120;i++){if(await fn())return;await delay(50);}throw Error('Timeout: '+label);};
const checks=[],report={baseline,checks,scope:'Real Controller, native overlay, renderer, IPC and WebContentsView with isolated sessions and loopback HTTP. No production profiles, network settings or model messages.'};
let win,c,dispose,server;const sockets=new Set();setTimeout(()=>app.exit(2),60000).unref();
app.whenReady().then(async()=>{let failure;try{
 server=http.createServer((req,res)=>{
  if(req.url==='/closed'){req.socket.destroy();return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');
  if(req.url==='/hold'){res.write('waiting');return;}
  if(req.url==='/slow'){res.end('<!doctype html><title>DOM ready; image pending</title><h1>Ready content</h1><input value="keep draft"><img src="/hold">');return;}
  if(req.url==='/redirect'){res.end('<!doctype html><title>Redirecting</title><img src="/hold"><script>setTimeout(()=>location.replace("/final"),50)</script>');return;}
  res.end('<!doctype html><title>Final page</title><h1>Final page loaded</h1><input value="keep draft"><script>localStorage.setItem("test-only","retained")</script>');
 });server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 win=new BrowserWindow({show:false,width:1200,height:800,webPreferences:{preload:path.resolve('src/main/preload.cjs'),sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
 c=new Controller(win,path.join(root,'data'),path.join(root,'no-core'));dispose=installIPC(win,c);await win.loadFile(path.resolve('src/renderer/index.html'));
 const id=c.store.list()[0].id;c.store.update(id,{url:base+'/initial'});await c.start(id);const r=c.runtimes.get(id),wc=r.view.webContents,ui=s=>win.webContents.executeJavaScript(s);
 await until(()=>wc.getTitle()==='Final page','initial page');await ui('route("browser",'+JSON.stringify(id)+')');
 const beforeOrigin=await wc.executeJavaScript('performance.timeOrigin');r.view.setVisible(false);
 assert.equal(wc.getBackgroundThrottling(),baseline);const background=await wc.executeJavaScript('new Promise(resolve=>{let ticks=0;const t=setInterval(()=>ticks++,200);setTimeout(()=>{clearInterval(t);resolve({ticks,hidden:document.hidden,draft:document.querySelector("input").value})},1800)})');
 if(!baseline){assert.equal(background.hidden,false);assert(background.ticks>=5);}assert.equal(background.draft,'keep draft');assert.equal(await wc.executeJavaScript('performance.timeOrigin'),beforeOrigin);checks.push({name:'hidden-page-execution',background,throttle:wc.getBackgroundThrottling(),documentPreserved:true});
 const slow=c.workspace.data.quickLinks[0],fast=c.workspace.data.quickLinks[1];c.workspace.saveQuickLink({id:slow.id,name:'Slow fixture',url:base+'/slow'});c.workspace.saveQuickLink({id:fast.id,name:'Fast fixture',url:base+'/final'});c.emit();
 await ui('globalThis.__slowDone=false;void browserMenuAction({browserMenuAction:"quick",instanceId:'+JSON.stringify(id)+',quickId:'+JSON.stringify(slow.id)+'}).finally(()=>globalThis.__slowDone=true)');
 await until(()=>wc.getTitle()==='DOM ready; image pending','slow page DOM');await delay(250);assert.equal(await ui('__slowDone'),false,'image really keeps load pending');
 await ui('openBrowserMenu("favorites")');await until(()=>c.overlay.open,'native menu');const overlay=c.overlay.view.webContents;
 const disabled=await overlay.executeJavaScript('document.querySelectorAll("[data-browser-menu-action=quick]:disabled").length');
 assert.equal(disabled,baseline?5:0);checks.push({name:'menu-during-pending-resource',loadStillPending:true,disabledButtons:disabled});
 if(baseline){await ui('closeBrowserMenu()');await c.navigate(id,base+'/final').catch(()=>{});}else{
  const point=await overlay.executeJavaScript('(()=>{const e=document.querySelector('+JSON.stringify('[data-quick-id="'+fast.id+'"]')+'),r=e.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');
  const start=Date.now();overlay.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});overlay.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
  await until(()=>wc.getTitle()==='Final page','replacement bookmark');await until(()=>ui('__slowDone'),'superseded operation settled');await delay(100);
  assert.equal(c.overlay.open,false);assert.equal(await ui('!document.querySelector("#toast")||document.querySelector("#toast").hidden'),true);assert(c.store.get(id).url.endsWith('/final'));
  checks.push({name:'actual-native-bookmark-click-replaces-slow-load',elapsedMs:Date.now()-start,finalTitle:wc.getTitle(),errorToast:false,persisted:true});
 }
 const nav=route=>ui('facet.request("navigate",{id:'+JSON.stringify(id)+',url:'+JSON.stringify(base+route)+'})');
 const redirected=await nav('/redirect');await until(()=>wc.getTitle()==='Final page','redirect final page');
 if(baseline){assert.equal(redirected.ok,false);}else{assert.equal(redirected.ok,true);assert.equal(redirected.value?.cancelled,true);}checks.push({name:'site-script-redirect',ok:redirected.ok,cancelled:redirected.value?.cancelled===true,finalTitle:wc.getTitle()});
 const broken=await nav('/closed');assert.equal(broken.ok,false);assert.match(broken.error,/ERR_EMPTY_RESPONSE/);checks.push({name:'real-network-error-still-reported',ok:broken.ok});
 await c.navigate(id,base+'/final');await c.stop(id);await c.start(id);const restarted=c.runtimes.get(id).view.webContents;await until(()=>restarted.getTitle()==='Final page','restart restores saved destination');assert.equal(restarted.getBackgroundThrottling(),baseline);assert.equal(await restarted.executeJavaScript('localStorage.getItem("test-only")'),'retained');checks.push({name:'instance-restart-policy-and-storage',throttle:restarted.getBackgroundThrottling(),retained:true});
 }catch(e){failure=e;console.error(e.stack);}finally{
  try{await c?.closeAll();}catch(e){failure||=e;}dispose?.();if(win&&!win.isDestroyed())win.destroy();for(const socket of sockets)socket.destroy();server?.close();
  const out=path.resolve('.local-dev/navigation-background-'+(baseline?'before':'after')+'.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify({...report,success:!failure,error:failure?.message,temporaryData:root},null,2));console.log(JSON.stringify({...report,success:!failure},null,2));app.exit(failure?1:0);
 }});
