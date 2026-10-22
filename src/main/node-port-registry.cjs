'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {atomic}=require('./json-storage.cjs');
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
function nodeKey(node,settings={}){const {name,...configuration}=node;return crypto.createHash('sha256').update(JSON.stringify(canonical({node:configuration,settings}))).digest('hex');}
class NodePortRegistry{
 constructor(dir){this.file=path.join(dir,'node-ports.json');this.data={version:1,enabled:false,ports:{}};try{const data=JSON.parse(fs.readFileSync(this.file,'utf8'));if(data.version!==1||typeof data.enabled!=='boolean'||!data.ports||typeof data.ports!=='object'||Array.isArray(data.ports))throw Error();const used=new Set();for(const [key,port]of Object.entries(data.ports)){if(!/^[a-f0-9]{64}$/.test(key)||!Number.isInteger(port)||port<20000||port>49000||used.has(port))throw Error();used.add(port);}this.data=data;}catch(e){if(e.code!=='ENOENT')throw Error('节点端口映射无法读取；原文件已保留，请恢复备份后重试');}}
 save(patch){const next={...this.data,...patch};try{atomic(this.file,next);}catch(error){if(error.atomicWriteCommitted)this.data=next;throw error;}this.data=next;}
 setEnabled(enabled){if(typeof enabled!=='boolean')throw Error('节点端口服务开关无效');this.save({enabled});}
 get(key){return this.data.ports[key]||null;}
 async allocate(key,reserve){const previous=this.get(key),excluded=new Set(Object.entries(this.data.ports).filter(([k])=>k!==key).map(([,p])=>p));const port=await reserve(previous,excluded);try{this.save({ports:{...this.data.ports,[key]:port}});}catch(e){e.reservedPort=port;throw e;}return {port,previous,changed:!!previous&&previous!==port};}
}
module.exports={NodePortRegistry,nodeKey,canonical};
