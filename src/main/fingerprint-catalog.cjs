'use strict';
const crypto=require('node:crypto');
const data=require('./fingerprint-catalog.json');
const ID='library-v1';
if(data.schemaVersion!==1||!Array.isArray(data.gpus)||!data.gpus.length)throw Error('指纹候选库格式无效');
const GPUS=Object.freeze(data.gpus.map(g=>{
 if(!['NVIDIA','AMD','Intel'].includes(g.brand)||typeof g.model!=='string'||g.model.length>120||!/^[\w ().+/-]+$/.test(g.model))throw Error('指纹显卡条目无效');
 return Object.freeze({brand:g.brand,model:g.model,vendor:`Google Inc. (${g.brand})`,renderer:`ANGLE (${g.brand}, ${g.model} Direct3D11 vs_5_0 ps_5_0)`});
}));
// Logical screen + DPR pairs. No artificial GPU manufacturer/screen restriction.
// The pools describe Facet's desktop profiles, not population statistics.
const SCREENS=Object.freeze([
 [1280,720,1],[1366,768,1],[1440,900,1],[1536,864,1.25],
 [1600,900,1],[1920,1080,1],[1920,1080,2],[1920,1200,1],
 [2560,1080,1],[2560,1440,1],[2560,1440,1.5],[3440,1440,1],[3840,2160,1],
].map(([width,height,dpr])=>Object.freeze({width,height,availHeight:height-40,dpr})));
const CPUS=Object.freeze([6,8,12,16,20,24,28,32]);
const BRANDS=Object.freeze(['NVIDIA','AMD','Intel'].filter(brand=>GPUS.some(g=>g.brand===brand)));
function index(seed,key,length){if(!/^[a-zA-Z0-9_-]{1,64}$/.test(seed))throw Error('固定种子格式无效');if(!length)throw Error('指纹候选池为空');return crypto.createHash('sha256').update(ID+':'+seed+':'+key).digest().readUInt32LE(0)%length;}
function pick(seed,key,pool){return pool[index(seed,key,pool.length)];}
function generate(seed,base={},full=false){
 const brand=pick(seed,'brand',BRANDS),gpu=pick(seed,'gpu',GPUS.filter(g=>g.brand===brand));
 const cpu=pick(seed,'cpu',CPUS),memory=cpu<=8?pick(seed,'memory',[4,8]):8;
 // Keep explicitly fixed viewport dimensions. Choose a screen that can contain them.
 const screens=SCREENS.filter(s=>s.width>=(base.width||0)&&s.height>=(base.height||0));
 if(full&&!screens.length)throw Error('现有视口超过设备库屏幕范围，请先调整视口');
 const screen=full?pick(seed,'screen',screens):null;
 return {gpu,cpu,memory,screen};
}
module.exports={ID,GPUS,SCREENS,CPUS,generate};
