'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const viewport=require('../src/main/viewport.cjs');
const env={width:0,height:0,scale:1.25,fingerprint:{enabled:true,hardware:true,screenWidth:1280,screenHeight:720}};

test('adaptive viewport fills its host within configured screen without changing DPR or settings',()=>{
 const original=structuredClone(env),m=viewport.deviceMetrics(env,{width:1600,height:600});
 assert.deepEqual([m.width,m.height,m.scale],[1280,480,1.25]);
 assert.equal(m.deviceScaleFactor,1.25);assert.equal(m.dontSetVisibleSize,true);
 assert.deepEqual(env,original);
 assert.deepEqual(viewport.deviceMetrics(env,{width:800,height:600}),{width:0,height:0,deviceScaleFactor:1.25,mobile:false,scale:1,dontSetVisibleSize:true,screenWidth:1280,screenHeight:720});
});

test('adaptive fitting covers wide/tall/odd hosts and avoids floating point screen overflow',()=>{
 for(const sw of [800,1280,1366,1536,1920,2560])for(const sh of [600,720,768,1080,1440])for(let bw=320;bw<4000;bw+=37)for(const bh of [300,601,900,1111,2160]){
  const m=viewport.deviceMetrics({...env,fingerprint:{...env.fingerprint,screenWidth:sw,screenHeight:sh}},{width:bw,height:bh});
  if(!m.width){assert(bw<=sw&&bh<=sh);continue;}
  assert(Number.isInteger(m.width)&&Number.isInteger(m.height));assert(m.width<=sw&&m.height<=sh);
  assert(m.width*m.scale>=bw-1e-8&&m.height*m.scale>=bh-1e-8);
  assert(m.width*m.scale<bw+m.scale+1e-8&&m.height*m.scale<bh+m.scale+1e-8,'at most one logical pixel rounding at an edge');
 }
});

test('fixed, disabled hardware and grid modes preserve their sizing policy and native backing surface',()=>{
 const fixed=viewport.deviceMetrics({...env,width:1280,height:720},{width:800,height:600});
 assert.deepEqual([fixed.width,fixed.height,fixed.scale],[1280,720,.625]);assert.equal(fixed.dontSetVisibleSize,true);
 const off=viewport.deviceMetrics({...env,fingerprint:{...env.fingerprint,hardware:false}},{width:1600,height:900});
 assert.deepEqual([off.width,off.height,off.scale],[0,0,1]);assert.equal(off.screenWidth,undefined);
 const normal=viewport.deviceMetrics(env,{width:1600,height:600}),grid=viewport.tileMetrics(env,{width:400,height:250},{width:1600,height:600});
 assert.deepEqual([grid.width,grid.height],[normal.width,normal.height]);assert(grid.scale<1);assert.equal(grid.dontSetVisibleSize,true);
 assert.equal(grid.screenWidth,1280);assert.equal(grid.deviceScaleFactor,1.25);
});
