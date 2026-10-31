'use strict';
// 网页内查找（Ctrl+F）与右键菜单：真实 Electron 实例页面 + 真实键盘输入，本机夹具页，不访问外网、不用正式数据。
const {app,BrowserWindow,Menu,clipboard}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-page-tools-'));app.setPath('userData',root);app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
let c,win,server,savedText=null;const checks=[],pause=ms=>new Promise(r=>setTimeout(r,ms));
const ok=name=>{checks.push(name);console.log('PASS '+name);};
async function wait(fn,label,n=200){for(let i=0;i<n;i++){try{const v=await fn();if(v)return v;}catch{}await pause(50);}throw Error('Timed out: '+label);}
const page=`<!doctype html><meta charset="utf-8"><title>Page tools fixture</title><body style="font:16px system-ui;padding:24px">
<p id="a">苹果 apple 第一段</p><p>香蕉 banana</p><p id="b">苹果 apple 第二段</p><p>APPLE 大写</p>
<a id="link" href="/next" style="display:inline-block;padding:8px">下一页链接</a>
<input id="field" value="可编辑文字" style="width:240px;padding:6px"><script>
window.observed={selectionReads:0};const orig=Selection.prototype.toString;Selection.prototype.toString=function(){observed.selectionReads++;return orig.call(this);};
</script></body>`;
setTimeout(()=>{console.error('watchdog');app.exit(2);},120000).unref();
app.whenReady().then(async()=>{try{
 server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(req.url==='/next'?'<!doctype html><title>Next</title><p>第二个页面 apple</p>':page);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/';
 require('../src/main/browser-tabs-state.cjs').NEW_TAB_URL=url;
 try{savedText=await clipboard.readText();}catch{}
 win=new BrowserWindow({show:true,width:1280,height:860,webPreferences:{preload:path.join(__dirname,'../src/main/preload.cjs'),sandbox:true,contextIsolation:true}});
 c=new(require('../src/main/controller.cjs').Controller)(win,root,'');require('../src/main/ipc.cjs').installIPC(win,c);
 await win.loadFile(path.join(__dirname,'../src/renderer/index.html'));const ui=code=>win.webContents.executeJavaScript(code);
 await wait(()=>ui('typeof route==="function"&&!!state.instances.length'),'control UI');
 const a=c.store.list()[0];c.store.update(a.id,{url});await c.start(a.id);
 const r=()=>c.runtimes.get(a.id),wc=()=>r().view.webContents;
 await wait(()=>wc().getURL()===url&&!wc().isLoading(),'instance page');
 await ui(`localOpen.add(${JSON.stringify(a.id)});route('browser',${JSON.stringify(a.id)})`);await wait(()=>ui('!!document.querySelector("#browserHost")'),'browser page');
 win.show();win.focus();wc().focus();await wait(()=>wc().executeJavaScript('document.hasFocus()'),'page focus');
 const hostTop=()=>ui('Math.round(document.querySelector("#browserHost").getBoundingClientRect().top)');const topBefore=await hostTop();

 // 1. 网页拿着键盘焦点时按 Ctrl+F：主进程拦截，打开查找栏并把焦点交给输入框。
 wc().sendInputEvent({type:'keyDown',keyCode:'F',modifiers:['control']});wc().sendInputEvent({type:'keyUp',keyCode:'F',modifiers:['control']});
 await wait(()=>ui('document.activeElement?.id==="pageFindInput"'),'Ctrl+F from page focuses find input');
 assert.equal(await wc().executeJavaScript('observed.selectionReads'),0,'opening find must not run script in the page');
 ok('网页获得焦点时 Ctrl+F 打开查找栏，键盘焦点进入输入框，没有在网页里执行脚本');

 // 2. 真实键盘输入：计数随输入更新，大小写不敏感，Enter / Shift+Enter 前后跳转并循环。
 win.webContents.focus();for(const ch of 'apple')win.webContents.sendInputEvent({type:'char',keyCode:ch});
 await wait(()=>ui('document.querySelector("#pageFindCount").textContent==="1/3"'),'count 1/3');
 const press=(key,mods=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode:key,modifiers:mods});win.webContents.sendInputEvent({type:'keyUp',keyCode:key,modifiers:mods});};
 press('Enter');await wait(()=>ui('document.querySelector("#pageFindCount").textContent==="2/3"'),'Enter -> 2/3');
 press('Enter');await wait(()=>ui('document.querySelector("#pageFindCount").textContent==="3/3"'),'Enter -> 3/3');
 press('Enter');await wait(()=>ui('document.querySelector("#pageFindCount").textContent==="1/3"'),'wraps to 1/3');
 press('Enter',['shift']);await wait(()=>ui('document.querySelector("#pageFindCount").textContent==="3/3"'),'Shift+Enter -> 3/3');
 await ui('document.querySelector("[data-page-find=prev]").click()');await wait(()=>ui('document.querySelector("#pageFindCount").textContent==="2/3"'),'prev button -> 2/3');
 assert.equal(await ui('document.activeElement?.id'),'pageFindInput','buttons keep focus in the input');
 ok('输入关键词后显示 1/3（不区分大小写）；Enter、Shift+Enter 和上一个按钮正确跳转并循环');

 // 3. 查找栏占用一行，原生网页视图同步下移，不被查找栏盖住。
 const topOpen=await hostTop(),bounds=r().view.getBounds();
 assert(topOpen>topBefore,'find bar pushes the page area down');assert(Math.abs(bounds.y-topOpen)<=1,`native view y ${bounds.y} follows host ${topOpen}`);
 ok('查找栏出现后网页区域下移 '+(topOpen-topBefore)+'px，原生网页视图跟随，不被遮挡');

 // 4. 没有结果时提示「无结果」；清空后不再高亮。
 await ui('{const i=document.querySelector("#pageFindInput");i.value="不存在的词";i.dispatchEvent(new Event("input",{bubbles:true}))}');
 await wait(()=>ui('document.querySelector("#pageFindCount").textContent==="无结果"&&document.querySelector("#pageFind").classList.contains("empty")'),'no results');
 await ui('{const i=document.querySelector("#pageFindInput");i.value="";i.dispatchEvent(new Event("input",{bubbles:true}))}');await wait(()=>ui('document.querySelector("#pageFindCount").textContent===""'),'cleared');
 ok('找不到时显示「无结果」并标红；清空输入后计数消失');

 // 5. Esc 关闭：查找栏消失、网页区域复原、键盘焦点回到网页；再次打开沿用上次关键词。
 await ui('{const i=document.querySelector("#pageFindInput");i.value="香蕉";i.dispatchEvent(new Event("input",{bubbles:true}))}');await wait(()=>ui('document.querySelector("#pageFindCount").textContent==="1/1"'),'香蕉 1/1');
 press('Escape');await wait(async()=>!(await ui('!!document.querySelector("#pageFind")'))&&!r().find,'closed');
 await wait(async()=>await hostTop()===topBefore&&r().view.getBounds().y===topBefore,'layout restored');
 await wait(()=>wc().executeJavaScript('document.hasFocus()'),'focus back to page');
 await ui('pageFindOpen()');await wait(()=>ui('document.querySelector("#pageFindInput")?.value==="香蕉"&&document.querySelector("#pageFindCount").textContent==="1/1"'),'reopen keeps last query');
 ok('Esc 关闭查找栏，网页区域复原且焦点回到网页；再次打开沿用上次关键词并重新计数');

 // 6. 切换网页标签后不保留旧标签的查找；导航后计数清零。
 await c.newTab(a.id,{url,active:true});await wait(()=>r().tabs.size===2&&!wc().isLoading(),'second tab');
 await wait(async()=>!(await ui('!!document.querySelector("#pageFind")'))&&!r().find,'find closed on tab switch');
 await ui('pageFindOpen()');await wait(()=>ui('document.querySelector("#pageFindCount").textContent==="1/1"'),'new tab search');
 wc().loadURL(url+'next');await wait(()=>wc().getURL().endsWith('/next')&&!wc().isLoading(),'navigated');
 await wait(()=>ui('document.querySelector("#pageFindCount")?.textContent===""'),'count reset after navigation');
 await ui('document.querySelector("[data-page-find=close]").click()');await wait(()=>!r().find,'close button');
 await c.closeTab(a.id,r().activeTabId);await wait(()=>r().tabs.size===1,'back to one tab');
 ok('切换网页标签时关闭旧查找；页面导航后匹配数清零；关闭按钮可用');

 // 7. 右键菜单：普通区域、链接、可编辑框、选中文字各给出对应项；扩展菜单项接在后面。
 const pt=require('../src/main/page-tools.cjs'),tab=r().tabs.get(r().activeTabId),labels=params=>pt.template(c,a.id,r(),tab,wc(),{x:10,y:10,editFlags:{},mediaType:'none',...params}).filter(i=>i.type!=='separator').map(i=>i.label);
 assert.deepEqual(labels({}),['后退','前进','重新加载','在此页查找…','检查']);
 assert.deepEqual(labels({linkURL:url+'next'}),['在新标签页中打开链接','复制链接地址','检查']);
 assert.deepEqual(labels({isEditable:true,editFlags:{canCopy:true,canPaste:true,canSelectAll:true}}),['撤销','重做','剪切','复制','粘贴','全选','检查']);
 assert.deepEqual(labels({selectionText:'苹果'}),['复制','在此页查找所选文字','检查']);
 assert.deepEqual(labels({linkURL:'javascript:alert(1)'}),['后退','前进','重新加载','在此页查找…','检查'],'non-web links are not offered');
 r().extensionHost={menuItems:()=>[{id:'ext:1',label:'扩展菜单项',click:()=>{}}]};
 assert.deepEqual(labels({}).slice(-2),['检查','扩展菜单项']);r().extensionHost=null;
 ok('右键菜单按场景给出链接、编辑、选中文字和页面项；非网页链接不提供打开；扩展菜单接在最后');

 // 8. 真实右键：网页触发 context-menu 时确实弹出菜单；点击菜单项真正生效。
 let popped=null;const popup=Menu.prototype.popup;Menu.prototype.popup=function(options){popped=this;this.closePopup=()=>{};options?.callback?.();};
 try{
  await wc().loadURL(url);await wait(()=>!wc().isLoading(),'reload fixture');const p=await wc().executeJavaScript('(()=>{const r=document.querySelector("#link").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');
  for(const type of ['mouseMove','mouseDown','mouseUp'])wc().sendInputEvent({type,...p,button:'right',clickCount:1});
  await wait(()=>popped,'context menu popup');const items=popped.items.map(i=>i.label).filter(Boolean);assert.equal(items[0],'在新标签页中打开链接',items.join(','));
  await clipboard.writeText('before');popped.items.find(i=>i.label==='复制链接地址').click();await wait(async()=>await clipboard.readText()===url+'next','copy link address');
  popped.items.find(i=>i.label==='在新标签页中打开链接').click();await wait(()=>r().tabs.size===2,'link opened in background tab');
  assert.equal([...r().tabs.values()].find(t=>t.id!==r().activeTabId).url,url+'next');assert.equal(wc().getURL(),url,'current tab stays');
  popped=null;const f=await wc().executeJavaScript('(()=>{const e=document.querySelector("#field");e.focus();e.select();const r=e.getBoundingClientRect();return {x:Math.round(r.x+20),y:Math.round(r.y+r.height/2)}})()');
  for(const type of ['mouseMove','mouseDown','mouseUp'])wc().sendInputEvent({type,...f,button:'right',clickCount:1});
  await wait(()=>popped,'editable popup');await clipboard.writeText('');popped.items.find(i=>i.label==='复制').click();await wait(async()=>await clipboard.readText()==='可编辑文字','copy from editable');
  popped=null;const q=await wc().executeJavaScript('(()=>{getSelection().removeAllRanges();const r=document.querySelector("#a").getBoundingClientRect();return {x:Math.round(r.right+40),y:Math.round(r.y+r.height/2)}})()');
  for(const type of ['mouseMove','mouseDown','mouseUp'])wc().sendInputEvent({type,...q,button:'right',clickCount:1});
  await wait(()=>popped,'page popup');assert(popped.items.some(i=>i.label==='后退'),popped.items.map(i=>i.label).join(','));
  popped.items.find(i=>i.label==='检查').click();await wait(()=>r().devtoolsOpen&&r().devtoolsView?.webContents.getURL().startsWith('devtools://'),'inspect opens devtools');
  await c.toggleDevTools(a.id);await wait(()=>!r().devtoolsOpen,'devtools closed');
 }finally{Menu.prototype.popup=popup;}
 ok('真实右键弹出菜单；复制链接地址写入剪贴板；后台新标签打开链接且当前页不变；可编辑框复制生效；「检查」打开停靠的开发者工具');

 // 9. 查找请求只对运行中的实例生效；停止实例后查找状态清除。
 await ui('pageFindOpen()');await wait(()=>r().find,'find open before stop');
 await c.stop(a.id);await wait(async()=>!(await ui('!!document.querySelector("#pageFind")')),'find bar gone after stop');
 await assert.rejects(()=>win.webContents.executeJavaScript(`request('page-find',{id:${JSON.stringify(a.id)},query:'x'})`),/请先启动实例/);
 ok('停止实例后查找栏消失；未运行实例的查找请求被拒绝');
}catch(e){console.error(e);process.exitCode=1;}finally{
 try{await c?.closeAll();}catch{}win?.destroy();server?.closeAllConnections?.();server?.close();
 try{if(savedText!==null)await clipboard.writeText(savedText);}catch{}
 const report={passed:!process.exitCode,electron:process.versions.electron,checks};console.log(JSON.stringify(report));
 try{fs.rmSync(root,{recursive:true,force:true});}catch{}app.exit(process.exitCode||0);
}});
