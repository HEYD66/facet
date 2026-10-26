'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const id=require('../src/main/gpu-identity.cjs'),catalog=require('../src/main/fingerprint-catalog.cjs');

test('renderers use the format Chromium 152 reports on Windows, and both Facet formats parse',()=>{
 // Native value measured on this machine (RTX 4060 Laptop GPU).
 assert.equal(id.rendererString('NVIDIA','NVIDIA GeForce RTX 4060 Laptop GPU','0x28a0'),'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU (0x000028A0) Direct3D11 vs_5_0 ps_5_0, D3D11)');
 assert.deepEqual(id.parseRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU (0x000028A0) Direct3D11 vs_5_0 ps_5_0, D3D11)'),{brand:'NVIDIA',model:'NVIDIA GeForce RTX 4060 Laptop GPU',id:'0x000028A0'});
 assert.deepEqual(id.parseRenderer('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)'),{brand:'Intel',model:'Intel(R) Iris(R) Xe Graphics',id:null});
 assert.deepEqual(id.parseRenderer('ANGLE (Intel, Intel(R) Arc(TM) 130T GPU (16GB) (0x00007D51) Direct3D11 vs_5_0 ps_5_0, D3D11)'),{brand:'Intel',model:'Intel(R) Arc(TM) 130T GPU (16GB)',id:'0x00007D51'});
 for(const bad of ['','ANGLE (Apple, Apple M1 Direct3D11 vs_5_0 ps_5_0)','ANGLE (NVIDIA, NVIDIA GeForce GTX 560 Direct3D9Ex vs_3_0 ps_3_0)','Mesa Intel(R) UHD Graphics'])assert.equal(id.parseRenderer(bad),null);
 assert.throws(()=>id.rendererString('Apple','Apple M1','0x1'));
});

test('device IDs map to the architecture names Dawn reports',()=>{
 for(const [brand,device,want] of [['NVIDIA','0x000028A0','lovelace'],['NVIDIA','0x00002484','ampere'],['NVIDIA','0x00001F06','turing'],['NVIDIA','0x00001C03','pascal'],['NVIDIA','0x00001380','maxwell'],['NVIDIA','0x00000FC2','kepler'],['NVIDIA','0x00002D05','blackwell'],
  ['AMD','0x000073DF','rdna-2'],['AMD','0x000015BF','rdna-3'],['AMD','0x00007340','rdna-1'],['AMD','0x000067DF','gcn-4'],['AMD','0x00001636','gcn-5'],['AMD','0x00006611','gcn-1'],
  ['Intel','0x00009A49','gen-12lp'],['Intel','0x000056A0','gen-12hp'],['Intel','0x00007D55','xe-lpg'],['Intel','0x00003E92','gen-9'],['Intel','0x00008A51','gen-11'],['Intel','0x00001616','gen-8'],['Intel','0x00000412','gen-7'],
  ['AMD','0x00009990',''],['NVIDIA','0x0000FFFF','']])assert.equal(id.dawnArchitecture(brand,device),want,brand+' '+device);
});

test('GPUs without Direct3D 12 have no WebGPU adapter',()=>{
 for(const [brand,device,want] of [['NVIDIA','0x00000DE1',false],['NVIDIA','0x0000104A',false],['NVIDIA','0x00001201',false],['NVIDIA','0x00001245',false],['NVIDIA','0x00000FC2',true],['NVIDIA','0x00001284',true],['NVIDIA','0x00001005',true],
  ['AMD','0x000068D9',false],['AMD','0x00009990',false],['AMD','0x00006611',true],['AMD','0x00009874',true],['AMD','0x000073DF',true],
  ['Intel','0x00000116',false],['Intel','0x00000166',false],['Intel','0x00000F31',false],['Intel','0x00000412',true],['Intel','0x000022B1',true]])assert.equal(id.webgpuSupportedById(brand,device),want,brand+' '+device);
});

test('name rules agree with the device IDs the catalog has seen for the same model',()=>{
 // APU graphics names were reused across generations (Kaveri, Carrizo, Stoney): any GCN is plausible.
 const rebranded=/\br[1-7]e? graphics\b/i;
 let checked=0;
 for(const g of catalog.GPUS){
  if(!g.ids.length)continue;
  const byName=id.architectureByName(g.brand,g.model),arches=new Set(g.ids.map(x=>id.dawnArchitecture(g.brand,x)));
  assert(g.ids.some(x=>id.webgpuSupportedById(g.brand,x)===byName.supported),`${g.model}: WebGPU support by name ${byName.supported}`);
  if(!byName.supported||!byName.architecture||rebranded.test(g.model)||/GTX 2060 6GB/.test(g.model))continue;// a counterfeit card name
  assert(arches.has(byName.architecture),`${g.model}: name ${byName.architecture}, IDs ${[...arches].join('/')}`);checked++;
 }
 assert(checked>150,'compared '+checked);
 // Every catalog model gets a decision; unknown names report an empty architecture like Chrome does for unlisted IDs.
 for(const g of catalog.GPUS)assert.equal(typeof id.architectureByName(g.brand,g.model).supported,'boolean');
});

test('WebGPU info follows the WebGL renderer, including renderers saved without a device ID',()=>{
 const info=renderer=>id.webgpuInfo(renderer,{idsFor:catalog.idsFor,pick:ids=>catalog.pickId('seed-a',ids)});
 assert.deepEqual(info('ANGLE (NVIDIA, NVIDIA GeForce GT 630 (0x00000FC2) Direct3D11 vs_5_0 ps_5_0, D3D11)'),{vendor:'nvidia',architecture:'kepler',supported:true});
 assert.deepEqual(info('ANGLE (NVIDIA, NVIDIA GeForce GT 430 (0x00000DE1) Direct3D11 vs_5_0 ps_5_0, D3D11)'),{vendor:'nvidia',architecture:'fermi',supported:false});
 // Saved renderers of the user's existing instances (old format, some models without catalog IDs).
 assert.deepEqual(info('ANGLE (Intel, Intel(R) Iris(R) Xe MAX 100 Graphics Direct3D11 vs_5_0 ps_5_0)'),{vendor:'intel',architecture:'gen-12lp',supported:true});
 assert.deepEqual(info('ANGLE (Intel, Intel(R) HD Graphics P4600/P4700 Direct3D11 vs_5_0 ps_5_0)'),{vendor:'intel',architecture:'gen-7',supported:true});
 assert.deepEqual(info('ANGLE (Intel, Intel(R) UHD Graphics 617 Direct3D11 vs_5_0 ps_5_0)'),{vendor:'intel',architecture:'gen-9',supported:true});
 assert.deepEqual(info('ANGLE (NVIDIA, NVIDIA Quadro K5000 Direct3D11 vs_5_0 ps_5_0)'),{vendor:'nvidia',architecture:'kepler',supported:true});
 assert.deepEqual(info('ANGLE (AMD, AMD Radeon HD 7640G Direct3D11 vs_5_0 ps_5_0)'),{vendor:'amd',architecture:'',supported:false});
 assert.deepEqual(info('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Ti Direct3D11 vs_5_0 ps_5_0)'),{vendor:'nvidia',architecture:'ampere',supported:true});
 // A saved model the catalog has IDs for uses one of them, stably per seed.
 const generic='ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0)',a=info(generic);
 assert.deepEqual(a,info(generic));assert(['gen-9','gen-11','gen-12lp'].includes(a.architecture));
 assert.equal(info('ANGLE (Apple, Apple M1)'),null);
});
