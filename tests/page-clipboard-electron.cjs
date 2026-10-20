'use strict';
// Real instance session + trusted input. Clipboard payloads stay in memory and are restored.
const {app,BrowserWindow,clipboard,ClipboardItem}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-page-clipboard-'));app.setPath('userData',root);
let controller,win,server,savedClipboard,clipboardTouched=false;
const checks=[],pause=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,label){for(let i=0;i<150;i++){if(await fn())return;await pause(50);}throw Error('Timed out: '+label);}
const html=`<!doctype html><meta charset="utf-8"><title>Clipboard regression</title>
<button id="text">Copy text</button><button id="rich">Copy rich text</button><button id="legacy">Legacy copy</button><button id="read">Read text</button><button id="readRich">Read rich</button>
<textarea id="selection">Legacy copy fixture</textarea><script>
window.results={};
async function run(name,fn){try{await fn();results[name]='ok';}catch(e){results[name]=e.name;}}
document.getElementById('text').onclick=()=>run('text',()=>navigator.clipboard.writeText('Facet copy 中文 🧪'));
document.getElementById('rich').onclick=()=>run('rich',()=>navigator.clipboard.write([new ClipboardItem({'text/plain':new Blob(['Rich clipboard fixture'],{type:'text/plain'}),'text/html':new Blob(['<b>Rich clipboard fixture</b>'],{type:'text/html'})})]));
document.getElementById('legacy').onclick=()=>run('legacy',()=>{selection.select();if(!document.execCommand('copy'))throw Error('copy failed');});
document.getElementById('read').onclick=()=>run('read',()=>navigator.clipboard.readText());
document.getElementById('readRich').onclick=()=>run('readRich',()=>navigator.clipboard.read());
</script>`;
setTimeout(()=>app.exit(2),90000).unref();
app.whenReady().then(async()=>{try{
 // Materialize every advertised clipboard format before any test writes; never log it.
 savedClipboard=[];for(const item of await clipboard.read()){
  const data={};for(const type of item.types)data[type]=await item.getType(type);
  savedClipboard.push(new ClipboardItem(data));
 }
 server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(req.url==='/parent'?'<iframe src="/frame" allow="clipboard-write" style="width:100%;height:300px"></iframe>':html);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 win=new BrowserWindow({show:true,width:1200,height:800,webPreferences:{preload:path.join(__dirname,'../src/main/preload.cjs'),sandbox:true,contextIsolation:true}});
 controller=new(require('../src/main/controller.cjs').Controller)(win,root,'');require('../src/main/ipc.cjs').installIPC(win,controller);
 await win.loadFile(path.join(__dirname,'../src/renderer/index.html'));await wait(()=>win.webContents.executeJavaScript('typeof state!=="undefined"&&!!state.instances.length'),'control UI loaded');
 const a=controller.store.list()[0],b=controller.store.create('Clipboard second');
 for(const x of [a,b])controller.store.update(x.id,{url});
 async function select(id){await win.webContents.executeJavaScript(`localOpen.add(${JSON.stringify(id)});route('browser',${JSON.stringify(id)})`);win.show();win.focus();const wc=controller.runtimes.get(id).view.webContents;wc.focus();await wait(()=>wc.executeJavaScript('document.hasFocus()'),'page focus');await wait(()=>wc.executeJavaScript('innerWidth>300&&innerHeight>150'),'page layout');await pause(200);return wc;}
 async function click(wc,name){
  const p=await wc.executeJavaScript(`(()=>{const r=document.querySelector('#${name}').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  wc.sendInputEvent({type:'mouseMove',...p});await pause(40);wc.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});await pause(40);wc.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});
  try{await wait(()=>wc.executeJavaScript(`!!results.${name}`),'clipboard '+name);}catch(e){console.error(await wc.executeJavaScript(`JSON.stringify({name:${JSON.stringify(name)},focus:document.hasFocus(),width:innerWidth,results,handler:typeof document.querySelector('#${name}').onclick,buttons:[...document.querySelectorAll('button')].map(x=>({id:x.id,rect:x.getBoundingClientRect().toJSON()}))})`));throw e;}return wc.executeJavaScript(`results.${name}`);
 }
 await controller.start(a.id);let wc=await select(a.id);await wait(()=>!wc.isLoading(),'page load');
 clipboardTouched=true;await clipboard.writeText('Facet initial fixture');
 assert.equal(await click(wc,'text'),'ok','writeText from real copy button');assert.equal(await clipboard.readText(),'Facet copy 中文 🧪');checks.push('Trusted copy button writes Unicode to OS clipboard');
 assert.equal(await click(wc,'rich'),'ok');const item=(await clipboard.read())[0];assert(item.types.includes('text/html'));assert.match(await (await item.getType('text/html')).text(),/Rich clipboard fixture/);checks.push('Rich text ClipboardItem writes HTML');
 assert.equal(await click(wc,'legacy'),'ok');assert.equal(await clipboard.readText(),'Legacy copy fixture');checks.push('Legacy execCommand copy remains functional');
 assert.equal(await click(wc,'read'),'NotAllowedError');assert.equal(await click(wc,'readRich'),'NotAllowedError');checks.push('Clipboard text and rich reads remain denied');
 await wc.loadURL(url+'/parent');wc.focus();const frame=()=>wc.mainFrame.frames[0];await wait(()=>frame()?.url.endsWith('/frame'),'frame loaded');
 // Trusted activation propagated from the real frame button, rather than invoking clipboard in a test shim.
 const p=await wc.executeJavaScript("(()=>{const f=document.querySelector('iframe'),r=f.getBoundingClientRect(),b=f.contentDocument.querySelector('#text').getBoundingClientRect();return {x:Math.round(r.x+f.clientLeft+b.x+b.width/2),y:Math.round(r.y+f.clientTop+b.y+b.height/2)}})()");
 await clipboard.writeText('Frame initial fixture');for(const type of ['mouseMove','mouseDown','mouseUp'])wc.sendInputEvent({type,...p,button:'left',clickCount:1});await wait(()=>frame().executeJavaScript('!!results.text'),'frame copy');assert.equal(await frame().executeJavaScript('results.text'),'ok');assert.equal(await clipboard.readText(),'Facet copy 中文 🧪');checks.push('Delegated same-origin iframe copy writes OS clipboard');
 await controller.start(b.id);wc=await select(b.id);await wait(()=>!wc.isLoading(),'second instance load');assert.equal(await click(wc,'text'),'ok');assert.equal(await click(wc,'read'),'NotAllowedError');checks.push('Second instance uses the same write-only permission policy');
 await controller.stop(a.id);controller.store.update(a.id,{url});await controller.start(a.id);wc=await select(a.id);await wait(()=>!wc.isLoading(),'restarted page');assert.equal(await click(wc,'text'),'ok');assert.equal(await clipboard.readText(),'Facet copy 中文 🧪');checks.push('Restart reapplies clipboard policy');
}catch(e){console.error(e);process.exitCode=1;}finally{
 await controller?.closeAll();win?.destroy();server?.closeAllConnections();server?.close();
 if(clipboardTouched){try{if(savedClipboard.length)await clipboard.write(savedClipboard);else clipboard.clear();checks.push('Original OS clipboard restored');}catch(e){console.error('Clipboard restore failed: '+e.message);process.exitCode=1;}}
 const report={passed:!process.exitCode,electron:process.versions.electron,checks};fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({root,...report}));app.exit(process.exitCode||0);
}});
