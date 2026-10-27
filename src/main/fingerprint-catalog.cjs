'use strict';
const crypto=require('node:crypto');
const data=require('./fingerprint-catalog.json');
const identity=require('./gpu-identity.cjs');
const ID='library-v1';
if(data.schemaVersion!==2||!Array.isArray(data.gpus)||!data.gpus.length)throw Error('指纹候选库格式无效');
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
// Old integrated graphics (Intel HD 2000–6000, AMD HD 7xx0G APUs) mostly shipped with
// 4-thread CPUs (i5-3210M, A8-4500M), so the low tier includes 4.
const CPU_TIERS=Object.freeze({low:Object.freeze([4,6,8]),mid:Object.freeze([8,12,16,20]),high:Object.freeze([16,20,24,28,32])});
// Physical panel size a tier plausibly drives: an old integrated or entry GPU on a 4K
// panel (3840x2160, or 1920x1080 at DPR 2 / 2560x1440 at 1.5) or a 3440 ultrawide is a
// combination detectors can flag; so is a current high-end GPU (an RTX 5060 Laptop) on a
// 1366x768 or 1440x900 panel. Mid-tier GPUs drive every library screen.
const PANEL_LIMITS=Object.freeze({low:Object.freeze({max:Object.freeze({width:2560,height:1600})}),high:Object.freeze({min:Object.freeze({width:1920,height:1080})})});
function drivable(tier,screen){
 const limit=PANEL_LIMITS[tier];if(!limit)return true;
 // A display's DIP size is rounded up from its panel (2560 at 150% is 1707), so round the product down.
 const width=Math.floor(screen.width*screen.dpr+1e-6),height=Math.floor(screen.height*screen.dpr+1e-6);
 return !(limit.max&&(width>limit.max.width||height>limit.max.height))&&!(limit.min&&(width<limit.min.width||height<limit.min.height));
}
// ids: PCI device IDs seen with this model in the sources (real Chrome puts one in the renderer).
const GPUS=Object.freeze(data.gpus.map(g=>{
 if(!['NVIDIA','AMD','Intel'].includes(g.brand)||typeof g.model!=='string'||g.model.length>120||!/^[\w ().+/-]+$/.test(g.model))throw Error('指纹显卡条目无效');
 const ids=g.ids===undefined?[]:g.ids;if(!Array.isArray(ids)||ids.some(id=>!identity.ID_PATTERN.test(id)))throw Error('指纹显卡设备 ID 无效');
 return Object.freeze({brand:g.brand,model:g.model,tier:gpuTier(g.brand,g.model),vendor:`Google Inc. (${g.brand})`,ids:Object.freeze([...ids])});
}));
// New plans only use GPUs with a known device ID, so the renderer has Chrome's full format.
const PLAN_GPUS=Object.freeze(GPUS.filter(g=>g.ids.length));
const byModel=new Map(GPUS.map(g=>[g.brand+'|'+g.model.toLowerCase(),g]));
function idsFor(brand,model){return byModel.get(brand+'|'+String(model).toLowerCase())?.ids||[];}
// Logical screen + DPR pairs, used when the machine's DPR is unknown (see PANELS for the
// application). No artificial GPU manufacturer/screen restriction.
// The pools describe Facet's desktop profiles, not population statistics.
// Available height leaves the Windows 11 taskbar (48 DIP at every scale; measured on this
// machine: 1152 - 48 = 1104). The UA-CH platformVersion Facet reports (native, 19.0.0) is
// Windows 11; Windows 10's 40 px taskbar was used before.
const TASKBAR=48;
const SCREENS=Object.freeze([
 [1280,720,1],[1366,768,1],[1440,900,1],[1536,864,1.25],
 [1600,900,1],[1920,1080,1],[1920,1080,2],[1920,1200,1],
 [2560,1080,1],[2560,1440,1],[2560,1440,1.5],[3440,1440,1],[3840,2160,1],
].map(([width,height,dpr])=>Object.freeze({width,height,availHeight:height-TASKBAR,dpr})));
// The DPR of a plan must be the DPR of the machine Facet runs on. A cross-site iframe runs in its
// own renderer, and Chromium neither passes DevTools device emulation to it nor accepts
// setDeviceMetricsOverride on an iframe target ("Command can only be executed on top-level
// targets"): its devicePixelRatio, matchMedia resolution and CSS @media stay the machine's
// (measured, Electron 44 / Chromium 152, .local-dev/oopif-dpr-20261027). Verification widgets
// (Turnstile, hCaptcha) run in such iframes, so any other DPR contradicts the page.
// With the display known, plans use its DPR and screens are these physical panels at that DPR,
// only where the panel divides exactly (no reliance on Chromium's DIP rounding), plus the
// display itself as Chromium reports it. Without a known DPR (tests) SCREENS is used.
const PANELS=Object.freeze([
 [1280,720],[1366,768],[1440,900],[1600,900],[1920,1080],[1920,1200],
 [2560,1080],[2560,1440],[3440,1440],[3840,2160],
].map(([width,height])=>Object.freeze({width,height})));
// Screen limits accepted by fingerprint.normalize.
function storable(width,height){return width>=640&&width<=7680&&height>=480&&height<=4320&&height-TASKBAR>=240;}
function screensAt(display){
 const scale=display.scale,list=[];
 const add=(width,height)=>{if(storable(width,height)&&!list.some(s=>s.width===width&&s.height===height))list.push(Object.freeze({width,height,availHeight:height-TASKBAR,dpr:scale}));};
 for(const p of PANELS){const width=Math.round(p.width/scale),height=Math.round(p.height/scale);if(Math.abs(width*scale-p.width)<1e-3&&Math.abs(height*scale-p.height)<1e-3)add(width,height);}
 add(display.width,display.height);
 return list;
}
const CPUS=Object.freeze([...new Set([...CPU_TIERS.low,...CPU_TIERS.mid,...CPU_TIERS.high])].sort((a,b)=>a-b));
const BRANDS=Object.freeze(['NVIDIA','AMD','Intel'].filter(brand=>PLAN_GPUS.some(g=>g.brand===brand)));
// navigator.deviceMemory. Desktop Chrome now reports up to 32 (Device Memory API limits update,
// blink-dev 2026-03; this machine's native value is 32). 4 GB only with at most 8 threads.
const MEMORY_TIERS=Object.freeze({low:Object.freeze([4,8]),mid:Object.freeze([8,16,16,32]),high:Object.freeze([16,32])});
const MEMORY=Object.freeze([...new Set(Object.values(MEMORY_TIERS).flat())].sort((a,b)=>a-b));
function index(seed,key,length){if(!/^[a-zA-Z0-9_-]{1,64}$/.test(seed))throw Error('固定种子格式无效');if(!length)throw Error('指纹候选池为空');return crypto.createHash('sha256').update(ID+':'+seed+':'+key).digest().readUInt32LE(0)%length;}
function pick(seed,key,pool){return pool[index(seed,key,pool.length)];}
// The display Facet runs on (DIP). Pages are presented 1:1 and never scaled
// (viewport.cjs), so a simulated screen smaller than this display leaves an empty
// margin once the window is maximized or full screen — e.g. 1280x720 on a
// 2048x1152 desktop. The application registers a provider ({width,height,scaleFactor});
// tests and other callers without one keep the full pool. Its scaleFactor selects the
// DPR of new plans (see PANELS).
let displaySize=()=>null;
function setDisplayProvider(fn){displaySize=typeof fn==='function'?fn:()=>null;}
// Touch points of the machine Facet runs on. With a touchscreen, Chromium derives
// any-pointer: coarse from the system digitizer (ui/base/pointer/pointer_device_win.cc) and
// neither CDP (Emulation.setEmulatedMedia ignores pointer/hover, measured) nor Electron can
// override it, so a plan reporting 0 touch points beside it contradicts itself. New plans report
// the machine's own count (Chrome on this machine: 10); without a provider (tests) or a
// touchscreen they report 0. Saved instances keep their stored value.
let touchPoints=()=>0;
function setTouchProvider(fn){touchPoints=typeof fn==='function'?fn:()=>0;}
function hostTouchPoints(){try{const n=Number(touchPoints());return Number.isInteger(n)&&n>0&&n<=10?n:0;}catch{return 0;}}
// scale is the display's DPR as Chromium reports it (1.25, or 1.100000023841858 for 110%),
// kept unrounded so the emulated value equals the native one; 0 when unknown or outside the
// range an environment accepts (1–3).
function hostDisplay(){try{const s=displaySize();const width=Math.round(Number(s?.width)||0),height=Math.round(Number(s?.height)||0),scale=Number(s?.scaleFactor);return width>0&&height>0?{width,height,scale:Number.isFinite(scale)&&scale>=1&&scale<=3?scale:0}:null;}catch{return null;}}
function displayFloor(){const d=hostDisplay();return d&&{width:d.width,height:d.height};}
function screenPool(){const d=hostDisplay();return d?.scale?screensAt(d):SCREENS;}
// A fixed device template on this machine: the same physical panel at the machine's DPR. Chromium
// sizes a display in DIP as the enclosing rect of the panel scaled by 1/DPR (rounded up). A size an
// environment cannot store falls back to the display itself. Unknown DPR: the template as is.
function templateScreen(width,height,dpr){
 const d=hostDisplay();if(!d?.scale||Math.abs(d.scale-dpr)<1e-6)return {width,height,availHeight:height-TASKBAR,dpr};
 const up=v=>Math.ceil(v-1e-6),w=up(width*dpr/d.scale),h=up(height*dpr/d.scale);
 const [sw,sh]=storable(w,h)?[w,h]:[d.width,d.height];
 return {width:sw,height:sh,availHeight:sh-TASKBAR,dpr:d.scale};
}
function generate(seed,base={},full=false){
 const brand=pick(seed,'brand',BRANDS),gpu=pick(seed,'gpu',PLAN_GPUS.filter(g=>g.brand===brand));
 const renderer=identity.rendererString(gpu.brand,gpu.model,pick(seed,'gpu-id',gpu.ids));
 // Pick the thread count from the GPU's own tier so the pair is a real machine.
 const cpu=pick(seed,'cpu',CPU_TIERS[gpu.tier]),memory=pick(seed,'memory',MEMORY_TIERS[gpu.tier].filter(m=>m>4||cpu<=8));
 // Keep explicitly fixed viewport dimensions. Choose a screen that can contain them,
 // and when the real display is known, one at least as large as that display; among
 // those, one the GPU's tier can drive. Containing the viewport comes first, then the
 // display floor (an undersized screen leaves a margin around the 1:1 page), then the tier.
 const fits=screenPool().filter(s=>s.width>=(base.width||0)&&s.height>=(base.height||0)),floor=displayFloor();
 const large=floor?fits.filter(s=>s.width>=floor.width&&s.height>=floor.height):fits;
 const sized=large.length?large:fits,plausible=sized.filter(s=>drivable(gpu.tier,s));
 const screens=plausible.length?plausible:sized;
 if(full&&!screens.length)throw Error('现有视口超过设备库屏幕范围，请先调整视口');
 const screen=full?pick(seed,'screen',screens):null;
 return {gpu,renderer,cpu,memory,screen};
}
// A device ID for a saved renderer that carries none, stable per instance seed.
function pickId(seed,ids){return ids.length?ids[index(seed||'none','gpu-id',ids.length)]:null;}
module.exports={ID,GPUS,PLAN_GPUS,SCREENS,PANELS,screensAt,screenPool,templateScreen,CPUS,CPU_TIERS,MEMORY,MEMORY_TIERS,TASKBAR,PANEL_LIMITS,gpuTier,drivable,generate,setDisplayProvider,setTouchProvider,hostTouchPoints,idsFor,pickId};
