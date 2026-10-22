'use strict';
// Real isolated Electron sessions and real CPU/memory workloads; no public network or user data.
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-resource-metrics-'));app.setPath('userData',root);app.on('window-all-closed',()=>{});
const {Controller}=require('../src/main/controller.cjs'),{installIPC}=require('../src/main/ipc.cjs'),{appMetrics}=require('../src/main/app-metrics.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),children=[],checks=[],readings=[];let win,c,group,server;
setTimeout(()=>app.exit(2),90000).unref();
app.whenReady().then(async()=>{let error;try{
 assert.equal(process.platform,'win32','Windows external-process accounting test');
 win=new BrowserWindow({show:false,width:1200,height:800,webPreferences:{preload:path.join(__dirname,'../src/main/preload.cjs'),sandbox:true,contextIsolation:true}});
 c=new Controller(win,root,path.join(__dirname,'../resources/mihomo/mihomo.exe'));
 server=http.createServer((q,res)=>{res.setHeader('Content-Type','text/html');res.end('<title>Resource test</title><h1>Real session</h1>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const ids=[];for(let i=0;i<2;i++){const row=c.store.create('Resource test '+i);c.store.update(row.id,{url:'http://127.0.0.1:'+server.address().port+'/'});await c.start(row.id);ids.push(row.id);}
 const workload='const held=Buffer.alloc(32*1024*1024,1);setInterval(()=>{const until=performance.now()+30;while(performance.now()<until){Math.sqrt(Math.random());}if(!held[0])process.exit(1)},10)';
 for(let i=0;i<2;i++){const p=spawn(process.execPath,['-e',workload],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,stdio:'ignore'});children.push(p);await new Promise((resolve,reject)=>{p.once('spawn',resolve);p.once('error',reject);});}
 await sleep(500);assert(children.every(p=>p.exitCode===null));
 // Register the same live external processes for both real sessions and the pool.
 const core={pid:children[0].pid,child:{pid:children[1].pid}};
 for(const id of ids)c.runtimes.get(id).core=core;
 group={core};c.proxyPool.groups.add(group);
 const first=await appMetrics(c);assert(!first.cpuComplete);assert(first.memoryComplete);assert.equal(first.cores,1);
 assert(first.coreMB>25&&first.hostMB>25);await sleep(5400);
 const loaded=await appMetrics(c);assert(loaded.cpuComplete,'second Windows sample is complete');assert(loaded.cpuBreakdown.core>100/os.cpus().length*.15,JSON.stringify(loaded.cpuBreakdown));assert(loaded.cpuBreakdown.host>100/os.cpus().length*.15);
 assert(Math.abs(Object.values(loaded.cpuBreakdown).reduce((a,b)=>a+b,0)-loaded.cpu)<.001);
 assert(Math.abs(Object.values(loaded.breakdown).reduce((a,b)=>a+b,0)-loaded.memoryMB)<.001);
 for(const id of ids){const m=loaded.instances[id];assert.equal(m.sharedCoreUsers,2);assert(m.cpuComplete&&m.memoryComplete);assert.equal(m.coreMB,loaded.coreMB/2);assert.equal(m.hostMB,loaded.hostMB/2);assert(m.cpu>=(loaded.cpuBreakdown.core+loaded.cpuBreakdown.host)/2-.001);}
 checks.push('Real busy external processes contribute CPU and private memory; shared core/protection are counted once and split equally across two sessions');readings.push({phase:'loaded',cpu:loaded.cpu,cpuBreakdown:loaded.cpuBreakdown,memoryMB:loaded.memoryMB,coreMB:loaded.coreMB,hostMB:loaded.hostMB,instances:loaded.instances});
 const rapid=await appMetrics(c);assert(rapid.cpuComplete);assert(rapid.cpuBreakdown.core>0&&rapid.cpuBreakdown.host>0);checks.push('Rapid repeat query preserves CPU baseline and complete external sample');
 // Render the actual management UI and its grid resource text using the same metrics.
 installIPC(win,c);await win.loadFile(path.join(__dirname,'../src/renderer/index.html'),{query:{frame:'custom'}});win.showInactive();await sleep(1500);
 await win.webContents.executeJavaScript('facetMetricsNow()');await sleep(1000);
 const ui=await win.webContents.executeJavaScript(`({text:document.querySelector('#resMeter').textContent,title:document.querySelector('#resMeter').title,grid:gridResText(${JSON.stringify(ids[0])}),gridTitle:gridResTitle(${JSON.stringify(ids[0])})})`);
 assert(ui.text.includes('内存提交'));assert(ui.title.includes('CPU 分项')&&ui.title.includes('全应用'));assert(ui.grid.includes('提交 '));assert(ui.gridTitle.includes('2 个运行实例分摊'));
 await win.webContents.executeJavaScript("route('grid')");await sleep(1500);await win.webContents.executeJavaScript('facetMetricsNow()');await sleep(1000);
 const grid=await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.grid-res')).map(el=>({text:el.textContent,title:el.title,width:el.getBoundingClientRect().width}))`);assert.equal(grid.length,2);assert(grid.every(el=>el.text.includes('提交')&&el.width>0));
 fs.writeFileSync(path.join(root,'resource-ui.png'),(await win.webContents.capturePage()).toPNG());checks.push('Actual renderer labels private commit and explains CPU breakdown and shared allocation');
 // Concurrent polls with different PID sets must receive their own immutable samples.
 const pair=await Promise.all([appMetrics({runtimes:new Map()}),appMetrics(c)]);assert.equal(pair[0].coreMB,0);assert(pair[1].coreMB>25&&pair[1].hostMB>25);checks.push('Concurrent PID-set changes preserve each request sample');
 for(const p of children){const exit=new Promise(r=>p.once('exit',r));p.kill();await exit;}
 await sleep(5400);const unavailable=await appMetrics(c);assert.equal(unavailable.memoryComplete,false);assert.equal(unavailable.cpuComplete,false);assert(ids.every(id=>unavailable.instances[id].cpuComplete===false&&unavailable.instances[id].memoryComplete===false));checks.push('Exited or inaccessible registered processes mark total and instances incomplete instead of reporting complete zeros');
 for(const id of ids)delete c.runtimes.get(id).core;c.proxyPool.groups.delete(group);
 const stopped=await appMetrics(c);assert.equal(stopped.cores,0);assert.equal(stopped.coreMB,0);assert.equal(stopped.hostMB,0);assert.equal(stopped.cpuBreakdown.core,0);assert.equal(stopped.cpuBreakdown.host,0);for(const m of Object.values(stopped.instances)){assert.equal(m.coreMB,0);assert.equal(m.hostMB,0);}
 checks.push('Stopped external processes disappear from total and instance CPU/memory without waiting for cache expiry');
}catch(e){error=e.stack;}finally{
 for(const r of c?.runtimes?.values()||[])if(children.some(p=>p.pid===r.core?.pid))delete r.core;
 if(group)c?.proxyPool?.groups.delete(group);
 for(const p of children)if(p.exitCode===null)p.kill();await c?.closeAll();win?.destroy();server?.close();
 const report={root,checks,readings,error};fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(error?1:0);
}});
