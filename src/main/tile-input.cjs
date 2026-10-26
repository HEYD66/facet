'use strict';
// Mouse and wheel input for cross-site iframes inside scaled grid tiles.
//
// A live grid tile shows the page laid out at its normal size and shrunk with the emulation
// scale (viewport.cjs tileMetrics). In the grid, Chromium can then fail to route input into
// out-of-process iframes: clicks and wheel over an embedded preview (arena.ai's HTML preview,
// payment and login widgets) reach the outer page with the <iframe> element as their target and
// the iframe never gets them. Measured on arena.ai in a 0.31 tile: 0 of 1 clicks and 0 of 3 wheel
// notches reached the preview, all of them reached the outer page; the 1:1 zoom dialog and normal
// browsing are not affected.
//
// While a tab is shown as a tile, the frame preload (tile-input-preload.cjs, isolated world of the
// top frame) stops exactly those misrouted events before the page sees them and reports them here.
// This module finds the out-of-process frame that should have received each one and delivers it
// through that frame's own DevTools session, which is not hit-tested again. The outer page's own
// event targeting already decided that the <iframe> is the topmost element at the point (not
// covered, not pointer-events:none); deeper levels of nested frames are checked with each parent
// document's hit test (DOM.getNodeForLocation). Only misrouted events are touched, so wherever
// Chromium routes correctly nothing changes.
// Verification widgets still reject clicks in a scaled tile (their screen coordinates are scaled);
// the 1:1 zoom dialog remains the way to complete them.
const {contextEnvironmentState,targetCommand}=require('./environment-contexts.cjs');
const MAP_TTL=500,LINE=40,RECT_NEAR=2,MAX_DELTA=100000;
const states=new WeakMap(),attached=new WeakSet(),owners=new Set();
let ipcInstalled=false;

// Pure geometry (unit tested): frames are {sid,parent,owner,origin:{x,y},scale:{x,y},size:{w,h},box}
// with origin/scale/box in the parent frame's CSS pixels (box = bounding box of the border quad).
// chainOf returns root..frame, or null when the chain is broken.
function chainOf(frames,frame){
 const chain=[];let f=frame;
 for(let i=0;f&&i<16;i++){chain.unshift(f);if(!f.parent)return chain;f=frames.find(x=>x.sid===f.parent);}
 return null;
}
// The point in the last frame's own CSS pixels, or null when it is outside a frame of the chain.
function toLocal(chain,point,{clamp=false}={}){
 let q=point;
 for(const f of chain){
  q={x:(q.x-f.origin.x)/f.scale.x,y:(q.y-f.origin.y)/f.scale.y};
  if(!clamp&&(q.x<0||q.y<0||q.x>=f.size.w||q.y>=f.size.h))return null;
 }
 return q;
}
function sameRect(a,b,limit=RECT_NEAR){return !!a&&!!b&&['x','y','w','h'].every(k=>Math.abs(Number(a[k])-Number(b[k]))<=limit);}
// Deepest frame whose whole chain contains the point. With `rect` (the <iframe> the outer page
// targeted), the chain must start at that element.
function locate(frames,point,rect){
 let best=null;
 for(const f of frames){
  const chain=chainOf(frames,f);if(!chain||rect&&!sameRect(chain[0].box,rect))continue;
  const local=toLocal(chain,point);if(local&&(!best||chain.length>best.chain.length))best={frame:f,chain,point:local};
 }
 return best;
}
function wheelPixels(delta,mode,page){const n=Number(delta)||0;return mode===1?n*LINE:mode===2?n*(Number(page)||800):n;}
function tileScale(r,wc){
 if(!r?.viewportTiled||r.view?.webContents!==wc)return 0;
 try{const m=JSON.parse(String(r.viewportKey||'').replace(/^tile:/,''));const s=Number(m.scale);return Number.isFinite(s)&&s>0&&s<1?s:0;}catch{return 0;}
}

