'use strict';
// Query actual Win32 icon handles and taskbar properties, not constructor options.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const {APP_ID,installWindowIdentity}=require('../src/main/window-identity.cjs');
const {resourcePath}=require('../src/main/app-paths.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-window-identity-'));
app.setPath('userData',root);
app.on('window-all-closed',()=>{});
const results=[];
const timeout=setTimeout(()=>app.exit(2),90000);timeout.unref();
app.whenReady().then(async()=>{
 try{
  if(process.platform!=='win32')throw Error('This verification requires Windows');
  const icon=resourcePath(app,'facet.ico');
  const probe=async win=>JSON.parse((await promisify(execFile)('pwsh.exe',['-NoProfile','-File',path.join(__dirname,'window-identity-properties.ps1'),'-WindowHandle',win.getNativeWindowHandle().readBigUInt64LE().toString()],{encoding:'utf8',windowsHide:true,timeout:15000})).stdout);
  const previous=new BrowserWindow({show:false,icon,title:'Facet icon baseline',webPreferences:{sandbox:true,contextIsolation:true}});
  await previous.loadURL('data:text/plain,Facet icon baseline');
  const before=await probe(previous);
  assert.equal(before.pid,process.pid);assert(before.large&&before.small);assert.equal(before.icon,null);
  const fallback=new BrowserWindow({show:false,title:'Electron fallback baseline',webPreferences:{sandbox:true,contextIsolation:true}});
  const defaultIcons=await probe(fallback);
  assert.notEqual(before.large.hash,defaultIcons.large.hash);assert.notEqual(before.small.hash,defaultIcons.small.hash);
  results.push('Existing Facet window icons differ from Electron defaults, but taskbar relaunch icon is absent');previous.destroy();fallback.destroy();
  installWindowIdentity(app);
  for(const options of [
   {title:'Facet main icon verification',icon,titleBarStyle:'hidden',titleBarOverlay:true},
   {title:'Facet extension icon verification'},
   {title:'Facet dialog icon verification',skipTaskbar:true,frame:false}
  ]){
   const win=new BrowserWindow({...options,show:false,webPreferences:{sandbox:true,contextIsolation:true}});
   await win.loadURL('data:text/plain,'+encodeURIComponent(options.title));
   const actual=await probe(win);
   assert.equal(actual.pid,process.pid);assert.equal(actual.appId,APP_ID);
   assert.equal(actual.icon,icon+',0');assert.equal(actual.command,'"'+process.execPath+'" "'+app.getAppPath()+'"');assert.equal(actual.name,'千面 Facet');
   for(const size of ['large','small']){assert(actual[size]);assert.equal(actual[size].hash,before[size].hash);}
   results.push(options.title+': native large/small icons and taskbar properties match Facet');
   win.destroy();
  }
  const file=path.join(root,'report.json');fs.writeFileSync(file,JSON.stringify({passed:true,results},null,2));
  console.log(JSON.stringify({passed:true,results,report:file}));app.exit(0);
 }catch(error){fs.writeFileSync(path.join(root,'report.json'),JSON.stringify({passed:false,results,error:error.stack},null,2));console.error(error);console.error('Report: '+path.join(root,'report.json'));app.exit(1);}
});
