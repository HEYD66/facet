'use strict';
// Exercise the actual installed executable and packaged UI/IPC with isolated data.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),net=require('node:net'),assert=require('node:assert/strict');
const {spawn,execFile}=require('node:child_process'),{promisify}=require('node:util');
const {chromium}=require('playwright');
const {Store}=require('../src/main/store.cjs');
const {ExtensionCatalog}=require('../src/main/extension-catalog.cjs');
const {childEnvironment}=require('./electron-runtime.cjs');
const buildManifest=path.resolve(__dirname,'../release/build-manifest.json');
const executable=path.resolve(process.argv[2]||(fs.existsSync(buildManifest)?JSON.parse(fs.readFileSync(buildManifest,'utf8')).unpackedExecutable:'release/win-unpacked/Facet.exe'));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-installed-中文-'));
const results=[],errors=[];let server,proxy,child,browser,ui,inspectorUrl,proxyHits=0,geoHits=0,aiUpload='';
const sockets=new Set(),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pass=name=>{results.push(name);console.log('PASS '+name);};
async function wait(fn,label,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await sleep(50);}throw Error('Timeout: '+label);}
async function launch(){
 const portFile=path.join(root,'DevToolsActivePort');fs.rmSync(portFile,{force:true});
 inspectorUrl=null;let inspectorOutput='';
 child=spawn(executable,['--user-data-dir='+root,'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--inspect=127.0.0.1:0'],{env:childEnvironment(),windowsHide:false,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',d=>fs.appendFileSync(path.join(root,'stdout.log'),d));child.stderr.on('data',d=>{fs.appendFileSync(path.join(root,'stderr.log'),d);inspectorOutput=(inspectorOutput+d.toString()).slice(-8192);const match=inspectorOutput.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/);if(match)inspectorUrl=match[1];});
 let launchError;child.on('error',e=>launchError=e);
 const controlFile=path.join(root,'control-api.json'),control=fs.existsSync(controlFile)?JSON.parse(fs.readFileSync(controlFile,'utf8')):null;
 await wait(async()=>{if(launchError)throw launchError;if(child.exitCode!==null)throw Error('Installed app exited: '+child.exitCode);if(control?.enabled){try{return (await fetch('http://127.0.0.1:'+control.cdpPort+'/json/version')).ok;}catch{return false;}}return fs.existsSync(portFile);},'installed debugger ready',45000);
 const port=control?.enabled?control.cdpPort:Number(fs.readFileSync(portFile,'utf8').split(/\r?\n/)[0]);assert(port>0);
 browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);
 await wait(()=>{ui=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/src/renderer/index.html'));return !!ui;},'packaged control page');
 await ui.waitForFunction(()=>typeof bridge!=='undefined'&&state.instances.length===2);
 assert(ui.url().includes('app.asar'),'must load packaged source');
}
async function call(action,payload={}){const response=await ui.evaluate(({action,payload})=>bridge.request(action,payload),{action,payload});assert.equal(response.ok,true,response.error);return response.value;}
async function mainValue(expression){
 await wait(()=>!!inspectorUrl,'test main-process inspector');
 return new Promise((resolve,reject)=>{
  const socket=new WebSocket(inspectorUrl),timer=setTimeout(()=>finish(Error('Main-process fixture setup timed out')),10000);
  function finish(error,value){clearTimeout(timer);socket.close();error?reject(error):resolve(value);}
  socket.addEventListener('error',()=>finish(Error('Main-process fixture connection failed')),{once:true});
  socket.addEventListener('open',()=>socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}})),{once:true});
  socket.addEventListener('message',event=>{const value=JSON.parse(event.data);if(value.id===1){if(value.error||value.result?.exceptionDetails)return finish(Error(JSON.stringify(value.error||value.result.exceptionDetails)));finish(null,value.result.result.value);}});
 });
}
async function setIsolatedGeoEndpoint(url){
 // Only redirect the diagnostic destination in this isolated test process.
 assert.equal(await mainValue("process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json')('./src/main/diagnostics.cjs').TARGETS.ip="+JSON.stringify(url)),url);
}
// PowerShell 7 is optional on Windows; fall back to the built-in Windows PowerShell 5.1.
// Bypass applies to this one process only so the read-only probe script can run under the default policy.
async function runPowerShell(args,options){try{return await promisify(execFile)('pwsh.exe',args,options);}catch(e){if(e.code!=='ENOENT')throw e;return promisify(execFile)('powershell.exe',['-ExecutionPolicy','Bypass',...args],options);}}
async function verifyTaskbar(){
 const native=JSON.parse((await runPowerShell(['-NoProfile','-File',path.join(__dirname,'../tests/window-identity-properties.ps1'),'-ProcessId',String(child.pid)],{encoding:'utf8',windowsHide:true,timeout:15000})).stdout);
 assert.equal(native.pid,child.pid);assert.equal(native.appId,'Facet.MultiInstanceBrowser');
 assert.equal(native.icon,path.join(path.dirname(executable),'resources/facet.ico')+',0');
 assert.equal(native.command,'"'+executable+'"');assert.equal(native.name,'千面 Facet');
 assert(native.large?.hash&&native.small?.hash);
 return native;
}
async function api(endpoint,{body,authenticated=true}={}){
 const control=await call('control-status');
 const response=await fetch(`http://127.0.0.1:${control.apiPort}${endpoint}`,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(authenticated?{authorization:'Bearer '+control.token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 if(!authenticated){assert.equal(response.status,401);return;}
 const result=await response.json();assert.equal(result.ok,true,result.error);return result.value;
}
async function instancePage(id,knownTarget){
 const target=knownTarget||(await api('/v1/targets')).find(x=>x.instanceId===id);assert(target,'running instance target missing');
 for(const page of browser.contexts().flatMap(c=>c.pages())){
  const session=await page.context().newCDPSession(page);let info;try{info=await session.send('Target.getTargetInfo');}finally{await session.detach();}
  if(info.targetInfo.targetId===target.targetId)return page;
 }
 throw Error('running instance page missing');
}
async function extensionPage(id,extensionId){
 await call('extension-open',{id,extensionId,kind:'popup'});let panel;
 await wait(()=>{panel=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('chrome-extension://')&&p.url().endsWith('/popup.html'));return !!panel;},'packaged extension panel');
 await panel.waitForFunction(()=>!!window.__facetExtensionCompatApplied);return panel;
}
async function close(){
 if(!child||child.exitCode!==null)return;
 if(ui){const snapshot=await call('snapshot');for(const x of snapshot.instances)if(x.status==='running'||x.status==='starting')await call('stop',{id:x.id});}
 // Send WM_CLOSE to this test window. Electron's normal exit guard and cleanup still run.
 const closer=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$p=Get-Process -Id ${child.pid} -ErrorAction Stop; if(-not $p.CloseMainWindow()){exit 1}`],{windowsHide:true,stdio:'ignore'});
 await new Promise((resolve,reject)=>{closer.once('error',reject);closer.once('exit',code=>code===0?resolve():reject(Error('Test window close failed: '+code)));});
 await wait(()=>child.exitCode!==null,'installed application normal exit',15000);browser=null;ui=null;
}
async function verifyPackagedDsh(target){
 let step=0,fixtureError;const sample=path.join(root,'packaged-ai-upload.txt');fs.writeFileSync(sample,'PACKAGED_REAL_UPLOAD');
 const model=http.createServer(async(req,res)=>{try{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
  assert(body.tools.every(t=>t.type==='function'&&t.function.parameters?.type==='object'));
  const tool=body.messages.findLast(m=>m.role==='tool');let message;
  if(step===0)message={content:null,tool_calls:[{id:'packaged-manual',type:'function',function:{name:'read_manual',arguments:JSON.stringify({document:'AI-AGENT.md'})}}]};
  else if(step===1){assert(tool.content.includes('DeepSeek Harness'));message={content:null,tool_calls:[{id:'packaged-page',type:'function',function:{name:'observe',arguments:JSON.stringify({instanceId:target,full_text:true})}}]};}
  else if(step===2){assert(tool.content.includes('REAL_INSTALLED_PAGE'),'Expected whole-page fixture text: '+tool.content.slice(0,500));message={tool_calls:[{id:'packaged-network',type:'function',function:{name:'network_log',arguments:JSON.stringify({instanceId:target,action:'start'})}}]};}
  else if(step===3){assert(JSON.parse(tool.content).started);message={tool_calls:[{id:'packaged-script',type:'function',function:{name:'cdp_command',arguments:JSON.stringify({instanceId:target,method:'Runtime.evaluate',params:{expression:'fetch("/ai-probe").then(r=>r.json())',awaitPromise:true,returnByValue:true}})}}]};}
  else if(step===4){assert.equal(JSON.parse(tool.content).result.result.value.retryAfterMs,25000);message={tool_calls:[{id:'packaged-read-network',type:'function',function:{name:'network_log',arguments:JSON.stringify({instanceId:target,action:'read'})}}]};}
  else if(step===5){const row=JSON.parse(tool.content).items.find(x=>x.url.endsWith('/ai-probe'));assert(row&&row.status===200);message={tool_calls:[{id:'packaged-network-body',type:'function',function:{name:'network_log',arguments:JSON.stringify({instanceId:target,action:'body',requestId:row.requestId})}}]};}
  else if(step===6){assert.equal(JSON.parse(JSON.parse(tool.content).body).retryAfterMs,25000);message={tool_calls:[{id:'packaged-upload',type:'function',function:{name:'upload_file',arguments:JSON.stringify({instanceId:target,selector:'#aiFile',files:[sample]})}}]};}
  else if(step===7){assert(JSON.parse(tool.content).filled);message={tool_calls:[{id:'packaged-submit',type:'function',function:{name:'cdp_command',arguments:JSON.stringify({instanceId:target,method:'Runtime.evaluate',params:{expression:'document.querySelector("#aiFile").files[0].text().then(text=>fetch("/ai-upload",{method:"POST",body:text})).then(r=>r.text())',awaitPromise:true,returnByValue:true}})}}]};}
  else {assert.equal(JSON.parse(tool.content).result.result.value,'received');assert.equal(aiUpload,'PACKAGED_REAL_UPLOAD');message={content:'PACKAGED_DSH_VERIFIED：已核对说明书、真实网页、脚本、网络响应和文件上传。'};}
  step++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',...message}}]}));
 }catch(e){fixtureError=e;res.statusCode=500;res.end('packaged fixture error');}});
 await new Promise(r=>model.listen(0,'127.0.0.1',r));
 try{
  await call('ai-settings',{settings:{baseURL:'http://127.0.0.1:'+model.address().port+'/v1',model:'packaged-dsh-protocol',maxRounds:0}});
  await call('ai-run',{prompt:'读取说明书并验收真实网页控制、网络响应和文件上传',ids:[target],permission:'full'});
  await wait(async()=>!(await call('ai-state')).busy,'packaged official DSH completion',45000);if(fixtureError)throw fixtureError;
  const state=await call('ai-state');assert.equal(state.engine.name,'DeepSeek Harness');assert.equal(state.engine.version,'0.2.1-rc.2');assert.equal(state.task.status,'已完成',state.task.entries.filter(e=>e.kind==='system').map(e=>e.text).join('\n'));assert.equal(step,9);assert(!state.task.pending);
  assert(state.task.entries.some(e=>e.kind==='assistant'&&e.text.includes('PACKAGED_DSH_VERIFIED')));
  assert(state.task.entries.some(e=>e.kind==='tool'&&e.text.startsWith('observe：')));
  pass('Packaged ASAR official DSH executes real manual, browser, scripts, Network body and HTTP file upload without approval');
 }finally{model.closeAllConnections();model.close();}
}
async function main(){
 assert(fs.existsSync(executable),'installed executable missing');
 const resources=path.join(path.dirname(executable),'resources');
 for(const file of ['app.asar','mihomo/mihomo.exe','mihomo/LICENSE','mihomo/mihomo-source.tar.gz','process-host/facet-process-host.exe','process-host/manifest.json','facet.ico','AGENTS.md','README.md','docs/README.md','docs/PROJECT.md','docs/CURRENT-SCOPE.md','docs/AI-CONTROL-HANDOFF.md','docs/CONTROL-API.md','docs/EXTENSION-COMPATIBILITY.md','docs/FINGERPRINT-CATALOG.md','docs/DIAGNOSTICS.md'])assert(fs.existsSync(path.join(resources,file)),file+' missing');
 pass('Installed resources include packaged code, core, process host, icon, licenses and source archive');
 server=http.createServer(async(req,res)=>{if(req.url==='/ai-probe'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({status:'cooldown',retryAfterMs:25000}));}if(req.url==='/ai-upload'){aiUpload='';for await(const b of req)aiUpload+=b;return res.end('received');}if(req.url==='/geo'){geoHits++;res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({ip:'203.0.113.40',country_code:'JP',country:'Japan',timezone:{id:'Asia/Tokyo'}}));}if(req.url.startsWith('/diagnostic-reset'))return req.socket.destroy();if(req.url.startsWith('/diagnostic-status'))res.statusCode=503;res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>Installed live fixture</title><h1>REAL_INSTALLED_PAGE</h1><input type="file" id="aiFile"><script>window.ticks=0;function tick(){window.ticks++;requestAnimationFrame(tick)}tick();</script>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/';
 proxy=http.createServer((req,res)=>{proxyHits++;const destination=new URL(req.url);const request=http.request(destination,{method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});request.on('error',()=>res.end());req.pipe(request);});
 proxy.on('connect',(req,downstream,head)=>{proxyHits++;const target=new URL('http://'+req.url);const upstream=net.connect(Number(target.port)||443,target.hostname,()=>{downstream.write('HTTP/1.1 200 Connection established\r\n\r\n');if(head.length)upstream.write(head);upstream.pipe(downstream);downstream.pipe(upstream);});for(const socket of [upstream,downstream]){sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));}});
 await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
 const store=new Store(root),a=store.create('安装验证·直连'),b=store.create('安装验证·代理');
 const adaptive=structuredClone(store.get(a.id).environment);Object.assign(adaptive,{width:0,height:0,scale:1});Object.assign(adaptive.fingerprint,{enabled:true,hardware:true,seed:'viewport-package-fixture',screenWidth:800,screenHeight:600,availHeight:560});
 store.update(a.id,{url,environment:adaptive});store.update(b.id,{url,network:{mode:'mihomo',nodeName:'本机验证代理'}});store.saveNodes(b.id,[{name:'本机验证代理',type:'http',server:'127.0.0.1',port:proxy.address().port}],null);
 const extensionSource=path.join(root,'extension-source');fs.mkdirSync(extensionSource);
 fs.writeFileSync(path.join(extensionSource,'manifest.json'),JSON.stringify({manifest_version:3,name:'Packaged API verification',version:'1.0.0',permissions:['tabs','webNavigation','bookmarks','storage'],host_permissions:['http://127.0.0.1/*'],action:{default_popup:'popup.html'}}));
 fs.writeFileSync(path.join(extensionSource,'popup.html'),'<title>Packaged extension verification</title><p>Real packaged extension API</p>');
 const catalog=new ExtensionCatalog(root),extension=catalog.stage(extensionSource);catalog.accept(extension);catalog.setEnabled(b.id,extension.id,true);
 fs.writeFileSync(path.join(root,'workspace-tools.json'),JSON.stringify({nodes:[],ips:[],quickLinksRevision:1,quickLinks:[{id:'quick-ipip',name:'ipip.la',url:'https://ipip.la/disguise.html'},{id:'quick-arena',name:'Arena',url:'https://arena.ai/agent'},{id:'duplicate',name:'ipip.la',url:'https://ipip.la/'}]}));
 await launch();if(process.argv.includes('--ai-only')){await call('start',{id:a.id});await wait(async()=>(await call('snapshot')).instances.find(x=>x.id===a.id).title==='Installed live fixture','AI test page');await ui.evaluate(id=>route('browser',id),a.id);await ui.locator('#aiToggle').click();await verifyPackagedDsh(a.id);await close();await launch();assert((await call('ai-state')).task.entries.some(e=>e.text.includes('PACKAGED_DSH_VERIFIED')));pass('Packaged DSH history persists across restart');await close();return;}assert((await call('snapshot')).instances.every(x=>x.status==='stopped'));pass('Installed app loads real production preload/IPC and does not auto-start instances');
 const firstIcon=await verifyTaskbar();pass('Actual packaged window exposes native Facet icons and correct taskbar icon/relaunch paths');
 assert.equal((await call('snapshot')).versions.app,require('../package.json').version);
 const beforeCatalogEnvironment=(await call('snapshot')).instances.find(x=>x.id===a.id).environment;
 const plan=await call('fingerprint-preset',{preset:'library-v1',environment:{language:'ja-JP',timezone:'Asia/Tokyo'}});
 assert.equal(plan.width,0);assert.equal(plan.height,0);assert.equal(plan.fingerprint.template,'library-v1');assert.equal(plan.fingerprint.touch,0);assert(plan.fingerprint.renderer&&plan.fingerprint.vendor);assert.equal(plan.language,'ja-JP');assert.equal(plan.timezone,'Asia/Tokyo');
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'instances.json'),'utf8')).instances.find(x=>x.id===a.id).environment,beforeCatalogEnvironment);
 pass('Packaged fingerprint catalog generates coherent desktop plans without changing saved instances');
 await ui.locator('#sidebar .nav[data-view="settings"]').click();await ui.waitForFunction(()=>view==='settings'&&!!document.querySelector('#nodeNetworkCard'));
 assert.match(await ui.locator('#workspaceHead h1').textContent(),/^应用设置/);assert(await ui.locator('[data-palette-mode]').count()>0);
 assert(await ui.locator('#nodeNetworkCard').isVisible());
 assert.deepEqual(await ui.locator('#nodeDnsMode option').evaluateAll(rows=>rows.map(x=>x.value)),['auto','system','secure','strict']);
 assert.equal(await ui.locator('#nodeDnsMode').inputValue(),'system');
 assert.equal(await ui.locator('#controlApiEnabled').getAttribute('role'),'switch');
 assert.equal(await ui.locator('#controlApiEnabled').isChecked(),false);
 assert.deepEqual((await call('snapshot')).nodeNetwork.settings,{dnsMode:'system',routeMode:'system',interfaceName:''});
 const interfaces=await call('node-network-interfaces');assert(interfaces.every(row=>row.name&&Number.isSafeInteger(row.index)));
 assert(interfaces.length>0);
 assert(!fs.existsSync(path.join(root,'node-network.json')),'Viewing settings must not write network configuration');
 await ui.screenshot({path:path.join(root,'node-network-settings.png')});pass('Packaged settings expose all four DNS modes and the external control switch; defaults remain unchanged without writing network configuration');
 await ui.locator('#sidebar .nav[data-view="global"]').click();
 await ui.waitForFunction(()=>view==='global'&&!!document.querySelector('.github-support-card'));
 const info=await ui.locator('#content').textContent();
 assert(!info.includes('独立新项目')&&!info.includes('（原 Arena Core）')&&!info.includes('明确的边界'));
 for(const text of ['支持开源项目','github.com/HEYD66/facet','隐私保护与 AI 助手','模型服务','系统加密','键盘快捷键','免责声明'])assert(info.includes(text),text+' missing');
 assert.equal(await ui.locator('#content .section-intro').count(),0);
 assert(await ui.locator('[data-action="open-github"]').first().isEnabled());
 await ui.screenshot({path:path.join(root,'application-info.png')});
 pass('Packaged application info explains privacy and AI data routing, retaining GitHub, shortcuts and disclaimer');
 for(const id of [a.id,b.id])await call('start',{id});
 await wait(async()=>{const snapshot=await call('snapshot');return snapshot.instances.every(x=>x.status==='running'&&x.title==='Installed live fixture'&&!x.error);},'both installed pages loaded',45000);
 assert(proxyHits>0);const proxyConfig=JSON.parse(fs.readFileSync(path.join(root,'core-runtime',b.id,'runtime.json'),'utf8'));assert.equal(proxyConfig.dns.enable,false);assert(!proxyConfig.hosts);assert(!proxyConfig['interface-name']);pass('Two independent real webpages load; packaged Mihomo and process host use original DNS and routing without hosts overrides');
 await ui.evaluate(id=>route('browser',id),a.id);await ui.waitForFunction(()=>view==='browser');
 const adaptiveTarget=await mainValue(`(async()=>{const e=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json')('electron'),wc=e.webContents.getAllWebContents().find(w=>w.session===e.session.fromPartition(${JSON.stringify('persist:arena-core-'+a.id)})&&w.getURL()===${JSON.stringify(url)});return {webContentsId:wc.id,targetId:(await wc.debugger.sendCommand('Target.getTargetInfo')).targetInfo.targetId};})()`);
 const adaptivePage=await instancePage(a.id,adaptiveTarget);await adaptivePage.evaluate(()=>{const b=document.createElement('button');b.id='viewport-corner';b.textContent='CORNER';b.style='position:fixed;right:0;bottom:0;width:100px;height:50px;background:rgb(200,51,68);border:0';b.onclick=()=>window.cornerClicked=true;document.body.append(b);});await sleep(350);
 const fill=await mainValue(`(async()=>{
  const req=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json'),e=req('electron'),wc=e.webContents.fromId(${adaptiveTarget.webContentsId});
  const view=e.BrowserWindow.getAllWindows().flatMap(w=>w.contentView.children).find(v=>v.webContents?.id===wc.id),bounds=view.getBounds();
  const m=req('./src/main/viewport.cjs').deviceMetrics(${JSON.stringify(adaptive)},bounds),image=await wc.capturePage(),size=image.getSize(),pixels=image.toBitmap(),at=((size.height-8)*size.width+size.width-8)*4;
  const actual=await wc.executeJavaScript('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})');
  const point={x:Math.round((actual.width-50)*m.scale),y:Math.round((actual.height-25)*m.scale)};
  wc.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});wc.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
  return {bounds,metrics:m,actual,zoom:wc.getZoomFactor(),pixel:[pixels[at+2],pixels[at+1],pixels[at]]};
 })()`);
 assert(fill.metrics.scale>1);assert(fill.actual.width<=800&&fill.actual.height<=600);assert(Math.abs(fill.actual.dpr-1)<1e-5);assert.equal(fill.zoom,1);
 assert(fill.pixel.every((v,i)=>Math.abs(v-[200,51,68][i])<=8),'packaged adaptive view paints its native bottom-right edge');await adaptivePage.waitForFunction(()=>window.cornerClicked===true);
 fs.writeFileSync(path.join(root,'adaptive-fill.json'),JSON.stringify(fill,null,2));await ui.screenshot({path:path.join(root,'adaptive-fill.png')});
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'instances.json'),'utf8')).instances.find(x=>x.id===a.id).environment,adaptive);
 pass('Packaged small-screen adaptive viewport fills its native view with unchanged DPR/configuration and a working native corner click');
 assert.deepEqual(await ui.evaluate(()=>state.quickLinks.map(x=>x.name)),['Arena']);
 assert.equal(await ui.locator('[data-browser-menu="favorites"]').count(),1);
 await ui.locator('[data-browser-menu="favorites"]').click();let favorites;
 await wait(()=>{favorites=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().endsWith('/src/renderer/overlay.html'));return !!favorites;},'packaged favorites menu');
 await favorites.locator('[data-browser-menu-action="quick"] b').waitFor();
 assert.deepEqual(await favorites.locator('[data-browser-menu-action="quick"] b').allTextContents(),['Arena']);
 assert.equal(await favorites.locator('[data-browser-menu-action="manage-quick"]').count(),1);
 // Electron's before-input-event needs native input; CDP dispatch does not close this view.
 await mainValue("(()=>{const e=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json')('electron'),w=e.webContents.getAllWebContents().find(w=>w.getURL().endsWith('/src/renderer/overlay.html'));w.sendInputEvent({type:'keyDown',keyCode:'Escape'});w.sendInputEvent({type:'keyUp',keyCode:'Escape'});return true;})()");
 await ui.waitForFunction(()=>browserMenu===null);
 pass('Packaged favorites menu displays migrated links and its management entry');
 assert.deepEqual(await ui.evaluate(()=>privacySites.map(x=>x.id)),['ipip','ipleak','browserleaks','dnsleaktest','ippure','netcoffee']);
 await ui.locator('[data-privacy-toggle]').click();let menu;
 await wait(()=>{menu=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().endsWith('/src/renderer/overlay.html'));return !!menu;},'packaged privacy menu');
 await menu.locator('[data-privacy-site]').first().waitFor();assert.equal(await menu.locator('[data-privacy-site="ipip"]').count(),1);assert.equal(await menu.locator('[data-privacy-site="netcoffee"]').count(),1);assert.equal(await menu.locator('[data-privacy-site]').count(),6);
 await menu.screenshot({path:path.join(root,'privacy-menu.png')});await menu.keyboard.press('Escape');
 pass('Packaged toolbar removes both legacy ipip shortcuts and opens a real native menu containing exactly one ipip and one Net.Coffee entry');
 const pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url()===url);assert.equal(pages.length,2);
 await ui.locator('[data-action="toggle-devtools"]').click();
 await wait(()=>browser.contexts().flatMap(c=>c.pages()).some(p=>p.url().startsWith('devtools://')),'packaged developer tools');
 await ui.screenshot({path:path.join(root,'embedded-devtools.png')});
 assert.equal((await call('toggle-devtools',{id:a.id})).open,false);
 pass('Packaged toolbar opens the real DevTools frontend and the control channel closes it');
 await pages[0].evaluate(()=>localStorage.setItem('facet-install-persistence','installed-check'));
 assert.equal(await pages[1].evaluate(()=>localStorage.getItem('facet-install-persistence')),null);pass('Installed browser sessions remain isolated');
 await ui.evaluate(()=>{gridPrefs.mode='live';route('grid');});await ui.waitForFunction(()=>view==='grid'&&!gridFrame&&!gridInFlight);
 assert.equal(await ui.locator('.grid-tile').count(),2);assert.equal(await ui.locator('.grid-thumb').count(),0);
 const before=await Promise.all(pages.map(p=>p.evaluate(()=>window.ticks)));await sleep(250);const after=await Promise.all(pages.map(p=>p.evaluate(()=>window.ticks)));assert(after.every((v,i)=>v>before[i]));
 await ui.locator('[data-grid-act="zoom"]').first().click();await ui.waitForFunction(()=>!!gridZoom&&!gridInFlight&&!gridFrame);await ui.locator('[data-grid-act="unzoom"]').click();await ui.waitForFunction(()=>!gridZoom&&!gridInFlight&&!gridFrame);
 pass('Packaged realtime grid retains animated real pages and zoom/restore works');
 await ui.locator('#sidebar .nav[data-view="settings"]').click();await ui.locator('#controlApiEnabled').check();await ui.waitForFunction(()=>state.control?.running);
 await api('/v1/status',{authenticated:false});assert.equal((await api('/v1/status')).running,true);
 await api('/v1/actions',{body:{action:'rename',id:a.id,name:'安装验证·已改名'}});
 assert((await api('/v1/instances')).some(x=>x.id===a.id&&x.name==='安装验证·已改名'));
 const targets=await api('/v1/targets');assert(targets.some(x=>x.instanceId===a.id&&x.targetId&&x.url===url));
 await api('/v1/instances/'+a.id+'/navigate',{body:{url:url+'?external-control'}});
 await ui.waitForFunction(id=>activeId===id&&view==='browser',a.id);await wait(async()=>(await api('/v1/targets')).some(x=>x.instanceId===a.id&&x.url===url+'?external-control'),'external navigation downstream');
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'instances.json'),'utf8')).instances.find(x=>x.id===a.id).url,url+'?external-control');await call('navigate',{id:a.id,url});
 pass('Packaged API rejects missing credentials; authenticated rename and navigation update the UI, target and saved data');
 const panel=await extensionPage(b.id,extension.id),ownTarget=(await api('/v1/targets')).find(x=>x.instanceId===b.id),peerTarget=(await api('/v1/targets')).find(x=>x.instanceId===a.id);
 const extra=await panel.evaluate(async({url,tabId})=>{
  const frames=await chrome.webNavigation.getAllFrames({tabId});
  const tab=await chrome.tabs.create({url:url+'?extension-page'});
  const bookmark=await chrome.bookmarks.create({title:'Packaged durable bookmark',url});
  return {frames,tab,bookmark,tabs:await chrome.tabs.query({})};
 },{url,tabId:ownTarget.webContentsId});
 assert(extra.frames.some(x=>x.frameId===0&&x.url===url));assert(extra.tabs.some(x=>x.id===extra.tab.id));assert(!extra.tabs.some(x=>x.id===peerTarget.webContentsId));
 await wait(()=>browser.contexts().flatMap(c=>c.pages()).some(p=>p.url()===url+'?extension-page'),'packaged extension page loaded');
 await panel.evaluate(id=>chrome.tabs.remove(id),extra.tab.id);
 pass('Actual packaged extension queries frames, opens an owned proxied page, rejects peer visibility and stores a bookmark');
 const diagnosticPage=await instancePage(a.id);await diagnosticPage.evaluate(async()=>{await Promise.all([fetch('/diagnostic-reset?token=package-fixture-secret').catch(()=>null),fetch('/diagnostic-status?token=package-fixture-secret')]);});
 await ui.evaluate(()=>route('global-logs'));assert.equal(await ui.locator('[data-work="export-diagnostics"]').textContent(),'导出详细诊断包');assert.equal(await ui.locator('[data-work="export-logs"]').textContent(),'导出操作记录');await ui.screenshot({path:path.join(root,'detailed-log-buttons.png')});
 const tracesFile=path.join(root,'network-trace.json');await wait(()=>{try{const rows=JSON.parse(fs.readFileSync(tracesFile,'utf8')).rows;return rows.some(x=>x.operation==='page-request'&&x.steps.some(s=>s.status===503))&&rows.some(x=>x.operation==='page-request'&&x.steps.some(s=>s.code));}catch{return false;}},'packaged request failures persisted');
 assert(!fs.readFileSync(tracesFile,'utf8').includes('package-fixture-secret'));
 pass('Packaged collectors persist actual failed fetch and HTTP 503 metadata without URL credentials; diagnostic buttons show their actual scope');
 const output=await call('runtime-output');assert.equal(output.warning,'');assert(output.rows.some(r=>r.text.includes('ready')));pass('Installed runtime output works without the development launcher');
 const corePids=(await call('snapshot')).instances.map(x=>x.pid).filter(Boolean);await close();assert(corePids.every(pid=>{try{process.kill(pid,0);return false;}catch{return true;}}));pass('Normal exit reclaims packaged proxy processes');
 await launch();const restoredOutput=await call('runtime-output');assert(restoredOutput.rows.some(x=>x.source==='core'&&x.runId!==restoredOutput.runId));assert(JSON.parse(fs.readFileSync(path.join(root,'network-trace.json'),'utf8')).rows.some(x=>x.operation==='page-request'&&x.result==='failed'));pass('Packaged output and request failures survive a completely new process');const secondIcon=await verifyTaskbar();assert.equal(secondIcon.large.hash,firstIcon.large.hash);assert.equal(secondIcon.small.hash,firstIcon.small.hash);const second=await call('snapshot');assert(second.instances.some(x=>x.name==='安装验证·已改名'));assert(second.instances.every(x=>x.status==='stopped'));assert.equal(second.nodeNetwork.settings.dnsMode,'system');assert.equal(second.nodeNetwork.settings.routeMode,'system');assert(!fs.existsSync(path.join(root,'node-network.json')));
 assert.equal((await call('control-status')).restartRequired,false);assert.equal((await api('/v1/status')).running,true);assert.deepEqual(second.quickLinks.map(x=>x.name),['Arena']);
 for(const id of [a.id,b.id])await call('start',{id});await wait(async()=>(await call('snapshot')).instances.every(x=>x.title==='Installed live fixture'&&x.status==='running'),'restarted pages',45000);
 const restartedPanel=await extensionPage(b.id,extension.id);
 assert((await restartedPanel.evaluate(()=>chrome.bookmarks.search('Packaged durable bookmark'))).some(x=>x.id===extra.bookmark.id));
 pass('Packaged extension durable data survives a completely new application process');
 const restarted=browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url()===url);assert((await Promise.all(restarted.map(p=>p.evaluate(()=>localStorage.getItem('facet-install-persistence'))))).includes('installed-check'));
 pass('Application restart retains renamed configuration, browser storage, migrated shortcuts and enabled API/CDP');
 await restartedPanel.evaluate(()=>chrome.storage.local.set({resetPackageProbe:'present'}));const beforeReset=(await call('snapshot')).instances.find(x=>x.id===b.id);
 const resetPage=await instancePage(b.id);
 await resetPage.evaluate(()=>{localStorage.setItem('reset-marker','present');document.cookie='reset-cookie=present; path=/';});
 assert.equal(await resetPage.evaluate(()=>localStorage.getItem('reset-marker')),'present');assert((await resetPage.evaluate(()=>document.cookie)).includes('reset-cookie'));
 await setIsolatedGeoEndpoint(url+'geo');const beforeGeoHits=geoHits;
 await ui.evaluate(id=>route('environment',id),b.id);await ui.locator('[data-action="reset-environment"]').click();await ui.locator('#modal [data-action="confirm"]').click();
 const oldId=b.id;await ui.waitForFunction(id=>!modal&&current().id!==id&&current().status==='stopped'&&!environmentChanged(),oldId);b.id=await ui.evaluate(()=>current().id);assert(!(await call('snapshot')).instances.some(x=>x.id===oldId));
 const savedReset=JSON.parse(fs.readFileSync(path.join(root,'instances.json'),'utf8')).instances.find(x=>x.id===b.id);
 assert.equal(savedReset.environment.width,0);assert.equal(savedReset.environment.height,0);assert.equal(savedReset.environment.fingerprint.template,'library-v1');
 assert.deepEqual(savedReset.network,beforeReset.network);assert.notEqual(savedReset.environment.fingerprint.seed,beforeReset.environment.fingerprint.seed);assert.equal(savedReset.environment.fingerprint.touch,0);
 assert(geoHits>beforeGeoHits,'reset must query exit through the real diagnostic path');assert.equal(savedReset.environment.language,'ja-JP');assert.equal(savedReset.environment.timezone,'Asia/Tokyo');
 assert.deepEqual(await ui.evaluate(()=>environmentFormValue().environment.fingerprint),savedReset.environment.fingerprint);
 await call('start',{id:b.id});await call('navigate',{id:b.id,url});await wait(async()=>(await call('snapshot')).instances.find(x=>x.id===b.id).title==='Installed live fixture','reset instance restarted');
 const resetPageAfter=await instancePage(b.id);assert.notEqual(resetPageAfter,resetPage);
 const resetValue=await resetPageAfter.evaluate(()=>({storage:localStorage.getItem('reset-marker'),cookie:document.cookie,touch:navigator.maxTouchPoints}));assert.equal(resetValue.storage,null);assert(!resetValue.cookie.includes('reset-cookie'));assert.equal(resetValue.touch,0);
 const diskCatalog=new ExtensionCatalog(root);assert.deepEqual(diskCatalog.enabled(b.id),[extension.id]);assert.equal(savedReset.resetPending??null,null);const freshPanel=await extensionPage(b.id,extension.id);assert.equal(await freshPanel.evaluate(async()=> (await chrome.storage.local.get('resetPackageProbe')).resetPackageProbe),undefined);pass('Packaged reset queries controlled exit through the real proxy, aligns locale, creates clean storage and preserves proxy and extension bindings while clearing extension data');
 await ui.locator('#aiToggle').click();await ui.waitForFunction(()=>!document.querySelector('#aiPanel').hidden);const originalSession=(await call('ai-state')).sessions.selectedId;await ui.locator('#aiClear').click();await wait(async()=>(await call('ai-state')).sessions.selectedId!==originalSession,'packaged new session');const sessionId=(await call('ai-state')).sessions.selectedId;await call('ai-session-rename',{sessionId,title:'Packaged session persistence'});await call('ai-session-select',{sessionId:originalSession});await call('ai-session-select',{sessionId});pass('Packaged AI panel creates, selects and renames independently persisted sessions');await verifyPackagedDsh(b.id);await close();await launch();const restoredAI=await call('ai-state');assert.equal(restoredAI.sessions.selectedId,sessionId);assert(restoredAI.sessions.items.some(x=>x.title==='Packaged session persistence'));assert(restoredAI.task.entries.some(e=>e.kind==='assistant'&&e.text.includes('PACKAGED_DSH_VERIFIED')));pass('Packaged AI sessions and completed DSH tool history restore after complete process restart');
 const control=await call('control-status');await call('control-save',{enabled:false});await assert.rejects(()=>fetch('http://127.0.0.1:'+control.apiPort+'/v1/status'));pass('Disabling external control closes the packaged API listener');await close();
}
main().catch(e=>{errors.push(e.stack||String(e));console.error(e.message);}).finally(async()=>{
 try{await close();}catch(e){errors.push(e.message);}
 if(child&&child.exitCode===null)child.kill();for(const socket of sockets)socket.destroy();proxy?.close();server?.close();
 const report={executable,isolatedData:root,passed:results.length,results,errors,proxyHits};const file=path.join(root,'verification.json');fs.writeFileSync(file,JSON.stringify(report,null,2));console.log('Verification: '+file);process.exit(errors.length?1:0);
});
