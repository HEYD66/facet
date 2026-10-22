'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {LANGUAGES,environment}=require('./environment.cjs');
const DEFAULT_INSTANCE_URL='https://ipip.la/disguise.html';
function notes(value){if(typeof value!=='string'||value.length>10000||value.includes('\0'))throw Error('备注需为文本，最多 10000 个字符');return value;}
function safeURL(value){let s=String(value||'').trim();if(!s)throw Error('请输入网址');if(!/^[a-z][a-z\d+.-]*:/i.test(s))s='https://'+s;const u=new URL(s);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('仅允许不含用户名密码的 HTTP/HTTPS 网址');return u.href;}
function networkConfig(value){
 if(!value||typeof value!=='object'||!['direct','mihomo'].includes(value.mode))throw Error('实例网络配置无效，已阻止启动；请修复配置或恢复备份');
 if(typeof value.nodeName!=='string')throw Error('实例网络配置无效，节点名称格式错误');
 return {mode:value.mode,nodeName:value.nodeName};
}
const {atomic}=require('./json-storage.cjs');
function parseStoreData(raw){
 if(Array.isArray(raw))raw={version:1,instances:raw};
 if(!raw||typeof raw!=='object'||!Array.isArray(raw.instances))throw Error('配置版本不支持，未覆盖原文件');
 // Version 0/omitted files from early builds had the same instance shape.
 if(raw.version===undefined||raw.version===0)raw={...raw,version:1};
 if(raw.version!==1)throw Error('配置版本不支持，未覆盖原文件');
 return raw;
}
function validateStoreData(raw) {
 const data=parseStoreData(raw),ids=new Set();
 const instances=data.instances.map(value=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||
     !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.id)||ids.has(value.id))throw Error('实例 ID 无效或重复');
  if(value.autoStart!==undefined&&typeof value.autoStart!=='boolean')throw Error('随应用启动设置必须为布尔值');
  ids.add(value.id);
  return {...value,autoStart:value.autoStart===true,notes:notes(value.notes??''),network:networkConfig(value.network),environment:environment(value.environment),url:safeURL(value.url),...(value.browserTabs!==undefined?{browserTabs:require('./browser-tabs-state.cjs').normalize(value.browserTabs)}:{})};
 });
 return {...data,instances};
}
function readStoreFile(file) {
 let raw,readError;
 try { raw=JSON.parse(fs.readFileSync(file,'utf8')); }
 catch(error) {
  // Unsupported versions, invalid networks and permission/I/O failures are not
  // reasons to silently roll back to an older configuration.
  if(!(error instanceof SyntaxError)&&error.code!=='ENOENT')throw error;
  readError=error;
 }
 if(!readError)return {data:validateStoreData(raw),recovered:false};
 let data;
 try { data=validateStoreData(JSON.parse(fs.readFileSync(file+'.bak','utf8'))); }
 catch(cause) { throw new Error('实例配置损坏或缺失，且备份不可用；原文件已保留，请人工恢复', {cause}); }
 // Validate ALL instances first. Do not replace the good backup with corrupt
 // primary bytes; recovery itself must also use a flushed, atomic replacement.
 atomic(file,data,{backup:false});
 return {data,recovered:true};
}
class Store {
 constructor(dir){this.dir=dir;this.file=path.join(dir,'instances.json');this.data={version:1,instances:[]};this.recovered=false;if(fs.existsSync(this.file)||fs.existsSync(this.file+'.bak')){const result=readStoreFile(this.file);this.data=result.data;this.recovered=result.recovered;}}
 save(){atomic(this.file,this.data);}
 commit(data){
  try{atomic(this.file,data);}catch(error){if(error.atomicWriteCommitted)this.data=data;throw error;}
  this.data=data;
 }
 list(){return this.data.instances;}
 get(id){const x=this.list().find(x=>x.id===id);if(!x)throw Error('实例不存在');return x;}
 name(value,id){const name=String(value||'').trim();if(!name||name.length>40)throw Error('名称必须为1–40个字符');if(this.list().some(x=>x.id!==id&&x.name===name))throw Error('实例名称重复');return name;}
 create(name,network,plannedEnvironment){const x={id:crypto.randomUUID(),name:this.name(name),autoStart:false,notes:'',url:DEFAULT_INSTANCE_URL,network:networkConfig(network===undefined?{mode:'direct',nodeName:''}:network),environment:environment(plannedEnvironment===undefined?{}:plannedEnvironment)};this.commit({...this.data,instances:[...this.list(),x]});return x;}
 setResetPending(id,value){this.get(id);const pending=value?{environment:environment(value.environment),startedAt:String(value.startedAt)}:null;this.commit({...this.data,instances:this.list().map(row=>row.id===id?{...row,resetPending:pending}:row)});}
 update(id,patch){const original=this.get(id),x={...original};if(patch.notes!==undefined)x.notes=notes(patch.notes);if(patch.autoStart!==undefined){if(typeof patch.autoStart!=='boolean')throw Error('随应用启动设置必须为布尔值');x.autoStart=patch.autoStart;}if(patch.name!==undefined)x.name=this.name(patch.name,id);if(patch.url!==undefined)x.url=safeURL(patch.url);if(patch.browserTabs!==undefined)x.browserTabs=require('./browser-tabs-state.cjs').normalize(patch.browserTabs);if(patch.environment)x.environment=environment(patch.environment);if(patch.muted!==undefined){if(patch.muted)x.muted=true;else delete x.muted;}if(patch.volume!==undefined){const v=Math.round(Number(patch.volume));if(!Number.isFinite(v)||v<0||v>100)throw Error('音量必须是 0–100');if(v===100)delete x.volume;else x.volume=v;}if(patch.network){if(!['direct','mihomo'].includes(patch.network.mode))throw Error('不支持的网络模式');x.network={mode:patch.network.mode,nodeName:String(patch.network.nodeName||'')};}this.commit({...this.data,instances:this.list().map(row=>row.id===id?x:row)});return x;}
 // 全部静音（顶部按钮）：存在 instances.json 顶层，重启后保持。
 get muted(){return this.data.muted===true;}
 setMuted(value){const data={...this.data};if(value)data.muted=true;else delete data.muted;this.commit(data);}
 remove(id){this.get(id);this.commit({...this.data,instances:this.list().filter(x=>x.id!==id)});}
 proxyFile(id){this.get(id);return path.join(this.dir,'proxy-sources',id+'.json');}
 importNodes(id,text){const nodes=parseNodes(text);this.saveNodes(id,nodes,null);return nodes.map(n=>n.name);}
 saveNodes(id,nodes,subscription,assignment=null){this.sourceCache?.delete(id);atomic(this.proxyFile(id),{version:1,nodes,subscription,assignment});}
 // 状态推送很频繁：节点文件按修改时间和大小缓存，未变化时不再重复读取解析。
 source(id){const p=this.proxyFile(id);let st;try{st=fs.statSync(p);}catch{this.sourceCache?.delete(id);return {nodes:[],subscription:null};}const hit=this.sourceCache?.get(id);if(hit&&hit.mtime===st.mtimeMs&&hit.size===st.size)return hit.data;const raw=JSON.parse(fs.readFileSync(p,'utf8'));let data;if(Array.isArray(raw))data={nodes:raw,subscription:null};else{if(raw.version!==1||!Array.isArray(raw.nodes))throw Error('节点配置格式无效，请重新导入');data=raw;}(this.sourceCache??=new Map()).set(id,{mtime:st.mtimeMs,size:st.size,data});return data;}
 subscriptionSummary(id){const sub=this.source(id).subscription;if(!sub)return null;return {host:new URL(sub.url).host,updatedAt:sub.updatedAt};}

