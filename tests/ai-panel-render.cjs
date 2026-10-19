'use strict';
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
app.disableHardwareAcceleration();const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-ai-panel-'));app.setPath('userData',root);
app.whenReady().then(async()=>{let win,c;try{
 win=new BrowserWindow({width:1280,height:900,show:false,webPreferences:{offscreen:true,preload:path.join(__dirname,'../src/main/preload.cjs'),contextIsolation:true,sandbox:true}});
 c=new(require('../src/main/controller.cjs').Controller)(win,root,'');require('../src/main/ipc.cjs').installIPC(win,c);
 c.aiAgent.save({providerId:'demo',name:'预览提供商（未联网）',baseURL:'http://127.0.0.1:1/v1',model:'vision-model',models:['vision-model','text-model']});
 await win.loadFile(path.join(__dirname,'../src/renderer/index.html'));
 const ui=s=>win.webContents.executeJavaScript(s);await new Promise(r=>setTimeout(r,1000));
 await ui("document.documentElement.dataset.theme='dark';document.querySelector('#aiToggle').click()");await new Promise(r=>setTimeout(r,1000));
 await ui("document.querySelector('#aiSettingsButton').click()");await new Promise(r=>setTimeout(r,1000));
 let image=await win.webContents.capturePage();if(image.isEmpty())throw Error('Empty settings image');fs.writeFileSync(path.join(root,'settings.png'),image.toPNG());
 await ui("document.querySelector('#aiSettingsDone').click();document.querySelector('#aiModelBadge').click()");await new Promise(r=>setTimeout(r,1000));
 image=await win.webContents.capturePage();if(image.isEmpty())throw Error('Empty model image');fs.writeFileSync(path.join(root,'models.png'),image.toPNG());console.log(root);
 }catch(e){console.error(e);process.exitCode=1;}finally{await c?.closeAll();win?.destroy();app.exit(process.exitCode||0);}});
