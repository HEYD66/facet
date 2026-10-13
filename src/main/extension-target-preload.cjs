'use strict';
// Only extension panel windows load this preload. The bridge exposes no application controls.
const {contextBridge,ipcRenderer}=require('electron');
if(location.protocol==='chrome-extension:'){
 contextBridge.exposeInMainWorld('__facetExtensionTarget',{id:()=>ipcRenderer.invoke('facet:extension-target')});
 contextBridge.executeInMainWorld({func:()=>{
  if(globalThis.__facetExtensionCompatApplied)return;
  const tabs=globalThis.chrome?.tabs;if(typeof tabs?.query!=='function')return;
  const query=tabs.query.bind(tabs);
  tabs.query=function(info,callback){
   if(info?.active!==true)return query(info,callback);
   const result=globalThis.__facetExtensionTarget.id().then(async id=>{
    if(!Number.isInteger(id))return [];
    const filters={...info};delete filters.active;
    // Native enumeration retains Chrome permission checks and all supported filters.
    return (await query(filters)).filter(tab=>tab.id===id).map(tab=>({...tab,active:true}));
   });
   if(typeof callback==='function'){result.then(callback,()=>callback([]));return;}
   return result;
  };
 }});
}
