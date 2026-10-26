'use strict';
// What a real Chrome on Windows reports for a GPU, from the WebGL renderer string.
//
// - WebGL: `ANGLE (<Brand>, <Model> (0x<8 hex device ID>) Direct3D11 vs_5_0 ps_5_0, D3D11)`
//   (Chromium 152, measured on this machine: `ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU
//   (0x000028A0) Direct3D11 vs_5_0 ps_5_0, D3D11)`). Older Facet versions stored the string
//   without the device ID and `, D3D11`; those saved values are still parsed here.
// - WebGPU GPUAdapterInfo: vendor is the lower-case vendor name; architecture comes from the PCI
//   device ID through Dawn's src/dawn/gpu_info.json (google/dawn main, last change 2026-05-05),
//   named by Dawn's js_enum_case ("Gen 12 LP" -> "gen-12lp", "RDNA 2" -> "rdna-2"). An ID Dawn
//   does not list reports an empty architecture.
// - Without Direct3D 12 (NVIDIA Tesla/Fermi, AMD TeraScale, Intel Sandy/Ivy Bridge) there is no
//   WebGPU adapter: requestAdapter() resolves null.
const BRANDS=Object.freeze(['NVIDIA','AMD','Intel']);
// [mask, {architecture: [device IDs after mask]}] per vendor, copied from Dawn's gpu_info.json.
const DAWN=Object.freeze({
 AMD:[[0xFFF0,{'terascale-2':[0x6730,0x6740,0x6750,0x6780],'gcn-1':[0x1300,0x1310,0x6600,0x6610,0x6660,0x6790,0x6800,0x6810,0x6820,0x6830],'gcn-2':[0x6640,0x6650,0x67A0,0x67B0,0x9830,0x9850],'gcn-3':[0x6900,0x6920,0x6930,0x7300,0x9870,0x98E0],'gcn-4':[0x67C0,0x67D0,0x67E0,0x67F0,0x6980,0x6990,0x6FD0,0x9920,0x6940],'gcn-5':[0x66A0,0x6860,0x6870,0x69A0,0x15D0],'rdna-1':[0x7310,0x7340,0x7360],'rdna-2':[0x73A0,0x73B0,0x73D0,0x73E0,0x73F0,0x7400,0x7420,0x7430,0x1430,0x15E0,0x1640,0x1680,0x13C0,0x13F0],'rdna-3':[0x7440,0x7470,0x7480,0x1500,0x15B0,0x15C0,0x7450,0x1900,0x1580,0x1110],'rdna-4':[0x7550,0x7590]}],
  [0xFFFF,{'gcn-5':[0x1636,0x1638],'rdna-2':[0x163F]}]],
 Intel:[[0xFF00,{'gen-7':[0x0100,0x0400,0x0A00,0x0C00,0x0D00,0x0F00],'gen-8':[0x1600,0x2200],'gen-9':[0x1900,0x3100,0x3E00,0x5A00,0x5900,0x8700,0x9B00],'gen-11':[0x8A00,0x4500,0x4E00,0x9800],'gen-12lp':[0x4600,0x4C00,0x4900,0x9A00,0xA700],'gen-12hp':[0x4F00,0x5600],'xe-lpg':[0x7D00,0xB600],'xe-2lpg':[0x6400],'xe-2hpg':[0xE200],'xe-3lpg':[0xB000],'xe-3lpg-xs':[0xFD00]}]],
 NVIDIA:[[0xFFFFFF00,{fermi:[0x0D00],kepler:[0x0F00,0x1000,0x1100,0x1200],maxwell:[0x1300,0x1400,0x1600,0x1700],pascal:[0x1500,0x1B00,0x1C00,0x1D00],turing:[0x1E00,0x1F00,0x2100],ampere:[0x2200,0x2400,0x2500,0x2000],lovelace:[0x2600,0x2700,0x2800],blackwell:[0x2B00,0x2C00,0x2D00,0x2F00]}]],
});
const ID_PATTERN=/^0x[0-9A-F]{8}$/;
function normalizeId(value){
 const m=/^0x([0-9a-f]{1,8})$/i.exec(String(value||'').trim());
 return m?'0x'+m[1].toUpperCase().padStart(8,'0'):null;
}
function rendererString(brand,model,id){
 if(!BRANDS.includes(brand))throw Error('未知显卡厂商');
 const device=normalizeId(id);
 return device?`ANGLE (${brand}, ${model} (${device}) Direct3D11 vs_5_0 ps_5_0, D3D11)`:`ANGLE (${brand}, ${model} Direct3D11 vs_5_0 ps_5_0)`;
}
// {brand, model, id|null} for a Windows D3D11 ANGLE renderer, in either Facet format; else null.
function parseRenderer(renderer){
 const m=/^ANGLE \((NVIDIA|AMD|Intel), (.+?) Direct3D11 vs_5_0 ps_5_0(?:, D3D11)?\)$/.exec(String(renderer||''));
 if(!m)return null;
 const withId=/^(.+?) \((0x[0-9A-Fa-f]{1,8})\)$/.exec(m[2]);
 return {brand:m[1],model:withId?withId[1]:m[2],id:withId?normalizeId(withId[2]):null};
}
function dawnArchitecture(brand,id){
 const n=parseInt(String(id),16);if(!Number.isFinite(n))return '';
 for(const [mask,table] of DAWN[brand]||[])for(const [name,list] of Object.entries(table))if(list.includes((n&mask)>>>0))return name;
 return '';
}
// Hardware without Direct3D 12, by PCI device ID.
function webgpuSupportedById(brand,id){
 const n=parseInt(String(id),16);if(!Number.isFinite(n))return true;
 if(brand==='NVIDIA')return !(n<0x0FC0||n>=0x1040&&n<=0x10FF||n>=0x1200&&n<=0x127F);// Tesla, Fermi (GF1xx)
 if(brand==='AMD'){const a=dawnArchitecture(brand,id);return !(a==='terascale-2'||!a&&(n>=0x6700&&n<=0x68FF||n>=0x9400&&n<=0x99FF));}// TeraScale
 if(brand==='Intel')return !((n&0xFF00)===0x0100||(n&0xFF00)===0x0F00||n<0x0100);// Sandy/Ivy Bridge, Bay Trail
 return true;
}
// Architecture from the model name, for saved renderers without a device ID. Reports the real
// architecture; {supported:false} when the GPU has no Direct3D 12.
function architectureByName(brand,model){
 // AMD names carry "(TM)" with or without spaces; drop it so the rules see "radeon 530".
 const n=String(model||'').toLowerCase().replace(brand==='AMD'?/\(tm\)/g:/$^/,' ').replace(/\s+/g,' ').trim();
 const out=(architecture,supported=true)=>({architecture,supported});
 if(brand==='NVIDIA'){
  if(/\bgeforce 6[01]5\b|\bgts? ?4\d0\b|\bgtx ?4\d0\b|\bgtx? ?5\d0\b|\bgt ?6[12]0m?\b|\bgt ?625\b|\bgt ?63[05]m\b|\bgt ?705\b|\bgt ?720m\b/.test(n))return out('fermi',false);
  // Quadro RTX 3000/4000/5000 are Turing; check before the GeForce RTX generations.
  if(/\bquadro rtx|\brtx ?20(?!5)\d0|\bgtx ?16\d0|\bquadro t\d{3,4}\b|\btitan rtx\b/.test(n))return out('turing');
  if(/\brtx ?50\d0/.test(n))return out('blackwell');
  if(/\brtx ?40\d0|\brtx ?\d{4} ada\b/.test(n))return out('lovelace');
  if(/\brtx ?30\d0|\brtx ?2050\b|\brtx ?a\d{4}\b/.test(n))return out('ampere');
  if(/\bgtx ?10\d0|\bgt ?10[13]0\b|\bquadro p\d{3,4}\b/.test(n))return out('pascal');
  if(/\bgtx ?(745|750)\b|\bgtx ?9\d{2}|\btitan x\b|\bquadro k(620|1200|2200)\b|\bquadro m\d{3,4}\b/.test(n))return out('maxwell');
  if(/\bgtx ?[67]\d{2}|\bgt ?(630|635|640|640m|650m|710|720|730|740|740m|750m)\b|\bquadro k\d{3,4}\b|\bgtx titan\b/.test(n))return out('kepler');
  return out('');
 }
 if(brand==='AMD'){
  if(/\bhd ?[2-6]\d{3}|\bhd ?7[0-6]\d{2}|\bhd ?8[5-6][57]0d\b|\br5 ?2[23][05]\b/.test(n))return out('terascale',false);
  if(/\brx ?9\d{3}/.test(n))return out('rdna-4');
  if(/\brx ?7\d{3}|\b7[4-8]0m\b/.test(n))return out('rdna-3');
  if(/\brx ?6\d{3}|\b6[1-8]0m\b/.test(n))return out('rdna-2');
  if(/\brx ?5[5-7]00|\bpro 5[3-6]00m\b|\bpro 5500 xt\b/.test(n))return out('rdna-1');
  if(/\bvega m g[hl]\b/.test(n))return out('gcn-4');
  if(/\bvega\b/.test(n))return out('gcn-5');
  if(/\bfury\b|\br9 ?(285|380)\b|\br9 m395x\b|\br5 m315\b|\bradeon(?: \(tm\))? 530\b/.test(n))return out('gcn-3');
  if(/\brx ?[45][5-9]0|\brx ?4[6-8]0|\brx ?640\b|\bpro 4[56][05]\b|\bpro 5[5-8][05]x?\b|\bpro wx ?[2-7]100\b|\bwx 5100\b|\bradeon(?: \(tm\))? 5[45]0x?\b|\b540x\b/.test(n))return out('gcn-4');
  if(/\br9 ?(290|295|390|360)\b|\br7 ?(260|360)\b|\bhd ?7790\b|\bhd ?8[2-4]\d0\b|\bhd ?8[2-4]00 \/ r3\b|\br[23]e?\b(?: graphics)?|\br1e graphics\b/.test(n))return out('gcn-2');
  if(/\bhd ?7[7-9]\d{2}|\bhd ?8[5-9]\d0m?\b|\bfirepro\b|\br[579] ?(m\d{3}x?|\d{3}x?)\b|\br[4-7] graphics\b|\br9 200\b|\bradeon 520\b/.test(n))return out('gcn-1');
  return out('');
 }
 if(brand==='Intel'){
  if(/\bhd graphics (2000|2500|3000|4000)\b/.test(n))return out('gen-7',false);
  if(/\barc\(tm\) b[5-9]\d0\b/.test(n))return out('xe-2hpg');
  if(/\barc\(tm\) 1[34]0v\b/.test(n))return out('xe-2lpg');
  if(/\barc\(tm\) a\d{3}m?\b/.test(n))return out('gen-12hp');
  if(/\barc\(tm\) (1[34]0t|graphics)\b|^intel\(r\) graphics$/.test(n))return out('xe-lpg');
  if(/\biris\(r\) xe\b|\buhd graphics (7\d0|p750)\b/.test(n))return out('gen-12lp');
  if(/^intel\(r\) iris\(r\) plus graphics$/.test(n))return out('gen-11');
  if(/\bhd graphics (4200|4400|4600|5000|p4600|p4700|p4600\/p4700)\b|\bgraphics 5100\b|\bgraphics 5200\b/.test(n))return out('gen-7');
  if(/\bhd graphics (400|405|5300|5500|5600|6000)\b|\bgraphics 6100\b|\bgraphics 6200\b/.test(n))return out('gen-8');
  if(/\buhd graphics (6\d{2}|p630)\b|\bhd graphics (5[0-3]\d|6[0-3]\d|p530|p630)\b|\biris\((?:r|tm)\) (?:plus |pro )?graphics p?(540|550|580|640|645|650|655)\b/.test(n))return out('gen-9');
  return out('');
 }
 return null;
}
// GPUAdapterInfo for a renderer, or null when it is not a Windows D3D11 renderer this can map.
// idsFor(brand, model) supplies known device IDs for saved renderers that carry none; one is
// picked by `pick` so the choice is stable per instance.
function webgpuInfo(renderer,{idsFor,pick}={}){
 const parsed=parseRenderer(renderer);if(!parsed)return null;
 let id=parsed.id;
 if(!id&&typeof idsFor==='function'){const ids=idsFor(parsed.brand,parsed.model)||[];if(ids.length)id=typeof pick==='function'?pick(ids):ids[0];}
 const vendor=parsed.brand.toLowerCase();
 if(id)return {vendor,architecture:dawnArchitecture(parsed.brand,id),supported:webgpuSupportedById(parsed.brand,id)};
 const byName=architectureByName(parsed.brand,parsed.model);
 return {vendor,architecture:byName.supported?byName.architecture:'',supported:byName.supported};
}
module.exports={BRANDS,ID_PATTERN,normalizeId,rendererString,parseRenderer,dawnArchitecture,webgpuSupportedById,architectureByName,webgpuInfo};
