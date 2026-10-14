'use strict';
const {resourcePath}=require('./app-paths.cjs');
const APP_ID='Facet.MultiInstanceBrowser';
function installWindowIdentity(app){
 const icon=resourcePath(app,process.platform==='win32'?'facet.ico':'facet.png');
 if(process.platform==='win32')app.setAppUserModelId(APP_ID);
 app.on('browser-window-created',(_event,win)=>{
  if(process.platform==='win32'||process.platform==='linux')win.setIcon(icon);
  if(process.platform==='win32'){
   // The taskbar group uses relaunch metadata, separately from the window icon.
   // Development launches run electron.exe, whose embedded icon is Electron's.
   win.setAppDetails({appId:APP_ID,appIconPath:icon,appIconIndex:0,
    relaunchCommand:'"'+process.execPath+'"'+(app.isPackaged?'':' "'+app.getAppPath()+'"'),
    relaunchDisplayName:'千面 Facet'});
  }
 });
 return icon;
}
module.exports={APP_ID,installWindowIdentity};
