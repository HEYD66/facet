'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {atomic}=require('./store.cjs');
const LIMIT=500*1024*1024,ENTRY_LIMIT=50000,DEPTH_LIMIT=64;
const DANGEROUS_PERMISSIONS=new Set(['nativeMessaging','debugger','proxy','webRequestBlocking','management','downloads','clipboardRead','clipboardWrite','privacy','enterprise.platformKeys']);
const GLOBAL_MATCHES=new Set(['<all_urls>','*://*/*','http://*/*','https://*/*']);
// Development-only folders/files that an unpacked extension never needs at runtime; skipped on import and reported.
const SKIP_DIRS=new Set(['.git','.svn','.hg','.vscode','.idea','node_modules','__pycache__']),SKIP_FILES=new Set(['.DS_Store','Thumbs.db','desktop.ini']);
const sizeText=b=>b>=1024**3?(b/1024**3).toFixed(1)+' GB':b>=1024**2?(b/1024**2).toFixed(b>=100*1024**2?0:1).replace(/\.0$/,'')+' MB':Math.max(1,Math.ceil(b/1024))+' KB';
function localPage(value){if(typeof value!=='string'||!value||value.length>1024||/[\\%?#\x00-\x1f]/.test(value)||value.startsWith('/')||value.includes(':')||value.split('/').some(x=>x==='..'||x==='.'||!x))throw Error('扩展页面必须是扩展目录内的相对路径');return value;}
// Files Chromium reads while loading an extension; one missing file makes loadExtension fail for
// every instance that enables it (verified on Electron 44: content js/css, background service worker
// or scripts, manifest and action icons, DNR rule files; side_panel/devtools pages are not checked).
function referencedFiles(m){
 const out=[],add=v=>{if(typeof v==='string'&&v.trim())out.push(v.trim());},list=v=>{if(Array.isArray(v))v.forEach(add);},icons=v=>{if(typeof v==='string')add(v);else if(v&&typeof v==='object')Object.values(v).forEach(add);};
 icons(m.icons);for(const a of [m.action,m.browser_action,m.page_action])icons(a?.default_icon);
 add(m.background?.service_worker);add(m.background?.page);list(m.background?.scripts);
 for(const c of Array.isArray(m.content_scripts)?m.content_scripts:[]){list(c?.js);list(c?.css);}
 for(const r of Array.isArray(m.declarative_net_request?.rule_resources)?m.declarative_net_request.rule_resources:[])add(r?.path);
 return [...new Set(out)];
}
function missingFiles(folder,manifest){
 let m=manifest;if(!m){try{m=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8').replace(/^\uFEFF/,''));}catch{return [];}}
 const root=path.resolve(folder);
 return referencedFiles(m).filter(raw=>{const file=path.resolve(root,raw.replace(/^\.?\//,''));if(file!==root&&!file.startsWith(root+path.sep))return true;try{return !fs.statSync(file).isFile();}catch{return true;}});
}
function incompleteMessage(missing){return `扩展文件不完整，Chromium 无法加载：清单引用的 ${missing.length} 个文件不存在（${missing.slice(0,5).join('、')}${missing.length>5?' 等':''}）。如果这是从完整扩展里拆出的部分文件，请导入完整的扩展文件夹`;}
function inspect(folder){const file=path.join(folder,'manifest.json');if(!fs.existsSync(file)||fs.statSync(file).size>1024*1024)throw Error('请选择包含manifest.json的解压扩展文件夹（清单上限1MB）');let m;try{m=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error('扩展manifest.json不是有效JSON');}if(![2,3].includes(m.manifest_version)||typeof m.name!=='string'||!m.name.trim()||m.name.length>200||typeof m.version!=='string'||m.version.length>50)throw Error('扩展名称、版本或manifest_version无效');
 const entries={};for(const [key,value]of Object.entries({popup:m.action?.default_popup||m.browser_action?.default_popup||m.page_action?.default_popup,options:m.options_ui?.page||m.options_page})){if(value){entries[key]=localPage(value);if(!fs.statSync(path.join(folder,entries[key])).isFile())throw Error('扩展界面文件不存在');}}
 for(const key of ['permissions','host_permissions','optional_permissions','optional_host_permissions','content_scripts'])if(m[key]!==undefined&&!Array.isArray(m[key]))throw Error('扩展权限或脚本清单无效');
 const missing=missingFiles(folder,m);if(missing.length)throw Error(incompleteMessage(missing));
 const permissions=[...(m.permissions||[]),...(m.host_permissions||[])];if(permissions.some(x=>typeof x!=='string')||permissions.length>500)throw Error('扩展权限清单无效');const matches=(m.content_scripts||[]).flatMap(x=>x.matches||[]);if(matches.some(x=>typeof x!=='string')||matches.length>500)throw Error('内容脚本范围无效');
 const optionalPermissions=[...(m.optional_permissions||[]),...(m.optional_host_permissions||[])].map(String).slice(0,500),riskPermissions=[...new Set([...permissions,...optionalPermissions].filter(x=>DANGEROUS_PERMISSIONS.has(x)))],globalMatches=[...new Set([...matches,...permissions,...optionalPermissions].filter(x=>GLOBAL_MATCHES.has(x)))],riskLevel=riskPermissions.length||globalMatches.length?'high':matches.length?'medium':'low';
 let name=m.name;if(/^__MSG_(.+)__$/.test(name)&&m.default_locale&&/^[a-zA-Z0-9_-]+$/.test(m.default_locale)){try{const messages=JSON.parse(fs.readFileSync(path.join(folder,'_locales',m.default_locale,'messages.json'),'utf8'));name=messages[name.slice(6,-2)]?.message||name;}catch{}}
 const compatibilityNotice=name==='Dark Reader'&&m.version==='4.9.133'?'官方 Dark Reader 4.9.133 在当前 Electron 的 Linux 初测未通过：后台窗口API报错、面板停留在加载中、网页未变暗。Windows仍待实测；不能视为可用。':'';
 const warnings=['Electron仅支持部分扩展API；已加载不代表功能全部兼容。',...(riskPermissions.length?[`高风险权限需要逐项审查：${riskPermissions.join(', ')}`]:[]),...(globalMatches.length?[`扩展可注入全站网页范围：${globalMatches.join(', ')}`]:[]),...(m.background?.service_worker?['此扩展使用MV3 Service Worker；必须实际验证后台功能。']:[]),...(permissions.includes('nativeMessaging')?['原生程序通信不受支持。']:[])];
 return {compatibilityNotice,name:String(name).slice(0,200),version:m.version,manifestVersion:m.manifest_version,permissions:[...new Set(permissions)],optionalPermissions,matches:[...new Set(matches)],entries,key:m.key||null,riskLevel,riskPermissions,globalMatches,requiresElevatedReview:riskLevel==='high',warnings};}
const ICON_TYPES={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml'},ICON_LIMIT=64*1024;
function extensionIcon(folder){try{const m=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8')),found=[];
 for(const v of [m.icons,m.action?.default_icon,m.browser_action?.default_icon,m.page_action?.default_icon]){if(typeof v==='string')found.push([0,v]);else if(v&&typeof v==='object')for(const [k,p]of Object.entries(v))if(typeof p==='string')found.push([Number(k)||0,p]);}
 const big=found.filter(x=>x[0]>=32).sort((a,b)=>a[0]-b[0]),rest=found.filter(x=>x[0]<32).sort((a,b)=>b[0]-a[0]);
 for(const [,raw]of [...big,...rest]){try{const rel=localPage(raw.replace(/^\.?\//,'')),type=ICON_TYPES[path.extname(rel).slice(1).toLowerCase()];if(!type)continue;const file=path.join(folder,rel),st=fs.lstatSync(file);if(!st.isFile()||st.size>ICON_LIMIT||!st.size)continue;return 'data:'+type+';base64,'+fs.readFileSync(file).toString('base64');}catch{}}
}catch{}return null;}
class ExtensionCatalog{
 constructor(dir){this.base=path.join(dir,'extensions-packages');this.file=path.join(dir,'extensions.json');fs.mkdirSync(this.base,{recursive:true});this.data=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{items:[],enabled:{}};if(!Array.isArray(this.data.items)||!this.data.enabled||this.data.items.some(x=>!/^ext-[a-f0-9-]+$/.test(x.id)))throw Error('扩展目录索引无效');}
 commit(data){atomic(this.file,data);this.data=data;}
 get(id){const row=this.data.items.find(x=>x.id===id);if(!row)throw Error('扩展不存在');return row;}
 folder(id){this.get(id);return path.join(this.base,id);}
 stage(source,replacing=null){if(!replacing&&this.data.items.length>=20)throw Error('扩展上限20个');const id='ext-'+crypto.randomUUID(),dest=path.join(this.base,id);let count=0,bytes=0;const digest=crypto.createHash('sha256');
 try{if(!fs.lstatSync(source).isDirectory())throw Error('请选择解压后的扩展文件夹');const relative=path.relative(fs.realpathSync(source),dest);if(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))throw Error('不能导入包含应用扩展存储目录的父文件夹');
  if(!fs.existsSync(path.join(source,'manifest.json'))){const found=[];try{for(const n of fs.readdirSync(source).sort()){const d=path.join(source,n);try{if(fs.lstatSync(d).isDirectory()&&fs.existsSync(path.join(d,'manifest.json')))found.push(n);}catch{}if(found.length>=8)break;}}catch{}
   throw Error('请选择包含manifest.json的解压扩展文件夹：所选文件夹的根目录没有 manifest.json'+(found.length?'。里面这些子文件夹是扩展，请选其中一个：'+found.join('、'):''));}
  // node_modules is only skipped when the manifest does not point into it.
  const keepModules=fs.readFileSync(path.join(source,'manifest.json'),'utf8').includes('node_modules'),skip=n=>SKIP_DIRS.has(n)&&!(n==='node_modules'&&keepModules);
  // Pass 1: sizes only, so an oversize folder is rejected before anything is copied and the message can say why.
  const top=new Map(),skipped=new Map();
  const scan=(src,rel,depth,bucket)=>{if(depth>DEPTH_LIMIT)throw Error('扩展目录层级超过'+DEPTH_LIMIT+'层');const st=fs.lstatSync(src);if(st.isSymbolicLink())throw Error('扩展不允许符号链接或目录联接');count++;
   if(st.isDirectory()){for(const n of fs.readdirSync(src)){const child=path.join(src,n),r=rel?rel+'/'+n:n,isDir=fs.lstatSync(child).isDirectory(),b=bucket??(isDir?n:null);
     if(isDir?skip(n):SKIP_FILES.has(n)){let size=0;const measure=x=>{const t=fs.lstatSync(x);if(t.isSymbolicLink())return;if(t.isDirectory())for(const m of fs.readdirSync(x))measure(path.join(x,m));else size+=t.size;};try{measure(child);}catch{}skipped.set(r,size);continue;}
     scan(child,r,depth+1,b);}}
   else if(st.isFile()){bytes+=st.size;top.set(bucket,(top.get(bucket)||0)+st.size);}else throw Error('扩展包含不支持的文件类型');};
  scan(source,'',0,null);count--;
  if(bytes>LIMIT||count>ENTRY_LIMIT){const biggest=[...top].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([n,b])=>(n??'根目录文件')+'（'+sizeText(b)+'）').join('、');
   throw Error(`扩展文件夹共 ${sizeText(bytes)} / ${count} 个文件和目录，超过上限 500MB / ${ENTRY_LIMIT} 个。占用最多：${biggest}`);}
  // Pass 2: stream-copy in chunks (large model files never sit in memory) and hash exactly what was copied.
  const buffer=Buffer.allocUnsafe(4*1024*1024);
  const copy=(src,out,rel)=>{const st=fs.lstatSync(src);if(st.isSymbolicLink())throw Error('扩展不允许符号链接或目录联接');
   if(st.isDirectory()){fs.mkdirSync(out);for(const n of fs.readdirSync(src).sort()){const child=path.join(src,n),r=rel+'/'+n;if(skipped.has(r.slice(1)))continue;copy(child,path.join(out,n),r);}}
   else if(st.isFile()){const input=fs.openSync(src,'r'),output=fs.openSync(out,'wx');let total=0;digest.update(rel).update('\0');try{for(;;){const n=fs.readSync(input,buffer,0,buffer.length,null);if(!n)break;total+=n;digest.update(buffer.subarray(0,n));fs.writeSync(output,buffer,0,n);}}finally{fs.closeSync(input);fs.closeSync(output);}if(total!==st.size)throw Error('扩展文件正在改变，请关闭编辑程序后重试');}
   else throw Error('扩展包含不支持的文件类型');};
  copy(source,dest,'');
  const info=inspect(dest),sha256=digest.digest('hex');if(this.data.items.some(x=>x.id!==replacing&&(x.sha256===sha256||info.key&&x.key===info.key)))throw Error('此扩展或同一签名的版本已导入；请先停用并移除旧版本');
  return {id,...info,source:path.resolve(source),sha256,bytes,files:count,skipped:[...skipped].map(([name,size])=>({name,size})),importedAt:new Date().toISOString()};}catch(e){fs.rmSync(dest,{recursive:true,force:true});throw e;}}
 accept(row){this.commit({...this.data,items:[...this.data.items,row]});}
 // Refresh in place: the package folder path (and so the Chromium extension ID and its saved data) stays the same.
 replace(id,row){const old=this.get(id),dir=path.join(this.base,id),staged=path.join(this.base,row.id),trash=path.join(this.base,id+'.old-'+Date.now());
  try{fs.renameSync(dir,trash);}catch{throw Error('扩展文件被占用，无法替换；请关闭扩展面板或相关实例后重试');}
  try{fs.renameSync(staged,dir);}catch{fs.renameSync(trash,dir);throw Error('新版本文件无法放入扩展目录，已保留旧版本');}
  const next={...row,id,defaultEnabled:old.defaultEnabled===true,importedAt:old.importedAt,updatedAt:new Date().toISOString()};
  try{this.commit({...this.data,items:this.data.items.map(x=>x.id===id?next:x)});}catch(e){fs.renameSync(dir,staged);fs.renameSync(trash,dir);throw e;}
  fs.rmSync(trash,{recursive:true,force:true});return next;}
 setSource(id,source){this.get(id);this.commit({...this.data,items:this.data.items.map(x=>x.id===id?{...x,source}:x)});}
 discard(row){fs.rmSync(path.join(this.base,row.id),{recursive:true,force:true});}
 setDefaultEnabled(id,enabled){const row=this.get(id);if(typeof enabled!=='boolean')throw Error('默认启用状态无效');if(enabled){const missing=missingFiles(this.folder(id));if(missing.length)throw Error(incompleteMessage(missing)+'；不能设为默认启用');}if((row.defaultEnabled===true)===enabled)return {extensionId:id,enabled,changed:false};this.commit({...this.data,items:this.data.items.map(x=>x.id===id?{...x,defaultEnabled:enabled}:x)});return {extensionId:id,enabled,changed:true};}
 applyDefaults(instanceId){const ids=this.data.items.filter(x=>x.defaultEnabled===true).map(x=>x.id);if(!ids.length)return;const enabled=[...new Set([...this.enabled(instanceId),...ids])];this.commit({...this.data,enabled:{...this.data.enabled,[instanceId]:enabled}});}
 setEnabled(instanceId,id,enabled){this.get(id);if(typeof enabled!=='boolean')throw Error('启用状态无效');const set=new Set(this.data.enabled[instanceId]||[]);enabled?set.add(id):set.delete(id);this.commit({...this.data,enabled:{...this.data.enabled,[instanceId]:[...set]}});}
 enabled(id){return this.data.enabled[id]||[];}
 forget(id){const enabled={...this.data.enabled};delete enabled[id];this.commit({...this.data,enabled});}
 remove(id,{disableAll=false}={}){this.get(id);if(!disableAll&&Object.values(this.data.enabled).some(list=>list.includes(id)))throw Error('请先在所有实例中停用此扩展');
  const dir=path.join(this.base,id),trash=path.join(this.base,id+'.remove-'+crypto.randomUUID()),exists=fs.existsSync(dir);
  // Rename before metadata commit; a locked package cannot leave a removed catalog entry.
  if(exists)fs.renameSync(dir,trash);
  const enabled=Object.fromEntries(Object.entries(this.data.enabled).map(([key,list])=>[key,list.filter(x=>x!==id)]));
  try{this.commit({...this.data,items:this.data.items.filter(x=>x.id!==id),enabled});}catch(error){if(exists)fs.renameSync(trash,dir);throw error;}
  let cleanupPending=false;if(exists)try{fs.rmSync(trash,{recursive:true,force:true,maxRetries:2});}catch{cleanupPending=true;}
  return {removed:true,cleanupPending};}
}
module.exports={ExtensionCatalog,inspect,localPage,extensionIcon,sizeText,missingFiles,incompleteMessage,DANGEROUS_PERMISSIONS,GLOBAL_MATCHES};
