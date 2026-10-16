'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {capture}=require('../src/main/grid-thumbnails.cjs');
test('captures are limited to two, failures do not block remaining tiles, exit cancels queued tiles',async()=>{
 let active=0,max=0,calls=0,release=[];
 const image={isEmpty:()=>false,getSize:()=>({width:100,height:100}),crop(){return this;},resize(){return this;},toJPEG:()=>Buffer.from('jpeg')};
 const c={screenSize:()=>({width:1000,height:800}),gridBase:()=>({width:1000,height:800}),runtimes:new Map()};
 const tiles=new Map();for(let i=0;i<5;i++){tiles.set(String(i),{width:100,height:100});c.runtimes.set(String(i),{status:'running',gridCapture:true,environment:{},view:{webContents:{isDestroyed:()=>false,capturePage:async()=>{calls++;active++;max=Math.max(max,active);await new Promise(r=>release.push(r));active--;if(i===0)throw Error('capture failed');return image;}}}});}
 c.grid={tiles};const work=capture(c,c.grid);assert.equal(calls,2);release.splice(0).forEach(r=>r());await new Promise(r=>setImmediate(r));assert.equal(calls,4);assert.equal(max,2);release.splice(0).forEach(r=>r());await new Promise(r=>setImmediate(r));assert.equal(calls,5);release.splice(0).forEach(r=>r());const result=await work;assert.equal(Object.keys(result).length,4);
 calls=0;release=[];const canceled=capture(c,c.grid);assert.equal(calls,2);c.grid=null;release.splice(0).forEach(r=>r());assert.deepEqual(await canceled,{});assert.equal(calls,2);
});
test('renderer does not overlap polling or accept results from a previous grid visit',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');let resolve,calls=0;
 const source=fs.readFileSync(require('node:path').join(__dirname,'../src/renderer/grid.js'),'utf8').split('\n').find(line=>line.startsWith('async function gridPollThumbs()'));
 const ctx=vm.createContext({view:'grid',gridThumbBusy:false,gridPrefs:{mode:'saver'},document:{hidden:false},gridRevision:1,state:{instances:[{id:'a',status:'running'}]},gridThumbCache:new Map(),gridPaintThumbs(){},gridLeave(){},bridge:{request(){calls++;return new Promise(r=>{resolve=r;});}}});
 vm.runInContext(source,ctx);const first=ctx.gridPollThumbs();await ctx.gridPollThumbs();assert.equal(calls,1);ctx.gridRevision=2;resolve({ok:true,value:{a:'data:image/jpeg;base64,old'}});await first;assert.equal(ctx.gridThumbCache.size,0);assert.equal(ctx.gridThumbBusy,false);
 const next=ctx.gridPollThumbs();resolve({ok:true,value:{a:'data:image/jpeg;base64,new'}});await next;assert.equal(ctx.gridThumbCache.get('a'),'data:image/jpeg;base64,new');
});
