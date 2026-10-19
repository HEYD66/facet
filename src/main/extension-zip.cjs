'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{Transform}=require('node:stream'),{pipeline}=require('node:stream/promises');
const LIMIT=500*1024*1024,COUNT=50000;
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function safeName(name){
 if(typeof name!=='string'||!name||name.includes('\\')||/[:\x00-\x1f]/.test(name)||name.startsWith('/'))throw Error('ZIP 包含不安全路径');
 const parts=name.replace(/\/$/,'').split('/');
 if(parts.length>64||parts.some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/[<>"|?*]/.test(p)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)))throw Error('ZIP 包含不安全路径');
 return parts.join('/');
}
async function stageSource(catalog,source,replacing=null){
 if(fs.lstatSync(source).isDirectory())return catalog.stage(source,replacing);
 if(path.extname(source).toLowerCase()!=='.zip')throw Error('请选择 ZIP 扩展文件');
 if(fs.statSync(source).size>LIMIT)throw Error('ZIP 文件超过 500MB 上限');
 const zip=await require('unzipper').Open.file(source);if(zip.files.length>COUNT)throw Error('ZIP 文件数量超过 50000 上限');
 const names=new Set();let declared=0;
 const entries=zip.files.map(entry=>{const name=safeName(entry.path),key=name.toLowerCase();if(names.has(key))throw Error('ZIP 包含重复路径');names.add(key);
 const mode=(entry.externalFileAttributes>>>16)&0xf000;if(mode&&mode!==0x8000&&mode!==0x4000)throw Error('ZIP 不允许符号链接或特殊文件');
 if(entry.flags&1)throw Error('不支持加密 ZIP');if(![0,8].includes(entry.compressionMethod))throw Error('ZIP 压缩方式不受支持');
 declared+=entry.uncompressedSize;if(!Number.isSafeInteger(declared)||declared>LIMIT)throw Error('ZIP 解压大小超过 500MB 上限');return {entry,name};});
 const manifests=entries.filter(x=>x.entry.type!=='Directory'&&path.posix.basename(x.name)==='manifest.json'&&!x.name.startsWith('__MACOSX/'));
 const selected=manifests.find(x=>x.name==='manifest.json')||(manifests.length===1?manifests[0]:null);
 if(!selected)throw Error(manifests.length?'ZIP 包含多个扩展，请分别导入':'ZIP 中没有 manifest.json');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-extension-zip-'));let total=0;
 try{for(const {entry,name} of entries){const dest=path.resolve(root,...name.split('/'));if(!dest.startsWith(root+path.sep))throw Error('ZIP 路径越界');if(entry.type==='Directory'){fs.mkdirSync(dest,{recursive:true});continue;}
 fs.mkdirSync(path.dirname(dest),{recursive:true});let bytes=0,crc=0xffffffff;
 const guard=new Transform({transform(chunk,encoding,done){bytes+=chunk.length;total+=chunk.length;if(total>LIMIT||bytes>entry.uncompressedSize)return done(Error('ZIP 实际解压大小超出声明或上限'));for(const byte of chunk)crc=table[(crc^byte)&255]^(crc>>>8);done(null,chunk);}});
 await pipeline(entry.stream(),guard,fs.createWriteStream(dest,{flags:'wx'}));if(bytes!==entry.uncompressedSize||((crc^0xffffffff)>>>0)!==entry.crc32)throw Error('ZIP 文件损坏（大小或 CRC 不匹配）');
 }
 const row=catalog.stage(path.join(root,path.posix.dirname(selected.name)),replacing);row.source=path.resolve(source);return row;
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
module.exports={stageSource,safeName};