 nodes(id){return this.source(id).nodes;}
}
function parseNodes(text){if(Buffer.byteLength(text)>2*1024*1024)throw Error('配置文件上限2MB');const yaml=require('js-yaml');let config;try{config=yaml.load(text,{schema:yaml.JSON_SCHEMA});}catch{throw Error('配置 YAML/JSON 无法解析，请检查格式');}if(!config||!Array.isArray(config.proxies)||!config.proxies.length)throw Error('需要含 proxies 节点列表的 Clash YAML/JSON；暂不支持仅 proxy-providers 的订阅文件');if(config.proxies.length>3000)throw Error('节点数量过多');const names=new Set();const nodes=config.proxies.map(p=>{if(!p||typeof p!=='object'||!p.name||!p.type||!p.server||!p.port)throw Error('节点缺少 name/type/server/port');if(typeof p.name!=='string'||names.has(p.name))throw Error('节点名称无效或重复');if(!['http','socks5','ss','ssr','vmess','vless','trojan','hysteria','hysteria2','tuic','wireguard','ssh','snell','anytls','mieru'].includes(p.type))throw Error('节点协议不支持；不能把 DIRECT 或策略组当作代理节点');if(p['dialer-proxy'])throw Error('暂不支持依赖其他节点的 dialer-proxy');names.add(p.name);let count=0;const chain=new Set();function copy(v,depth=0){if(++count>20000||depth>16)throw Error('节点结构过深或过大');if(v===null||typeof v!=='object')return v;if(chain.has(v))throw Error('配置包含循环引用');chain.add(v);const out=Array.isArray(v)?v.map(x=>copy(x,depth+1)):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,copy(x,depth+1)]));chain.delete(v);return out;}const node=copy(p);for(const key of ['password','uuid','username'])if(node[key]!==undefined)node[key]=String(node[key]);return node;});return nodes;}
module.exports={notes,Store,environment,safeURL,networkConfig,atomic,LANGUAGES,parseNodes,DEFAULT_INSTANCE_URL};
