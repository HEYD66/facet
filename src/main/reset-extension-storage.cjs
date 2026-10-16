'use strict';
const {BrowserWindow}=require('electron');
// The instance must already be stopped. Do not run extension pages on the user's network.
async function clearExtensionStorage(session,catalog){
 session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_details,callback)=>callback({cancel:true}));
 try{
  for(const item of catalog.data.items){
   const manifest=require('node:fs').readFileSync(require('node:path').join(catalog.folder(item.id),'manifest.json'),'utf8');
   if(!JSON.parse(manifest).permissions?.includes('storage'))continue;
   let extension,window;
   try{
    extension=await session.extensions.loadExtension(catalog.folder(item.id),{allowFileAccess:false});
    window=new BrowserWindow({show:false,webPreferences:{session,sandbox:true,nodeIntegration:false,contextIsolation:true}});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    await window.loadURL('chrome-extension://'+extension.id+'/manifest.json');
    await window.webContents.executeJavaScript(`(async()=>{await chrome.storage.local.clear();if(chrome.storage.session)await chrome.storage.session.clear();if(Object.keys(await chrome.storage.local.get(null)).length)throw Error('扩展存储清理校验失败');})()`);
   }finally{if(window&&!window.isDestroyed())window.destroy();if(extension)session.extensions.removeExtension(extension.id);}
  }
 }finally{session.webRequest.onBeforeRequest(null);}
}
module.exports={clearExtensionStorage};
