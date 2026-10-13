'use strict';
// Read JSON only. Never execute source tools or retain account/network fields.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function gpuRecord(row){
 const vendor=row.webGLManufacturer??row.gpuVendor,renderer=row.webGLRender??row.gpuRender;
 const brand=/^Google Inc\. \((NVIDIA|AMD|Intel)\)$/.exec(vendor||'')?.[1];
 if(!brand||typeof renderer!=='string'||!renderer.startsWith('ANGLE ('+brand+', ')||!renderer.includes('Direct3D11 vs_5_0 ps_5_0'))return null;
 const model=renderer.slice(('ANGLE ('+brand+', ').length).split(' Direct3D11')[0].replace(/\s*\(0x[0-9a-f]+\)/ig,'').trim();
 if(model.length>120||!/^[\w ().+/-]+$/.test(model))return null;
 if(!(brand==='NVIDIA'&&/^NVIDIA (GeForce|Quadro|RTX|NVS)/.test(model)||brand==='AMD'&&/(AMD|ATI|Radeon)/.test(model)||brand==='Intel'&&/^Intel/.test(model)))return null;
 return {brand,model};
}
function build(files){
 const gpus=new Map(),sources=[];
 for(const file of files){
  const raw=fs.readFileSync(file),rows=JSON.parse(raw);if(!Array.isArray(rows))throw Error('指纹来源必须是 JSON 数组');
  let accepted=0;for(const row of rows){const gpu=gpuRecord(row);if(gpu){accepted++;gpus.set(gpu.brand+'|'+gpu.model.toLowerCase(),gpu);}}
  sources.push({name:path.basename(path.dirname(file)),sha256:crypto.createHash('sha256').update(raw).digest('hex'),rows:rows.length,accepted});
 }
 if(!gpus.size)throw Error('未找到可用的 Windows D3D11 显卡记录');
 return {schemaVersion:1,sources,gpus:[...gpus.values()].sort((a,b)=>(a.brand+'|'+a.model).localeCompare(b.brand+'|'+b.model,'en'))};
}
if(require.main===module){const [output,...files]=process.argv.slice(2);if(!output||!files.length)throw Error('用法：node scripts/import-fingerprint-catalog.cjs <输出JSON> <来源JSON...>');if(fs.existsSync(output))throw Error('输出文件已存在，请先备份并选择新的输出路径');const catalog=build(files);fs.writeFileSync(output,JSON.stringify(catalog,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({gpus:catalog.gpus.length,sources:catalog.sources,output:path.resolve(output)},null,2));}
module.exports={gpuRecord,build};
