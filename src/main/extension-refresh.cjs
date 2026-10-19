'use strict';
// Refresh unpacked extensions from the folder they were imported from (one extension or all at once).
// The package folder is replaced in place, so the Chromium extension ID, its saved data and the enable list stay.
const fs=require('node:fs'),path=require('node:path');
const {sizeText}=require('./extension-catalog.cjs');
const added=(a,b)=>(a||[]).filter(x=>!(b||[]).includes(x));
const validSource=row=>row.source&&(fs.existsSync(path.join(row.source,'manifest.json'))||(path.extname(row.source).toLowerCase()==='.zip'&&fs.existsSync(row.source)))?row.source:null;
function usersOf(controller,id){const catalog=controller.extensions.catalog,users=controller.store.list().filter(x=>catalog.enabled(x.id).includes(id));return {users,running:users.filter(x=>{const r=controller.runtimes.get(x.id);return !!r&&r.status!=='stopped';})};}
function changes(old,row){const plus=added(row.permissions,old.permissions),minus=added(old.permissions,row.permissions),scope=added(row.matches,old.matches);
 return {risky:!!(plus.length||scope.length),lines:[`版本：${old.version} → ${row.version}`+(row.name!==old.name?`；名称：${old.name} → ${row.name}`:''),plus.length?'新增权限：'+plus.join(', '):'',minus.length?'移除权限：'+minus.join(', '):'',scope.length?'新增内容脚本范围：'+scope.join(', '):''].filter(Boolean)};}
async function stageFrom(catalog,old,source){const row=await require('./extension-zip.cjs').stageSource(catalog,source,old.id);if(old.key&&row.key!==old.key){catalog.discard(row);throw Error(`所选文件夹不是「${old.name}」（扩展签名 key 不同）`);}return row;}
async function stopAll(controller,running){for(const x of running)await controller.queue(x.id,()=>controller.stopInner(x.id));}
function stopLine(running,plural){return running.length?`将停止正在运行的实例：${running.map(x=>x.name).join('、')}（更新完成后自动重启；未保存的网页输入可能丢失）`:`没有正在运行的实例使用${plural?'这些扩展':'它'}，不会停止任何实例`;}

async function restartAll(controller,running){
 const restarted=[],restartFailed=[];
 for(const x of running){try{await controller.start(x.id);if(controller.runtimes.get(x.id)?.status!=='running')throw Error('实例未进入运行状态');restarted.push(x.name);controller.log(x.id,'扩展更新后已自动重启');}catch(e){restartFailed.push({id:x.id,name:x.name,error:e.message});controller.log(x.id,'扩展更新后自动重启失败：'+e.message,'ERROR');}}
 controller.emit();return {restarted,restartFailed};
}
async function refreshOne(controller,window,dialog,extensionId){
 const catalog=controller.extensions.catalog,old=catalog.get(extensionId);let source=validSource(old);
 if(!source){const pick=await dialog.showOpenDialog(window,{title:`选择「${old.name}」的来源（ZIP 或解压文件夹，沿用原导入类型）`,defaultPath:old.source&&fs.existsSync(old.source)?old.source:undefined,properties:[path.extname(old.source||'').toLowerCase()==='.zip'?'openFile':'openDirectory'],filters:path.extname(old.source||'').toLowerCase()==='.zip'?[{name:'ZIP 扩展',extensions:['zip']}]:undefined});if(pick.canceled)return {cancelled:true};source=pick.filePaths[0];}
 if(controller.disposing)throw Error('应用正在退出');
 const row=await stageFrom(catalog,old,source);let replaced=false;
 try{
  if(row.sha256===old.sha256){catalog.setSource(old.id,row.source);return {unchanged:true,version:old.version};}
  const {users,running}=usersOf(controller,old.id),c=changes(old,row);
  const detail=[`来源：${row.source}`,...c.lines,'大小：'+sizeText(row.bytes)+' · '+row.files+' 个文件和目录',row.skipped?.length?'已跳过开发用文件夹/文件：'+row.skipped.map(x=>x.name).join('、'):'',stopLine(running,false),users.length?'启用范围不变：'+users.map(x=>x.name).join('、'):'','各实例中扩展已保存的数据保留不变。',...(row.warnings||[])].filter(Boolean).join('\n');
  const answer=await dialog.showMessageBox(window,{type:c.risky?'warning':'question',title:'更新浏览器扩展',message:`更新「${old.name}」到 ${row.version}？`,detail,buttons:['取消','更新并重启'],defaultId:1,cancelId:0,noLink:true});
  if(answer.response!==1||controller.disposing)return {cancelled:true};
  await stopAll(controller,running);catalog.replace(old.id,row);replaced=true;controller.extensions.forget(old.id);
  const restart=await restartAll(controller,running);
  return {updated:true,from:old.version,version:row.version,stopped:running.map(x=>x.name),...restart};
 }finally{if(!replaced)catalog.discard(row);}
}

