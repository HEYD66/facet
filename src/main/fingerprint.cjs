'use strict';
const fs=require('node:fs'),path=require('node:path');
const crypto = require('node:crypto');
const catalog = require('./fingerprint-catalog.cjs');

// arena 指纹环境 · 设备模板与设置
//
// 设备模板（WebGL 串、屏幕、DPR、CPU/内存）移植自 Arena模型助手 的编译期常量。
// 种子一律由 instanceId 派生，保证同一实例跨会话指纹恒定 ——
// 每次刷新都变的指纹比不做伪装更醒目。

const FINGERPRINT_SCHEMA_VERSION = 1;

const WEBGL_VENDORS = Object.freeze({
  nvidia: 'Google Inc. (NVIDIA)',
  amd: 'Google Inc. (AMD)',
  intel: 'Google Inc. (Intel)',
});

// 六个预设。id 保持与源项目一致，便于对照。
// 渲染器按真实 Chrome 的格式带 PCI 设备 ID 和“, D3D11”；可用高度留出 Windows 11 任务栏（48）；
// 内存按新版 Chrome 的上限（最高 32）。只影响之后选用的预设，已保存的实例不变。
const DEVICE_TEMPLATES = Object.freeze([
  Object.freeze({
    id: 'win-nvidia-qhd',
    label: 'Windows · NVIDIA RTX 3070 · 2K',
    platform: 'Win32',
    screenWidth: 2560, screenHeight: 1440, availableScreenHeight: 1392,
    deviceScaleFactor: 1,
    colorDepth: 24,
    hardwareConcurrency: 16,
    deviceMemory: 16,
    maxTouchPoints: 0,
    webGlVendor: WEBGL_VENDORS.nvidia,
    webGlRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 (0x00002484) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  }),
  Object.freeze({
    id: 'win-nvidia-fhd',
    label: 'Windows · NVIDIA RTX 3060 · 1080p',
    platform: 'Win32',
    screenWidth: 1920, screenHeight: 1080, availableScreenHeight: 1032,
    deviceScaleFactor: 1,
    colorDepth: 24,
    hardwareConcurrency: 12,
    deviceMemory: 16,
    maxTouchPoints: 0,
    webGlVendor: WEBGL_VENDORS.nvidia,
    webGlRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  }),
  Object.freeze({
    id: 'win-amd-qhd',
    label: 'Windows · AMD RX 6700 XT · 2K',
    platform: 'Win32',
    screenWidth: 2560, screenHeight: 1440, availableScreenHeight: 1392,
    deviceScaleFactor: 1,
    colorDepth: 24,
    hardwareConcurrency: 12,
    deviceMemory: 16,
    maxTouchPoints: 0,
    webGlVendor: WEBGL_VENDORS.amd,
    webGlRenderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT (0x000073DF) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  }),
  Object.freeze({
    id: 'win-amd-fhd',
    label: 'Windows · AMD RX 6600 · 1080p',
    platform: 'Win32',
    screenWidth: 1920, screenHeight: 1080, availableScreenHeight: 1032,
    deviceScaleFactor: 1,
    colorDepth: 24,
    hardwareConcurrency: 12,
    deviceMemory: 16,
    maxTouchPoints: 0,
    webGlVendor: WEBGL_VENDORS.amd,
    webGlRenderer: 'ANGLE (AMD, AMD Radeon RX 6600 (0x000073FF) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  }),
  Object.freeze({
    id: 'win-intel-fhd',
    label: 'Windows · Intel UHD · 1080p',
    platform: 'Win32',
    screenWidth: 1920, screenHeight: 1080, availableScreenHeight: 1032,
    deviceScaleFactor: 1,
    colorDepth: 24,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    webGlVendor: WEBGL_VENDORS.intel,
    webGlRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics (0x00009BC4) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  }),
  Object.freeze({
    id: 'win-intel-iris',
    label: 'Windows · Intel Iris Xe · 笔记本',
    platform: 'Win32',
    screenWidth: 1536, screenHeight: 864, availableScreenHeight: 816,
    deviceScaleFactor: 1.25,
    colorDepth: 24,
    hardwareConcurrency: 8,
    deviceMemory: 16,
    maxTouchPoints: 0,
    webGlVendor: WEBGL_VENDORS.intel,
    webGlRenderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  }),
]);


const FLAGS=['hardware','webgl','canvas','audio','rects'];
function normalize(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('指纹设置格式无效');
 const enabled=value.enabled===true, seed=String(value.seed|| (enabled?crypto.randomBytes(16).toString('hex'):''));
 if(seed&&!/^[a-zA-Z0-9_-]{1,64}$/.test(seed))throw Error('固定种子须为1–64位字母、数字、下划线或短横线');
 const n=(key,def,min,max)=>{const v=Number(value[key]??def);if(!Number.isInteger(v)||v<min||v>max)throw Error('指纹参数超出范围：'+key);return v;};
 const template=String(value.template||'custom');if(!['custom',catalog.ID,...DEVICE_TEMPLATES.map(x=>x.id)].includes(template))throw Error('未知设备预设');
 const f={enabled,seed,template,screenWidth:n('screenWidth',1920,640,7680),screenHeight:n('screenHeight',1080,480,4320),availHeight:n('availHeight',1040,240,4320),memory:n('memory',8,1,32),touch:n('touch',0,0,10),colorDepth:n('colorDepth',24,24,32)};
 // Memory buckets: powers of two up to the current desktop Chrome limit of 32.
 if(f.availHeight>f.screenHeight||![1,2,4,8,16,32].includes(f.memory)||![24,30,32].includes(f.colorDepth))throw Error('屏幕可用高度、内存档位或色深无效');
 for(const k of FLAGS)f[k]=value[k]===true;
 for(const k of ['vendor','renderer']){f[k]=String(value[k]||'');if(f[k].length>300||/[\x00-\x1f\x7f]/.test(f[k]))throw Error('WebGL文本无效');}
 if(f.enabled&&f.webgl&&(!f.vendor||!f.renderer))throw Error('启用WebGL覆盖需要厂商和渲染器');
 return f;
}
function preset(id,base={},seed=crypto.randomBytes(16).toString('hex'),options={}){
 if(id==='random'||id===catalog.ID){
  // One-click random keeps the screen and DPR unless the caller asks to randomize them too
  // (options.screen); the full library plan always picks a screen. Either way the browsing
  // viewport (width/height) is kept.
  const full=id===catalog.ID,current=normalize(base.fingerprint),withScreen=full||options.screen===true,plan=catalog.generate(seed,base,withScreen);
  const choice=key=>crypto.createHash('sha256').update(seed+':'+key).digest().readUInt32LE(0);
  const screen=plan.screen;
  return {...base,colorScheme:['system','light','dark'][choice('color-scheme')%3],reducedMotion:choice('reduced-motion')%2?'reduce':'no-preference',
   userAgent:generatedUserAgent(),platform:'Win32',cpu:plan.cpu,
   width:base.width||0,height:base.height||0,scale:withScreen?screen.dpr:(base.scale||0),
   fingerprint:normalize({...current,enabled:true,hardware:withScreen||!!(base.fingerprint?.enabled&&current.hardware),webgl:true,canvas:true,audio:true,seed,template:catalog.ID,
    screenWidth:withScreen?screen.width:current.screenWidth,screenHeight:withScreen?screen.height:current.screenHeight,availHeight:withScreen?screen.availHeight:current.availHeight,
    memory:plan.memory,touch:catalog.hostTouchPoints(),colorDepth:24,vendor:plan.gpu.vendor,renderer:plan.renderer})};
 }
 const t=DEVICE_TEMPLATES.find(x=>x.id===id);if(!t)throw Error('未知设备预设');
 return {...base,userAgent:generatedUserAgent(),platform:'Win32',width:0,height:0,scale:t.deviceScaleFactor,cpu:t.hardwareConcurrency,
 fingerprint:normalize({...base.fingerprint,enabled:true,hardware:true,seed,template:t.id,screenWidth:t.screenWidth,screenHeight:t.screenHeight,availHeight:t.availableScreenHeight,memory:t.deviceMemory,touch:catalog.hostTouchPoints(),colorDepth:24,vendor:t.webGlVendor,renderer:t.webGlRenderer})};
}
function generatedUserAgent(){return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome||'0.0.0.0'} Safari/537.36`;}
// Only a generated UA matching this runtime can reuse native UA-CH metadata.
// An explicitly edited or old-version UA retains the existing custom-UA policy.
// NOTE: adding a "Google Chrome" brand here would only cover the page and the
// CDP-overridden workers; service workers keep native UA-CH (preload-based, no
// metadata override), so a page-only brand would split page vs. service worker.
// A consistent "Google Chrome" brand belongs with the Sec-CH-UA header gap at
// the kernel level, where native UA-CH applies to every context and the headers.
function generatedMetadata(env,native){
 if(!env.fingerprint?.enabled||env.fingerprint.template==='custom'||env.platform!=='Win32'||env.userAgent!==generatedUserAgent()||native?.metadata?.platform!=='Windows')return null;
 return {...native.metadata,platform:'Windows',mobile:false,model:''};
}
// A custom UA (user-edited, or a stored generated UA that drifted from a newer
// runtime after an update) is still a Chrome-on-Windows UA in almost every case.
// The old policy cleared UA-CH to empty brands for any custom UA, but an empty
// navigator.userAgentData.brands is itself a strong "spoofed" tell. Instead,
// derive the brands from the UA's own Chrome version and reuse the native GREASE
// brand and OS fields, so the page's UA string, brands and fullVersionList all
// agree. Only the full (patch) version may differ from service workers' native
// UA-CH — far subtler than an empty brand list. Non-Chrome or non-Windows custom
// UAs keep the previous empty behaviour.
function customMetadata(env,native){
 const parsed=String(env.userAgent||'').match(/Chrome\/(\d+)\.(\d+\.\d+\.\d+)(?:\s|$)/);
 if(!parsed)return null;
 if(env.platform&&env.platform!=='Win32')return null;
 const meta=native?.metadata;
 if(!meta||meta.platform!=='Windows'||!Array.isArray(meta.brands))return null;
 const major=parsed[1],full=parsed[1]+'.'+parsed[2];
 const atVersion=(list,version)=>list.map(b=>b&&b.brand==='Chromium'?{...b,version}:b);
 const fullList=Array.isArray(meta.fullVersionList)?meta.fullVersionList:meta.brands;
 return {...meta,platform:'Windows',mobile:false,model:'',brands:atVersion(meta.brands,major),fullVersionList:atVersion(fullList,full),fullVersion:full};
}
// WebGPU adapter info that matches the WebGL renderer (all instances with WebGL override, also
// renderers saved before device IDs were stored). Without it the page saw the real GPU through
// navigator.gpu (measured: WebGL "GT 630", WebGPU "nvidia / lovelace").
function webgpu(f){
 if(!f.webgl||!f.renderer)return null;
 const info=require('./gpu-identity.cjs').webgpuInfo(f.renderer,{idsFor:catalog.idsFor,pick:ids=>catalog.pickId(f.seed,ids)});
 return info&&{Vendor:info.vendor,Architecture:info.architecture,Supported:info.supported};
}
function script(env){const f=normalize(env.fingerprint);if(!f.enabled)return null;
 const seed=key=>crypto.createHash('sha256').update(f.seed+':'+key).digest().readUInt32LE(0);
 const payload={Hardware:f.hardware,WebGL:f.webgl,WebGpu:webgpu(f),Canvas:f.canvas,Audio:f.audio,Rects:f.rects,DeviceMemory:f.memory,MaxTouchPoints:f.touch,ScreenWidth:f.screenWidth,ScreenHeight:f.screenHeight,AvailableScreenHeight:f.availHeight,ColorDepth:f.colorDepth,WebGlVendor:f.vendor,WebGlRenderer:f.renderer,CanvasSeed:seed('canvas'),AudioSeed:seed('audio'),ClientRectsSeed:seed('rects'),WorkerUserAgent:env.userAgent||'',WorkerPlatform:env.platform||'',WorkerLanguage:env.language||'',WorkerCPU:env.cpu||0,DevicePixelRatio:Number(env.scale)||0};
 const source=fs.readFileSync(path.join(__dirname,'fingerprint-inject.js'),'utf8'),slot='/*__FACET_FP_PAYLOAD__*/null';if(source.split(slot).length!==2)throw Error('指纹注入槽位无效');return source.replace(slot,()=>JSON.stringify(payload));
}
module.exports={normalize,preset,script,DEVICE_TEMPLATES,generatedMetadata,customMetadata,generatedUserAgent};
