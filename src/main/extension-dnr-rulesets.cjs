'use strict';
// Electron loads unpacked MV3 extensions without enabling the static rulesets that the manifest
// marks "enabled": true; Chrome does that on install and update. Facet applies those defaults
// once per package fingerprint in each instance profile. Electron persists the enabled set in the
// profile, so later starts, and the extension's own updateEnabledRulesets choices, stay as they are.
const fs=require('node:fs'),path=require('node:path');
const FILE='facet-dnr-rulesets.json',TIMEOUT=10000;
function defaultRulesets(manifest){
  const list=manifest?.declarative_net_request?.rule_resources;
  if(!Array.isArray(list)||!list.length)return null;
  return [...new Set(list.filter(r=>r&&r.enabled===true&&typeof r.id==='string'&&r.id).map(r=>r.id))];
}
// install: first time this profile sees the extension; only fills an empty enabled set.
// update: package content changed; enables rulesets that became default in the new manifest.
function plan(entry,fingerprint,defaults){
  if(entry&&entry.fingerprint===fingerprint)return null;
  if(!entry)return {mode:'install',enable:defaults};
  const old=Array.isArray(entry.defaults)?entry.defaults:[];
  return {mode:'update',enable:defaults.filter(id=>!old.includes(id))};
}
function read(file){
  try{const data=JSON.parse(fs.readFileSync(file,'utf8'));if(data?.version===1&&data.extensions&&typeof data.extensions==='object'&&!Array.isArray(data.extensions))return data;}catch{}
  return {version:1,extensions:{}};
}
// Runs in the extension's own origin, the same way reset-extension-storage.cjs clears storage.
function script(mode,enable){
  return `(async()=>{const d=globalThis.chrome?.declarativeNetRequest;if(!d||typeof d.updateEnabledRulesets!=='function'||typeof d.getEnabledRulesets!=='function')return {skipped:'api'};`+
    `const mode=${JSON.stringify(mode)},want=${JSON.stringify(enable)},current=await d.getEnabledRulesets();if(mode==='install'&&current.length)return {kept:current};`+
    `const add=want.filter(id=>!current.includes(id));if(add.length)await d.updateEnabledRulesets({enableRulesetIds:add});return {enabled:await d.getEnabledRulesets()};})()`;
}
async function inExtension(session,id,code,BrowserWindow,timeout){
  let win,timer;
  try{
    win=new BrowserWindow({show:false,webPreferences:{session,sandbox:true,nodeIntegration:false,contextIsolation:true}});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    const run=(async()=>{await win.loadURL('chrome-extension://'+id+'/manifest.json');return win.webContents.executeJavaScript(code);})();
    run.catch(()=>{});
    return await Promise.race([run,new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('扩展页面响应超时')),timeout);})]);
  }finally{clearTimeout(timer);if(win&&!win.isDestroyed())win.destroy();}
}
// items: [{key, extension: Electron Extension, fingerprint}]. Never throws for one extension;
// a failed extension is retried on the next start because its marker is not written.
async function applyDefaultRulesets(session,items,deps={}){
  const BrowserWindow=deps.BrowserWindow||require('electron').BrowserWindow,timeout=deps.timeout||TIMEOUT;
  const file=path.join(session.getStoragePath(),FILE),state=read(file),results=[];let dirty=false;
  for(const {key,extension,fingerprint}of items){
    const defaults=defaultRulesets(extension?.manifest);if(!defaults||!fingerprint)continue;
    const step=plan(state.extensions[extension.id],fingerprint,defaults);if(!step)continue;
    let value=null;
    if(step.enable.length){
      try{value=await inExtension(session,extension.id,script(step.mode,step.enable),BrowserWindow,timeout);}
      catch(error){results.push({key,ok:false,mode:step.mode,error:String(error?.message||error)});continue;}
    }
    state.extensions[extension.id]={fingerprint,defaults};dirty=true;
    results.push({key,ok:true,mode:step.mode,value});
  }
  if(dirty)(deps.atomic||require('./json-storage.cjs').atomic)(file,state,{backup:false});
  return results;
}
module.exports={applyDefaultRulesets,defaultRulesets,plan,script,FILE};
