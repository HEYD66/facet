'use strict';
// Real native menu + production IPC/Controller/Mihomo, with local HTTP/TLS origins.
// No public detection requests or user profiles are used.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const http=require('node:http'),https=require('node:https'),net=require('node:net'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-privacy-sites-test-'));
app.setPath('userData',root);
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
const {Controller}=require('../src/main/controller.cjs'),{installIPC}=require('../src/main/ipc.cjs');
const sites=[['ipleak','https://ipleak.net/'],['browserleaks','https://browserleaks.com/dns'],['dnsleaktest','https://dnsleaktest.com/'],['ippure','https://ippure.com/']];
const cert=fs.readFileSync(path.join(__dirname,'fixtures/dns/cert.pem'),'utf8');
const seen=[],passed=[],sockets=new Set();let win,c,origin,tlsOrigin,proxy,dispose;
const wait=async(fn,label)=>{for(let i=0;i<300;i++){if(await fn())return;await new Promise(r=>setTimeout(r,40));}throw Error('Timeout: '+label);};
const pause=()=>new Promise(r=>setTimeout(r,180));
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const track=socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));};
const ok=name=>{passed.push(name);console.log('PASS '+name);};
setTimeout(()=>app.exit(2),120000).unref();
app.whenReady().then(async()=>{
 try{
  origin=http.createServer((_req,res)=>res.end('<title>Local page</title><h1>LOCAL PAGE</h1>'));await listen(origin);
  tlsOrigin=https.createServer({cert,key:fs.readFileSync(path.join(__dirname,'fixtures/dns/key.pem'))},(req,res)=>{seen.push({host:req.headers.host,path:req.url});res.end('<title>Controlled HTTPS origin</title><h1>HTTPS ORIGIN</h1>');});await listen(tlsOrigin);
  proxy=http.createServer((req,res)=>{const upstream=http.request('http://127.0.0.1:'+origin.address().port+new URL(req.url).pathname,{method:req.method},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});upstream.on('error',()=>res.end());req.pipe(upstream);});
  proxy.on('connect',(req,socket,head)=>{track(socket);const host=req.url.split(':')[0];if(!sites.some(([,url])=>new URL(url).hostname===host)){socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');return;}const upstream=net.connect(tlsOrigin.address().port,'127.0.0.1',()=>{socket.write('HTTP/1.1 200 Connection established\r\n\r\n');if(head.length)upstream.write(head);upstream.pipe(socket);socket.pipe(upstream);});track(upstream);upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());});await listen(proxy);
  win=new BrowserWindow({width:1440,height:960,show:true,webPreferences:{preload:path.join(__dirname,'../src/main/preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  c=new Controller(win,root,path.join(__dirname,'../resources/mihomo',process.platform==='win32'?'mihomo.exe':'mihomo'));dispose=installIPC(win,c);
  const direct=c.store.list()[0],other=c.store.create('保留页面'),target=c.store.create('检测实例',{mode:'mihomo',nodeName:'local-test'});
  for(const x of [direct,other,target])c.store.update(x.id,{url:'http://127.0.0.1:'+origin.address().port+'/home'});
  c.store.saveNodes(target.id,[{name:'local-test',type:'http',server:'127.0.0.1',port:proxy.address().port}]);
  await win.loadFile(path.join(__dirname,'../src/renderer/index.html'));
  const ui=code=>win.webContents.executeJavaScript(code),ov=()=>c.overlay.view.webContents;
  await wait(()=>ui('!!current()'),'UI initialization');
  const click=async(wc,selector)=>{const p=await wc.executeJavaScript(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Unavailable control');const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);wc.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});wc.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});await pause();};
  const open=async()=>{await click(win.webContents,'[data-privacy-toggle]');await wait(()=>c.overlay.open,'menu opened');await wait(()=>ov().executeJavaScript('document.querySelectorAll("[data-privacy-site]").length===4'),'four sites rendered');};
  await open();assert.equal(await ov().executeJavaScript('document.querySelectorAll("[data-privacy-site]:disabled").length'),4);assert.equal(c.runtimes.size,0);assert.equal(seen.length,0);ok('Stopped instances show four disabled sites without starting or contacting them');
  ov().sendInputEvent({type:'keyDown',keyCode:'Escape'});await wait(()=>!c.overlay.open,'Escape closes');await wait(()=>ui('document.activeElement?.hasAttribute("data-privacy-toggle")'),'focus restored');await new Promise(r=>setTimeout(r,360));
  await c.start(other.id);await c.start(target.id);const runtime=c.runtimes.get(target.id),otherRuntime=c.runtimes.get(other.id);await ui(`route('browser',${JSON.stringify(target.id)})`);await pause();
  runtime.session.setCertificateVerifyProc((req,cb)=>cb(sites.some(([,url])=>new URL(url).hostname===req.hostname)&&req.certificate.data.trim()===cert.trim()?0:-3));
  const wcId=runtime.view.webContents.id,otherURL=otherRuntime.view.webContents.getURL(),environment=JSON.stringify(c.store.get(target.id).environment);
  await runtime.view.webContents.executeJavaScript("localStorage.setItem('privacy-test','retained')");
  const before=await ui('JSON.stringify(document.querySelector("#browserHost").getBoundingClientRect().toJSON())');
  await open();assert.equal(runtime.view.getVisible(),true);assert.equal(win.contentView.children.at(-1),c.overlay.view);assert.equal(await ui('JSON.stringify(document.querySelector("#browserHost").getBoundingClientRect().toJSON())'),before);assert.equal(await ui('!!document.querySelector(".page-snapshot")'),false);
  fs.writeFileSync(path.join(root,'privacy-menu-light.png'),(await ov().capturePage()).toPNG());
  const bar=await ui('(()=>{const r=document.querySelector(".quick-sites").getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.floor(r.width),height:Math.ceil(r.height)}})()');
  fs.writeFileSync(path.join(root,'privacy-button.png'),(await win.webContents.capturePage(bar)).toPNG());
  c.emit();await pause();assert.equal(c.overlay.open,true);assert.equal(runtime.view.getVisible(),true);ok('Menu stays above the live page across state updates and does not change browser bounds');
  ov().sendInputEvent({type:'keyDown',keyCode:'Escape'});await wait(()=>!c.overlay.open,'close for theme');await click(win.webContents,'#themeToggle');await new Promise(r=>setTimeout(r,360));await open();assert.equal(await ov().executeJavaScript('document.documentElement.dataset.theme'),'dark');fs.writeFileSync(path.join(root,'privacy-menu-dark.png'),(await ov().capturePage()).toPNG());
  for(const [id,url] of sites){
   if(!c.overlay.open){await new Promise(r=>setTimeout(r,360));await open();}
   const count=seen.length;await click(ov(),`[data-privacy-site="${id}"]`);await wait(()=>runtime.view.webContents.getURL()===url&&c.store.get(target.id).url===url,'destination '+id);await wait(()=>seen.length>count,'actual TLS upstream '+id);
   const expected=new URL(url);assert(seen.slice(count).some(x=>x.host===expected.hostname&&x.path===expected.pathname));assert.equal(c.overlay.open,false);assert.equal(runtime.view.webContents.id,wcId);assert.equal(otherRuntime.view.webContents.getURL(),otherURL);assert.equal(JSON.stringify(c.store.get(target.id).environment),environment);assert.equal(await ui('activeId'),target.id);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'instances.json'),'utf8')).instances.find(x=>x.id===target.id).url,sites.at(-1)[1]);
  await c.navigate(target.id,'http://127.0.0.1:'+origin.address().port+'/home');assert.equal(await runtime.view.webContents.executeJavaScript("localStorage.getItem('privacy-test')"),'retained');ok('All four native buttons navigate the current instance through real Mihomo and TLS; saved URL, session and other instance remain correct');
  await new Promise(r=>setTimeout(r,360));await open();await click(win.webContents,'[data-privacy-toggle]');await wait(()=>!c.overlay.open,'same button collapses');
  await new Promise(r=>setTimeout(r,360));await open();await click(win.webContents,'#addressField');await wait(()=>!c.overlay.open,'outside click closes');
  await new Promise(r=>setTimeout(r,360));await open();await ui(`route('browser',${JSON.stringify(other.id)})`);await wait(()=>!c.overlay.open,'instance switch closes');assert.equal(await ui('privacyMenuFor'),null);ok('Toggle, outside click and instance switching close the menu');
  for(const width of [960,1280,1440]){win.setSize(width,800);await pause();await new Promise(r=>setTimeout(r,360));await open();const bounds=c.overlay.view.getBounds();assert(bounds.x>=0&&bounds.x+bounds.width<=win.getContentSize()[0]&&bounds.y+bounds.height<=win.getContentSize()[1]);assert(await ui('document.querySelector(".quick-sites").getBoundingClientRect().height<=32'));assert.equal(otherRuntime.view.getVisible(),true);ov().sendInputEvent({type:'keyDown',keyCode:'Escape'});await wait(()=>!c.overlay.open,'close size '+width);}
  ok('Day/night themes and menus fit at 960, 1280 and 1440 pixels in one bookmarks row');
  await ui(`route('browser',${JSON.stringify(target.id)})`);await pause();await ui('openExtensionMenu(activeId)');await wait(()=>c.overlay.open,'extension menu still works');assert.equal(await ov().executeJavaScript('document.querySelector("header strong").textContent'),'扩展');win.webContents.focus();await wait(()=>!c.overlay.open,'extension dismiss');
  runtime.core.child.kill();await wait(()=>runtime.status==='error','proxy terminated');await pause();await new Promise(r=>setTimeout(r,360));await open();assert.equal(await ov().executeJavaScript('document.querySelectorAll("[data-privacy-site]:disabled").length'),4);assert.equal(c.store.get(target.id).network.mode,'mihomo');ok('Extension menu still works; failed proxy disables detection links without changing network mode');
  fs.writeFileSync(path.join(root,'results.json'),JSON.stringify({passed,root},null,2));console.log('Artifacts: '+root);
 }catch(e){console.error(e);process.exitCode=1;}
 finally{try{await c?.closeAll();dispose?.();}catch(e){console.error(e);process.exitCode=1;}win?.destroy();for(const socket of sockets)socket.destroy();origin?.close();tlsOrigin?.close();proxy?.close();app.exit(process.exitCode||0);}
});
