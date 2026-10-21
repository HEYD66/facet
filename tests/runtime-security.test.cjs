'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),https=require('node:https'),zlib=require('node:zlib');
const fs=require('node:fs'),path=require('node:path'),{X509Certificate,createHash}=require('node:crypto');
const {safeFetch,checkedHostname,networkURL,checkServerIdentity,canDecodeBrotli}=require('../src/main/safe-http.cjs');
const {downloadSubscription}=require('../src/main/subscription.cjs');
const {completionRequest}=require('../src/main/ai-request.cjs');
async function serve(t,handler){
 const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});
 return 'http://127.0.0.1:'+server.address().port;
}
test('Brotli is enabled only for verified Electron or patched standalone Node builds',()=>{
 for(const versions of [{node:'24.18.0'},{node:'24.22.0'},{node:'22.23.3'},{node:'26.12.0'},{electron:'44.4.5',chrome:'152.0.7977.130',node:'24.21.0'},{electron:'44.9.3',chrome:'152.0.7977.130',node:'24.22.0'}])assert.equal(canDecodeBrotli(versions),false);
 for(const versions of [{node:'22.23.4'},{node:'24.22.1'},{node:'26.12.1'},{electron:'44.9.3',chrome:'152.0.7977.167',node:'24.22.0'}])assert.equal(canDecodeBrotli(versions),true);
});
test('Node network inputs reject NUL and ambiguous hostname spellings',async()=>{
 for(const host of ['bad\0.test','127.1','2130706433','0x7f000001','0177.0.0.1','１２７.０.０.１','127.0.0.1.','bad name','user@host'])assert.throws(()=>checkedHostname(host));
 for(const host of ['127.0.0.1','::1','example.com','xn--bcher-kva.example'])assert.equal(checkedHostname(host),host);
 assert.equal(checkedHostname('bücher.example'),'xn--bcher-kva.example');
 assert.equal(networkURL('https://１２７.０.０.１').hostname,'127.0.0.1');
 await assert.rejects(safeFetch('https://bad\0.test/'),/主机名/);
 assert.throws(()=>networkURL('https://example.test/%00\0'));
});
test('TLS matching rejects ambiguous IPs, wrong DNS names and DNS SANs for IP endpoints',()=>{
 const raw=fs.readFileSync(path.join(__dirname,'fixtures/dns/cert.pem'));
 const cert={raw,subjectaltname:'DNS:fixture.test',subject:{CN:'fixture.test'}};
 for(const host of ['127.1','2130706433','１２７.０.０.１','0x7f000001','example.test','127.0.0.1','::1'])assert.equal(checkServerIdentity(host,cert)?.code,'ERR_TLS_CERT_ALTNAME_INVALID',host);
 assert.equal(checkServerIdentity('fixture.test',cert),undefined);
 // For an IP literal, the signed raw certificate is authoritative.
 assert.equal(new X509Certificate(raw).checkIP('127.0.0.1'),undefined);
});
test('canonical IPv4 and IPv6 IP SANs still complete a real TLS handshake',async t=>{
 // Public test certificate signed by the existing public fixture key. Trust is
 // scoped to this one test client; production trust stores are never changed.
 const dir=path.join(__dirname,'fixtures/dns'),cert=fs.readFileSync(path.join(dir,'ip-cert.pem'));
 for(const host of ['127.0.0.1','::1']){
  const server=https.createServer({key:fs.readFileSync(path.join(dir,'key.pem')),cert},(_req,res)=>res.end('TLS_IP_OK'));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,host,resolve);});
  try{
   const text=await new Promise((resolve,reject)=>{
    const req=https.get({hostname:host,port:server.address().port,ca:cert,agent:false,checkServerIdentity},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve(text));});req.on('error',reject);
   });assert.equal(text,'TLS_IP_OK');
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
 }
});
test('safe transport streams gzip/deflate and uses a fresh connection for each request',async t=>{
 const sockets=new Set(),requests=[];
 const url=await serve(t,(req,res)=>{
  sockets.add(req.socket);requests.push(req.headers);
  const encoding=req.url==='/gzip'?'gzip':'deflate';res.setHeader('Content-Encoding',encoding);
  const compress=encoding==='gzip'?zlib.createGzip():zlib.createDeflate();compress.pipe(res);compress.write('first');setImmediate(()=>compress.end('second'));
 });
 for(const suffix of ['/gzip','/deflate'])assert.equal(await(await safeFetch(url+suffix)).text(),'firstsecond');
 assert.equal(sockets.size,2);for(const h of requests){assert.equal(h['accept-encoding'].split(', ').includes('br'),canDecodeBrotli());assert.equal(h.connection,'close');}
});
test('subscription and AI decode Brotli on verified builds, never invoke it on vulnerable builds',async t=>{
 const safe=canDecodeBrotli(),original=zlib.createBrotliDecompress,descriptor=Object.getOwnPropertyDescriptor(zlib,'createBrotliDecompress');let calls=0,requests=0;
 Object.defineProperty(zlib,'createBrotliDecompress',{configurable:true,value:()=>{calls++;assert(safe,'decoder must never be called on an unpatched runtime');return original();}});
 t.after(()=>Object.defineProperty(zlib,'createBrotliDecompress',descriptor));
 const url=await serve(t,(req,res)=>{requests++;assert.equal(req.headers['accept-encoding'].split(', ').includes('br'),safe);const text=req.url==='/ai'?JSON.stringify({choices:[{message:{role:'assistant',content:'BROTLI_OK'}}]}):'BROTLI_OK';res.writeHead(200,{'Content-Encoding':'br'});res.end(zlib.brotliCompressSync(text));});
 if(safe){
  assert.equal(await(await safeFetch(url)).text(),'BROTLI_OK');
  assert.equal((await downloadSubscription(url,{allowPrivateHosts:true})).text,'BROTLI_OK');
  assert.equal((await completionRequest({url:url+'/ai',headers:{},body:'{}',signal:new AbortController().signal})).content,'BROTLI_OK');
  assert.equal(calls,3);
 }else{
  await assert.rejects(safeFetch(url),e=>e.code==='ERR_UNSAFE_CONTENT_ENCODING');
  await assert.rejects(downloadSubscription(url,{allowPrivateHosts:true}),/Brotli/);
  await assert.rejects(completionRequest({url:url+'/ai',headers:{},body:'{}',signal:new AbortController().signal}),/Brotli/);
  assert.equal(calls,0);
 }
 assert.equal(requests,3,'unsafe encoding is not retried');
});
test('redirects cannot forward a model API credential to another origin',async t=>{
 let leaked=0;const other=await serve(t,(_req,res)=>{leaked++;res.end('unexpected');});
 const url=await serve(t,(_req,res)=>{res.writeHead(302,{Location:other});res.end();});
 await assert.rejects(safeFetch(url,{headers:{Authorization:'Bearer ephemeral-fixture'}}),e=>e.code==='ERR_UNSAFE_REDIRECT');assert.equal(leaked,0);
});
test('abort closes an active response stream and rejects its reader',async t=>{
 let socket;const url=await serve(t,(req,res)=>{socket=req.socket;res.write('first');});
 const abort=new AbortController(),response=await safeFetch(url,{signal:abort.signal}),reader=response.body.getReader();
 assert.equal(new TextDecoder().decode((await reader.read()).value),'first');abort.abort();
 await assert.rejects(reader.read());await new Promise(r=>setTimeout(r,25));assert(socket.destroyed);
});
test('cancelling gzip response releases the upstream connection',async t=>{
 let socket;const url=await serve(t,(req,res)=>{socket=req.socket;res.setHeader('Content-Encoding','gzip');const gzip=zlib.createGzip();gzip.pipe(res);gzip.write('first');gzip.flush();req.socket.once('close',()=>gzip.destroy());});
 const response=await safeFetch(url),reader=response.body.getReader();await reader.read();await reader.cancel();await new Promise(r=>setTimeout(r,25));assert(socket.destroyed);
});
test('untrusted HTTPS certificates remain rejected',async t=>{
 const dir=path.join(__dirname,'fixtures/dns'),server=https.createServer({key:fs.readFileSync(path.join(dir,'key.pem')),cert:fs.readFileSync(path.join(dir,'cert.pem'))},(_req,res)=>res.end('unexpected'));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 await assert.rejects(safeFetch('https://127.0.0.1:'+server.address().port),e=>/CERT|SELF_SIGNED/.test(e.code));
});
test('bundled proxy bytes match the pinned security build and source',()=>{
 const root=path.join(__dirname,'../resources/mihomo'),record=JSON.parse(fs.readFileSync(path.join(root,'ARTIFACT.json'))),release=require('../src/main/core-release.cjs');
 const sha=file=>createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
 assert.equal(record.version,release.version);assert.equal(record.sourceRef,release.sourceRef);assert.equal(record.goVersion,release.goVersion);
 assert.equal(sha(process.platform==='win32'?'mihomo.exe':'mihomo'),record.binarySHA256);assert.equal(sha('mihomo-source.tar.gz'),record.sourceSHA256);
});
