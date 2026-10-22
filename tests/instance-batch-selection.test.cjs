'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/main/store.cjs'),{Library}=require('../src/main/library.cjs'),{DiagnosticHistory}=require('../src/main/diagnostic-history.cjs');
const batch=require('../src/main/instance-batch.cjs');
async function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'facet-batch-selection-')),store=new Store(dir),library=new Library(dir,store),history=new DiagnosticHistory(dir);
 const nodes=['A','B','C','D','套餐到期'].map((name,i)=>({name,type:'http',server:'127.0.0.1',port:12000+i}));
 const sourceId=await library.save({name:'Batch source',text:JSON.stringify({proxies:nodes})}),controller={store,library,diagnostics:{history,results:new Map()}};
 let tick=0;const record=(name,ok=true,extra={})=>{const value={sourceId,name,kind:'latency',ok,at:new Date(Date.now()+1000+(tick++)).toISOString(),...extra};history.record(value);return value;};
 const assign=(name,node)=>{const x=store.create('Assigned '+store.list().length,{mode:'mihomo',nodeName:node?.name||name});store.saveNodes(x.id,[node||library.node(sourceId,name)]);return x;};
 const payload=(patch={})=>({count:1,prefix:'Batch',mode:'mihomo',allocation:'unique',nodes:[],random:true,syncLocale:false,...patch});
 return {dir,store,library,history,sourceId,controller,nodes,record,assign,payload,close(){history.flush();assert.equal(path.dirname(dir),os.tmpdir());fs.rmSync(dir,{recursive:true,force:true});}};
}
test('batch random excludes stopped assignments and failed checks; does not require or rank latency',async()=>{
 const f=await fixture();try{
  f.record('A',true,{latencyMs:1});f.record('B');f.record('C',true,{latencyMs:9000});f.record('D',false);f.record('套餐到期');f.assign('A',{...f.nodes[0],name:'Renamed A'});
  const rows=batch.options(f.controller);assert.equal(rows.find(n=>n.name==='A').usage,1);assert.equal(rows.find(n=>n.name==='D').available,false);assert(!rows.some(n=>n.name==='套餐到期'));
  const before=JSON.stringify(f.store.list());for(let i=0;i<20;i++){const plan=batch.prepare(f.controller,f.payload({count:2}));assert.deepEqual(new Set(plan.items.map(x=>x.nodeName)),new Set(['B','C']));assert.equal(new Set(plan.items.map(x=>x.environment.fingerprint.seed)).size,2);assert.equal(plan.allocation,'unique');}assert.equal(JSON.stringify(f.store.list()),before);
 }finally{f.close();}
});
test('selected scope skips assigned nodes and collapses identical configurations across sources',async()=>{
 const f=await fixture();try{
  f.record('A');f.record('B');f.assign('B');const sourceId=await f.library.save({name:'Duplicate',text:JSON.stringify({proxies:[{...f.nodes[0],name:'Another A'}]})});
  f.history.record({sourceId,name:'Another A',kind:'latency',ok:true,at:new Date(Date.now()+2000).toISOString()});
  const nodes=[{sourceId:f.sourceId,name:'A'},{sourceId:f.sourceId,name:'B'},{sourceId,name:'Another A'}];
  assert.throws(()=>batch.prepare(f.controller,f.payload({count:2,nodes})),/需要 2 个.*仅 1 个/);
  const plan=batch.prepare(f.controller,f.payload({nodes}));assert.equal(plan.items.length,1);assert(['A','Another A'].includes(plan.items[0].nodeName));
 }finally{f.close();}
});
test('no available unused nodes and insufficient count fail without creating or silently reusing',async()=>{
 const f=await fixture();try{
  f.record('A');f.assign('A');assert.throws(()=>batch.prepare(f.controller,f.payload()),/没有未分配/);
  f.record('B');const before=JSON.stringify(f.store.list());assert.throws(()=>batch.prepare(f.controller,f.payload({count:2})),/不会自动复用/);assert.equal(JSON.stringify(f.store.list()),before);
 }finally{f.close();}
});
test('newer persisted failures beat older live success and stale checks are excluded',async()=>{
 const f=await fixture();try{
  const live=f.record('A');f.controller.diagnostics.results.set('A',live);f.record('A',false);f.record('B',true,{at:'2000-01-01T00:00:00.000Z'});f.record('C');
  assert.equal(batch.prepare(f.controller,f.payload()).items[0].nodeName,'C');
 }finally{f.close();}
});
test('manual cycle still deliberately reuses the selected node in selection order',async()=>{
 const f=await fixture();try{
  f.assign('A');const plan=batch.prepare(f.controller,f.payload({count:4,allocation:'cycle',nodes:[{sourceId:f.sourceId,name:'A'}]}));assert(plan.items.every(x=>x.nodeName==='A'));assert.equal(plan.items.length,4);
 }finally{f.close();}
});
test('assignment or failed connectivity after preview rejects the whole exclusive plan before writing',async()=>{
 const f=await fixture();try{
  f.record('A');const plan=batch.prepare(f.controller,f.payload());f.assign('A');const before=JSON.stringify(f.store.list());await assert.rejects(batch.execute(f.controller,plan.token),/草稿节点已被分配/);assert.equal(JSON.stringify(f.store.list()),before);
  f.record('B');const next=batch.prepare(f.controller,f.payload());f.record('B',false);await assert.rejects(batch.execute(f.controller,next.token),/检测不可用/);assert.equal(JSON.stringify(f.store.list()),before);
 }finally{f.close();}
});
