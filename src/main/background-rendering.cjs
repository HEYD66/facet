'use strict';
// Electron 44 on Windows may pause compositor frames after native minimization
// or a new RenderWidget, even though getBackgroundThrottling() remains false.
// Reapply that same native policy; never replace the page's animation functions.
function resume(contents) {
 if (!contents || contents.isDestroyed() || contents.getBackgroundThrottling()) return;
 contents.setBackgroundThrottling(false);
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
    if(tab.backgroundViewport&&contents&&!contents.isDestroyed()&&!runtime.viewportTiled&&!window.isMinimized()&&window.isVisible()&&!tab.backgroundViewportClearing){
     tab.backgroundViewportClearing=true;
     contents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride').then(()=>{delete tab.backgroundViewport;}).catch(()=>{}).finally(()=>{delete tab.backgroundViewportClearing;});
    }
   }
  }
 };
 const changed = () => {clearTimeout(pending);pending=setTimeout(refresh,100);};
 const events=['minimize','hide','restore','show'];
 for(const event of events)window.on(event,changed);
 const dispose=() => {clearTimeout(pending);for(const event of events)window.removeListener(event,changed);window.removeListener('closed',dispose);};
 window.once('closed',dispose);return dispose;
}
module.exports={resume,install};
