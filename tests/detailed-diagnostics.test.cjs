'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),https=require('node:https');
const {RuntimeOutput,readRuntimeOutput,OUTPUT_LIMIT}=require('../src/main/runtime-output.cjs');
const {NetworkTrace}=require('../src/main/network-trace.cjs');
const {downloadSubscription}=require('../src/main/subscription.cjs');
const {resolvePublicHost}=require('../src/main/subscription-policy.cjs');
const {buildDiagnosticBundle,exportDiagnosticBundle}=require('../src/main/diagnostic-bundle.cjs');
const {Library}=require('../src/main/library.cjs'),{Store}=require('../src/main/store.cjs');
function temporary(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'facet-detailed-diagnostics-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
async function server(t,handler,tls=false){const s=tls?https.createServer({key:fs.readFileSync(path.join(__dirname,'fixtures/dns/key.pem')),cert:fs.readFileSync(path.join(__dirname,'fixtures/dns/cert.pem'))},handler):http.createServer(handler);await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{s.closeAllConnections();s.close(resolve);}));return (tls?'https':'http')+'://127.0.0.1:'+s.address().port;}
const minimal={versions:{app:'test',electron:'test'},instances:[]};
test('runtime output preserves two launches, split UTF-8, source IDs and credentials redaction',t=>{
 const dir=temporary(t),file=path.join(dir,'runtime-output.json'),first=new RuntimeOutput(file),bytes=Buffer.from('中文内核错误 password="fixture secret with spaces"\n');
 first.write('stderr',bytes.subarray(0,2),{source:'core',instanceId:'instance-one',pid:42});first.write('stderr',bytes.subarray(2),{source:'core',instanceId:'instance-one',pid:42});first.close();
 const second=new RuntimeOutput(file);assert.notEqual(second.runId,first.runId);second.record('stderr','"Cookie": "fixture cookie"',{source:'control'});second.record('stderr','https://sub.test/private-path?token=fixture-url-token');second.close();
 const saved=readRuntimeOutput(file,{limit:5000});assert.equal(saved.rows.length,3);assert(saved.rows[0].text.includes('中文内核错误'));assert.equal(saved.rows[0].instanceId,'instance-one');assert.equal(saved.rows[0].source,'core');assert.equal(saved.rows[0].runId,first.runId);
 const encoded=JSON.stringify(saved);for(const secret of ['fixture secret','fixture cookie','private-path','fixture-url-token'])assert(!encoded.includes(secret),secret);
});
test('output and trace retention report dropped entries; corrupt originals remain untouched',t=>{
 const dir=temporary(t),output=new RuntimeOutput(path.join(dir,'runtime-output.json'));
 for(let i=0;i<OUTPUT_LIMIT+2;i++)output.record('stdout','row-'+i);output.close();assert.equal(output.snapshot().dropped,2);assert.equal(output.snapshot(1000).omittedFromView,4000);assert.equal(new RuntimeOutput(output.file).dropped,2);
 const trace=new NetworkTrace(dir),pending=trace.begin({operation:'subscription'});for(let i=0;i<162;i++)trace.record(pending,{stage:'response',status:200});trace.flush();
 const reopened=new NetworkTrace(dir);assert.equal(reopened.rows[0].result,'interrupted');assert.equal(reopened.rows[0].stepsDropped,2);assert.equal(reopened.rows[0].steps.length,160);reopened.flush();
 fs.writeFileSync(output.file,'corrupt original');const broken=new RuntimeOutput(output.file);broken.record('stderr','new memory-only failure');broken.close();assert.equal(fs.readFileSync(output.file,'utf8'),'corrupt original');assert(broken.snapshot().warning.includes('原文件已保留'));
 fs.writeFileSync(trace.file,'corrupt trace original');const brokenTrace=new NetworkTrace(dir);brokenTrace.begin({operation:'subscription'});brokenTrace.flush();assert.equal(fs.readFileSync(trace.file,'utf8'),'corrupt trace original');
});
test('oversized split lines discard the remaining fragments, and shorter truncations are explicit',t=>{
 const output=new RuntimeOutput(path.join(temporary(t),'runtime-output.json'));
 output.write('stderr','password="'+('secret-fragment-'.repeat(1300)));output.write('stderr','fixture-secret-tail"\nnormal next line\n');output.record('stderr','x'.repeat(800));output.close();
 const encoded=JSON.stringify(output.snapshot());assert(!encoded.includes('secret-fragment'));assert(!encoded.includes('fixture-secret-tail'));assert(output.rows.some(x=>x.text==='normal next line'));assert.equal(output.snapshot().longLinesTruncated,2);
});
test('DNS failures and private answers retain real codes and actual address classification',async t=>{
 const trace=new NetworkTrace(temporary(t)),id=trace.begin({operation:'subscription'}),report=x=>trace.record(id,x);
 await assert.rejects(resolvePublicHost(new URL('https://missing.test/?token=do-not-export'),{lookup:async()=>{const e=Error('getaddrinfo ENOTFOUND missing.test');e.code='ENOTFOUND';throw e;},onStage:report}));
 assert(trace.rows[0].steps.some(s=>s.stage==='dns-error'&&s.code==='ENOTFOUND'));
 await assert.rejects(resolvePublicHost(new URL('https://private.test/'),{lookup:async()=>[{address:'10.0.0.1',family:4}],onStage:report}));
 assert(trace.rows[0].steps.some(s=>s.stage==='dns-answer'&&s.addresses[0].public===false));assert(!JSON.stringify(trace.snapshot()).includes('do-not-export'));trace.finish(id,{result:'failed'});trace.flush();
});
test('actual connection reset, TLS rejection, HTTP error and timeout retain their failing phases',async t=>{
 const dir=temporary(t),trace=new NetworkTrace(dir),reset=await server(t,req=>req.socket.destroy()),cert=await server(t,(_req,res)=>res.end('unused'),true),bad=await server(t,(_req,res)=>{res.writeHead(403);res.end('private response body');}),slow=await server(t,(_req,res)=>{res.writeHead(200);res.write('partial');});
 const outcomes=[];
 for(const [kind,url,timeoutMs]of [['reset',reset,1000],['tls',cert,1000],['http',bad,1000],['timeout',slow,100]]){
  const id=trace.begin({operation:'subscription',kind});await assert.rejects(downloadSubscription(url+'/?token=fixture-protected-token',{allowPrivateHosts:true,timeoutMs,onStage:x=>trace.record(id,x)}));trace.finish(id,{result:'failed'});outcomes.push(trace.rows.at(-1));
 }
 assert(outcomes[0].steps.some(s=>s.code==='ECONNRESET'));assert(outcomes[0].steps.some(s=>s.stage==='tcp-connected'));
 assert(outcomes[1].steps.some(s=>s.stage==='tls-start'));assert(outcomes[1].steps.some(s=>/CERT|TLS/.test(s.code||'')));
 assert(outcomes[2].steps.some(s=>s.stage==='response'&&s.status===403));assert(outcomes[3].steps.some(s=>s.code==='ETIMEDOUT'));assert(outcomes[3].steps.some(s=>s.wireBytes===7));
 trace.flush();const saved=JSON.stringify(new NetworkTrace(dir).snapshot());assert(!saved.includes('fixture-protected-token'));assert(!saved.includes('private response body'));assert(saved.includes('ECONNRESET'));
});
test('real library import, invalid refresh and export keep source data and full diagnostic evidence',async t=>{
 const dir=temporary(t),trace=new NetworkTrace(dir),output=new RuntimeOutput(path.join(dir,'runtime-output.json')),store=new Store(dir),library=new Library(dir,store,{trace,downloadOptions:{allowPrivateHosts:true}});let invalid=false;
 const url=await server(t,(_req,res)=>{res.setHeader('content-type','application/json');res.end(invalid?'invalid payload secret-body':JSON.stringify({proxies:[{name:'fixture',type:'http',server:'127.0.0.1',port:12345,password:'fixture-node-password'}]}));});
 const id=await library.save({name:'fixture',url:url+'/?token=fixture-subscription-token'}),sourceBefore=fs.readFileSync(library.file);invalid=true;await assert.rejects(library.save({id}));assert.deepEqual(fs.readFileSync(library.file),sourceBefore);
 assert(trace.rows[0].steps.some(s=>s.stage==='persisted'&&s.nodeCount===1));assert(trace.rows[1].steps.some(s=>s.code==='PARSE_FAILED'));output.record('stderr','core connection reset token=fixture-runtime-token',{source:'core',instanceId:'fixture'});output.flush();
 const history=[{sourceId:id,name:'fixture',at:new Date().toISOString(),latency:{ok:1,total:2,last:{ok:false,error:'ECONNRESET',at:'2026-10-14'},lastOk:{ok:true,latencyMs:123},recent:[{ok:false,error:'timeout'}]}}];
 const controller={snapshot:()=>minimal,workspace:{events:[{text:'update failed'}]},networkTrace:trace,diagnosticOutput:output,diagnostics:{history:{flush(){},list:()=>history}}};
 const file=path.join(dir,'export.json');const result=await exportDiagnosticBundle(controller,null,{showSaveDialog:async()=>({filePath:file,canceled:false})});const exported=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(exported.version,2);assert.equal(result.networkTraceCount,2);assert.equal(exported.diagnostics.history[0].latency.last.error,'ECONNRESET');assert(exported.summary.issues.some(x=>x.code==='PARSE_FAILED'));assert(exported.debug.rows.some(x=>x.source==='core'));
 for(const secret of ['fixture-node-password','fixture-subscription-token','fixture-runtime-token','secret-body'])assert(!JSON.stringify(exported).includes(secret),secret);trace.flush();output.close();
 const restored=buildDiagnosticBundle(minimal,[],new RuntimeOutput(output.file).snapshot(),new Date(),{network:new NetworkTrace(dir).snapshot(),history});assert.equal(restored.network.rows.length,2);assert.equal(restored.debug.rows.length,1);
});
