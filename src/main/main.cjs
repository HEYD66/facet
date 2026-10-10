'use strict';
const {app,BrowserWindow,ipcMain,dialog}=require('electron');
const path=require('node:path'),fs=require('node:fs');
const {Controller}=require('./controller.cjs');
app.setName('千面 Facet');
// Persisted data and session identifiers remain stable across application upgrades.
const {userDataPath,resourcePath}=require('./app-paths.cjs');
app.setPath('userData',userDataPath(app));
const controlApiModule=require('./control-api.cjs');
const controlConfigFile=path.join(app.getPath('userData'),'control-api.json');
let controlSettings=controlApiModule.loadSettings(controlConfigFile);
if(app.isPackaged)require('./runtime-output.cjs').installRuntimeOutput(app);
if(process.platform==='win32')app.setAppUserModelId('Facet.MultiInstanceBrowser');
const appIcon=resourcePath(app,process.platform==='win32'?'facet.ico':'facet.png');
require('./webrtc-policy.cjs').installWebRTCPolicy(app);
require('./browser-network-policy.cjs').installBrowserNetworkPolicy(app);
app.commandLine.appendSwitch('disable-quic');
// 外部控制默认关闭。开启后由应用级 CDP 端口承载所有实例页面，端口只监听本机。
const cdpStarted=controlSettings.enabled&&!!controlSettings.cdpPort;
if(cdpStarted){app.commandLine.appendSwitch('remote-debugging-port',String(controlSettings.cdpPort));app.commandLine.appendSwitch('remote-debugging-address','127.0.0.1');}
const locked=app.requestSingleInstanceLock();if(!locked)app.quit();
let window,controller,quitting=false,closing=false;
// Windows：去掉系统黑色标题栏，改由界面自绘一行（颜色跟随主题），最小化/最大化/关闭仍用系统按钮（titleBarOverlay）。
const customFrame=process.platform==='win32';
if(locked){app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
app.whenReady().then(async()=>{
 const transferStartup=await require('./instance-transfer.cjs').finalizePending(app.getPath('userData'));

 window=new BrowserWindow({width:1440,height:960,minWidth:960,minHeight:700,title:'千面 Facet',icon:appIcon,backgroundColor:'#f5f8f7',autoHideMenuBar:true,...(customFrame?{titleBarStyle:'hidden',titleBarOverlay:{color:'#e9eaee',symbolColor:'#171a21',height:32}}:{}),webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,nodeIntegration:false,contextIsolation:true,webSecurity:true,webviewTag:false,backgroundThrottling:false,partition:'persist:arena-core-controls'}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
 window.webContents.session.setPermissionRequestHandler((_wc,_permission,cb)=>cb(false));window.webContents.session.setPermissionCheckHandler(()=>false);
 const binary=resourcePath(app,'mihomo',process.platform==='win32'?'mihomo.exe':'mihomo');
 controller=new Controller(window,app.getPath('userData'),binary);
 controlSettings=controlApiModule.loadSettings(controlConfigFile);
 controller.controlApi=new controlApiModule.ControlApi({file:controlConfigFile,settings:controlSettings,controller,cdpStarted});
 if(controlSettings.enabled)controller.controlApi.start().catch(error=>controller.workspace.log('application','本地控制 API 启动失败：'+error.message,'WARN'));
 controller.transferOutcome=transferStartup?.outcome||null;
 controller.updates=new (require('./updates.cjs').Updates)(app,{onChange:value=>{if(!window.isDestroyed())window.webContents.send('core:update',value);},prepareInstall:()=>controller.closeAll(),beginQuit:()=>{quitting=true;},cancelQuit:()=>{quitting=false;controller.disposing=false;}});
 require('./ipc.cjs').installIPC(window,controller);
 window.on('close',event=>{if(quitting)return;event.preventDefault();if(closing)return;closing=true;require('./exit-guard.cjs').confirmExit(controller,window,{showMessageBox:require('./exit-dialog.cjs').showExitDialog},app.getPath('userData')).then(go=>{if(!go){closing=false;return;}return controller.closeAll().then(()=>{quitting=true;app.quit();});}).catch(e=>{closing=false;dialog.showErrorBox('暂不能退出',e.message);});});
 app.on('before-quit',event=>{if(!quitting&&window&&!window.isDestroyed()){event.preventDefault();window.close();}});
 await window.loadFile(path.join(__dirname,'../renderer/index.html'),customFrame?{query:{frame:'custom'}}:undefined);
 controller.updates.scheduleStartupCheck();
 (transferStartup?Promise.allSettled(transferStartup.runningIds.filter(id=>controller.store.list().some(x=>x.id===id)).map(id=>controller.start(id))):controller.startOnLaunch()).catch(e=>controller.workspace.log('application','随应用启动任务失败：'+require('./workspace.cjs').redact(e.message),'ERROR'));
 window.once('closed',()=>{controller.controlApi?.stop().catch(()=>{});controller.updates.dispose();});
 console.log('千面 Facet '+require('./application-version.cjs').applicationVersion(app)+' ready; enabled instances start sequentially.');
}).catch(e=>{dialog.showErrorBox('千面 Facet 启动失败',e.message);quitting=true;app.quit();});
app.on('window-all-closed',()=>app.quit());}
