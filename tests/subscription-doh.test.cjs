'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { queryDohAddresses, isPublicHostname } = require('../src/main/subscription-doh.cjs');
function reply(options, addresses) {
  const url = new URL('https://' + options.hostname + options.path);
  const type = url.searchParams.get('type') === 'A' ? 1 : 28;
  return JSON.stringify({ Status: 0, Question: [{ name: url.searchParams.get('name') + '.', type }],
    Answer: (addresses || (type === 1 ? ['93.184.216.34'] : ['2606:4700:4700::1111'])).map(data => ({ type, data })) });
}
function mockDnsHttp(t, respond) {
  const calls = [];
  t.mock.method(https, 'request', (options, callback) => {
    calls.push(options);
    const req = new EventEmitter(); let closed = false, stream;
    const onAbort = () => { if (!closed) req.emit('error', Object.assign(Error('aborted'), { code: 'ABORT_ERR' })); };
    options.signal.addEventListener('abort', onAbort, { once: true });
    req.destroy = () => { closed = true; options.signal.removeEventListener('abort', onAbort); stream?.destroy(); };
    req.end = () => queueMicrotask(() => {
      if (closed) return;
      const result = respond(options, calls.length) || {};
      if (result.hang) return;
      if (result.error) return req.emit('error', result.error);
      stream = new PassThrough(); stream.statusCode = result.status || 200; stream.headers = result.headers || {};
      callback(stream);
      if (!closed) stream.end(result.body === undefined ? reply(options) : result.body);
    });
    return req;
  });
  return calls;
}

