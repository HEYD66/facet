'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {completionRequest,retryAfter}=require('../src/main/ai-request.cjs');
const ok=res=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'已收到'}}]}));};
async function provider(t,handler){const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));return 'http://127.0.0.1:'+server.address().port+'/v1/chat/completions';}
const request=(url,options={})=>completionRequest({url,headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'local-fixture',messages:[],stream:true}),signal:new AbortController().signal,...options});
test('Retry-After supports seconds, dates and invalid values',()=>{
 assert.equal(retryAfter(null),null);assert.equal(retryAfter(''),null);assert.equal(retryAfter('-1'),null);assert.equal(retryAfter('2.5'),2500);assert.equal(retryAfter('invalid'),null);
 assert.equal(retryAfter('Wed, 21 Oct 2026 00:00:02 GMT',Date.parse('2026-10-21T00:00:00Z')),2000);
});
test('real HTTP 429 and 503 retry up to three attempts without changing the request',async t=>{
 const bodies=[],events=[];let count=0;
 const url=await provider(t,async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;bodies.push(body);if(++count<3){res.writeHead(count===1?429:503,{'Retry-After':'0'});res.end('temporary');}else ok(res);});
 const result=await request(url,{onRetry:e=>events.push(e)});assert.equal(result.content,'已收到');assert.equal(count,3);assert.equal(new Set(bodies).size,1);assert.deepEqual(events.map(e=>e.phase),['waiting','requesting','waiting','requesting']);
});
test('authentication failure is not retried or echoed from the service body',async t=>{
 let count=0;const url=await provider(t,(_req,res)=>{count++;res.writeHead(401);res.end('SENSITIVE_SERVICE_BODY');});
 await assert.rejects(request(url),e=>/HTTP 401/.test(e.message)&&!e.message.includes('SENSITIVE'));assert.equal(count,1);
});
test('connection reset retries before any text is delivered',async t=>{
 let count=0;const url=await provider(t,(req,res)=>{if(++count===1)req.socket.destroy();else ok(res);});assert.equal((await request(url)).content,'已收到');assert.equal(count,2);
});
test('a broken stream after visible text is never replayed',async t=>{
 let count=0;const chunks=[];const url=await provider(t,(_req,res)=>{count++;res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{index:0,delta:{content:'部分文字'}}]})+'\n\n');setTimeout(()=>res.destroy(),30);});
 await assert.rejects(request(url,{onText:s=>chunks.push(s)}));assert.deepEqual(chunks,['部分文字']);assert.equal(count,1);
});
test('a long server cooldown is reported without an early retry',async t=>{
 let count=0;const url=await provider(t,(_req,res)=>{count++;res.writeHead(429,{'Retry-After':'60'});res.end();});await assert.rejects(request(url),/等待 60 秒/);assert.equal(count,1);
});
test('stop aborts a pending retry before another HTTP request',async t=>{
 let count=0;const abort=new AbortController(),url=await provider(t,(_req,res)=>{count++;res.writeHead(429,{'Retry-After':'30'});res.end();});
 await assert.rejects(request(url,{signal:abort.signal,onRetry:e=>{if(e.phase==='waiting')abort.abort();}}),/停止|abort/i);assert.equal(count,1);
});
test('repeated service errors stop after the third attempt',async t=>{
 let count=0;const url=await provider(t,(_req,res)=>{count++;res.writeHead(503,{'Retry-After':'0'});res.end();});await assert.rejects(request(url),/HTTP 503/);assert.equal(count,3);
});