const send=(wc,method,params,sid)=>targetCommand(wc,method,params,sid||undefined);
// Geometry of every out-of-process iframe the environment layer is attached to.
async function buildFrames(wc){
 const env=contextEnvironmentState(wc);if(!env?.targetIds)return [];
 const frames=[];
 for(const [sid,type] of env.children){if(type!=='iframe')continue;const targetId=env.targetIds.get(sid);if(targetId)frames.push({sid,targetId,parent:env.parents?.get(sid)||''});}
 const placed=await Promise.all(frames.map(async f=>{
  try{
   const {backendNodeId}=await send(wc,'DOM.getFrameOwner',{frameId:f.targetId},f.parent);
   const {model}=await send(wc,'DOM.getBoxModel',{backendNodeId},f.parent);
   const b=model.border,c=model.content,sx=model.width?(b[2]-b[0])/model.width:1,sy=model.height?(b[5]-b[1])/model.height:1;
   if(!(sx>0&&sy>0))return null;
   const xs=[b[0],b[2],b[4],b[6]],ys=[b[1],b[3],b[5],b[7]],bx=Math.min(...xs),by=Math.min(...ys);
   return {...f,owner:backendNodeId,origin:{x:c[0],y:c[1]},scale:{x:sx,y:sy},size:{w:(c[2]-c[0])/sx,h:(c[5]-c[1])/sy},box:{x:bx,y:by,w:Math.max(...xs)-bx,h:Math.max(...ys)-by}};
  }catch{return null;}
 }));
 return placed.filter(Boolean);
}
function state(wc){let s=states.get(wc);if(!s){s={frames:[],framesAt:0,framesWork:null,queue:[],running:false,capture:null,captureButton:'left',hover:null,last:null,active:undefined};states.set(wc,s);}return s;}
async function frames(wc){
 const s=state(wc);if(Date.now()-s.framesAt<MAP_TTL)return s.frames;
 s.framesWork??=buildFrames(wc).then(list=>{s.frames=list;s.framesAt=Date.now();return list;}).finally(()=>{s.framesWork=null;});
 return s.framesWork;
}
// Nested levels: inside each out-of-process parent, the child's <iframe> must be the topmost element.
async function verifyNested(wc,hit,point){
 let q=toLocal([hit.chain[0]],point,{clamp:true});
 for(let i=1;i<hit.chain.length;i++){
  const parent=hit.chain[i-1],f=hit.chain[i];
  let top;try{top=await send(wc,'DOM.getNodeForLocation',{x:Math.round(q.x),y:Math.round(q.y),includeUserAgentShadowDOM:false},parent.sid);}catch{return false;}
  if(top?.backendNodeId!==f.owner)return false;
  q=toLocal([f],q,{clamp:true});
 }
 return true;
}
async function resolve(wc,point,rect,{nested=true}={}){
 const hit=locate(await frames(wc),point,rect);if(!hit)return null;
 return !nested||hit.chain.length===1||await verifyNested(wc,hit,point)?hit:null;
}
function dispatch(wc,hit,type,point,extra={}){
 const local=toLocal(hit.chain,point,{clamp:true});
 return send(wc,'Input.dispatchMouseEvent',{type,x:local.x,y:local.y,...extra},hit.frame.sid).catch(()=>{});
}
const leaveFrame=(wc,hit)=>send(wc,'Input.dispatchMouseEvent',{type:'mouseMoved',x:-1,y:-1},hit.frame.sid).catch(()=>{});
const finite=(...values)=>values.every(v=>Number.isFinite(v)&&Math.abs(v)<=MAX_DELTA);
const BUTTONS=new Set(['none','left','middle','right','back','forward']);

