'use strict';
const {WebContentsView}=require('electron');
const crypto=require('node:crypto'),path=require('node:path');
const {MAX_TABS,tabURL,forInstance}=require('./browser-tabs-state.cjs');
const PAGE_FIELDS=['url','title','pageState','lastLoadedAt','error','loadFailed'];
function current(r,tab){return r.activeTabId===tab.id;}
function sync(r,tab){if(current(r,tab)){for(const key of PAGE_FIELDS)r[key]=tab[key];r.native=tab.native||r.native;}}
function saved(r){return {activeId:r.activeTabId,items:[...r.tabs.values()].map(tab=>({id:tab.id,url:tab.url}))};}
function persist(c,id,r){
 if(c.runtimes.get(id)!==r||r.tabsClosing||!r.tabs?.size)return;
 const browserTabs=saved(r),x=c.store.get(id),active=r.tabs.get(r.activeTabId),patch={browserTabs};
 if(/^https?:/i.test(active?.url||''))patch.url=active.url;
 if(JSON.stringify(x.browserTabs)!==JSON.stringify(browserTabs)||patch.url&&patch.url!==x.url)c.store.update(id,patch);
}
function snapshot(x,r){
 const items=r?.tabs?[...r.tabs.values()]:x.browserTabs?.items||[];
 return {activeTabId:r?.activeTabId||x.browserTabs?.activeId||null,tabs:items.map(tab=>({id:tab.id,url:tab.url,title:tab.title||(tab.url==='about:blank'?'新标签页':''),active:tab.id===(r?.activeTabId||x.browserTabs?.activeId),loaded:!!tab.view&&!tab.view.webContents.isDestroyed(),loading:!!tab.view&&!tab.view.webContents.isDestroyed()&&tab.view.webContents.isLoading(),error:tab.error||''}))};
}
async function loadPage(c,id,r,tab){
 if(tab.view&&!tab.view.webContents.isDestroyed())return tab;
 // Running browser tabs keep timers/rendering alive when another instance or window is selected.
 const x=c.store.get(id),view=new WebContentsView({webPreferences:{session:r.session,sandbox:true,nodeIntegration:false,nodeIntegrationInSubFrames:true,contextIsolation:true,webSecurity:true,backgroundThrottling:false}}),wc=view.webContents;
 tab.view=view;view.setVisible(false);c.window.contentView.addChildView(view);wc.setAudioMuted(c.mutedFor(id));
 // Background tabs also need native bounds before their first document. Without
 // these, clearing the minimized-window override restores a 0x0 native viewport.
 const [windowWidth,windowHeight]=c.window.getContentSize(),initialBounds=c.bounds||c.lastPageSize||{width:windowWidth,height:windowHeight};
 view.setBounds({x:0,y:0,width:Math.max(1,Math.round(initialBounds.width)),height:Math.max(1,Math.round(initialBounds.height))});
 require('./background-rendering.cjs').setThrottling(r,!!c.grid&&c.grid.mode!=='live'&&!r.extensionWindows?.size);
 const alive=()=>!wc.isDestroyed()&&c.runtimes.get(id)===r&&r.tabs?.get(tab.id)===tab;
 // Each committed document can replace its native rendering widget. Reapply
 // the current policy after commit; explicit grid saver throttling still wins.
 const resumeRendering=()=>{if(alive())require('./background-rendering.cjs').resume(wc);};
 wc.on('dom-ready',resumeRendering);wc.on('did-finish-load',resumeRendering);
 const changed=()=>{if(!alive())return;const url=wc.getURL();if(url==='about:blank'||/^https?:/i.test(url))tab.url=url;tab.title=wc.getTitle();sync(r,tab);c.emitSoon();};
 const navigated=()=>{changed();if(alive())try{persist(c,id,r);}catch{c.log(id,'网页标签地址保存失败，当前页面仍保留','WARN');}};
 wc.on('before-input-event',(event,input)=>{
  if(input.type!=='keyDown'||input.isAutoRepeat)return;
  if(input.key==='F12'){event.preventDefault();if(!current(r,tab))return;c.toggleDevTools(id).catch(error=>c.log(id,'开发者工具切换失败：'+error.message,'WARN'));return;}
  if(!input.control||input.alt||input.meta)return;const key=input.key.toLowerCase();
  if(key==='t'&&!input.shift){event.preventDefault();c.newTab(id).then(()=>c.window.webContents.send('core:focus-address',{id})).catch(error=>c.log(id,error.message,'WARN'));}
  else if(key==='w'&&!input.shift){event.preventDefault();c.closeTab(id,tab.id).catch(error=>c.log(id,error.message,'WARN'));}
  else if(key==='tab'){event.preventDefault();const list=[...r.tabs.keys()],index=list.indexOf(r.activeTabId);c.activateTab(id,list[(index+(input.shift?-1:1)+list.length)%list.length]).catch(()=>{});}
  else if(/^[1-9]$/.test(key)&&!input.shift){event.preventDefault();const list=[...r.tabs.keys()];c.activateTab(id,list[key==='9'?list.length-1:Math.min(Number(key)-1,list.length-1)]).catch(()=>{});}
  else if(key==='n'&&input.shift){event.preventDefault();c.window.webContents.send('core:new-instance');}
  else if(key==='l'&&!input.shift){event.preventDefault();c.window.webContents.send('core:focus-address',{id});}
 });
 wc.setWindowOpenHandler(({url,disposition})=>{
  const popup=disposition==='new-window'&&c.popupAllowed(id,r);let checked;try{checked=tabURL(url);}catch{return popup&&url==='about:blank'?c.popupOptions(x):{action:'deny'};}
  if(popup)return c.popupOptions(x);
  setImmediate(()=>c.newTab(id,{url:checked,active:disposition!=='background-tab'}).catch(error=>c.log(id,error.message,'WARN')));return {action:'deny'};
 });
 wc.on('did-create-window',(win,details)=>c.adoptPopup(id,r,x,win,details));
 const guard=(event,url)=>{try{tabURL(url);}catch{event.preventDefault();}};wc.on('will-navigate',guard);wc.on('will-redirect',guard);
 wc.on('did-navigate',navigated);wc.on('did-navigate-in-page',navigated);wc.on('page-title-updated',changed);wc.on('did-stop-loading',changed);
 wc.on('did-start-navigation',(_event,_url,inPlace,main)=>{if(main&&!inPlace)tab.loadFailed=false;});
 wc.on('did-start-loading',()=>{if(!alive())return;tab.pageState='加载中';sync(r,tab);c.emitSoon();});
 wc.on('did-finish-load',()=>{if(!alive())return;tab.pageState='已完成加载（不代表所有资源可用）';tab.lastLoadedAt=new Date().toISOString();tab.error='';if(!tab.loadFailed&&/^https?:/i.test(wc.getURL()))c.clearProxyAlert(id,r);sync(r,tab);c.emitSoon();});
 wc.on('did-fail-load',(_event,code,description,url,main)=>{
  if(!alive()||code===-3)return;if(main)tab.loadFailed=true;let host;try{host=new URL(url).hostname;}catch{}
  const trace=c.networkTrace.begin({operation:'page-load',instanceId:id,host,proxy:!!r.core,route:r.core?'instance-proxy':'direct'});c.networkTrace.record(trace,{stage:'page-error',errorNumber:code,reason:description,mainFrame:main});c.networkTrace.finish(trace,{result:'failed'});
  if(main){tab.pageState='加载失败';tab.error=`页面加载失败：${description} (${code})`+(r.core?.recentIssue()?'；内核提示：'+r.core.recentIssue():'');sync(r,tab);c.log(id,tab.error,'WARN');c.notePageFailure(id,r,code,url);}
 });
 wc.on('render-process-gone',(_event,details)=>{if(!alive())return;tab.pageState='浏览进程退出';tab.error='此标签页的浏览进程退出，请刷新标签页';sync(r,tab);const trace=c.networkTrace.begin({operation:'renderer-exit',instanceId:id});c.networkTrace.record(trace,{stage:'process-exit',reason:details?.reason,exitCode:details?.exitCode});c.networkTrace.finish(trace,{result:'failed'});c.log(id,tab.error,'ERROR');});
 wc.on('facet-environment-error',error=>c.log(id,error.message,'WARN'));
 try{
  await wc.loadFile(path.join(__dirname,'../renderer/seed.html'));
  const native=await wc.executeJavaScript(`(async()=>({platform:navigator.platform,metadata:navigator.userAgentData?await navigator.userAgentData.getHighEntropyValues(['architecture','bitness','model','platformVersion','fullVersionList','wow64']):null}))()`);tab.native=native;
  wc.debugger.attach('1.3');await require('./environment.cjs').applyEnvironment(wc,r.environment,native,c.bounds||{width:c.window.getContentSize()[0],height:c.window.getContentSize()[1]});
  // Windows can report a zero native viewport for a widget first created while
  // minimized. Temporarily size adaptive tabs using the last browser layout.
  // Fixed/hardware viewports already have their own environment metrics.
  const env=r.environment;
  if(c.window.isMinimized()&&!env.width&&!env.scale&&!(env.fingerprint?.enabled&&env.fingerprint.hardware)){
   const [width,height]=c.window.getContentSize(),size=c.bounds||c.lastPageSize||{width,height};
   await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:Math.max(1,size.width),height:Math.max(1,size.height),deviceScaleFactor:0,mobile:false,dontSetVisibleSize:true});
   tab.backgroundViewport=true;
  }
  if(!alive()||c.disposing||!['starting','running'].includes(r.status)||r.core&&!r.core.child)throw Error('实例已停止或代理内核退出');
  r.extensionHost?.bindPage(wc);return tab;
 }catch(error){r.extensionHost?.unbindPage(wc);try{c.window.contentView.removeChildView(view);}catch{}if(!wc.isDestroyed())wc.close({waitForBeforeUnload:false});tab.view=null;throw error;}
}
function show(c,id,r,tab){
 const old=r.view,changed=r.activeTabId!==tab.id;if(old!==tab.view){c.releaseCapture(r);c.removeDevToolsView(r,true);if(old){old.setVisible(false);require('./background-rendering.cjs').resume(old.webContents);if(r.gridParent){r.gridParent.removeChildView(old);c.window.contentView.addChildView(old);r.gridParent=null;}}r.viewportKey=null;r.gridApplied=null;r.gridBounds=null;}
 r.activeTabId=tab.id;r.view=tab.view;sync(r,tab);
 require('./background-rendering.cjs').setThrottling(r,!!c.grid&&c.grid.mode!=='live'&&!r.extensionWindows?.size);
 if(r.extensionHost?.compat?.tabs){const compat=r.extensionHost.compat;compat.tabs.focusedId=tab.view.webContents.id;if(changed)compat.broadcast('tabs.onActivated',[{tabId:tab.view.webContents.id,windowId:compat.tabs.primaryWindowId}]);}
 if(c.grid)c.applyGrid();else if(c.activeId===id&&c.bounds){c.setDevToolsLayout(r,c.bounds);tab.view.setVisible(r.status==='running');if(r.status==='running')tab.view.webContents.focus();}
 require('./background-rendering.cjs').scheduleViewportRestore(c.window,r,tab);
 persist(c,id,r);c.emitSoon();
}
function navigatePage(c,id,r,tab){if(tab.started)return;tab.started=true;tab.view.webContents.loadURL(tab.url).catch(error=>{if(error.code!=='ERR_ABORTED'&&c.runtimes.get(id)===r)c.log(id,'网页未能完成加载，请检查网址或网络','WARN');});}
async function initialize(c,id,r,x){
 const plan=forInstance(x);r.tabs=new Map(plan.items.map(item=>[item.id,{...item,title:'',pageState:'等待加载',error:'',view:null}]));r.activeTabId=plan.activeId;
 const tab=r.tabs.get(plan.activeId);await loadPage(c,id,r,tab);show(c,id,r,tab);return tab.view.webContents;
}
function runtime(c,id){if(c.disposing)throw Error('应用正在退出');if(c.proxyModeSwitching)throw Error(require('./proxy-mode.cjs').busyMessage);if(c.transfer.progress?.running&&c.transfer.progress.ids.includes(id))throw Error('所选实例正在导出，请等待完成');const r=c.runtimes.get(id);if(!r?.view||r.tabsClosing||r.status!=='running')throw Error('请先启动实例');return r;}
async function create(c,id,{url='about:blank',active=true}={}){
 const r=runtime(c,id);if(r.tabs.size>=MAX_TABS)throw Error('每个实例最多打开 32 个网页标签');
 const tab={id:crypto.randomUUID(),url:tabURL(url),title:'',pageState:'准备加载',error:'',view:null};r.tabs.set(tab.id,tab);
 try{await loadPage(c,id,r,tab);if(active)show(c,id,r,tab);else persist(c,id,r);navigatePage(c,id,r,tab);c.emit();return {tabId:tab.id,webContentsId:tab.view.webContents.id};}
 catch(error){r.tabs.delete(tab.id);throw error;}
}
async function activate(c,id,tabId){const r=runtime(c,id),tab=r.tabs.get(tabId);if(!tab)throw Error('网页标签不存在或不属于此实例');await loadPage(c,id,r,tab);show(c,id,r,tab);navigatePage(c,id,r,tab);c.emit();return {tabId:tab.id};}
async function close(c,id,tabId){
 const r=runtime(c,id),tab=r.tabs.get(tabId);if(!tab)throw Error('网页标签不存在或不属于此实例');
 if(r.tabs.size===1){const created=await create(c,id);await close(c,id,tabId);return {...created,lastTabReplaced:true};}
 if(current(r,tab)){const list=[...r.tabs.keys()],index=list.indexOf(tabId);await activate(c,id,list[index+1]||list[index-1]);}
 r.tabs.delete(tabId);clearTimeout(tab.backgroundViewportTimer);if(tab.view){const wc=tab.view.webContents,row=r.extensionHost?.compat?.tabs.rows.get(wc.id);if(row)row.lastTab=r.extensionHost.compat.tabs.tab(row);r.extensionHost?.unbindPage(wc);try{c.window.contentView.removeChildView(tab.view);}catch{}if(!wc.isDestroyed()){wc.stop();wc.close({waitForBeforeUnload:false});}}
 persist(c,id,r);c.emit();return {closed:tabId};
}
function stopPages(c,r){
 r.tabsClosing=true;
 const pages=r.tabs?[...r.tabs.values()]:r.view?[{view:r.view}]:[];r.closingViews=[];
 for(const tab of pages){clearTimeout(tab.backgroundViewportTimer);const view=tab.view;if(!view)continue;const wc=view.webContents;try{(view===r.view&&r.gridParent?r.gridParent:c.window.contentView).removeChildView(view);}catch{}if(!wc.isDestroyed()){r.closingViews.push(wc);wc.stop();wc.close({waitForBeforeUnload:false});}tab.view=null;}
 r.closingView=r.closingViews[0]||null;r.view=null;r.gridParent=null;r.gridBounds=null;
}
module.exports={initialize,navigatePage,snapshot,create,activate,close,stopPages,persist};
