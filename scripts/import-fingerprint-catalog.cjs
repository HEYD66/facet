'use strict';
// Read JSON only. Never execute source tools or retain account/network fields.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {normalizeId}=require('../src/main/gpu-identity.cjs');
// Keeps the PCI device ID the renderer carries ("(0x00002484)"): real Chrome reports it in the
// WebGL renderer, and Dawn derives the WebGPU architecture from it.
function gpuRecord(row){
 const vendor=row.webGLManufacturer??row.gpuVendor,renderer=row.webGLRender??row.gpuRender;
 const brand=/^Google Inc\. \((NVIDIA|AMD|Intel)\)$/.exec(vendor||'')?.[1];
 if(!brand||typeof renderer!=='string'||!renderer.startsWith('ANGLE ('+brand+', ')||!renderer.includes('Direct3D11 vs_5_0 ps_5_0'))return null;
 const head=renderer.slice(('ANGLE ('+brand+', ').length).split(' Direct3D11')[0];
 const ids=[...head.matchAll(/\((0x[0-9a-f]+)\)/ig)].map(m=>normalizeId(m[1])).filter(Boolean);
 const model=head.replace(/\s*\(0x[0-9a-f]+\)/ig,'').trim();
 if(model.length>120||!/^[\w ().+/-]+$/.test(model))return null;
 if(!(brand==='NVIDIA'&&/^NVIDIA (GeForce|Quadro|RTX|NVS)/.test(model)||brand==='AMD'&&/(AMD|ATI|Radeon)/.test(model)||brand==='Intel'&&/^Intel/.test(model)))return null;
 return ids.length===1?{brand,model,id:ids[0]}:{brand,model};
}
// names: optional source names by position (kept stable when a source folder is renamed).
function build(files,{names=[]}={}){
 const gpus=new Map(),sources=[];
 for(const [index,file] of files.entries()){
  const raw=fs.readFileSync(file),rows=JSON.parse(raw);if(!Array.isArray(rows))throw Error('指纹来源必须是 JSON 数组');
  let accepted=0;for(const row of rows){const gpu=gpuRecord(row);if(!gpu)continue;accepted++;
   const key=gpu.brand+'|'+gpu.model.toLowerCase(),known=gpus.get(key),ids=new Set(known?.ids||[]);if(gpu.id)ids.add(gpu.id);
   gpus.set(key,{brand:gpu.brand,model:gpu.model,...(ids.size?{ids:[...ids].sort()}:{})});}
  sources.push({name:names[index]||path.basename(path.dirname(file)),sha256:crypto.createHash('sha256').update(raw).digest('hex'),rows:rows.length,accepted});
 }
 if(!gpus.size)throw Error('未找到可用的 Windows D3D11 显卡记录');
 return {schemaVersion:2,sources,gpus:[...gpus.values()].sort((a,b)=>(a.brand+'|'+a.model).localeCompare(b.brand+'|'+b.model,'en'))};
}
if(require.main===module){const [output,...files]=process.argv.slice(2);if(!output||!files.length)throw Error('用法：node scripts/import-fingerprint-catalog.cjs <输出JSON> <来源JSON...>');if(fs.existsSync(output))throw Error('输出文件已存在，请先备份并选择新的输出路径');const catalog=build(files);fs.writeFileSync(output,JSON.stringify(catalog,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({gpus:catalog.gpus.length,withIds:catalog.gpus.filter(g=>g.ids).length,sources:catalog.sources,output:path.resolve(output)},null,2));}
module.exports={gpuRecord,build};