// One reported event, in order. The outer page has already been kept from handling it.
async function handle(wc,m){
 const s=state(wc),point={x:Number(m.x),y:Number(m.y)},modifiers=Number(m.modifiers)&15;
 const button=BUTTONS.has(m.button)?m.button:'none',buttons=Number(m.buttons)&31,clickCount=Math.max(1,Math.min(3,Number(m.clicks)||1));
 if(m.kind==='leave'||m.kind==='cancel'){
  if(s.capture&&s.last)await dispatch(wc,s.capture,'mouseReleased',s.last,{button:s.captureButton,buttons:0,clickCount:1,modifiers});
  s.capture=null;if(m.kind==='leave'&&s.hover){await leaveFrame(wc,s.hover);s.hover=null;}return;
 }
 if(!finite(point.x,point.y))return;
 if(m.kind==='move'){
  const hit=s.capture||await resolve(wc,point,m.rect,{nested:false});
  if(s.hover&&s.hover.frame.sid!==hit?.frame.sid)await leaveFrame(wc,s.hover);
  s.hover=hit;if(hit){s.last=point;await dispatch(wc,hit,'mouseMoved',point,{button:s.capture?s.captureButton:'none',buttons,modifiers});}
 }else if(m.kind==='down'){
  const hit=s.capture||await resolve(wc,point,m.rect);if(!hit)return;
  if(!s.capture){s.capture=hit;s.captureButton=button;}
  s.hover=hit;s.last=point;await dispatch(wc,hit,'mousePressed',point,{button,buttons,clickCount,modifiers});
 }else if(m.kind==='up'){
  const hit=s.capture||await resolve(wc,point,m.rect);if(!buttons)s.capture=null;if(!hit)return;
  s.last=point;await dispatch(wc,hit,'mouseReleased',point,{button,buttons,clickCount,modifiers});
 }else if(m.kind==='wheel'){
  const page=Number(m.page)||0,dx=wheelPixels(m.dx,m.mode,page),dy=wheelPixels(m.dy,m.mode,page);if(!finite(dx,dy))return;
  const hit=await resolve(wc,point,m.rect);if(hit)await dispatch(wc,hit,'mouseWheel',point,{deltaX:dx,deltaY:dy,modifiers});
 }
}
// Events are handled strictly in order; queued moves collapse into the latest one.
function enqueue(wc,m){
 const s=state(wc),tail=s.queue.at(-1);
 if(m.kind==='move'&&tail?.kind==='move')s.queue[s.queue.length-1]=m;else if(s.queue.length<200)s.queue.push(m);
 if(s.running)return;s.running=true;
 (async()=>{while(s.queue.length&&!wc.isDestroyed())await handle(wc,s.queue.shift()).catch(()=>{});})().finally(()=>{s.running=false;});
}
function runtimeFor(wc){for(const c of owners)for(const r of c.runtimes.values())if(r.view?.webContents===wc)return r;return null;}
function installIPC(c){
 owners.add(c);if(ipcInstalled)return;ipcInstalled=true;
 const {ipcMain}=require('electron');
 ipcMain.handle('facet:tile-input-get',event=>{const r=runtimeFor(event.sender);return !!(r&&attached.has(event.sender)&&tileScale(r,event.sender));});
 ipcMain.on('facet:tile-pointer',(event,data)=>{
  const wc=event.sender;if(!attached.has(wc)||event.senderFrame!==wc.mainFrame||!data||typeof data!=='object')return;
  const r=runtimeFor(wc),known=['move','down','up','wheel','leave','cancel'].includes(data.kind);
  if(!known)return;if(!r||!tileScale(r,wc)){if(data.kind==='cancel'||data.kind==='leave')enqueue(wc,data);return;}
  enqueue(wc,data);
 });
}
function attach(c,r,wc){
 if(attached.has(wc))return;attached.add(wc);installIPC(c);state(wc);
 // A new document starts with no hover or press state in any frame.
 wc.on('did-start-navigation',(_event,_url,inPlace,main)=>{if(main&&!inPlace){const s=state(wc);s.capture=null;s.hover=null;s.framesAt=0;}});
 wc.once('destroyed',()=>states.delete(wc));
}
// Tile mode changed for this tab: tell the frame preload whether to watch for misrouted events.
function changed(r,wc){
 if(!wc||wc.isDestroyed()||!attached.has(wc))return;const s=state(wc),active=!!tileScale(r,wc);
 if(s.active===active)return;s.active=active;s.framesAt=0;
 if(!active){if(s.capture&&s.last)dispatch(wc,s.capture,'mouseReleased',s.last,{button:s.captureButton,buttons:0,clickCount:1});if(s.hover)leaveFrame(wc,s.hover);s.capture=null;s.hover=null;s.queue.length=0;}
 try{wc.send('facet:tile-input',active);}catch{}
}
module.exports={attach,changed,installIPC,locate,toLocal,chainOf,sameRect,wheelPixels,tileScale};
