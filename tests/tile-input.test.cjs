'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const tile=require('../src/main/tile-input.cjs');
// Frames as tile-input builds them: origin/scale/box in the parent's CSS pixels, size in the frame's own.
const frame=(sid,parent,x,y,w,h,s=1)=>({sid,parent,owner:sid+'-owner',origin:{x,y},scale:{x:s,y:s},size:{w,h},box:{x,y,w:w*s,h:h*s}});
const frames=[
 frame('a','',100,50,400,300),
 frame('b','a',20,30,200,100),          // nested inside a
 frame('t','',600,400,300,200,0.8),     // inside a transform: scale(0.8) container
 frame('lost','missing',0,0,50,50),     // parent no longer attached
];

test('chains run from the top-level frame down and stop at a missing parent',()=>{
 assert.deepEqual(tile.chainOf(frames,frames[1]).map(f=>f.sid),['a','b']);
 assert.deepEqual(tile.chainOf(frames,frames[0]).map(f=>f.sid),['a']);
 assert.equal(tile.chainOf(frames,frames[3]),null);
});

test('a point maps into each level, including scaled frames, and clamps only when asked',()=>{
 const chain=tile.chainOf(frames,frames[1]);
 assert.deepEqual(tile.toLocal(chain,{x:150,y:100}),{x:30,y:20});
 assert.deepEqual(tile.toLocal([frames[2]],{x:680,y:440}),{x:100,y:50});
 assert.equal(tile.toLocal(chain,{x:99,y:100}),null);
 assert.equal(tile.toLocal(chain,{x:500,y:100}),null,'the right edge is outside');
 assert.deepEqual(tile.toLocal(chain,{x:99,y:100},{clamp:true}),{x:-21,y:20});
});

test('the deepest frame under the point wins, and the targeted <iframe> must start the chain',()=>{
 assert.equal(tile.locate(frames,{x:150,y:100}).frame.sid,'b');
 assert.deepEqual(tile.locate(frames,{x:150,y:100}).point,{x:30,y:20});
 assert.equal(tile.locate(frames,{x:400,y:300}).frame.sid,'a');
 assert.equal(tile.locate(frames,{x:680,y:440}).frame.sid,'t');
 assert.equal(tile.locate(frames,{x:10,y:10}),null);
 // The outer page reported a different <iframe> than the one geometry finds: no delivery.
 assert.equal(tile.locate(frames,{x:150,y:100},{x:600,y:400,w:240,h:160}),null);
 assert.equal(tile.locate(frames,{x:150,y:100},{x:100.5,y:49.5,w:400,h:300}).frame.sid,'b');
 assert.equal(tile.locate(frames,{x:680,y:440},{x:600,y:400,w:240,h:160}).frame.sid,'t');
});

test('rectangles match within two CSS pixels',()=>{
 assert.equal(tile.sameRect({x:0,y:0,w:10,h:10},{x:2,y:-2,w:12,h:8}),true);
 assert.equal(tile.sameRect({x:0,y:0,w:10,h:10},{x:3,y:0,w:10,h:10}),false);
 assert.equal(tile.sameRect(null,{x:0,y:0,w:10,h:10}),false);
});

test('wheel deltas become pixels for every DOM delta mode',()=>{
 assert.equal(tile.wheelPixels(100,0),100);
 assert.equal(tile.wheelPixels(-3,1),-120);
 assert.equal(tile.wheelPixels(1,2,700),700);
 assert.equal(tile.wheelPixels(1,2),800);
 assert.equal(tile.wheelPixels('x',0),0);
});

test('only a shown, scaled-down grid tile counts as a tile',()=>{
 const wc={},view={webContents:wc},key=s=>'tile:'+JSON.stringify({width:1280,height:800,scale:s});
 assert.equal(tile.tileScale({viewportTiled:true,view,viewportKey:key(0.31)},wc),0.31);
 assert.equal(tile.tileScale({viewportTiled:true,view,viewportKey:key(1)},wc),0,'1:1 zoom is normal input');
 assert.equal(tile.tileScale({viewportTiled:false,view,viewportKey:key(0.31)},wc),0);
 assert.equal(tile.tileScale({viewportTiled:true,view:{webContents:{}},viewportKey:key(0.31)},wc),0,'another tab of the instance');
 assert.equal(tile.tileScale({viewportTiled:true,view,viewportKey:null},wc),0);
});
