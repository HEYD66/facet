'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {buildDiagnosticBundle,exportDiagnosticBundle}=require('../src/main/diagnostic-bundle.cjs');
const snapshot={versions:{app:'0.2.8',electron:'44.4.5'},nodeNetwork:{settings:{dnsMode:'auto',routeMode:'system'}},instances:[{id:'fixture',status:'stopped',network:{mode:'mihomo',password:'never-export'},environment:{language:'zh-CN',timezone:'Asia/Shanghai',userAgent:'private-ua',platform:'private-platform'},notes:'private-notes',cookies:'private-cookies',url:'https://example.test/?token=private-url',error:'Authorization: Bearer private-auth'}]};
test('bundle uses explicit fields and re-redacts operations and debug output',()=>{
 const b=buildDiagnosticBundle(snapshot,[{text:'https://example.test/?token=private-event',nodeName:'password=private-node',cookie:'private-event-cookie'}],{rows:[{channel:'stderr',text:'Session=private-session'}]},new Date('2026-10-08T00:00:00Z'));
 const s=JSON.stringify(b);for(const secret of ['never-export','private-ua','private-platform','private-notes','private-cookies','private-url','private-auth','private-event','private-node','private-event-cookie','private-session'])assert(!s.includes(secret),secret);
 assert.equal(b.format,'facet-diagnostics');assert.equal(b.instances[0].environment.customUA,true);assert.equal(b.nodeNetwork.dnsMode,'auto');assert.equal(b.debug.rows[0].channel,'stderr');assert.equal(b.events.length,1);
});
test('bundle keeps newest 1000 operations and last 5000 debug lines and reports missing output',()=>{
 const rows=Array.from({length:5500},(_,i)=>({text:String(i)}));const b=buildDiagnosticBundle(snapshot,rows,{rows,warning:'等待运行输出…'});
 assert.equal(b.events.length,1000);assert.equal(b.events[0].text,'0');assert.equal(b.events.at(-1).text,'999');assert.equal(b.debug.rows.length,5000);assert.equal(b.debug.rows[0].text,'500');assert.equal(b.debug.rows.at(-1).text,'5499');assert.equal(b.debug.warning,'等待运行输出…');
});
test('real file export is parseable, cancellation writes nothing, failure is explicit',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'facet-diagnostic-bundle-'));
 try{
  const controller={snapshot:()=>snapshot,workspace:{events:[{text:'检测任务结束'}]}};
  let suggestedName;const file=path.join(dir,'bundle.json');const dialog={showSaveDialog:async(_w,options)=>{suggestedName=options.defaultPath;return {canceled:false,filePath:file};}};
  const r=await exportDiagnosticBundle(controller,null,dialog);assert.equal(r.cancelled,false);assert.equal(r.eventCount,1);assert.match(suggestedName,/^Facet-diagnostics-.*\.json$/);
  const b=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(b.format,'facet-diagnostics');assert.equal(b.events[0].text,'检测任务结束');
  const before=fs.readFileSync(file);const cancelled=await exportDiagnosticBundle(controller,null,{showSaveDialog:async()=>({canceled:true,filePath:file})});assert.equal(cancelled.cancelled,true);assert.deepEqual(fs.readFileSync(file),before);
  await assert.rejects(exportDiagnosticBundle(controller,null,{showSaveDialog:async()=>({canceled:false,filePath:dir})}),/诊断包保存失败/);
  assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(fs.readdirSync(dir),['bundle.json']);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
