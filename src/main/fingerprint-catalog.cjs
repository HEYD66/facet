'use strict';
const crypto=require('node:crypto');
const data=require('./fingerprint-catalog.json');
const ID='library-v1';
if(data.schemaVersion!==1||!Array.isArray(data.gpus)||!data.gpus.length)throw Error('指纹候选库格式无效');
// Coarse GPU power tier, so the thread count paired with it stays physically
// plausible. A low-end/old GPU must never land on a 24–32 thread CPU (e.g. the
// Intel UHD 617 + 24 threads combo a detector can flag as impossible), and a
// current flagship must never report 6 threads. Unknown models fall to 'mid'.
function gpuTier(brand,model){
 const m=String(model).toLowerCase();
 if(brand==='Intel'){
  // Arc discrete and 12th-gen+ integrated (UHD 7x0 / Iris Xe) ship with many-thread CPUs.
  // "iris(r) xe" carries a trademark mark between the words; allow (r)/(tm) and spaces.
  if(/\barc\b|iris(?:\s|\(r\)|\(tm\))*xe|uhd\s*graphics\s*(7\d0|p750)\b/.test(m))return 'mid';
  return 'low';
 }
 if(brand==='NVIDIA'){
  if(/\brtx\s*(30[789]0|3090|40\d0|50\d0)|\brtx\s*a[45]\d{3}|quadro\s*rtx\s*[4-9]\d{3}|\btitan\b/.test(m))return 'high';
  if(/\bgt\s*\d|\bgts\s|geforce\s*6[01]5|\bgtx\s*[4-9]\d0\b|\bgtx\s*[4-9]\d0m\b|quadro\s*(k\d|p[0-9])/.test(m))return 'low';
  return 'mid';
 }
 if(brand==='AMD'){
  if(/\brx\s*6[789]\d0|\brx\s*7[6789]\d0|vega\s*(56|64)|radeon\s*pro\s*(5[6-9]\d0|w[6-9])/.test(m))return 'high';
  if(/\bhd\s*\d|radeon\s*hd|firepro|\b(r[3-9])\b|\b5[234]0\b|pro\s*wx\s*[23]\d00|vega\s*([3-9]|1[01])\b/.test(m))return 'low';
  return 'mid';
 }
 return 'mid';
}
// Thread counts realistic for each tier; overlapping mid-range keeps boundaries soft.
// The union is the full CPU pool, so every value stays reachable across the catalog.
const CPU_TIERS=Object.freeze({low:Object.freeze([6,8]),mid:Object.freeze([8,12,16,20]),high:Object.freeze([16,20,24,28,32])});
const GPUS=Object.freeze(data.gpus.map(g=>{
 if(!['NVIDIA','AMD','Intel'].includes(g.brand)||typeof g.model!=='string'||g.model.length>120||!/^[\w ().+/-]+$/.test(g.model))throw Error('指纹显卡条目无效');
 return Object.freeze({brand:g.brand,model:g.model,tier:gpuTier(g.brand,g.model),vendor:`Google Inc. (${g.brand})`,renderer:`ANGLE (${g.brand}, ${g.model} Direct3D11 vs_5_0 ps_5_0)`});
}));
// Logical screen + DPR pairs. No artificial GPU manufacturer/screen restriction.
// The pools describe Facet's desktop profiles, not population statistics.
const SCREENS=Object.freeze([
 [1280,720,1],[1366,768,1],[1440,900,1],[1536,864,1.25],
 [1600,900,1],[1920,1080,1],[1920,1080,2],[1920,1200,1],
 [2560,1080,1],[2560,1440,1],[2560,1440,1.5],[3440,1440,1],[3840,2160,1],
].map(([width,height,dpr])=>Object.freeze({width,height,availHeight:height-40,dpr})));
const CPUS=Object.freeze([...new Set([...CPU_TIERS.low,...CPU_TIERS.mid,...CPU_TIERS.high])].sort((a,b)=>a-b));
const BRANDS=Object.freeze(['NVIDIA','AMD','Intel'].filter(brand=>GPUS.some(g=>g.brand===brand)));
function index(seed,key,length){if(!/^[a-zA-Z0-9_-]{1,64}$/.test(seed))throw Error('固定种子格式无效');if(!length)throw Error('指纹候选池为空');return crypto.createHash('sha256').update(ID+':'+seed+':'+key).digest().readUInt32LE(0)%length;}
function pick(seed,key,pool){return pool[index(seed,key,pool.length)];}
function generate(seed,base={},full=false){
 const brand=pick(seed,'brand',BRANDS),gpu=pick(seed,'gpu',GPUS.filter(g=>g.brand===brand));
 // Pick the thread count from the GPU's own tier so the pair is a real machine.
 const cpu=pick(seed,'cpu',CPU_TIERS[gpu.tier]),memory=cpu<=8?pick(seed,'memory',[4,8]):8;
 // Keep explicitly fixed viewport dimensions. Choose a screen that can contain them.
 const screens=SCREENS.filter(s=>s.width>=(base.width||0)&&s.height>=(base.height||0));
 if(full&&!screens.length)throw Error('现有视口超过设备库屏幕范围，请先调整视口');
 const screen=full?pick(seed,'screen',screens):null;
 return {gpu,cpu,memory,screen};
}
module.exports={ID,GPUS,SCREENS,CPUS,CPU_TIERS,gpuTier,generate};
