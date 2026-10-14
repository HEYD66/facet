'use strict';
const {app,BrowserWindow,dialog}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const root=process.argv.find(x=>x.startsWith('--test-profile='))?.slice(15)||fs.mkdtempSync(path.join(os.tmpdir(),'facet-diagnostic-electron-')),resume=process.argv.includes('--resume');
app.setPath('userData',path.join(root,'data'));app.commandLine.appendSwitch('disable-gpu');app.on('window-all-closed',()=>{});
const output=require('../src/main/runtime-output.cjs').installRuntimeOutput(app),{Controller}=require('../src/main/controller.cjs'),{installIPC}=require('../src/main/ipc.cjs');
let win,c,server,proxy;const results=[];const wait=async(fn,label)=>{const end=Date.now()+30000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Timeout '+label);};
const pass=name=>{results.push(name);console.log('PASS '+name);};setTimeout(()=>app.exit(2),100000).unref();
app.whenReady().then(async()=>{let exitCode=0;try{
 win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{preload:path.join(__dirname,'../src/main/preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
 c=new Controller(win,app.getPath('userData'),path.join(__dirname,'../resources/mihomo/mihomo.exe'));installIPC(win,c);
 await win.loadFile(path.join(__dirname,'../src/renderer/index.html'));
 const ui=code=>win.webContents.executeJavaScript(code);await wait(()=>ui('typeof bridge!=="undefined"&&!!state.instances.length'),'real control UI');
 if(!resume){
  server=http.createServer((req,res)=>{if(req.url.startsWith('/fail'))return req.socket.destroy();if(req.url.startsWith('/http-error'))res.statusCode=503;res.setHeader('content-type','text/html');res.end('<title>Detailed diagnostic fixture</title><h1>REAL_PAGE</h1>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let proxyHits=0;proxy=http.createServer(req=>{proxyHits++;req.socket.destroy();});proxy.on('connect',(_req,socket)=>{proxyHits++;socket.destroy();});await new Promise(r=>proxy.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
  const a=c.store.list()[0],b=c.store.create('Diagnostic proxy fixture');c.store.update(a.id,{url:url+'/ok'});c.store.update(b.id,{url:url+'/ok',network:{mode:'mihomo',nodeName:'fixture'}});c.store.saveNodes(b.id,[{name:'fixture',type:'http',server:'127.0.0.1',port:proxy.address().port,username:'fixture-user',password:'fixture-core-password'}],null);
  await c.start(a.id);await wait(()=>c.runtimes.get(a.id)?.view.webContents.getTitle()==='Detailed diagnostic fixture','real direct page');
  await c.runtimes.get(a.id).view.webContents.executeJavaScript("Promise.all([fetch('/fail?token=fixture-fetch-token').catch(()=>null),fetch('/http-error?token=fixture-http-token')]).then(()=>true)");await wait(()=>c.networkTrace.rows.some(x=>x.operation==='page-request'&&x.steps.some(s=>s.status===503))&&c.networkTrace.rows.some(x=>x.operation==='page-request'&&x.steps.some(s=>s.code)),'real subresource failures');
  await c.runtimes.get(a.id).view.webContents.loadURL(url+'/fail?token=fixture-page-token').catch(()=>{});await wait(()=>c.networkTrace.rows.some(x=>x.operation==='page-load'&&x.instanceId===a.id),'page error recorded');
  await c.start(b.id);await wait(()=>proxyHits>0&&output.rows.some(x=>x.source==='core'&&x.instanceId===b.id),'actual core output');
  const config=JSON.parse(fs.readFileSync(path.join(c.dir,'core-runtime',b.id,'runtime.json'),'utf8'));assert.equal(config.dns.enable,false);assert(!config.hosts);assert.equal(config.tun.enable,false);
  await ui('console.error("Facet diagnostic fixture error Cookie=fixture-control-cookie")');await wait(()=>output.rows.some(x=>x.source==='control'&&x.text.includes('Facet diagnostic fixture error')),'real UI console error');
  pass('Real main-frame navigation failure and actual Mihomo output are collected without changing DNS, proxy or TUN');
  c.diagnostics.run([{instanceId:b.id,name:'fixture'}],'latency',1);const diagnosticTask=c.diagnostics.job.id;await wait(()=>!c.diagnostics.work,'real failed node diagnostic');
  const diagnosticRows=c.networkTrace.rows.filter(x=>x.operation==='diagnostic'&&x.taskId===diagnosticTask);assert.equal(diagnosticRows.length,2);assert(diagnosticRows.every(x=>x.instanceId===b.id&&x.nodeName==='fixture'&&x.result==='failed'));assert(diagnosticRows.some(x=>x.fallback));assert(c.diagnostics.history.list().some(x=>x.latency?.last?.ok===false));assert.equal(c.runtimes.get(b.id).status,'running');
  pass('Actual node detection preserves source/instance/task correlation, fallback failure and durable diagnostic history');
 }else{
  assert(output.rows.some(x=>x.runId!==output.runId&&x.source==='core'));assert(c.networkTrace.rows.some(x=>x.operation==='page-load'&&x.result==='failed'));assert(c.snapshot().instances.every(x=>x.status==='stopped'));
  pass('A completely new Electron process reads previous core output and page failures without auto-starting instances');
 }
 await ui('route("global-logs")');await wait(()=>ui('view==="global-logs"&&!!document.querySelector("[data-work=export-diagnostics]")'),'log UI');
 assert.equal(await ui('document.querySelector("[data-work=export-diagnostics]").textContent'),'导出详细诊断包');assert.equal(await ui('document.querySelector("[data-work=export-logs]").textContent'),'导出操作记录');
 const exported=path.join(root,resume?'restart-export.json':'first-export.json'),originalSave=dialog.showSaveDialog;
 // Controlled destination adapter only; production renderer, IPC, collection and file writing run unchanged.
 dialog.showSaveDialog=async()=>({canceled:false,filePath:exported});try{await ui('document.querySelector("[data-work=export-diagnostics]").click()');await wait(()=>fs.existsSync(exported),'actual diagnostic file');}finally{dialog.showSaveDialog=originalSave;}
 const data=JSON.parse(fs.readFileSync(exported,'utf8'));assert.equal(data.version,2);assert(data.debug.rows.some(x=>x.source==='core'));assert(data.network.rows.some(x=>x.operation==='page-load'&&x.steps.some(s=>s.errorNumber)));
 assert(data.network.rows.some(x=>x.operation==='core'&&x.steps.some(s=>s.stage==='core-ready')));assert(data.summary.issues.length>0);assert(data.network.rows.some(x=>x.operation==='page-request'&&x.steps.some(s=>s.resourceType==='xhr'&&s.status===503)));assert.equal(data.debug.lineLengthLimit,700);assert(data.diagnostics.history.some(x=>x.latency?.last?.ok===false));
 for(const secret of ['fixture-fetch-token','fixture-http-token','fixture-page-token','fixture-core-password','fixture-control-cookie','fixture-user'])assert(!JSON.stringify(data).includes(secret),secret);
 pass('Real UI export produces a parseable detailed diagnostic file with correlated core/page evidence and no fixture credentials');
 await c.closeAll();assert(c.networkTrace.rows.filter(x=>x.operation==='core').every(x=>x.endedAt));pass('Normal shutdown flushes diagnostics and reclaims all test proxy processes');
 }catch(error){exitCode=1;console.error(error.stack);}
 try{if(c&&!c.disposing)await c.closeAll();}catch(error){exitCode=1;console.error(error.message);}
 for(const s of [server,proxy])if(s){s.closeAllConnections();await new Promise(r=>s.close(r));}if(win&&!win.isDestroyed())win.destroy();output.close();
 const report=path.join(root,resume?'resume-report.json':'report.json');fs.writeFileSync(report,JSON.stringify({passed:!exitCode,resume,results},null,2));console.log('REPORT '+report);app.exit(exitCode);
});
