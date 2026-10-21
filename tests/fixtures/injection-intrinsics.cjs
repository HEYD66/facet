'use strict';
// Run unchanged in a native renderer and one with the production injection.
// A site's instrumentation of JavaScript helpers must not break browser APIs.
async function intrinsicsProbe(){
 const apply=Reflect.apply,descriptor=Object.getOwnPropertyDescriptor,define=Object.defineProperty;
 const rows=[];
 async function instrument(label,object,key,read){
  const previous=descriptor(object,key);let calls=0;
  define(object,key,{...previous,value:function(){calls++;throw Error('website helper hook');}});
  let value;
  try{value=await read();}catch(e){value={error:e.name,message:e.message};}
  finally{define(object,key,previous);}
  rows.push({label,value,calls});
 }
 const canvas=new OffscreenCanvas(8,8),context=canvas.getContext('2d');
 const toString=Function.prototype.toString;
 for(const key of ['has','get'])await instrument('WeakMap.'+key,WeakMap.prototype,key,()=>apply(toString,OffscreenCanvas.prototype.getContext,[]));
 await instrument('WeakMap.set / canvas context',WeakMap.prototype,'set',()=>!!new OffscreenCanvas(4,4).getContext('2d'));
 await instrument('WeakMap.get / canvas export',WeakMap.prototype,'get',async()=> (await canvas.convertToBlob()).type);
 for(const [object,key,label]of [[Reflect,'get','Reflect.get'],[Object,'create','Object.create'],[globalThis,'Proxy','Proxy'],[globalThis,'String','String']]){
  await instrument(label+' / export options',object,key,async()=>(await canvas.convertToBlob({type:'image/png'})).type);
 }
 for(const key of ['abs','floor','max','min'])await instrument('Math.'+key+' / pixels',Math,key,()=>context.getImageData(0,0,8,8).width);
 const glCanvas=new OffscreenCanvas(8,8),gl=glCanvas.getContext('webgl');
 if(gl){
  await instrument('Array.slice / WebGL enum',Array.prototype,'slice',()=>gl.getParameter({valueOf(){return gl.MAX_TEXTURE_SIZE;}})>0);
  await instrument('Number / WebGL enum',globalThis,'Number',()=>gl.getParameter(gl.MAX_TEXTURE_SIZE)>0);
 }
 if(typeof OfflineAudioContext!=='undefined'){
  for(const key of ['has','add'])await instrument('WeakSet.'+key+' / audio',WeakSet.prototype,key,async()=>{
   const audio=new OfflineAudioContext(1,16,48000);return (await audio.startRendering()).length;
  });
  await instrument('Reflect.construct / audio',Reflect,'construct',()=>new OfflineAudioContext(1,16,48000).length);
 }
 if(typeof document!=='undefined'){
  const element=document.createElement('div');element.style.cssText='width:20px;height:10px';document.body.append(element);
  await instrument('Function.apply / layout',Function.prototype,'apply',()=>element.getBoundingClientRect().width);
  await instrument('DOMRect / layout',globalThis,'DOMRect',()=>element.getBoundingClientRect().width);
  element.remove();
 }
 return rows;
}
module.exports={intrinsicsProbe};
