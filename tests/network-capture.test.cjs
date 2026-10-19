'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
const {captureFailures,releaseNetwork,watching,NETWORK_PARAMS}=require('../src/main/network-capture.cjs');
function session(dir){return {getStoragePath:()=>dir,get webRequest(){throw Error('network capture must not touch session.webRequest');}};}
function page(id,ses,{attached=true}={}){
  const wc=new EventEmitter();let destroyed=false;wc.id=id;wc.session=ses;wc.isDestroyed=()=>destroyed;wc.destroy=()=>{destroyed=true;wc.emit('destroyed');};
  const debug=new EventEmitter();debug.attached=attached;debug.calls=[];debug.isAttached=()=>debug.attached;
  debug.sendCommand=async(method,params)=>{debug.calls.push({method,params});return method==='Page.getFrameTree'?{frameTree:{frame:{id:'ROOT'}}}:{};};
  wc.debugger=debug;return wc;
}
function electron(...pages){const app=new EventEmitter(),all=[...pages];return {app,all,webContents:{getAllWebContents:()=>all.filter(x=>!x.isDestroyed())},create(wc){all.push(wc);app.emit('web-contents-created',{},wc);}};}
function journal(){const rows=[];return {rows,begin(input){const row={...input,steps:[]};rows.push(row);return rows.length-1;},record(id,step){rows[id].steps.push(step);},finish(id,input){Object.assign(rows[id],input);}};}
const flush=()=>new Promise(r=>setImmediate(r));
const send=(wc,method,params)=>wc.debugger.emit('message',{},method,params);
function request(wc,id,url,type='Fetch',extra={}){send(wc,'Network.requestWillBeSent',{requestId:id,type,frameId:extra.frameId||'ROOT',request:{url,method:extra.method||'GET'}});}

test('captures failures through page CDP without registering session.webRequest listeners',async()=>{
  const ses=session('/profiles/a'),wc=page(7,ses),env=electron(wc),log=journal();
  const dispose=captureFailures(ses,log,()=>({instanceId:'a',proxy:false,route:'direct'}),env);await flush();
  assert.deepEqual(wc.debugger.calls[0],{method:'Network.enable',params:{...NETWORK_PARAMS}});assert(watching(wc));
  request(wc,'1','http://127.0.0.1:8080/http-error?token=secret');send(wc,'Network.responseReceived',{requestId:'1',response:{status:503}});send(wc,'Network.loadingFinished',{requestId:'1'});
  request(wc,'2','https://example.com/fail?token=secret','XHR',{method:'POST'});send(wc,'Network.loadingFailed',{requestId:'2',errorText:'net::ERR_EMPTY_RESPONSE'});
  assert.equal(log.rows.length,2);
  assert.deepEqual(log.rows[0],{operation:'page-request',instanceId:'a',proxy:false,route:'direct',host:'127.0.0.1',result:'failed',steps:[{stage:'http-error',method:'GET',resourceType:'xhr',webContentsId:7,status:503}]});
  assert.deepEqual(log.rows[1].steps,[{stage:'request-error',method:'POST',resourceType:'xhr',webContentsId:7,code:'ERR_EMPTY_RESPONSE',reason:'net::ERR_EMPTY_RESPONSE'}]);
  assert(!JSON.stringify(log.rows).includes('secret'));assert(!JSON.stringify(log.rows).includes('/fail'));
  dispose();assert(!watching(wc));assert.equal(wc.debugger.listenerCount('message'),0);assert.equal(wc.listenerCount('did-start-navigation'),0);assert.equal(env.app.listenerCount('web-contents-created'),0);
});

