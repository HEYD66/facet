'use strict';
// 实例网页的查找（Ctrl+F）与右键菜单。查找只作用于当前网页标签；右键菜单先列浏览器常用项，扩展菜单项接在后面。
const {Menu,clipboard}=require('electron');
const MAX_QUERY=200;
function query(value){return String(value??'').replace(/[\r\n]+/g,' ').slice(0,MAX_QUERY);}
function emitFind(c,id,r){
 if(c.window.isDestroyed())return;
 const f=r.find,tab=f&&r.tabs?.get(f.tabId),alive=!!tab?.view&&!tab.view.webContents.isDestroyed();
 c.window.webContents.send('core:page-find',f?{id,open:true,tabId:f.tabId,query:f.query,matches:alive?f.matches:0,active:alive?f.active:0,pending:alive&&f.pending,searched:f.searched}:{id,open:false});
}
function activeTab(c,id){
 const r=c.runtimes.get(id),tab=r?.tabs?.get(r.activeTabId);
 if(!tab?.view||r.status!=='running'||r.tabsClosing||tab.view.webContents.isDestroyed())throw Error('请先启动实例');
 return {r,tab,wc:tab.view.webContents};
}
function session(r,tab){if(r.find&&r.find.tabId!==tab.id)r.find=null;return r.find||(r.find={tabId:tab.id,query:'',matches:0,active:0,requestId:0,pending:false,searched:false});}
// 打开查找栏。text 是右键「在此页查找所选文字」带入的关键词；没有时沿用上一次的关键词。
// 不在网页里执行脚本读取选中文字，避免网站察觉。
function open(c,id,{text}={}){
 const {r,tab}=activeTab(c,id);
 // 查找栏在浏览页面的地址栏下方；宫格缩略图里的网页没有这一栏。
 if(c.grid)throw Error('请先从宫格放大或切换到浏览页面再查找');
 if(r.find&&r.find.tabId!==tab.id)close(c,id,'clearSelection');
 const f=session(r,tab),value=query(text).trim();if(value)f.query=value;else if(!f.query)f.query=r.findLast||'';
 // 键盘焦点可能还在网页视图里；先把系统焦点交回控制界面，查找框才能收到输入。
 c.window.webContents.focus();c.window.webContents.send('core:page-find-open',{id,tabId:tab.id,query:f.query});
 if(f.query)search(c,id,f.query);else emitFind(c,id,r);
 return {open:true,query:f.query};
}
function search(c,id,value,{forward=true,next=false}={}){
 const {r,tab,wc}=activeTab(c,id),f=session(r,tab),text=query(value);
 const follow=next&&f.searched&&f.query===text;f.query=text;
 if(!text){wc.stopFindInPage('clearSelection');Object.assign(f,{matches:0,active:0,pending:false,searched:false});emitFind(c,id,r);return {matches:0};}
 // findNext:true 开始新的查找；同一关键词再按 Enter 时为 false，由 forward 决定跳到下一个还是上一个。
 if(!follow){f.matches=0;f.active=0;}
 f.pending=true;f.searched=true;f.requestId=wc.findInPage(text,{forward:forward!==false,findNext:!follow});emitFind(c,id,r);
 return {requestId:f.requestId};
}
function close(c,id,action='keepSelection',{focusPage=false}={}){
 const r=c.runtimes.get(id),f=r?.find;if(!f)return {open:false};
 r.find=null;if(f.query)r.findLast=f.query;
 const tab=r.tabs?.get(f.tabId),wc=tab?.view?.webContents;
 if(wc&&!wc.isDestroyed()){
  try{wc.stopFindInPage(action);}catch{}
  // 用 Esc 或关闭按钮收起查找栏后，键盘回到网页，和普通浏览器一致。
  if(focusPage&&r.activeTabId===tab.id&&c.activeId===id)wc.focus();
 }
 emitFind(c,id,r);return {open:false};
}
// 切换或关闭网页标签后，不把旧标签的查找结果留在新标签上。
function changed(c,id,r){if(r.find&&r.find.tabId!==r.activeTabId)close(c,id,'clearSelection');}
function attach(c,id,r,tab,wc){
 wc.on('found-in-page',(_event,result)=>{
  const f=r.find;if(!f||f.tabId!==tab.id||result.requestId!==f.requestId)return;
  // Chromium 会先回中间结果；finalUpdate 为 true 时才是最终数量。
  f.matches=result.matches;if(result.activeMatchOrdinal)f.active=result.activeMatchOrdinal;if(result.finalUpdate)f.pending=false;
  emitFind(c,id,r);
 });
 wc.on('did-start-navigation',(_event,_url,inPlace,main)=>{const f=r.find;if(main&&!inPlace&&f?.tabId===tab.id){Object.assign(f,{matches:0,active:0,pending:false,searched:false});emitFind(c,id,r);}});
 wc.on('context-menu',(_event,params)=>{
  if(c.runtimes.get(id)!==r||r.tabs?.get(tab.id)!==tab||wc.isDestroyed())return;
  const menu=build(c,id,r,tab,wc,params);if(!menu)return;r.pageMenu=menu;
  menu.popup({window:c.window,callback:()=>{if(r.pageMenu===menu)r.pageMenu=null;}});
 });
}
function trim(items){const out=[];for(const item of items){if(item.type==='separator'&&(!out.length||out.at(-1).type==='separator'))continue;out.push(item);}while(out.at(-1)?.type==='separator')out.pop();return out;}
function template(c,id,r,tab,wc,params){
 const flags=params.editFlags||{},web=v=>/^https?:\/\//i.test(v||'')?v:'',link=web(params.linkURL),image=params.mediaType==='image'?web(params.srcURL):'',selection=String(params.selectionText||'').trim(),items=[];
 const alive=fn=>()=>{if(!wc.isDestroyed())fn();},edit=method=>alive(()=>wc[method]());
 const copyText=text=>Promise.resolve(clipboard.writeText(text)).catch(error=>c.log(id,'复制失败：'+error.message,'WARN'));
 const newTab=url=>c.newTab(id,{url,active:false}).catch(error=>c.log(id,error.message,'WARN'));
 const find=text=>()=>{try{open(c,id,{text});}catch(error){c.log(id,error.message,'WARN');}};
 if(link)items.push({label:'在新标签页中打开链接',click:()=>newTab(link)},{label:'复制链接地址',click:()=>copyText(link)},{type:'separator'});
 if(image)items.push({label:'在新标签页中打开图片',click:()=>newTab(image)},{label:'复制图片',click:alive(()=>wc.copyImageAt(params.x,params.y))},{label:'复制图片地址',click:()=>copyText(image)},{type:'separator'});
 // 编辑命令直接作用于被点击的网页，不依赖当前哪个视图拿着焦点。
 if(params.isEditable)items.push({label:'撤销',enabled:!!flags.canUndo,click:edit('undo')},{label:'重做',enabled:!!flags.canRedo,click:edit('redo')},{type:'separator'},{label:'剪切',enabled:!!flags.canCut,click:edit('cut')},{label:'复制',enabled:!!flags.canCopy,click:edit('copy')},{label:'粘贴',enabled:!!flags.canPaste,click:edit('paste')},{label:'全选',enabled:!!flags.canSelectAll,click:edit('selectAll')},{type:'separator'});
 else if(selection)items.push({label:'复制',click:edit('copy')},{label:'在此页查找所选文字',click:find(selection.slice(0,MAX_QUERY))},{type:'separator'});
 else if(!link&&!image)items.push({label:'后退',enabled:wc.navigationHistory.canGoBack(),click:alive(()=>wc.navigationHistory.goBack())},{label:'前进',enabled:wc.navigationHistory.canGoForward(),click:alive(()=>wc.navigationHistory.goForward())},{label:'重新加载',click:alive(()=>wc.reload())},{type:'separator'},{label:'在此页查找…',accelerator:'CmdOrCtrl+F',registerAccelerator:false,click:find('')},{type:'separator'});
 // 宫格缩略图里的网页不提供「检查」：开发者工具只停靠在浏览页面旁。
 if(!c.grid&&r.activeTabId===tab.id)items.push({label:'检查',accelerator:'F12',registerAccelerator:false,click:()=>void inspect(c,id,r,tab,wc,params)});
 if(c.grid)for(const item of items)if(item.label==='在此页查找…'||item.label==='在此页查找所选文字')item.enabled=false;
 // 扩展通过 contextMenus 注册的项放在最后，点击仍交给扩展处理。
 const extension=r.extensionHost?.menuItems?.(params,wc)||[];if(extension.length)items.push({type:'separator'},...extension);
 return trim(items);
}
function build(c,id,r,tab,wc,params){const items=template(c,id,r,tab,wc,params);return items.length?Menu.buildFromTemplate(items):null;}
async function inspect(c,id,r,tab,wc,params){
 try{if(wc.isDestroyed()||r.activeTabId!==tab.id)return;if(!r.devtoolsOpen)await c.toggleDevTools(id);if(!wc.isDestroyed())wc.inspectElement(Math.round(params.x),Math.round(params.y));}
 catch(error){c.log(id,'开发者工具打开失败：'+error.message,'WARN');}
}
module.exports={attach,open,search,close,changed,template,build,MAX_QUERY};
