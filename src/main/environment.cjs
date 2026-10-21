'use strict';
const LANGUAGES=['zh-CN','en-US','ja-JP','en-GB'];
// Electron 在默认 UA 中追加 Electron/<version>，网页检测站和部分站点会把它当作运行时标记。
// 只清理运行时标记，保留 Chromium/Chrome 版本及其余兼容字段；用户显式填写的 UA 不改写。
function sanitizeElectronUserAgent(value){return String(value||'').replace(/\s+Electron\/[^\s]+/ig,'').trim();}
function environment(value={}){let language='zh-CN';try{language=Intl.getCanonicalLocales(String(value.language||'zh-CN'))[0];}catch{}const timezone=String(value.timezone||'Asia/Tokyo');try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format();}catch{throw Error('无效时区');}const number=(key,min,max,def=0)=>{const v=value[key]===undefined||value[key]===''?def:Number(value[key]);if(!Number.isFinite(v)||(v!==0&&(v<min||v>max)))throw Error('环境参数超出范围：'+key);return v;};const width=number('width',640,3840),height=number('height',480,2160);if(!!width!==!!height||!Number.isInteger(width)||!Number.isInteger(height))throw Error('视口宽高需同时设置整数，或同时为0自适应');const cpu=number('cpu',1,64);if(!Number.isInteger(cpu))throw Error('CPU线程数需为整数');const userAgent=String(value.userAgent||'').trim();if(userAgent.length>512||/[\r\n\x00-\x1f\x7f]/.test(userAgent))throw Error('UA格式无效');const platform=String(value.platform||'');if(!['','Win32','MacIntel','Linux x86_64'].includes(platform))throw Error('不支持的平台标识');const colorScheme=value.colorScheme||'system',reducedMotion=value.reducedMotion||'system';if(!['system','light','dark'].includes(colorScheme)||!['system','reduce','no-preference'].includes(reducedMotion))throw Error('媒体偏好无效');const geoEnabled=value.geoEnabled===true;const latitude=Number(value.latitude??0),longitude=Number(value.longitude??0);if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)throw Error('经纬度无效');const fingerprint=require('./fingerprint.cjs').normalize(value.fingerprint);if(fingerprint.enabled&&fingerprint.hardware&&(width>fingerprint.screenWidth||height>fingerprint.screenHeight))throw Error('视口不能超过模拟屏幕');return {fingerprint,language,timezone,width,height,scale:number('scale',1,3),cpu,userAgent,platform,colorScheme,reducedMotion,geoEnabled,latitude,longitude};}
// 同一实例的弹出窗口与主页面共用渲染进程，时区/语言覆盖在进程内已生效（值相同），此时 Chromium 报 already in effect，可忽略。
async function shared(promise){try{return await promise;}catch(e){if(!/already in effect/i.test(String(e?.message)))throw e;}}
async function applyEnvironment(wc,env,native,bounds){
 const custom=!!(env.userAgent||env.platform);
 const metadata=require('./fingerprint.cjs').generatedMetadata(env,native)||(custom?{brands:[],fullVersionList:[],platform:'',platformVersion:'',architecture:'',model:'',mobile:false}:native.metadata);
 const userAgent=env.userAgent||sanitizeElectronUserAgent(wc.getUserAgent());
 const source=require('./fingerprint.cjs').script({...env,userAgent,platform:env.platform||native.platform});
 await require('./environment-service-worker.cjs').installServiceWorkerEnvironment(wc,source,JSON.stringify([userAgent,env.platform||native.platform,env.language,env.timezone,env.cpu,metadata]));
 if(source){await wc.debugger.sendCommand('Page.enable');await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source,runImmediately:true});}
 const applyNative=async(sessionId,type='page',dispatch)=>{
  const send=dispatch||((method,params)=>require('./environment-contexts.cjs').targetCommand(wc,method,params,sessionId));
  await send('Emulation.setUserAgentOverride',{userAgent,acceptLanguage:env.language,platform:env.platform||native.platform,...(metadata?{userAgentMetadata:metadata}:{})});
  await shared(send('Emulation.setTimezoneOverride',{timezoneId:env.timezone}));
  await shared(send('Emulation.setLocaleOverride',{locale:env.language}));
  if(env.cpu)await send('Emulation.setHardwareConcurrencyOverride',{hardwareConcurrency:env.cpu});
  if(type==='page'||type==='iframe'){
   const features=[];
   if(env.colorScheme!=='system')features.push({name:'prefers-color-scheme',value:env.colorScheme});
   if(env.reducedMotion!=='system')features.push({name:'prefers-reduced-motion',value:env.reducedMotion});
   if(features.length)await send('Emulation.setEmulatedMedia',{features});
   if(env.geoEnabled)await send('Emulation.setGeolocationOverride',{latitude:env.latitude,longitude:env.longitude,accuracy:100});
  }
 };
 await applyNative();
 await require('./viewport.cjs').applyViewport(wc,env,bounds);
 await require('./environment-contexts.cjs').installContextEnvironment(wc,{source,applyNative});
 await require('./environment-shared-worker.cjs').installSharedWorkerEnvironment(wc,{source,applyNative,nativeKey:JSON.stringify([userAgent,env.platform||native.platform,env.language,env.timezone,env.cpu,metadata])});
}
module.exports={LANGUAGES,environment,applyEnvironment,sanitizeElectronUserAgent};
