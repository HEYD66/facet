'use strict';
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-overview-start-audit-'));app.setPath('userData',root);
let c,win,server;const wait=async fn=>{for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Verification timed out');};
setTimeout(()=>app.exit(2),90000).unref();
app.whenReady().then(async()=>{try{
 server=http.createServer((q,r)=>r.end('<html><title>Overview start audit</title><body>Loaded</body></html>'));await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/`;
 win=new BrowserWindow({show:false,width:1400,height:900,webPreferences:{preload:path.join(__dirname,'../src/main/preload.cjs'),sandbox:true,contextIsolation:true}});
 c=new(require('../src/main/controller.cjs').Controller)(win,root,'');require('../src/main/ipc.cjs').installIPC(win,c);
 const a=c.store.list()[0],b=c.store.create('Second');for(const x of [a,b])c.store.update(x.id,{url});
 await win.loadFile(path.join(__dirname,'../src/renderer/index.html'));const ui=s=>win.webContents.executeJavaScript(s);await wait(()=>ui('!!state?.instances?.length'));await ui("route('overview')");
 const click=id=>ui(`document.querySelector('[data-ux="instance-open"][data-id="${id}"]').click()`);
 for(const x of [a,b]){await click(x.id);await wait(()=>c.runtimes.get(x.id)?.status==='running');await wait(()=>c.runtimes.get(x.id).view.webContents.getTitle()==='Overview start audit');assert.equal(await ui('view'),'overview');await wait(()=>ui(`document.querySelector('[data-ux="instance-open"][data-id="${x.id}"]').textContent.includes('打开网页')`));}
 await click(a.id);await wait(()=>ui('view') .then(x=>x==='browser'));assert.equal(await ui('activeId'),a.id);
 await ui("route('overview')");await c.stop(b.id);await wait(()=>ui(`state.instances.find(x=>x.id==='${b.id}').status==='stopped'`));const original=c.start;c.start=async()=>{throw Error('Injected startup failure');};await click(b.id);await wait(()=>ui("document.body.textContent.includes('Injected startup failure')"));c.start=original;assert.equal(await ui('view'),'overview');
 const report={passed:true,checks:['Two consecutive starts stay on overview and real pages load','Explicit open navigates to selected instance','Failed start stays on overview and reports error']};fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({root,...report}));
 }catch(e){console.error(e);process.exitCode=1;}finally{await c?.closeAll();win?.destroy();server?.close();app.exit(process.exitCode||0);}});
