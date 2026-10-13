'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('extensionBrowser',{request:(method,args)=>ipcRenderer.invoke('facet:extension-browser',method,args),onState:fn=>{ipcRenderer.on('facet:extension-browser-state',(_e,value)=>fn(value));}});
