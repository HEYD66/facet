'use strict';
// BrowserView bounds are DIP. DPR is emulated independently of the page size.
//
// Normal browsing always presents the page 1:1 (emulation scale 1). Any other
// presentation scale makes real mouse events disagree with themselves: in the
// main frame screenX/screenY move `scale` times faster than clientX/clientY, and
// a cross-site iframe reports a screen origin that does not match where it sits
// on the page. Verification widgets such as Cloudflare Turnstile record these
// coordinates and reject the click (issue #10: after maximizing; fixed viewports
// larger than the window; the zoomed grid tile). Measured on the real managed
// widget: scale 1 passes after one click, 1.145 and 0.829 never pass.
//
// Instead of scaling, the native view is limited to what this environment can
// show and centred in the browsing area; the margin shows the control UI:
// - adaptive with hardware overrides: at most the configured screen size;
// - fixed viewport: at most the configured width/height, and simply smaller
//   (following the browsing area) when the area is smaller.
function hardware(env){return !!(env?.fingerprint?.enabled&&env.fingerprint.hardware);}
function limits(env){
 if(Number(env?.width)&&Number(env?.height))return {width:Number(env.width),height:Number(env.height)};
 if(hardware(env))return {width:Number(env.fingerprint.screenWidth)||Infinity,height:Number(env.fingerprint.screenHeight)||Infinity};
 return {width:Infinity,height:Infinity};
}
// Native page view bounds inside `host`, in the same coordinate space as `host`.
function presentedBounds(env,host={}){
 const x=Math.round(Number(host.x)||0),y=Math.round(Number(host.y)||0);
 const width=Math.max(1,Math.round(Number(host.width)||1)),height=Math.max(1,Math.round(Number(host.height)||1));
 const max=limits(env),w=Math.max(1,Math.min(width,Math.floor(max.width))),h=Math.max(1,Math.min(height,Math.floor(max.height)));
 return {x:x+Math.floor((width-w)/2),y:y+Math.floor((height-h)/2),width:w,height:h};
}
function screenMetrics(env){
 if(hardware(env))return {screenWidth:env.fingerprint.screenWidth,screenHeight:env.fingerprint.screenHeight};
 if(env?.width)return {screenWidth:Number(env.width),screenHeight:Number(env.height)};
 return {};
}
// Layout viewport = the presented view size, at scale 1. The size is explicit so
// every resize changes the metrics and is re-applied; with a 0 ("keep native")
// size the page was observed not to follow a later view resize. Without bounds
// the native size is kept.
function deviceMetrics(env,bounds){
 const size=Number(bounds?.width)&&Number(bounds?.height)?presentedBounds(env,bounds):null;
 return {width:size?size.width:0,height:size?size.height:0,deviceScaleFactor:env?.scale||0,mobile:false,scale:1,dontSetVisibleSize:true,...screenMetrics(env)};
}
async function applyViewport(wc,env,bounds){const needed=env.width||env.scale||hardware(env);if(needed)await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride',deviceMetrics(env,bounds));}
// 宫格小格子：页面仍按正常浏览时的视口排版，只把渲染结果等比缩小进格子（预览）。
// 不改 DPR；屏幕尺寸保持与正常浏览一致（硬件指纹 > 固定视口 > 真实屏幕），避免进出宫格时指纹变化。
// 缩小后的格子里点击验证框会被拒绝（见上），需要操作时用“放大查看”，放大框按 1:1 显示。
// The tile lays out at exactly the size normal browsing would present for `base`.
function tileMetrics(env,tile,base,screen={}){
 const {width,height}=presentedBounds(env,{width:Math.max(320,Number(base?.width)||1280),height:Math.max(240,Number(base?.height)||800)});
 const scale=Math.max(0.05,Math.min(1,(Number(tile.width)||1)/width,(Number(tile.height)||1)/height));
 return {width,height,deviceScaleFactor:env.scale||0,mobile:false,scale:Math.round(scale*10000)/10000,dontSetVisibleSize:true,...(hardware(env)||env.width?screenMetrics(env):screen.width?{screenWidth:screen.width,screenHeight:screen.height}:{})};}
module.exports={deviceMetrics,presentedBounds,applyViewport,tileMetrics};
