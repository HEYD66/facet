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
const DEVICE_TEMPLATES = Object.freeze([
  Object.freeze({
    id: 'win-nvidia-qhd',
    label: 'Windows · NVIDIA RTX 3070 · 2K',
    platform: 'Win32',
    screenWidth: 2560, screenHeight: 1440, availableScreenHeight: 1400,
    deviceScaleFactor: 1,
    colorDepth: 24,
    hardwareConcurrency: 16,
    deviceMemory: 8,
    maxTouchPoints: 0,
    webGlVendor: WEBGL_VENDORS.nvidia,
    webGlRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)',
  }),
  Object.freeze({
    id: 'win-nvidia-fhd',
    label: 'Windows · NVIDIA RTX 3060 · 1080p',
    platform: 'Win32',
    screenWidth: 1920, screenHeight: 1080, availableScreenHeight: 1040,
    deviceScaleFactor: 1,
    colorDepth: 24,
    hardwareConcurrency: 12,
    deviceMemory: 8,
    maxTouchPoints: 0,
    webGlVendor: WEBGL_VENDORS.nvidia,
    webGlRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)',
  }),
  Object.freeze({
    id: 'win-amd-qhd',
    label: 'Windows · AMD RX 6700 XT · 2K',
    platform: 'Win32',
    screenWidth: 2560, screenHeight: 1440, availableScreenHeight: 1400,
    deviceScaleFactor: 1,
    colorDepth: 24,
    hardwareConcurrency: 12,
    deviceMemory: 8,
    maxTouchPoints: 0,
    webGlVendor: WEBGL_VENDORS.amd,
    webGlRenderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0)',
  }),
  Object.freeze({
    id: 'win-amd-fhd',
    label: 'Windows · AMD RX 6600 · 1080p',
    platform: 'Win32',
    screenWidth: 1920, screenHeight: 1080, availableScreenHeight: 1040,
    deviceScaleFactor: 1,
    colorDepth: 24,
    hardwareConcurrency: 12,
    deviceMemory: 8,
    maxTouchPoints: 0,
    webGlVendor: WEBGL_VENDORS.amd,
    webGlRenderer: 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0)',
  }),
  Object.freeze({
    id: 'win-intel-fhd',
    label: 'Windows · Intel UHD · 1080p',
    platform: 'Win32',
    screenWidth: 1920, screenHeight: 1080, availableScreenHeight: 1040,
    deviceScaleFactor: 1,
    colorDepth: 24,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    webGlVendor: WEBGL_VENDORS.intel,
    webGlRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0)',
  }),
  Object.freeze({
    id: 'win-intel-iris',
    label: 'Windows · Intel Iris Xe · 笔记本',
    platform: 'Win32',
    screenWidth: 1536, screenHeight: 864, availableScreenHeight: 824,
    deviceScaleFactor: 1.25,
    colorDepth: 24,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    webGlVendor: WEBGL_VENDORS.intel,
    webGlRenderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)',
  }),
]);


