'use strict';
// Interactive acceptance only: real native dialogs/notification and real extension IPC.
// A human or the approved Windows UI tool chooses a NEW temporary file or cancels.
const {app,BrowserWindow,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {Controller}=require('../src/main/controller.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-extension-native-'));
const dialogsOnly=process.argv.includes('--dialogs-only');
app.setPath('userData',path.join(root,'data'));app.setPath('downloads',path.join(root,'downloads'));app.setAppUserModelId('Facet.MultiInstanceBrowser');
app.commandLine.appendSwitch('disable-gpu');app.commandLine.appendSwitch('disable-background-networking');
const body=Buffer.from('Facet native SaveAs: real file bytes\n'),results=[],errors=[];
let c,win,panel,server,phase='starting',downloadHits=0,done=false,showNotification;
const wait=async(fn,label,ms=20000)=>{const end=Date.now()+ms;while(Date.now()<end&&!done){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,60));}throw Error(done?'Native acceptance already ended':'Timeout '+label);};
const pass=name=>{results.push(name);console.log('PASS '+name);};
const setPhase=value=>{phase=value;console.log('PHASE '+value);if(!win?.isDestroyed())void win.webContents.executeJavaScript('document.querySelector("#phase").textContent='+JSON.stringify(value));};
setTimeout(()=>{errors.push('Native interaction timeout: '+phase);void finish();},600000).unref();
async function finish(){if(done)return;done=true;try{await c?.closeAll();}catch(e){errors.push(e.message);}win?.destroy();server?.close();const report={passed:errors.length===0&&phase==='complete',scope:dialogsOnly?'save-dialog-and-permission-lifecycle':'dialogs-and-notification-click',results,errors,root,downloadHits};fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log('REPORT '+path.join(root,'report.json'));app.exit(errors.length?1:0);}
app.whenReady().then(async()=>{try{
 server=http.createServer((req,res)=>{
  if(req.url==='/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({phase,root,downloadHits,results,errors}));return;}
  if(req.url==='/show-notification'&&req.method==='POST'){void showNotification?.();res.end('requested');return;}
  if(req.url==='/finish'&&req.method==='POST'){res.end('closing');setImmediate(()=>{if(phase!=='complete')errors.push('Interaction not complete: '+phase);void finish();});return;}
  if(req.url==='/file'){downloadHits++;res.setHeader('Content-Disposition','attachment; filename="native-file.txt"');res.end(body);return;}
  res.end('<!doctype html><title>Native API fixture page</title>Controlled local page');
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 console.log('CONTROL '+base);console.log('PROFILE '+root);
 win=new BrowserWindow({show:true,width:850,height:480,title:'Facet 扩展原生交互验收',webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
 await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><title>Facet 扩展原生交互验收</title><h1>Facet 扩展原生交互验收</h1><p>本窗口使用独立临时数据。保存新测试文件、取消第二次下载、点击测试通知。</p><p id="phase">starting</p>'));
 c=new Controller(win,path.join(root,'data'),path.join(root,'no-core'));
 const source=path.join(root,'package');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify({manifest_version:3,name:'Native interaction fixture',version:'1.0',permissions:['downloads','notifications'],optional_permissions:['bookmarks'],host_permissions:['http://127.0.0.1/*'],action:{default_popup:'popup.html'}}));
 fs.writeFileSync(path.join(source,'popup.html'),'<title>Native interaction API context</title><script src="popup.js"></script>');fs.writeFileSync(path.join(source,'popup.js'),'globalThis.nativeClicks=[];chrome.notifications.onClicked.addListener(id=>nativeClicks.push(id));');fs.writeFileSync(path.join(source,'icon.png'),nativeImage.createFromBitmap(Buffer.alloc(32*32*4,255),{width:32,height:32}).toPNG());
 const extension=c.extensions.catalog.stage(source);c.extensions.catalog.accept(extension);const instance=c.store.list()[0];c.store.update(instance.id,{url:base+'/page'});c.extensions.catalog.setEnabled(instance.id,extension.id,true);
 const open=async()=>{await c.start(instance.id);const runtime=c.runtimes.get(instance.id),loaded=runtime.loadedExtensions.get(extension.id);panel=new BrowserWindow({show:false,webPreferences:{session:runtime.session,sandbox:true,nodeIntegration:false,contextIsolation:true}});runtime.extensionWindows??=new Set();runtime.extensionWindows.add(panel);await panel.loadURL('chrome-extension://'+loaded.id+'/popup.html');return {runtime,loaded};};
 let {runtime,loaded}=await open();const run=code=>panel.webContents.executeJavaScript(code),download=filename=>run('chrome.downloads.download('+JSON.stringify({url:base+'/file',filename,saveAs:true})+')');
 setPhase('save-new-file');const saving=download('native-save.txt');saving.catch(()=>{});
 await wait(()=>runtime.extensionHost.compat.downloads.saveDialog,'real save dialog');assert.equal(downloadHits,0);
 await assert.rejects(()=>download('unexpected-dialog.txt'),/等待选择保存位置/);assert.equal(downloadHits,0);
 const id=await saving;await wait(async()=>(await run('chrome.downloads.search({id:'+id+'})'))[0]?.state==='complete','saved native file');
 const saved=(await run('chrome.downloads.search({id:'+id+'})'))[0];assert(saved.filename.startsWith(root+path.sep));assert.deepEqual(fs.readFileSync(saved.filename),body);assert.equal(downloadHits,1);pass('Native SaveAs writes the selected new file with exact bytes; a concurrent chooser is rejected before networking');
 setPhase('cancel-second-file');await assert.rejects(()=>download('native-cancel.txt'),/用户取消下载/);assert.equal(downloadHits,1);assert.equal((await run('chrome.downloads.search({})')).length,1);pass('Canceling the native SaveAs starts no HTTP transfer and creates no download record');
 setPhase('abort-permission-on-stop');const compat=runtime.extensionHost.compat,ctx=compat.endpoints.get(loaded.id),request=compat.permissions(ctx,'request',[{permissions:['bookmarks']}]);request.catch(()=>{});await wait(()=>compat.permissionDialog,'real native permission prompt');await new Promise(resolve=>setTimeout(resolve,250));await c.stop(instance.id);assert.equal(await request,false);assert.equal(compat.granted(ctx).permissions.includes('bookmarks'),false);pass('Stopping the isolated instance aborts its real permission dialog and preserves denial without choosing Allow');
 ({runtime,loaded}=await open());assert.deepEqual(fs.readFileSync(saved.filename),body);
 if(dialogsOnly){setPhase('complete');await finish();return;}
 let showing=false;showNotification=async()=>{if(showing)return;showing=true;try{await run('chrome.notifications.create("native-click",{type:"basic",title:"Facet 原生通知验收",message:"请点击这条测试通知，验证扩展 onClicked 回调。",iconUrl:chrome.runtime.getURL("icon.png")})');}catch(e){errors.push(e.message);}finally{showing=false;}};
 setPhase('click-test-notification');await showNotification();if(errors.length)throw Error(errors.at(-1));await wait(async()=>run('nativeClicks.includes("native-click")'),'actual native notification click',240000);
 pass('A real native notification click reaches the extension onClicked listener');await run('chrome.notifications.clear("native-click")');setPhase('complete');await finish();
 }catch(e){if(done)return;errors.push(e.stack||e.message);console.error(e.stack);await finish();}});
