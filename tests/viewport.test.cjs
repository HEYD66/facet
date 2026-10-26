'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const viewport=require('../src/main/viewport.cjs');
const env={width:0,height:0,scale:1.25,fingerprint:{enabled:true,hardware:true,screenWidth:1280,screenHeight:720}};

// Issue #10: any presentation scale other than 1 made real clicks inconsistent
// (screen vs client coordinates) and Cloudflare Turnstile rejected them.
test('normal browsing is never scaled: the view is limited to the configured screen and centred',()=>{
 const original=structuredClone(env);
 for(const host of [{x:10,y:20,width:1600,height:600},{x:0,y:0,width:800,height:900},{x:5,y:5,width:3000,height:2000},{x:0,y:0,width:800,height:600}]){
  const m=viewport.deviceMetrics(env,host),b=viewport.presentedBounds(env,host);
  assert.deepEqual([m.width,m.height,m.scale,m.deviceScaleFactor,m.screenWidth,m.screenHeight,m.dontSetVisibleSize],[b.width,b.height,1,1.25,1280,720,true]);
  // The height leaves a browser toolbar's room inside the screen (720 - 80; no availHeight given), so innerHeight < outerHeight.
  assert.equal(b.width,Math.min(host.width,1280));assert.equal(b.height,Math.min(host.height,640));
  assert(b.x>=host.x&&b.y>=host.y&&b.x+b.width<=host.x+host.width&&b.y+b.height<=host.y+host.height);
  assert(Math.abs((b.x-host.x)-(host.x+host.width-b.x-b.width))<=1,'horizontally centred');
  assert(Math.abs((b.y-host.y)-(host.y+host.height-b.y-b.height))<=1,'vertically centred');
 }
 assert.deepEqual(env,original);
 // With availHeight the room is taken from the available area; a fixed viewport is held to the same limit.
 const avail={...env,fingerprint:{...env.fingerprint,screenWidth:1366,screenHeight:768,availHeight:728}};
 assert.equal(viewport.presentedBounds(avail,{x:0,y:0,width:1454,height:900}).height,648);
 assert.equal(viewport.presentedBounds({...avail,width:1366,height:768},{x:0,y:0,width:1454,height:900}).height,648);
});

test('fixed viewports show at their size and follow a smaller area instead of shrinking the page',()=>{
 const fixed={...env,width:1280,height:720,fingerprint:{enabled:false}};
 assert.deepEqual(viewport.presentedBounds(fixed,{x:0,y:0,width:800,height:600}),{x:0,y:0,width:800,height:600});
 assert.deepEqual(viewport.presentedBounds(fixed,{x:0,y:0,width:1600,height:1000}),{x:160,y:140,width:1280,height:720});
 const m=viewport.deviceMetrics(fixed,{width:800,height:600});
 assert.deepEqual([m.width,m.height,m.scale,m.screenWidth,m.screenHeight],[800,600,1,1280,720]);
 const off={...env,fingerprint:{...env.fingerprint,hardware:false}},o=viewport.deviceMetrics(off,{width:1600,height:900});
 assert.deepEqual([o.width,o.height,o.scale],[1600,900,1]);assert.equal(o.screenWidth,undefined);
 assert.deepEqual(viewport.presentedBounds(off,{x:3,y:4,width:1600,height:900}),{x:3,y:4,width:1600,height:900});
 assert.deepEqual(viewport.presentedBounds(undefined,{x:1,y:2,width:30,height:40}),{x:1,y:2,width:30,height:40});
});

test('grid previews lay out exactly like normal browsing and only shrink the rendering',()=>{
 const base={width:1600,height:600},normal=viewport.presentedBounds(env,base),grid=viewport.tileMetrics(env,{width:400,height:250},base);
 assert.deepEqual([grid.width,grid.height],[normal.width,normal.height]);assert(grid.scale<1);assert.equal(grid.dontSetVisibleSize,true);
 assert.equal(grid.screenWidth,1280);assert.equal(grid.deviceScaleFactor,1.25);
 const fixed=viewport.tileMetrics({...env,width:1266,height:626},{width:400,height:250},{width:1000,height:700});
 assert.deepEqual([fixed.width,fixed.height],[1000,626]);
});
