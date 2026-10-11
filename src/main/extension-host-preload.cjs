'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const extensionContext=typeof location==='undefined'||location.protocol==='chrome-extension:';
if(extensionContext&&(typeof location==='undefined'||process.contextIsolated)){
 contextBridge.exposeInMainWorld('__facetExtensionHost',{
  call:(method,args)=>ipcRenderer.invoke('facet:extension-host',method,args),
  onClick:listener=>{const handler=(_event,info,tab)=>listener(info,tab);ipcRenderer.on('facet:extension-menu-click',handler);return ()=>ipcRenderer.removeListener('facet:extension-menu-click',handler);},
  onDebugger:listener=>{const handler=(_event,payload)=>listener(payload);ipcRenderer.on('facet:extension-debugger-event',handler);return ()=>ipcRenderer.removeListener('facet:extension-debugger-event',handler);}
 });
 contextBridge.executeInMainWorld({func:()=>{
  const api=globalThis.chrome,host=globalThis.__facetExtensionHost;if(location.protocol!=='chrome-extension:'||!api||!host)return;
  const result=(promise,callback)=>{if(typeof callback!=='function')return promise;promise.then(value=>callback(value),error=>{console.error('Extension compatibility: '+error.message);callback();});};
  // Electron intentionally does not implement chrome.debugger for extensions. Facet already
  // owns one CDP connection per instance, so expose a narrowly scoped adapter that multiplexes
  // supported Network commands onto that instance connection. The main process validates the
  // extension permission, target and command allow-list; this is not a general CDP bridge.
  {
   const listeners=new Set(),detachListeners=new Set();
   const invoke=(method,args)=>host.call(method,args);
   const targetOf=value=>value&&typeof value==='object'&&Number.isInteger(value.tabId)?{tabId:value.tabId}:null;
   const send=(method,args,callback)=>result(invoke(method,args),callback);
   const debuggerApi={
    attach:(target,version,callback)=>send('debugger-attach',[targetOf(target),typeof version==='string'?version:'1.3'],typeof version==='function'?version:callback),
    detach:(target,callback)=>send('debugger-detach',[targetOf(target)],callback),
    sendCommand:(target,method,params,callback)=>{if(typeof params==='function'){callback=params;params={};}return send('debugger-command',[targetOf(target),method,params||{}],callback);},
    onEvent:{addListener:fn=>{if(typeof fn==='function')listeners.add(fn);},removeListener:fn=>listeners.delete(fn),hasListener:fn=>listeners.has(fn),hasListeners:()=>listeners.size>0},
    onDetach:{addListener:fn=>{if(typeof fn==='function')detachListeners.add(fn);},removeListener:fn=>detachListeners.delete(fn),hasListener:fn=>detachListeners.has(fn),hasListeners:()=>detachListeners.size>0}
   };
   host.onDebugger(payload=>{
    if(!payload||typeof payload!=='object')return;
    const source=payload.source&&typeof payload.source==='object'?payload.source:{};
    if(payload.type==='event')for(const fn of [...listeners])try{fn(source,payload.method,payload.params||{});}catch(error){console.error('Extension debugger listener: '+error.message);}
    if(payload.type==='detach')for(const fn of [...detachListeners])try{fn(source,payload.reason||'target_closed');}catch(error){console.error('Extension debugger detach listener: '+error.message);}
   });
   // Replace a missing or Electron-incomplete implementation. Chrome keeps its native API.
   if(!api.debugger||typeof api.debugger.sendCommand!=='function')api.debugger=debuggerApi;
  }
  if(!api.contextMenus){
   const listeners=new Set(),pending=[];host.onClick((info,tab)=>{if(!listeners.size){if(pending.length<10)pending.push([info,tab]);return;}for(const fn of listeners)fn(info,tab);});
   let serial=0;
   api.contextMenus={
    create:(properties,callback)=>{const id=properties.id??'facet-menu-'+(++serial);result(host.call('menu-create',[{...properties,id}]),callback||(()=>{}));return id;},
    update:(id,properties,callback)=>result(host.call('menu-update',[id,properties]),callback),
    remove:(id,callback)=>result(host.call('menu-remove',[id]),callback),
    removeAll:callback=>result(host.call('menu-clear',[]),callback),
    onClicked:{addListener:fn=>{listeners.add(fn);for(const args of pending.splice(0))fn(...args);},removeListener:fn=>listeners.delete(fn),hasListener:fn=>listeners.has(fn),hasListeners:()=>listeners.size}
   };
  }
  if(!api.windows)api.windows={WINDOW_ID_CURRENT:-2,WINDOW_ID_NONE:-1,getCurrent:(info,callback)=>result(host.call('window',[]),typeof info==='function'?info:callback),getLastFocused:(info,callback)=>result(host.call('window',[]),typeof info==='function'?info:callback)};
  const tabs=api.tabs;if(!tabs)return;
  if(typeof tabs.get==='function'){const get=tabs.get.bind(tabs);tabs.get=(id,callback)=>result(Promise.all([get(id),host.call('target',[])]).then(([tab,target])=>tab.id===target.tabId?{...tab,active:true,windowId:target.windowId}:tab),callback);}
  if(typeof tabs.query==='function'){const query=tabs.query.bind(tabs);tabs.query=(info,callback)=>{if(info?.active!==true)return query(info,callback);const filters={...info};delete filters.active;return result(Promise.all([query(filters),host.call('target',[])]).then(([rows,target])=>rows.filter(x=>x.id===target.tabId).map(x=>({...x,active:true,windowId:target.windowId}))),callback);};}
  if(globalThis.browser){for(const key of ['contextMenus','windows','tabs'])Object.defineProperty(globalThis.browser,key,{configurable:true,value:api[key]});}
 }});
}