test('DoH accepts public hostnames, not URLs, IPs or local names', () => {
  for (const host of ['sub.vendor-one.com','feed.vendor-two.net','xn--bcher-kva.example.org']) assert.equal(isPublicHostname(host), true, host);
  for (const host of ['localhost','router','printer.local','a.localhost','x.home.arpa','x.internal','x.test','x.invalid','x.onion','https://source.example.com/sub?token=fixture','a.example.com/path','127.0.0.1','198.18.0.1','::1','a..com','-x.com','UPPER.example.com']) assert.equal(isPublicHostname(host), false, host);
});
test('DoH bootstraps fixed public services, validates TLS and sends only the hostname', async t => {
  const calls = mockDnsHttp(t, () => ({}));
  const rows = await queryDohAddresses('sub.vendor-one.com');
  assert.deepEqual(rows, [{ address:'93.184.216.34', family:4 }, { address:'2606:4700:4700::1111', family:6 }]);
  assert.equal(calls.length, 2);
  for (const options of calls) {
    assert.equal(options.hostname, 'cloudflare-dns.com'); assert.equal(options.servername, options.hostname);
    assert.equal(options.rejectUnauthorized, true); assert.equal(options.agent.options.rejectUnauthorized, true);
    const url = new URL('https://' + options.hostname + options.path);
    assert.deepEqual([...url.searchParams.keys()], ['name', 'type']); assert.equal(url.searchParams.get('name'), 'sub.vendor-one.com');
    assert.equal(options.headers.Accept, 'application/dns-json'); assert.equal(options.headers.Authorization, undefined); assert.equal(options.headers.Cookie, undefined);
    assert.deepEqual(await new Promise(resolve => options.lookup(options.hostname, {all:true}, (_e, value) => resolve(value))), [{address:'1.1.1.1',family:4}]);
    assert.equal(await new Promise(resolve => options.lookup(options.hostname, {}, (_e, value) => resolve(value))), '1.1.1.1');
  }
});
test('DoH keeps CNAME results, deduplicates addresses and supports IPv6-only data', async t => {
  mockDnsHttp(t, options => {
    const json = JSON.parse(reply(options, options.path.endsWith('type=A') ? [] : ['2606:4700:4700::1111','2606:4700:4700::1111']));
    json.Answer.unshift({type:5,data:'edge.example.net.'});
    return {body:JSON.stringify(json)};
  });
  assert.deepEqual(await queryDohAddresses('v6.vendor-two.net'), [{address:'2606:4700:4700::1111',family:6}]);
});
test('transport failures use the second fixed provider without disabling certificate validation', async t => {
  const calls = mockDnsHttp(t, options => options.hostname === 'cloudflare-dns.com' ? {error:Object.assign(Error('private response must not leak'),{code:'CERT_HAS_EXPIRED'})} : {});
  const rows = await queryDohAddresses('fallback.vendor-two.net');
  assert.equal(rows.length, 2); assert.equal(calls.length, 4);
  assert.deepEqual([...new Set(calls.map(x=>x.hostname))], ['cloudflare-dns.com','dns.google']);
  for (const options of calls.filter(x=>x.hostname==='dns.google')) {
    assert.equal(options.servername, 'dns.google'); assert.equal(options.rejectUnauthorized, true);
    assert.equal(await new Promise(resolve=>options.lookup('dns.google',{},(_e,address)=>resolve(address))), '8.8.8.8');
  }
});
test('DoH redirects are never followed to a response-supplied destination', async t => {
  const calls = mockDnsHttp(t, () => ({status:302,headers:{location:'https://127.0.0.1/private?token=do-not-echo'}}));
  await assert.rejects(queryDohAddresses('redirect.vendor-one.com'), error=>error.code==='DOH_UNAVAILABLE'&&!error.message.includes('do-not-echo'));
  assert.equal(calls.length, 4); assert(calls.every(x=>['cloudflare-dns.com','dns.google'].includes(x.hostname)));
});
test('oversized DoH response bodies are rejected', async t => {
  mockDnsHttp(t, () => ({body:'x'.repeat(65537)}));
  await assert.rejects(queryDohAddresses('large.vendor-one.com'), {code:'DOH_UNAVAILABLE'});
});
test('oversized declared responses are rejected before parsing', async t => {
  mockDnsHttp(t, () => ({headers:{'content-length':70000},body:'{}'}));
  await assert.rejects(queryDohAddresses('large.vendor-two.net'), {code:'DOH_UNAVAILABLE'});
});
test('mismatched DNS questions cannot provide an address', async t => {
  mockDnsHttp(t, options => { const json=JSON.parse(reply(options));json.Question[0].name='other.example.com';return {body:JSON.stringify(json)}; });
  await assert.rejects(queryDohAddresses('question.vendor-one.com'), {code:'DOH_UNAVAILABLE'});
});
test('malformed address records cannot provide an address', async t => {
  mockDnsHttp(t, options => ({body:reply(options,['not-an-ip'])}));
  await assert.rejects(queryDohAddresses('bad.vendor-one.com'), {code:'DOH_UNAVAILABLE'});
});
test('truncated DNS messages are not accepted as complete answers', async t => {
  mockDnsHttp(t, options => { const json=JSON.parse(reply(options));json.TC=true;return {body:JSON.stringify(json)}; });
  await assert.rejects(queryDohAddresses('truncated.vendor-one.com'), {code:'DOH_UNAVAILABLE'});
});
test('private answers remain visible to the caller for all-address validation', async t => {
  mockDnsHttp(t, options => ({body:reply(options,options.path.endsWith('type=A')?['93.184.216.34','127.0.0.1']:[])}));
  assert.deepEqual((await queryDohAddresses('mixed.vendor-one.com')).map(x=>x.address), ['93.184.216.34','127.0.0.1']);
});
test('empty answers do not cause a connection to a Fake-IP address', async t => {
  const calls=mockDnsHttp(t, options=>({body:reply(options,[])}));
  await assert.rejects(queryDohAddresses('empty.vendor-one.com'), {code:'DOH_UNAVAILABLE'});assert.equal(calls.length,4);
});
test('invalid hostname and pre-aborted requests never start DNS HTTP traffic', async t => {
  const calls=mockDnsHttp(t,()=>({}));const abort=new AbortController();abort.abort();
  await assert.rejects(queryDohAddresses('router.local'),{code:'DOH_INVALID_HOST'});
  await assert.rejects(queryDohAddresses('a.example.com',{signal:abort.signal}),{code:'ABORT_ERR'});
  assert.equal(calls.length,0);
});
test('parent cancellation stops the lookup and does not start a fallback provider', async t => {
  const calls=mockDnsHttp(t,()=>({hang:true}));const abort=new AbortController();
  const pending=queryDohAddresses('slow.vendor-one.com',{signal:abort.signal});
  abort.abort();await assert.rejects(pending,{code:'ABORT_ERR'});assert.equal(calls.length,2);
});
test('each provider has a bounded deadline for both address families', async t => {
  const calls=mockDnsHttp(t,()=>({hang:true}));const started=Date.now();
  await assert.rejects(queryDohAddresses('slow.vendor-two.net',{timeoutMs:20}),{code:'DOH_UNAVAILABLE'});
  assert.equal(calls.length,4);assert(Date.now()-started<2000);
});

