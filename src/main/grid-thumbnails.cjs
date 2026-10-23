'use strict';
// Bound full-resolution captures as well as JPEG encoding; discard results after
// leaving/replacing the grid or stopping/replacing the instance's WebContents.
// A page that has never been shown has no compositor surface: capturePage then
// resolves empty at once, with or without stayHidden or background throttling.
// Such a saver tile is shown in place (its own tile, inside the native grid clip)
// until the first frame exists, then follows the layout's visibility again.
// Never while a dialog, menu, zoom or scroll could be covered by the native view.
const PRIME_WAIT=1500,PRIME_RETRY=10000;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function primeAllowed(grid,t){
 const v=grid.viewport;if(grid.mode!=='saver'||grid.overlay||!v||grid.coordinates!=='content'||!t||t.live)return false;
 const top=t.y-grid.scrollTop;return t.x<v.width&&t.x+t.width>0&&top<v.height&&top+t.height>0;
}
async function prime(controller,grid,id,r,wc,valid){
 if(r.gridPrimed===wc||r.gridPrimeAt&&Date.now()-r.gridPrimeAt<PRIME_RETRY||!primeAllowed(grid,grid.tiles.get(id)))return null;
 const view=r.view;r.gridPrimeAt=Date.now();let image=null;
 try{
  view.setVisible(true);
  for(const end=Date.now()+PRIME_WAIT;valid()&&Date.now()<end;){const shot=await wc.capturePage(undefined,{stayHidden:true});if(!shot.isEmpty()){image=shot;break;}await sleep(30);}
 }finally{
  // The layout may have changed meanwhile. After leaving the grid, setGrid(null)
  // and the browser layout already own visibility, so leave it untouched.
  if(controller.grid&&!wc.isDestroyed())view.setVisible(controller.runtimes.get(id)===r&&r.view===view&&r.gridApplied?.visible===true);
 }
 if(image)r.gridPrimed=wc;return image;
}
async function capture(controller,grid){
 let sf=1;try{sf=require('electron').screen.getDisplayMatching(controller.window.getBounds()).scaleFactor||1;}catch{}
 const out={},vp=require('./viewport.cjs'),screen=controller.screenSize(),base=controller.gridBase(),tiles=[...grid.tiles];let next=0;
 const current=()=>controller.grid===grid;
 async function worker(){while(current()&&next<tiles.length){const [id,t]=tiles[next++],r=controller.runtimes.get(id),wc=r?.view?.webContents;
  const valid=()=>current()&&controller.runtimes.get(id)===r&&r?.status==='running'&&r.view?.webContents===wc&&!wc.isDestroyed()&&grid.tiles.has(id);
  if(!wc||!valid()||(!r.gridCapture&&r.gridThumbAt&&Date.now()-r.gridThumbAt<10000))continue;
  try{let image=await wc.capturePage(undefined,{stayHidden:true});if(!valid())continue;if(image.isEmpty())image=await prime(controller,grid,id,r,wc,valid);if(!image||!valid()||image.isEmpty())continue;
   const {width:W,height:H}=image.getSize(),m=vp.tileMetrics(r.environment,t,base,screen),dpr=r.environment.scale||sf,cw=Math.max(1,Math.min(W,Math.round(m.width*m.scale*dpr))),ch=Math.max(1,Math.min(H,Math.round(m.height*m.scale*dpr)));
   if(cw<W-1||ch<H-1)image=image.crop({x:0,y:0,width:cw,height:ch});const width=Math.min(image.getSize().width,Math.round(t.width*Math.min(2,sf)));
   out[id]='data:image/jpeg;base64,'+image.resize({width,quality:'good'}).toJPEG(72).toString('base64');r.gridThumbAt=Date.now();
  }catch{} // Closing one page must not abort the remaining thumbnails.
 }}
 await Promise.all([worker(),worker()]);return current()?out:{};
}
module.exports={capture,primeAllowed};
