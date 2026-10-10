'use strict';
// Exercise the actual installed executable and packaged UI/IPC with isolated data.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),net=require('node:net'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const {Store}=require('../src/main/store.cjs');
const {childEnvironment}=require('./electron-runtime.cjs');
const buildManifest=path.resolve(__dirname,'../release/build-manifest.json');
const executable=path.resolve(process.argv[2]||(fs.existsSync(buildManifest)?JSON.parse(fs.readFileSync(buildManifest,'utf8')).unpackedExecutable:'release/win-unpacked/Facet.exe'));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-installed-中文-'));
const results=[],errors=[];let server,proxy,child,browser,ui,proxyHits=0;
const sockets=new Set(),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pass=name=>{results.push(name);console.log('PASS '+name);};
async function wait(fn,label,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await sleep(50);}throw Error('Timeout: '+label);}
async function launch(){
 const portFile=path.join(root,'DevToolsActivePort');fs.rmSync(portFile,{force:true});
 child=spawn(executable,['--user-data-dir='+root,'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1'],{env:childEnvironment(),windowsHide:false,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',d=>fs.appendFileSync(path.join(root,'stdout.log'),d));child.stderr.on('data',d=>fs.appendFileSync(path.join(root,'stderr.log'),d));
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
async function api(endpoint,{body,authenticated=true}={}){
 const control=await call('control-status');
 const response=await fetch(`http://127.0.0.1:${control.apiPort}${endpoint}`,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(authenticated?{authorization:'Bearer '+control.token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 if(!authenticated){assert.equal(response.status,401);return;}
 const result=await response.json();assert.equal(result.ok,true,result.error);return result.value;
}
async function close(){
 if(!child||child.exitCode!==null)return;
 if(ui){const snapshot=await call('snapshot');for(const x of snapshot.instances)if(x.status==='running'||x.status==='starting')await call('stop',{id:x.id});}
 // Send WM_CLOSE to this test window. Electron's normal exit guard and cleanup still run.
 const closer=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$p=Get-Process -Id ${child.pid} -ErrorAction Stop; if(-not $p.CloseMainWindow()){exit 1}`],{windowsHide:true,stdio:'ignore'});
 await new Promise((resolve,reject)=>{closer.once('error',reject);closer.once('exit',code=>code===0?resolve():reject(Error('Test window close failed: '+code)));});
 await wait(()=>child.exitCode!==null,'installed application normal exit',15000);browser=null;ui=null;
}
async function main(){
 assert(fs.existsSync(executable),'installed executable missing');
 const resources=path.join(path.dirname(executable),'resources');
 for(const file of ['app.asar','mihomo/mihomo.exe','mihomo/LICENSE','mihomo/mihomo-source.tar.gz','process-host/facet-process-host.exe','process-host/manifest.json','facet.ico','AGENTS.md','docs/AI-CONTROL-HANDOFF.md','docs/CONTROL-API.md'])assert(fs.existsSync(path.join(resources,file)),file+' missing');
 pass('Installed resources include packaged code, core, process host, icon, licenses and source archive');
 server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>Installed live fixture</title><h1>REAL_INSTALLED_PAGE</h1><script>window.ticks=0;function tick(){window.ticks++;requestAnimationFrame(tick)}tick();</script>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/';
 proxy=http.createServer((req,res)=>{proxyHits++;const destination=new URL(req.url);const request=http.request(destination,{method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});request.on('error',()=>res.end());req.pipe(request);});
 proxy.on('connect',(req,downstream,head)=>{proxyHits++;const target=new URL('http://'+req.url);const upstream=net.connect(Number(target.port)||443,target.hostname,()=>{downstream.write('HTTP/1.1 200 Connection established\r\n\r\n');if(head.length)upstream.write(head);upstream.pipe(downstream);downstream.pipe(upstream);});for(const socket of [upstream,downstream]){sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));}});
 await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
 const store=new Store(root),a=store.create('安装验证·直连'),b=store.create('安装验证·代理');store.update(a.id,{url});store.update(b.id,{url,network:{mode:'mihomo',nodeName:'本机验证代理'}});store.saveNodes(b.id,[{name:'本机验证代理',type:'http',server:'127.0.0.1',port:proxy.address().port}],null);
 fs.writeFileSync(path.join(root,'workspace-tools.json'),JSON.stringify({nodes:[],ips:[],quickLinksRevision:1,quickLinks:[{id:'quick-ipip',name:'ipip.la',url:'https://ipip.la/disguise.html'},{id:'quick-arena',name:'Arena',url:'https://arena.ai/agent'},{id:'duplicate',name:'ipip.la',url:'https://ipip.la/'}]}));
 await launch();assert((await call('snapshot')).instances.every(x=>x.status==='stopped'));pass('Installed app loads real production preload/IPC and does not auto-start instances');
 assert.equal((await call('snapshot')).versions.app,require('../package.json').version);
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
 for(const text of ['支持开源项目','github.com/HEYD66/facet','已接入','键盘快捷键','免责声明'])assert(info.includes(text),text+' missing');
 assert.equal(await ui.locator('#content .section-intro').count(),0);
 assert(await ui.locator('[data-action="open-github"]').first().isEnabled());
 await ui.screenshot({path:path.join(root,'application-info.png')});
 pass('Application info removes the requested introduction and boundary card, retaining GitHub, shortcuts and disclaimer');
 for(const id of [a.id,b.id])await call('start',{id});
 await wait(async()=>{const snapshot=await call('snapshot');return snapshot.instances.every(x=>x.status==='running'&&x.title==='Installed live fixture'&&!x.error);},'both installed pages loaded',45000);
 assert(proxyHits>0);const proxyConfig=JSON.parse(fs.readFileSync(path.join(root,'core-runtime',b.id,'runtime.json'),'utf8'));assert.equal(proxyConfig.dns.enable,false);assert(!proxyConfig.hosts);assert(!proxyConfig['interface-name']);pass('Two independent real webpages load; packaged Mihomo and process host use original DNS and routing without hosts overrides');
 await ui.evaluate(id=>route('browser',id),a.id);await ui.waitForFunction(()=>view==='browser');
 assert.deepEqual(await ui.locator('[data-quick="open"]').allTextContents(),['Arena']);
 assert.deepEqual(await ui.evaluate(()=>privacySites.map(x=>x.id)),['ipip','ipleak','browserleaks','dnsleaktest','ippure']);
 await ui.locator('[data-privacy-toggle]').click();let menu;
 await wait(()=>{menu=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().endsWith('/src/renderer/overlay.html'));return !!menu;},'packaged privacy menu');
 await menu.locator('[data-privacy-site]').first().waitFor();assert.equal(await menu.locator('[data-privacy-site="ipip"]').count(),1);assert.equal(await menu.locator('[data-privacy-site]').count(),5);
 await menu.screenshot({path:path.join(root,'privacy-menu.png')});await menu.keyboard.press('Escape');
 pass('Packaged toolbar removes both legacy ipip shortcuts and opens a real native menu containing exactly one ipip entry');
 const pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url()===url);assert.equal(pages.length,2);
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
 const output=await call('runtime-output');assert.equal(output.warning,'');assert(output.rows.some(r=>r.text.includes('ready')));pass('Installed runtime output works without the development launcher');
 const corePids=(await call('snapshot')).instances.map(x=>x.pid).filter(Boolean);await close();assert(corePids.every(pid=>{try{process.kill(pid,0);return false;}catch{return true;}}));pass('Normal exit reclaims packaged proxy processes');
 await launch();const second=await call('snapshot');assert(second.instances.some(x=>x.name==='安装验证·已改名'));assert(second.instances.every(x=>x.status==='stopped'));assert.equal(second.nodeNetwork.settings.dnsMode,'system');assert.equal(second.nodeNetwork.settings.routeMode,'system');assert(!fs.existsSync(path.join(root,'node-network.json')));
 assert.equal((await call('control-status')).restartRequired,false);assert.equal((await api('/v1/status')).running,true);assert.deepEqual(second.quickLinks.map(x=>x.name),['Arena']);
 for(const id of [a.id,b.id])await call('start',{id});await wait(async()=>(await call('snapshot')).instances.every(x=>x.title==='Installed live fixture'&&x.status==='running'),'restarted pages',45000);
 const restarted=browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url()===url);assert((await Promise.all(restarted.map(p=>p.evaluate(()=>localStorage.getItem('facet-install-persistence'))))).includes('installed-check'));
 pass('Application restart retains renamed configuration, browser storage, migrated shortcuts and enabled API/CDP');
 const control=await call('control-status');await call('control-save',{enabled:false});await assert.rejects(()=>fetch('http://127.0.0.1:'+control.apiPort+'/v1/status'));pass('Disabling external control closes the packaged API listener');await close();
}
main().catch(e=>{errors.push(e.stack||String(e));console.error(e.message);}).finally(async()=>{
 try{await close();}catch(e){errors.push(e.message);}
 if(child&&child.exitCode===null)child.kill();for(const socket of sockets)socket.destroy();proxy?.close();server?.close();
 const report={executable,isolatedData:root,passed:results.length,results,errors,proxyHits};const file=path.join(root,'verification.json');fs.writeFileSync(file,JSON.stringify(report,null,2));console.log('Verification: '+file);process.exit(errors.length?1:0);
});