const {isPublicAddress} = require('../src/main/subscription-policy.cjs');
const nodeOptions = {nodeFallback:true, acceptAddress:isPublicAddress};
function regionalReply(options, addresses) {
  const data = JSON.parse(reply(options, addresses));
  data.Question = data.Question[0];
  return {body:JSON.stringify(data)};
}
test('node lookup rejects loopback responses and uses verified regional DNS with its object Question', async t => {
  const calls=mockDnsHttp(t, options=>options.hostname==='dns.alidns.com'
    ? regionalReply(options, options.path.endsWith('type=A')?['93.184.216.34']:[])
    : {body:reply(options,options.path.endsWith('type=A')?['127.127.127.5']:[])});
  assert.deepEqual(await queryDohAddresses('node.vendor-one.com',nodeOptions),[{address:'93.184.216.34',family:4}]);
  assert.deepEqual([...new Set(calls.map(x=>x.hostname))],['cloudflare-dns.com','dns.google','dns.alidns.com']);
  for(const options of calls.filter(x=>x.hostname==='dns.alidns.com')){
    assert(options.path.startsWith('/resolve?'));assert.equal(options.servername,'dns.alidns.com');assert.equal(options.rejectUnauthorized,true);
    assert.equal(await new Promise(resolve=>options.lookup(options.hostname,{},(_e,address)=>resolve(address))),'223.5.5.5');
    assert.deepEqual([...new URL('https://'+options.hostname+options.path).searchParams.keys()],['name','type']);
  }
});
test('node lookup uses Google before regional fallback and rejects an entire mixed response',async t=>{
  const calls=mockDnsHttp(t,options=>({body:reply(options,options.path.endsWith('type=A')?(options.hostname==='cloudflare-dns.com'?['93.184.216.34','127.0.0.1']:['93.184.216.35']):[])}));
  assert.deepEqual(await queryDohAddresses('mixed.node-vendor.com',nodeOptions),[{address:'93.184.216.35',family:4}]);
  assert.equal(calls.length,4);assert(!calls.some(x=>x.hostname==='dns.alidns.com'));
});
test('node regional fallback still rejects private, Fake-IP and mismatched questions',async t=>{
  const calls=mockDnsHttp(t,options=>{
    if(options.hostname!=='dns.alidns.com')return {body:reply(options,options.path.endsWith('type=A')?['127.127.127.5']:[])};
    const result=regionalReply(options,options.path.endsWith('type=A')?['93.184.216.34']:[]),data=JSON.parse(result.body);data.Question.name='other.vendor.com.';return {body:JSON.stringify(data)};
  });
  await assert.rejects(queryDohAddresses('unsafe.node-vendor.com',nodeOptions),{code:'DOH_NONPUBLIC_ADDRESS'});assert.equal(calls.length,6);
});
test('all unsafe node answers fall back to system DNS; system mode is unchanged',async t=>{
  const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),dns=require('node:dns').promises;
  const {NodeNetwork}=require('../src/main/node-network.cjs'),{Mihomo}=require('../src/main/mihomo.cjs');
  const calls=mockDnsHttp(t,options=>options.hostname==='dns.alidns.com'?regionalReply(options,options.path.endsWith('type=A')?['198.18.2.1']:[]):{body:reply(options,options.path.endsWith('type=A')?['127.127.127.5']:[])});
  t.mock.method(dns,'lookup',async()=>[{address:'198.18.1.2',family:4}]);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'facet-unsafe-dns-'));
  try{const network=new NodeNetwork(dir);await network.save({dnsMode:'auto',routeMode:'system'});const core=new Mihomo(path.resolve('resources/mihomo/mihomo.exe'),path.join(dir,'runtime'),null,network);
    // DoH returns non-public addresses, should auto-fallback to system DNS (no throw)
    const result=await network.prepare({server:'unsafe.node-vendor.com',type:'ss',port:8080});
    assert.equal(calls.length,6); // All 3 providers queried (2 requests each)
    assert.deepEqual(result.overrides,{}); // No hosts override, fell back to system
    assert(result.summary.dns.includes('回退')||result.summary.dns.includes('系统')); // Fallback message
    await network.save({dnsMode:'system',routeMode:'system'});assert.deepEqual((await network.prepare({server:'unsafe.node-vendor.com'})).overrides,{});assert.equal(calls.length,6);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('node fallback has bounded deadlines and parent cancellation never starts another provider',async t=>{
  const calls=mockDnsHttp(t,()=>({hang:true})),abort=new AbortController();
  const pending=queryDohAddresses('cancel.node-vendor.com',{...nodeOptions,signal:abort.signal});abort.abort();await assert.rejects(pending,{code:'ABORT_ERR'});assert.equal(calls.length,2);
  const started=Date.now();await assert.rejects(queryDohAddresses('slow.node-vendor.com',{...nodeOptions,timeoutMs:20}),{code:'DOH_UNAVAILABLE'});assert.equal(calls.length,8);assert(Date.now()-started<2000);
});
test('strict mode never falls back to system DNS when DoH fails',async t=>{
  const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),dns=require('node:dns').promises;
  const {NodeNetwork}=require('../src/main/node-network.cjs');
  const calls=mockDnsHttp(t,options=>options.hostname==='dns.alidns.com'?regionalReply(options,options.path.endsWith('type=A')?['198.18.2.1']:[]):{body:reply(options,options.path.endsWith('type=A')?['127.127.127.5']:[])});
  t.mock.method(dns,'lookup',async()=>[{address:'198.18.1.2',family:4}]);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'facet-strict-dns-'));
  try{const network=new NodeNetwork(dir);await network.save({dnsMode:'strict',routeMode:'system'});
    // Strict mode: DoH returns non-public, should throw (not fallback)
    await assert.rejects(network.prepare({server:'unsafe.node-vendor.com',type:'ss',port:8080}),/多个安全 DNS/);
    assert.equal(calls.length,6); // All 3 providers queried
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
