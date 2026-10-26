'use strict';
// Mouse and wheel over cross-site iframes inside scaled grid tiles (main process: tile-input.cjs).
// Runs in the isolated world of the top frame only; the page's own scripts cannot see it.
// In a tile, a mouse or wheel event the outer page receives with an <iframe> as its target, over
// that iframe's content box, is one Chromium failed to route into the out-of-process frame (a
// correctly routed event never reaches the parent document at all). Such events are stopped
// before any page listener runs and reported to the main process, which delivers them to the
// frame. A press keeps the following moves and the release until all buttons are up.
// Outside tiles every event passes through untouched.
const {ipcRenderer}=require('electron');
if(window.top===window){
 const TYPES=['pointerdown','pointerup','pointermove','pointerrawupdate','pointerover','pointerout','pointerenter','pointerleave','pointercancel','gotpointercapture','lostpointercapture','mousedown','mouseup','mousemove','mouseover','mouseout','mouseenter','mouseleave','click','dblclick','auxclick','contextmenu','wheel','dragstart','selectstart'];
 const BUTTONS=['left','middle','right','back','forward'];
 let active=false,captured=false,hovering=false;
 const post=data=>{try{ipcRenderer.send('facet:tile-pointer',data);}catch{}};
 const modifiers=e=>(e.altKey?1:0)|(e.ctrlKey?2:0)|(e.metaKey?4:0)|(e.shiftKey?8:0);
 // The iframe's content box (where its document is shown) in viewport CSS pixels; border and
 // padding belong to the outer page.
 function contentBox(el){
  const r=el.getBoundingClientRect(),w=el.offsetWidth,h=el.offsetHeight;if(!w||!h||!r.width||!r.height)return null;
  const sx=r.width/w,sy=r.height/h,cs=getComputedStyle(el),px=v=>parseFloat(v)||0;
  const pl=px(cs.paddingLeft),pt=px(cs.paddingTop),pr=px(cs.paddingRight),pb=px(cs.paddingBottom);
  return {x:r.left+(el.clientLeft+pl)*sx,y:r.top+(el.clientTop+pt)*sy,w:(el.clientWidth-pl-pr)*sx,h:(el.clientHeight-pt-pb)*sy,rect:{x:r.left,y:r.top,w:r.width,h:r.height}};
 }
 function overFrame(e){
  const t=e.target;if(!(t instanceof HTMLIFrameElement))return null;
  const box=contentBox(t);return box&&e.clientX>=box.x&&e.clientY>=box.y&&e.clientX<box.x+box.w&&e.clientY<box.y+box.h?box:null;
 }
 function leave(){if(hovering){hovering=false;post({kind:'leave'});}}
 function onEvent(e){
  if(!active||e.pointerType&&e.pointerType!=='mouse')return;
  // A move with no button held while captured: the release happened where this page never saw it.
  if(captured&&e.type==='mousemove'&&!e.buttons){captured=false;post({kind:'cancel'});}
  const box=captured?null:overFrame(e);
  if(!captured&&!box){if(e.type==='mousemove'||e.type==='mouseout'&&!e.relatedTarget)leave();return;}
  // Cancelling pointerdown would also suppress the compatibility mouse events reported below.
  e.stopImmediatePropagation();if(e.cancelable&&!e.type.startsWith('pointer')&&!e.type.endsWith('pointercapture'))e.preventDefault();
  const at={x:e.clientX,y:e.clientY,modifiers:modifiers(e)};if(box)at.rect=box.rect;
  if(e.type==='mousemove'){hovering=true;post({kind:'move',...at,buttons:e.buttons});}
  else if(e.type==='mousedown'){captured=true;hovering=true;post({kind:'down',...at,button:BUTTONS[e.button]||'none',buttons:e.buttons,clicks:e.detail||1});}
  else if(e.type==='mouseup'){if(!e.buttons)captured=false;post({kind:'up',...at,button:BUTTONS[e.button]||'none',buttons:e.buttons,clicks:e.detail||1});}
  else if(e.type==='wheel')post({kind:'wheel',...at,dx:e.deltaX,dy:e.deltaY,mode:e.deltaMode,page:innerHeight});
  else if(e.type==='mouseout'&&!e.relatedTarget&&!captured)leave();
 }
 // Registered now, before any page script, so these listeners run first even though tile mode
 // is only known later; outside tiles they return at once.
 for(const type of TYPES)window.addEventListener(type,onEvent,{capture:true,passive:false});
 const set=value=>{
  const next=value===true;if(next===active)return;active=next;
  if(!active){if(captured)post({kind:'cancel'});captured=false;hovering=false;}
 };
 window.addEventListener('blur',()=>{if(captured){captured=false;post({kind:'cancel'});}leave();});
 ipcRenderer.on('facet:tile-input',(_event,value)=>set(value));
 ipcRenderer.invoke('facet:tile-input-get').then(set).catch(()=>{});
}
