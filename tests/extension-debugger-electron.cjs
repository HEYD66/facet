'use strict';
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {Controller}=require('../src/main/controller.cjs');

const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-extension-debugger-'));
app.setPath('userData',root);
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-background-networking');
if(process.platform==='win32')app.commandLine.appendSwitch('disable-gpu');

const wait=async(fn,label,timeout=20000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Timeout '+label);};
const writeExtension=dir=>{
 fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({manifest_version:3,name:'CDP兼容验证扩展',version:'1.0.0',permissions:['debugger'],host_permissions:['http://127.0.0.1/*'],background:{service_worker:'background.js'},content_scripts:[{matches:['http://127.0.0.1/*'],js:['content.js'],run_at:'document_idle'}]}));
 fs.writeFileSync(path.join(dir,'background.js'),`let attached=false,events=0;\nchrome.debugger.onEvent.addListener((source,method)=>{if(method==='Network.responseReceived')events++;});\nchrome.debugger.onDetach.addListener(()=>{attached=false;});\nchrome.runtime.onMessage.addListener((message,sender,reply)=>{\n if(message==='start'){(async()=>{const rows=await chrome.tabs.query({active:true});const tab=rows[0];if(!tab||!Number.isInteger(tab.id))throw Error('no active tab');await chrome.debugger.attach({tabId:tab.id},'1.3');await chrome.debugger.sendCommand({tabId:tab.id},'Network.enable',{});attached=true;return {attached,events};})().then(reply,e=>reply({error:e.message}));return true;}\n if(message==='stop'){(async()=>{const rows=await chrome.tabs.query({active:true});const tab=rows[0];if(tab)await chrome.debugger.detach({tabId:tab.id});attached=false;return {attached,events};})().then(reply,e=>reply({error:e.message}));return true;}\n if(message==='status')reply({attached,events});\n});`);
 fs.writeFileSync(path.join(dir,'content.js'),`const ask=message=>new Promise(resolve=>chrome.runtime.sendMessage(message,resolve));\nwindow.addEventListener('message',event=>{if(event.source===window&&event.data?.source==='facet-debugger-test'&&event.data.command==='stop')void ask('stop');});\n(async()=>{const start=await ask('start');document.documentElement.dataset.debuggerStart=JSON.stringify(start);for(let i=0;i<80;i++){const value=await ask('status');document.documentElement.dataset.debuggerStatus=JSON.stringify(value);await new Promise(r=>setTimeout(r,50));}})();`);
};

let win,controller,server;
app.whenReady().then(async()=>{
 const results=[];try{
  server=http.createServer((req,res)=>{if(req.url==='/probe'){res.end('probe');return;}res.end('<!doctype html><script>setTimeout(()=>fetch("/probe"),100);</script><p>Facet debugger fixture</p>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port+'/';
  const ext=path.join(root,'extension');writeExtension(ext);
  win=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
  controller=new Controller(win,root,path.join(__dirname,'../resources/mihomo',process.platform==='win32'?'mihomo.exe':'mihomo'));
  const instance=controller.store.list()[0];controller.store.update(instance.id,{url});
  const entry=controller.extensions.catalog.stage(ext);controller.extensions.catalog.accept(entry);controller.extensions.catalog.setEnabled(instance.id,entry.id,true);
  await controller.start(instance.id);
  const runtime=controller.runtimes.get(instance.id);assert.equal(runtime.status,'running');
  await wait(()=>runtime.view.webContents.executeJavaScript('document.documentElement.dataset.debuggerStart||null'),'debugger start response');
  const start=JSON.parse(await runtime.view.webContents.executeJavaScript('document.documentElement.dataset.debuggerStart'));
  assert.deepEqual(start,{attached:true,events:0});results.push('扩展在千面实例内成功复用已有 CDP 并开启 Network');
  await runtime.view.webContents.executeJavaScript('void fetch("/probe?after=start")');
  await wait(()=>runtime.view.webContents.executeJavaScript('JSON.parse(document.documentElement.dataset.debuggerStatus||"{}").events>0'),'Network event forwarding');
  const active=JSON.parse(await runtime.view.webContents.executeJavaScript('document.documentElement.dataset.debuggerStatus'));
  assert.equal(active.attached,true);assert(active.events>0);results.push('Network.responseReceived 事件已转发给扩展 service worker');
  const before=active.events;await runtime.view.webContents.executeJavaScript('void fetch("/probe?after=stop")');await new Promise(r=>setTimeout(r,100));
  // The fixture extension has no stop control in the page; invoke its background through a one-shot script.
  await runtime.view.webContents.executeJavaScript('window.postMessage({source:"facet-debugger-test",command:"stop"},"*")');
  await wait(()=>runtime.view.webContents.executeJavaScript('JSON.parse(document.documentElement.dataset.debuggerStatus||"{}").attached===false'),'debugger stop response');
  const stopped=JSON.parse(await runtime.view.webContents.executeJavaScript('document.documentElement.dataset.debuggerStatus'));
  assert.equal(stopped.attached,false);assert(stopped.events>=before);results.push('停止检测后只停止插件转发，不关闭千面实例 CDP');
  await controller.stop(instance.id);assert.equal(runtime.view,null);results.push('实例停止时扩展调试桥接随实例清理');
  console.log(JSON.stringify({status:'passed',results},null,2));
 }catch(error){console.error(error.stack||String(error));process.exitCode=1;}
 finally{try{await controller?.closeAll();}catch{}if(!win?.isDestroyed())win?.destroy();server?.close();app.exit(process.exitCode||0);}
}).catch(error=>{console.error(error.stack||String(error));app.exit(1);});