test('ignores aborted, extension-blocked, CORS, preflight, non-HTTP and inactive-instance events',async()=>{
  const ses=session('/profiles/b'),wc=page(8,ses),env=electron(wc),log=journal();let active=false;
  const dispose=captureFailures(ses,log,()=>active?{instanceId:'b'}:null,env);await flush();
  request(wc,'0','https://example.com/x');send(wc,'Network.loadingFailed',{requestId:'0',errorText:'net::ERR_CONNECTION_RESET'});
  active=true;
  request(wc,'1','https://example.com/a');send(wc,'Network.loadingFailed',{requestId:'1',errorText:'net::ERR_ABORTED',canceled:true});
  request(wc,'2','https://ads.example.com/a','Script');send(wc,'Network.loadingFailed',{requestId:'2',errorText:'net::ERR_BLOCKED_BY_CLIENT',blockedReason:'other'});
  request(wc,'3','https://api.example.com/a');send(wc,'Network.loadingFailed',{requestId:'3',errorText:'net::ERR_FAILED',corsErrorStatus:{corsError:'MissingAllowOriginHeader'}});
  request(wc,'4','https://api.example.com/a','Preflight');send(wc,'Network.loadingFailed',{requestId:'4',errorText:'net::ERR_FAILED'});
  request(wc,'5','data:text/plain,hi');send(wc,'Network.loadingFailed',{requestId:'5',errorText:'net::ERR_FAILED'});
  request(wc,'6','https://example.com/child','Document');wc.debugger.emit('message',{},'Network.loadingFailed',{requestId:'6',errorText:'net::ERR_FAILED'},'child-session');
  assert.equal(log.rows.length,0);dispose();
});

test('documents map to main and sub frames and duplicate failures are recorded once',async()=>{
  const ses=session('/profiles/c'),wc=page(9,ses),env=electron(wc),log=journal();
  const dispose=captureFailures(ses,log,()=>({instanceId:'c'}),env);await flush();
  request(wc,'m','https://example.com/','Document',{frameId:'ROOT'});send(wc,'Network.responseReceived',{requestId:'m',response:{status:404}});send(wc,'Network.loadingFailed',{requestId:'m',errorText:'net::ERR_CONNECTION_CLOSED'});
  request(wc,'s','https://frame.example.com/','Document',{frameId:'CHILD'});send(wc,'Network.loadingFailed',{requestId:'s',errorText:'net::ERR_NAME_NOT_RESOLVED'});
  assert.deepEqual(log.rows.map(x=>x.steps[0].resourceType),['mainFrame','subFrame']);assert.equal(log.rows[0].steps.length,1);dispose();
});

test('arms only after Facet attaches the page debugger and follows new pages of the same session',async()=>{
  const ses=session('/profiles/d'),other=session('/profiles/other'),env=electron(),log=journal();
  const dispose=captureFailures(ses,log,()=>({instanceId:'d'}),env);
  const wc=page(10,ses,{attached:false}),foreign=page(11,other);env.create(wc);env.create(foreign);
  wc.emit('did-start-navigation');assert.equal(wc.debugger.calls.length,0);
  wc.debugger.attached=true;wc.emit('did-start-navigation');wc.emit('did-start-navigation');await flush();
  assert.equal(wc.debugger.calls.filter(x=>x.method==='Network.enable').length,1);assert.equal(foreign.debugger.calls.length,0);assert.equal(foreign.debugger.listenerCount('message'),0);
  wc.debugger.emit('detach');assert(!watching(wc));wc.emit('did-start-navigation');await flush();assert.equal(wc.debugger.calls.filter(x=>x.method==='Network.enable').length,2);
  wc.destroy();assert(!watching(wc));dispose();assert.equal(env.app.listenerCount('web-contents-created'),0);
});

test('many instances share one app hook and extension Network.disable keeps capture armed',async()=>{
  const env=electron(),disposers=[],pages=[];
  for(let i=0;i<15;i++){const ses=session('/profiles/many-'+i),wc=page(100+i,ses);env.all.push(wc);pages.push(wc);disposers.push(captureFailures(ses,journal(),()=>({instanceId:String(i)}),env));}
  assert.equal(env.app.listenerCount('web-contents-created'),1);await flush();
  const wc=pages[0];wc.debugger.calls.length=0;assert.deepEqual(await releaseNetwork(wc),{});assert.deepEqual(wc.debugger.calls,[{method:'Network.enable',params:{...NETWORK_PARAMS}}]);
  for(const dispose of disposers)dispose();assert.equal(env.app.listenerCount('web-contents-created'),0);
  wc.debugger.calls.length=0;await releaseNetwork(wc);assert.deepEqual(wc.debugger.calls,[{method:'Network.disable',params:{}}]);
});

test('source guard: instance diagnostics never register Electron webRequest listeners',()=>{
  const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'src/main/network-capture.cjs'),'utf8');
  assert(!/\.webRequest\./.test(source),'network-capture must not use session.webRequest');
  for(const file of ['extension-host.cjs','extension-compat.cjs'])assert(fs.readFileSync(path.join(root,'src/main',file),'utf8').includes('releaseNetwork'),file+' must keep diagnostics armed when an extension disables Network');
});
