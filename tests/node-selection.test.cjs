'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/main/store.cjs'),{Library}=require('../src/main/library.cjs'),{DiagnosticHistory}=require('../src/main/diagnostic-history.cjs');
const {selectForNewInstance}=require('../src/main/node-evidence.cjs');
async function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'facet-node-selection-')),store=new Store(dir),library=new Library(dir,store),history=new DiagnosticHistory(dir);
 const nodes=['A','B','C','D','套餐到期'].map((name,index)=>({name,type:'http',server:'127.0.0.1',port:1000+index,password:'selection-test-secret'}));
 const sourceId=await library.save({name:'Selection source',text:JSON.stringify({proxies:nodes})}),controller={store,library,diagnostics:{history,results:new Map()}};
 let tick=0;const at=()=>new Date(Date.now()+1000+(tick++)).toISOString();
 const result=(name,latencyMs,ok=true,options={})=>({sourceId,name,kind:'latency',ok,latencyMs,at:at(),...options});
 const record=(...args)=>{const value=result(...args);history.record(value);return value;};
 const assign=(name,options={})=>{const node={...library.node(sourceId,name),...(options.node||{})};const instance=store.create('Assigned '+name+' '+store.list().length,{mode:'mihomo',nodeName:node.name});store.saveNodes(instance.id,[node]);return instance;};
 return {dir,store,library,history,controller,nodes,sourceId,at,record,result,assign,close(){history.flush();assert.equal(path.dirname(dir),os.tmpdir());fs.rmSync(dir,{recursive:true,force:true});}};
}
test('chooses the lowest latency unused node, counting stopped assignments and renamed copies',async()=>{
 const f=await fixture();try{
  f.record('A',1);f.record('B',80);f.record('C',30);f.record('D',15);
  f.assign('A');f.assign('D',{node:{name:'Renamed D'}});
  const selected=selectForNewInstance(f.controller);assert.equal(selected.name,'C');assert.equal(selected.usage,0);assert.equal(selected.latencyMs,30);
  assert.equal(f.store.list().filter(x=>x.network.mode==='mihomo').length,2);
 }finally{f.close();}
});
test('when every eligible node is assigned, minimizes assignment count before latency',async()=>{
 const f=await fixture();try{
  f.record('A',1);f.record('B',70);f.record('C',30);f.assign('A');f.assign('A');f.assign('B');f.assign('C');
  let selected=selectForNewInstance(f.controller);assert.equal(selected.name,'C');assert.equal(selected.usage,1);
  f.assign('C');selected=selectForNewInstance(f.controller);assert.equal(selected.name,'B');assert.equal(selected.usage,1);
 }finally{f.close();}
});
test('excludes failed latest checks, stale source versions, hidden hints, excluded nodes and invalid latency',async()=>{
 const f=await fixture();try{
  f.record('A',1);f.record('A',undefined,false,{error:'检测失败'});
  f.record('B',2,true,{at:'2020-01-01T00:00:00.000Z'});
  f.record('C',3);f.library.removeNodes(f.sourceId,['C']);
  f.record('D',-1);f.record('套餐到期',0);
  assert.equal(selectForNewInstance(f.controller),null);
  f.record('D',NaN);assert.equal(selectForNewInstance(f.controller),null);
  f.record('D',Infinity);assert.equal(selectForNewInstance(f.controller),null);
  f.record('D',10,true,{at:'not-a-date'});assert.equal(selectForNewInstance(f.controller),null);
 }finally{f.close();}
});
test('compares live and persisted timestamps and ignores cancelled checks',async()=>{
 const f=await fixture();try{
  const stale=f.result('A',1);f.controller.diagnostics.results.set('old',stale);
  f.record('A',undefined,false,{error:'检测失败'});f.record('B',50);
  assert.equal(selectForNewInstance(f.controller).name,'B');
  const newest=f.result('A',2);f.controller.diagnostics.results.set('old',newest);
  assert.equal(selectForNewInstance(f.controller).name,'A');
  f.record('A',2);f.controller.diagnostics.results.set('old',f.result('A',undefined,false,{error:'已取消'}));
  assert.equal(selectForNewInstance(f.controller).name,'A');
 }finally{f.close();}
});
test('matches configurations across sources while keeping different credentials independent',async()=>{
 const f=await fixture();try{
  f.record('A',10);f.record('B',50);
  const duplicate=await f.library.save({name:'Duplicate source',text:JSON.stringify({proxies:[{...f.nodes[0],name:'Other A'}]})});
  const instance=f.store.create('Cross source copy',{mode:'mihomo',nodeName:'Other A'});f.store.saveNodes(instance.id,[f.library.node(duplicate,'Other A')]);
  assert.equal(selectForNewInstance(f.controller).name,'B');
  f.assign('B',{node:{password:'different-test-secret'}});assert.equal(selectForNewInstance(f.controller).name,'B');
  const output=JSON.stringify(selectForNewInstance(f.controller));assert(!output.includes('selection-test-secret'));assert(!output.includes('different-test-secret'));assert(!output.includes('server'));
 }finally{f.close();}
});
test('saved diagnostics and saved assignments still choose the right node after reloading storage',async()=>{
 const f=await fixture();try{
  f.record('A',10);f.record('B',30);f.assign('A');f.history.flush();
  const store=new Store(f.dir),controller={store,library:new Library(f.dir,store),diagnostics:{results:new Map(),history:new DiagnosticHistory(f.dir)}};
  const selected=selectForNewInstance(controller);assert.equal(selected.name,'B');assert.equal(selected.usage,0);
  const before=JSON.stringify(store.list());selectForNewInstance(controller);assert.equal(JSON.stringify(store.list()),before);
 }finally{f.close();}
});
