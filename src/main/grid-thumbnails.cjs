'use strict';
// Bound full-resolution captures as well as JPEG encoding; discard results after
// leaving/replacing the grid or stopping/replacing the instance's WebContents.
async function capture(controller,grid){
 let sf=1;try{sf=require('electron').screen.getDisplayMatching(controller.window.getBounds()).scaleFactor||1;}catch{}
 const out={},vp=require('./viewport.cjs'),screen=controller.screenSize(),base=controller.gridBase(),tiles=[...grid.tiles];let next=0;
 const current=()=>controller.grid===grid;
 async function worker(){while(current()&&next<tiles.length){const [id,t]=tiles[next++],r=controller.runtimes.get(id),wc=r?.view?.webContents;
  const valid=()=>current()&&controller.runtimes.get(id)===r&&r?.status==='running'&&r.view?.webContents===wc&&!wc.isDestroyed()&&grid.tiles.has(id);
  if(!wc||!valid()||(!r.gridCapture&&r.gridThumbAt&&Date.now()-r.gridThumbAt<10000))continue;
  try{let image=await wc.capturePage(undefined,{stayHidden:true});if(!valid()||image.isEmpty())continue;
   const {width:W,height:H}=image.getSize(),m=vp.tileMetrics(r.environment,t,base,screen),dpr=r.environment.scale||sf,cw=Math.max(1,Math.min(W,Math.round(m.width*m.scale*dpr))),ch=Math.max(1,Math.min(H,Math.round(m.height*m.scale*dpr)));
   if(cw<W-1||ch<H-1)image=image.crop({x:0,y:0,width:cw,height:ch});const width=Math.min(image.getSize().width,Math.round(t.width*Math.min(2,sf)));
   out[id]='data:image/jpeg;base64,'+image.resize({width,quality:'good'}).toJPEG(72).toString('base64');r.gridThumbAt=Date.now();
  }catch{} // Closing one page must not abort the remaining thumbnails.
 }}
 await Promise.all([worker(),worker()]);return current()?out:{};
}
module.exports={capture};
