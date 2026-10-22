'use strict';
// Electron 44 on Windows may pause compositor frames after native minimization
// or a new RenderWidget, even though getBackgroundThrottling() remains false.
// Reapply that same native policy; never replace the page's animation functions.
function resume(contents) {
 if (!contents || contents.isDestroyed() || contents.getBackgroundThrottling()) return;
 contents.setBackgroundThrottling(false);
}
// Policy belongs to every loaded tab, including tabs hidden before leaving grid.
function setThrottling(runtime, throttle) {
 const contents=new Set([runtime.view?.webContents,...[...(runtime.tabs?.values()||[])].map(tab=>tab.view?.webContents)]);
 for(const page of contents)if(page&&!page.isDestroyed()&&page.getBackgroundThrottling()!==throttle)page.setBackgroundThrottling(throttle);
}
function restoreViewport(window,runtime,tab){
 const view=tab?.view,contents=view?.webContents;
 // A hidden RenderWidget may still report 0x0 after restore even with nonzero
 // View bounds. Retain its temporary metrics until that tab is actually shown.
 if(!tab?.backgroundViewport||!contents||contents.isDestroyed()||!view.getVisible()||runtime.viewportTiled||window.isDestroyed()||window.isMinimized()||!window.isVisible()||tab.backgroundViewportClearing)return;
 const bounds=view.getBounds();if(bounds.width<1||bounds.height<1)return;
 tab.backgroundViewportClearing=true;
 contents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride').then(()=>{delete tab.backgroundViewport;}).catch(()=>{}).finally(()=>{delete tab.backgroundViewportClearing;});
}
function scheduleViewportRestore(window,runtime,tab){
 if(!tab?.backgroundViewport||tab.backgroundViewportTimer)return;
 tab.backgroundViewportTimer=setTimeout(()=>{delete tab.backgroundViewportTimer;restoreViewport(window,runtime,tab);},100);tab.backgroundViewportTimer.unref?.();
}
function install(window, runtimes) {
 let pending;
 const refresh = () => {
  if (window.isDestroyed()) return;
  resume(window.webContents);
  for (const runtime of runtimes.values()) {
   for (const tab of runtime.tabs?.values() || []) {
    const contents=tab.view?.webContents;
    resume(contents);
    restoreViewport(window,runtime,tab);
   }
  }
 };
 const changed = () => {clearTimeout(pending);pending=setTimeout(refresh,100);};
 const events=['minimize','hide','restore','show'];
 for(const event of events)window.on(event,changed);
 const dispose=() => {clearTimeout(pending);for(const event of events)window.removeListener(event,changed);window.removeListener('closed',dispose);};
 window.once('closed',dispose);return dispose;
}
module.exports={resume,install,setThrottling,scheduleViewportRestore};