const FLAGS=['hardware','webgl','canvas','audio','rects'];
function normalize(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('指纹设置格式无效');
 const enabled=value.enabled===true, seed=String(value.seed|| (enabled?crypto.randomBytes(16).toString('hex'):''));
 if(seed&&!/^[a-zA-Z0-9_-]{1,64}$/.test(seed))throw Error('固定种子须为1–64位字母、数字、下划线或短横线');
 const n=(key,def,min,max)=>{const v=Number(value[key]??def);if(!Number.isInteger(v)||v<min||v>max)throw Error('指纹参数超出范围：'+key);return v;};
 const template=String(value.template||'custom');if(!['custom',catalog.ID,...DEVICE_TEMPLATES.map(x=>x.id)].includes(template))throw Error('未知设备预设');
 const f={enabled,seed,template,screenWidth:n('screenWidth',1920,640,7680),screenHeight:n('screenHeight',1080,480,4320),availHeight:n('availHeight',1040,240,4320),memory:n('memory',8,1,8),touch:n('touch',0,0,10),colorDepth:n('colorDepth',24,24,32)};
 if(f.availHeight>f.screenHeight||![1,2,4,8].includes(f.memory)||![24,30,32].includes(f.colorDepth))throw Error('屏幕可用高度、内存档位或色深无效');
 for(const k of FLAGS)f[k]=value[k]===true;
 for(const k of ['vendor','renderer']){f[k]=String(value[k]||'');if(f[k].length>300||/[\x00-\x1f\x7f]/.test(f[k]))throw Error('WebGL文本无效');}
 if(f.enabled&&f.webgl&&(!f.vendor||!f.renderer))throw Error('启用WebGL覆盖需要厂商和渲染器');
 return f;
}
function preset(id,base={},seed=crypto.randomBytes(16).toString('hex')){
 if(id==='random'||id===catalog.ID){
  const full=id===catalog.ID,current=normalize(base.fingerprint),plan=catalog.generate(seed,base,full);
  const choice=key=>crypto.createHash('sha256').update(seed+':'+key).digest().readUInt32LE(0);
  const screen=plan.screen;
  return {...base,colorScheme:['system','light','dark'][choice('color-scheme')%3],reducedMotion:choice('reduced-motion')%2?'reduce':'no-preference',
   userAgent:generatedUserAgent(),platform:'Win32',cpu:plan.cpu,
   width:base.width||0,height:base.height||0,scale:full?screen.dpr:(base.scale||0),
   fingerprint:normalize({...current,enabled:true,hardware:full||!!(base.fingerprint?.enabled&&current.hardware),webgl:true,canvas:true,audio:true,seed,template:catalog.ID,
    screenWidth:full?screen.width:current.screenWidth,screenHeight:full?screen.height:current.screenHeight,availHeight:full?screen.availHeight:current.availHeight,
    memory:plan.memory,touch:0,colorDepth:24,vendor:plan.gpu.vendor,renderer:plan.gpu.renderer})};
 }
 const t=DEVICE_TEMPLATES.find(x=>x.id===id);if(!t)throw Error('未知设备预设');
 return {...base,userAgent:generatedUserAgent(),platform:'Win32',width:0,height:0,scale:t.deviceScaleFactor,cpu:t.hardwareConcurrency,
 fingerprint:normalize({...base.fingerprint,enabled:true,hardware:true,seed,template:t.id,screenWidth:t.screenWidth,screenHeight:t.screenHeight,availHeight:t.availableScreenHeight,memory:t.deviceMemory,touch:0,colorDepth:24,vendor:t.webGlVendor,renderer:t.webGlRenderer})};
}
function generatedUserAgent(){return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome||'0.0.0.0'} Safari/537.36`;}
// Only a generated UA matching this runtime can reuse native UA-CH metadata.
// An explicitly edited or old-version UA retains the existing custom-UA policy.
function generatedMetadata(env,native){
 if(!env.fingerprint?.enabled||env.fingerprint.template==='custom'||env.platform!=='Win32'||env.userAgent!==generatedUserAgent()||native?.metadata?.platform!=='Windows')return null;
 return {...native.metadata,platform:'Windows',mobile:false,model:''};
}
function script(env){const f=normalize(env.fingerprint);if(!f.enabled)return null;
 const seed=key=>crypto.createHash('sha256').update(f.seed+':'+key).digest().readUInt32LE(0);
 const payload={Hardware:f.hardware,WebGL:f.webgl,Canvas:f.canvas,Audio:f.audio,Rects:f.rects,DeviceMemory:f.memory,MaxTouchPoints:f.touch,ScreenWidth:f.screenWidth,ScreenHeight:f.screenHeight,AvailableScreenHeight:f.availHeight,ColorDepth:f.colorDepth,WebGlVendor:f.vendor,WebGlRenderer:f.renderer,CanvasSeed:seed('canvas'),AudioSeed:seed('audio'),ClientRectsSeed:seed('rects'),WorkerUserAgent:env.userAgent||'',WorkerPlatform:env.platform||'',WorkerLanguage:env.language||'',WorkerCPU:env.cpu||0};
 const source=fs.readFileSync(path.join(__dirname,'fingerprint-inject.js'),'utf8'),slot='/*__FACET_FP_PAYLOAD__*/null';if(source.split(slot).length!==2)throw Error('指纹注入槽位无效');return source.replace(slot,()=>JSON.stringify(payload));
}
module.exports={normalize,preset,script,DEVICE_TEMPLATES,generatedMetadata,generatedUserAgent};
