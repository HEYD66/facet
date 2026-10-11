'use strict';
const {ipcMain,Menu}=require('electron'),path=require('node:path');
const hosts=new Map(),channel='facet:extension-host';
function sender(event){
 const worker=event.type==='service-worker',ses=worker?event.session:event.sender?.session,host=hosts.get(ses);if(!host)throw Error('扩展上下文未登记');
 const r=host.runtime;if(!['starting','running'].includes(r.status)||!r.view||r.view.webContents.isDestroyed())throw Error('所属实例已停止');
 if(!worker&&event.senderFrame!==event.sender.mainFrame)throw Error('仅允许扩展主框架');
 const url=new URL(worker?event.serviceWorker.scriptURL:event.senderFrame.url);if(url.protocol!=='chrome-extension:')throw Error('仅允许扩展上下文');
 const extension=ses.extensions.getExtension(url.hostname);if(!extension||!host.allowed.has(path.resolve(extension.path)))throw Error('此扩展未绑定到实例');
 return {host,id:extension.id,manifest:extension.manifest,worker:worker?event.serviceWorker:null,wc:worker?null:event.sender};
}
function properties(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('菜单参数无效');const row={};
 for(const field of ['title','parentId','id','type','enabled','visible','checked','contexts','documentUrlPatterns','targetUrlPatterns'])if(value[field]!==undefined)row[field]=value[field];
 for(const field of ['id','parentId'])if(row[field]!==undefined&&(!['string','number'].includes(typeof row[field])||String(row[field]).length>200))throw Error('菜单标识无效');
 if(row.title!==undefined&&(typeof row.title!=='string'||row.title.length>300))throw Error('菜单标题无效');
 if(row.type!==undefined&&!['normal','checkbox','radio','separator'].includes(row.type))throw Error('菜单类型无效');
 for(const field of ['enabled','visible','checked'])if(row[field]!==undefined&&typeof row[field]!=='boolean')throw Error('菜单状态无效');
 const validContexts=['all','page','selection','link','image','video','audio','editable','frame'];
 if(row.contexts!==undefined&&(!Array.isArray(row.contexts)||!row.contexts.length||row.contexts.some(x=>!validContexts.includes(x))))throw Error('菜单场景无效');
 for(const field of ['documentUrlPatterns','targetUrlPatterns'])if(row[field]!==undefined&&(!Array.isArray(row[field])||row[field].length>50||row[field].some(x=>typeof x!=='string'||x.length>1000)))throw Error('菜单范围无效');
 return row;
}
function windowInfo(host){const w=host.controller.window;return {id:w.id,focused:w.isFocused(),type:'normal',state:w.isMaximized()?'maximized':w.isMinimized()?'minimized':'normal',...w.getBounds(),incognito:false,alwaysOnTop:w.isAlwaysOnTop()};}
function invoke(event,method,args){
 const {host,id,manifest,worker,wc}=sender(event);if(!Array.isArray(args))throw Error('扩展请求参数无效');
 if(method==='target')return {tabId:host.runtime.view.webContents.id,windowId:host.controller.window.id};
 if(method==='window')return windowInfo(host);
 if(method==='debugger-attach'||method==='debugger-detach'||method==='debugger-command'){
  if(!manifest.permissions?.includes('debugger'))throw Error('扩展未声明 debugger 权限');
  if(method==='debugger-attach'){
   if(args.length!==2)throw Error('调试器附加参数无效');
   return host.debuggerAttach(id,worker,args[0],args[1]);
  }
  if(method==='debugger-detach'){
   if(args.length!==1)throw Error('调试器断开参数无效');
   return host.debuggerDetach(id,worker,args[0]);
  }
  if(args.length!==3)throw Error('调试器命令参数无效');
  return host.debuggerCommand(id,worker,args[0],args[1],args[2]);
 }
 if(args.length>2)throw Error('扩展请求参数无效');
 if(!manifest.permissions?.includes('contextMenus'))throw Error('扩展未声明contextMenus权限');
 let entry=host.menus.get(id);if(!entry){entry={items:new Map(),worker,wc};host.menus.set(id,entry);}entry.worker=worker||entry.worker;entry.wc=wc||entry.wc;
 if(method==='menu-create'){const row=properties(args[0]);if(row.id===undefined)throw Error('缺少菜单标识');if(entry.items.size>=100)throw Error('扩展菜单数量超限');if(entry.items.has(String(row.id)))throw Error('菜单标识已存在');if(row.parentId!==undefined&&!entry.items.has(String(row.parentId)))throw Error('父菜单不存在');entry.items.set(String(row.id),row);return row.id;}
 if(method==='menu-update'){const key=String(args[0]),old=entry.items.get(key);if(!old)throw Error('菜单不存在');const changes=properties(args[1]);if(changes.id!==undefined||changes.parentId!==undefined)throw Error('不支持更改菜单标识或层级');entry.items.set(key,{...old,...changes});return;}
 if(method==='menu-remove'){const key=String(args[0]);if(!entry.items.has(key))throw Error('菜单不存在');const remove=k=>{for(const [child,row]of entry.items)if(String(row.parentId)===k)remove(child);entry.items.delete(k);};remove(key);return;}
 if(method==='menu-clear'){entry.items.clear();return;}
 throw Error('不支持的扩展请求');
}
function pattern(pattern,url){if(pattern==='<all_urls>')return /^(https?|file|ftp):/.test(url);try{const escaped=pattern.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*');return new RegExp('^'+escaped+'$').test(url);}catch{return false;}}
function applies(row,params){
 if(row.visible===false)return false;const contexts=row.contexts||['page'];const flags=new Set(['all',...(params.selectionText?['selection']:[]),...(params.linkURL?['link']:[]),...(params.isEditable?['editable']:[]),...(params.mediaType&&params.mediaType!=='none'?[params.mediaType]:[])]);if(flags.size===1)flags.add('page');if(params.frameURL&&params.frameURL!==params.pageURL)flags.add('frame');
 return contexts.some(x=>flags.has(x))&&(!row.documentUrlPatterns||row.documentUrlPatterns.some(x=>pattern(x,params.frameURL||params.pageURL)))&&(!row.targetUrlPatterns||row.targetUrlPatterns.some(x=>pattern(x,params.linkURL||params.srcURL||'')));
}
class ExtensionHost{
 constructor(controller,runtime,instanceId,allowed){
  this.controller=controller;this.runtime=runtime;this.instanceId=instanceId;this.allowed=new Set(allowed.map(x=>path.resolve(x)));this.menus=new Map();this.workers=new Set();this.closed=false;this.lastMenu=null;this.debuggerOwner=null;this.debuggerWorker=null;this.debuggerAttached=false;
  if(!hosts.size)ipcMain.handle(channel,invoke);hosts.set(runtime.session,this);
  this.preloads=['frame','service-worker'].map(type=>runtime.session.registerPreloadScript({type,filePath:path.join(__dirname,'extension-host-preload.cjs')}));
  this.onWorker=event=>{const worker=runtime.session.serviceWorkers.getWorkerFromVersionID(event.versionId);if(worker&&!this.workers.has(worker)){this.workers.add(worker);worker.ipc.handle(channel,invoke);}};
  runtime.session.serviceWorkers.on('running-status-changed',this.onWorker);
  this.onDebuggerMessage=(_event,method,params)=>{if(!this.debuggerAttached||!this.debuggerWorker||this.debuggerWorker.isDestroyed()||!['Network.responseReceived','Network.dataReceived','Network.loadingFinished','Network.loadingFailed'].includes(method))return;try{this.debuggerWorker.send('facet:extension-debugger-event',{type:'event',source:{tabId:this.runtime.view.webContents.id},method,params:params||{}});}catch(error){this.controller.log(this.instanceId,'扩展调试事件转发失败：'+require('./workspace.cjs').redact(error.message),'WARN');}};
  this.onDebuggerDetach=(_event,reason)=>{const worker=this.debuggerWorker;this.debuggerAttached=false;this.debuggerOwner=null;this.debuggerWorker=null;if(worker&&!worker.isDestroyed())try{worker.send('facet:extension-debugger-event',{type:'detach',source:{tabId:this.runtime.view?.webContents?.id},reason});}catch{}};
  runtime.view.webContents.debugger.on('message',this.onDebuggerMessage);
  runtime.view.webContents.debugger.on('detach',this.onDebuggerDetach);
  this.onContext=(_event,params)=>{const menu=this.buildMenu(params);if(menu){this.lastMenu=menu;menu.popup({window:controller.window,callback:()=>{if(this.lastMenu===menu)this.lastMenu=null;}});}};
  runtime.view.webContents.on('context-menu',this.onContext);
 }
 debuggerTarget(target){
  if(!target||typeof target!=='object'||target.tabId!==this.runtime.view?.webContents?.id)throw Error('调试器目标不是当前实例页面');
  return this.runtime.view.webContents.debugger;
 }
 debuggerAttach(extensionId,worker,target,version){
  this.debuggerTarget(target);if(typeof version!=='string'||!/^\d+\.\d+$/.test(version))throw Error('不支持的调试器协议版本');
  if(this.debuggerAttached&&this.debuggerOwner!==extensionId)throw Error('该实例页面的调试器已被其他扩展占用');
  const debug=this.runtime.view.webContents.debugger;
  if(!debug.isAttached())throw Error('实例页面调试器尚未就绪');
  this.debuggerAttached=true;this.debuggerOwner=extensionId;this.debuggerWorker=worker;return undefined;
 }
 debuggerDetach(extensionId,worker,target){
  this.debuggerTarget(target);if(!this.debuggerAttached)return undefined;
  if(this.debuggerOwner!==extensionId||this.debuggerWorker!==worker)throw Error('只能断开当前扩展创建的调试会话');
  // The application owns the underlying CDP connection. Stop forwarding events for this
  // extension, but keep the connection alive for Facet's environment and viewport controls.
  this.debuggerAttached=false;this.debuggerOwner=null;this.debuggerWorker=null;return undefined;
 }
 async debuggerCommand(extensionId,worker,target,method,params){
  this.debuggerTarget(target);if(!this.debuggerAttached||this.debuggerOwner!==extensionId||this.debuggerWorker!==worker)throw Error('请先附加当前实例页面的调试器');
  if(typeof method!=='string'||!['Network.enable','Network.disable','Network.streamResourceContent','Network.getResponseBody'].includes(method))throw Error('此扩展不允许调用该调试器命令');
  if(!params||typeof params!=='object'||Array.isArray(params))throw Error('调试器命令参数无效');
  return this.runtime.view.webContents.debugger.sendCommand(method,params);
 }
 buildMenu(params){
  const template=[];
  for(const [id,entry]of this.menus){const rows=[...entry.items.values()];const children=parent=>rows.filter(row=>parent===undefined?row.parentId===undefined:String(row.parentId)===String(parent)).filter(row=>row.parentId===undefined?applies(row,params):row.visible!==false).map(row=>{
   const submenu=children(row.id),item={id:id+':'+row.id,type:row.type||'normal',label:(row.title||'').replace(/%s/g,(params.selectionText||'').slice(0,80)),enabled:row.enabled!==false,checked:!!row.checked};if(submenu.length)item.submenu=submenu;else if(item.type!=='separator')item.click=clicked=>this.click(id,row.id,params,clicked);return item;
  });template.push(...children(undefined));}
  if(!template.length)return null;template.push({type:'separator'},{role:'copy'},{role:'paste'},{role:'selectAll'});return Menu.buildFromTemplate(template);
 }
 async click(id,menuItemId,params,clicked){
  try{if(this.closed||this.runtime.status!=='running')return;const entry=this.menus.get(id),wc=this.runtime.view.webContents,extension=this.runtime.session.extensions.getExtension(id);if(!entry||!extension)return;
   let recipient=extension.manifest.background?.service_worker?entry.worker:entry.wc;
   if((!recipient||recipient.isDestroyed())&&extension.manifest.background?.service_worker)recipient=await this.runtime.session.serviceWorkers.startWorkerForScope('chrome-extension://'+id+'/');if(!recipient||recipient.isDestroyed()||this.closed||this.runtime.status!=='running')return;
   const tab={id:wc.id,url:wc.getURL(),title:wc.getTitle(),windowId:this.controller.window.id,active:true,incognito:false};
   const info={menuItemId,pageUrl:params.pageURL||wc.getURL(),frameUrl:params.frameURL,selectionText:params.selectionText,linkUrl:params.linkURL,srcUrl:params.srcURL,editable:!!params.isEditable,mediaType:params.mediaType==='none'?undefined:params.mediaType,frameId:0};
   const row=entry.items.get(String(menuItemId));if(row&&['checkbox','radio'].includes(row.type)){info.wasChecked=!!row.checked;info.checked=clicked?!!clicked.checked:row.type==='radio'||!row.checked;row.checked=info.checked;if(row.type==='radio'){const siblings=[...entry.items.values()].filter(x=>String(x.parentId)===String(row.parentId)),index=siblings.indexOf(row);for(const direction of [-1,1])for(let i=index+direction;siblings[i]?.type==='radio';i+=direction)siblings[i].checked=false;}}
   recipient.send('facet:extension-menu-click',info,tab);
  }catch(error){this.controller.log(this.instanceId,'扩展菜单执行失败：'+require('./workspace.cjs').redact(error.message),'WARN');}
 }
 close(){if(this.closed)return;this.closed=true;this.lastMenu?.closePopup();this.lastMenu=null;this.runtime.view?.webContents.removeListener('context-menu',this.onContext);this.runtime.view?.webContents.debugger.removeListener('message',this.onDebuggerMessage);this.runtime.view?.webContents.debugger.removeListener('detach',this.onDebuggerDetach);this.runtime.session.serviceWorkers.removeListener('running-status-changed',this.onWorker);for(const worker of this.workers)if(!worker.isDestroyed())worker.ipc.removeHandler(channel);for(const id of this.preloads)this.runtime.session.unregisterPreloadScript(id);this.menus.clear();this.debuggerOwner=null;this.debuggerWorker=null;this.debuggerAttached=false;hosts.delete(this.runtime.session);if(!hosts.size)ipcMain.removeHandler(channel);}
}
module.exports={ExtensionHost,properties,applies,pattern};
