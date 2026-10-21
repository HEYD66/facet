'use strict';
// BrowserView bounds are DIP. DPR and the fitted presentation scale are independent.
function adaptiveSize(env,bounds){
 const hardware=!!(env.fingerprint?.enabled&&env.fingerprint.hardware);
 const width=Math.max(1,Math.round(Number(bounds.width)||1)),height=Math.max(1,Math.round(Number(bounds.height)||1));
 const sw=hardware?(Number(env.fingerprint.screenWidth)||width):width,sh=hardware?(Number(env.fingerprint.screenHeight)||height):height;
 const scale=Math.max(1,width/sw,height/sh);
 // Keep the host aspect ratio while bounding the logical viewport by the
 // configured screen. Round up so the presented page covers every host pixel.
 return {width:Math.min(sw,Math.ceil(width/scale)),height:Math.min(sh,Math.ceil(height/scale)),scale};
}
function deviceMetrics(env,bounds={}){
 const fixed=!!env.width,hardware=!!(env.fingerprint?.enabled&&env.fingerprint.hardware);
 let width=Number(env.width)||0,height=Number(env.height)||0;
 const bw=Math.max(1,Number(bounds.width)||width||1),bh=Math.max(1,Number(bounds.height)||height||1);
 // Zero keeps the native adaptive size. When it exceeds the configured screen,
 // fit a bounded logical viewport back into the host without changing DPR or
 // page zoom. Capping axes alone leaves an unpainted margin in WebContentsView.
 const size=adaptiveSize(env,{width:bw,height:bh});
 if(!fixed&&size.scale>1){width=size.width;height=size.height;}
 const fit=fixed?Math.min(1,bw/width,bh/height):size.scale;
 // Electron owns the native view/backing surface size. Letting emulation resize
 // it crops or leaves margins when configured DPR differs from desktop scaling.
 return {width,height,deviceScaleFactor:env.scale||0,mobile:false,scale:fit,dontSetVisibleSize:true,
 ...(hardware?{screenWidth:env.fingerprint.screenWidth,screenHeight:env.fingerprint.screenHeight}:fixed?{screenWidth:width,screenHeight:height}:{})};
}
async function applyViewport(wc,env,bounds){const needed=env.width||env.scale||env.fingerprint?.enabled&&env.fingerprint.hardware;if(needed)await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride',deviceMetrics(env,bounds));}
// 宫格总览：页面仍按原视口（固定视口或正常浏览区域大小）排版，只把渲染结果等比缩小进格子。
// 不改 DPR；屏幕尺寸保持与正常浏览一致（硬件指纹 > 固定视口 > 真实屏幕），避免进出宫格时指纹变化。
function tileMetrics(env,tile,base,screen={}){const fixed=!!env.width,hardware=!!(env.fingerprint?.enabled&&env.fingerprint.hardware);
 const size=adaptiveSize(env,{width:Math.max(320,Number(base?.width)||1280),height:Math.max(240,Number(base?.height)||800)});
 const width=fixed?Number(env.width):size.width,height=fixed?Number(env.height):size.height;
 const scale=Math.max(0.05,Math.min(1,(Number(tile.width)||1)/width,(Number(tile.height)||1)/height));
 return {width,height,deviceScaleFactor:env.scale||0,mobile:false,scale:Math.round(scale*10000)/10000,dontSetVisibleSize:true,...(hardware?{screenWidth:env.fingerprint.screenWidth,screenHeight:env.fingerprint.screenHeight}:fixed?{screenWidth:width,screenHeight:height}:screen.width?{screenWidth:screen.width,screenHeight:screen.height}:{})};}
module.exports={deviceMetrics,applyViewport,tileMetrics};