async function refreshAll(controller,window,dialog){
 const catalog=controller.extensions.catalog,staged=[],unchanged=[],noSource=[],failed=[];
 try{
  for(const old of [...catalog.data.items]){const source=validSource(old);if(!source){noSource.push(old.name);continue;}
   try{const row=await stageFrom(catalog,old,source);if(row.sha256===old.sha256){catalog.discard(row);unchanged.push(old.name);}else staged.push({old,row,done:false});}catch(e){failed.push(`${old.name}：${e.message}`);}}
  if(!staged.length)return {updated:[],unchanged,noSource,failed,stopped:[]};
  const stop=new Map();for(const {old} of staged)for(const x of usersOf(controller,old.id).running)stop.set(x.id,x);const running=[...stop.values()];
  const detail=[...staged.map(({old,row})=>`● ${old.name}\n    ${changes(old,row).lines.join('\n    ')}`),unchanged.length?'已是最新：'+unchanged.join('、'):'',noSource.length?'未记录来源（请在卡片上单独刷新并选择文件夹）：'+noSource.join('、'):'',failed.length?'读取失败：\n'+failed.join('\n'):'',stopLine(running,true),'各实例中扩展已保存的数据和启用范围保留不变。'].filter(Boolean).join('\n\n');
  const answer=await dialog.showMessageBox(window,{type:staged.some(({old,row})=>changes(old,row).risky)?'warning':'question',title:'更新浏览器扩展',message:`发现 ${staged.length} 个扩展有新版本，全部更新？`,detail,buttons:['取消','全部更新并重启'],defaultId:1,cancelId:0,noLink:true});
  if(answer.response!==1||controller.disposing)return {cancelled:true};
  await stopAll(controller,running);const updated=[];
  for(const p of staged){try{catalog.replace(p.old.id,p.row);p.done=true;controller.extensions.forget(p.old.id);updated.push({name:p.row.name,from:p.old.version,version:p.row.version});}catch(e){failed.push(`${p.old.name}：${e.message}`);}}
  const restart=await restartAll(controller,running);
  return {updated,unchanged,noSource,failed,stopped:running.map(x=>x.name),...restart};
 }finally{for(const p of staged)if(!p.done)catalog.discard(p.row);}
}

async function reveal(controller,shell,extensionId){const row=controller.extensions.catalog.get(extensionId);if(!row.source||!fs.existsSync(row.source))throw Error(row.source?`来源文件夹不存在：${row.source}；可点「刷新」重新选择`:'还没有记录来源文件夹；点「刷新」选择一次后会记住');if(path.extname(row.source).toLowerCase()==='.zip'){shell.showItemInFolder(row.source);return;}const error=await shell.openPath(row.source);if(error)throw Error('无法打开来源文件夹：'+error);}
module.exports={refreshOne,refreshAll,reveal};
