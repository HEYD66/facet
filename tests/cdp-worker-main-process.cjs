'use strict';
// Run the shipped main entry with disposable data, real API, real CDP and two
// independent Playwright clients. No user profile, public site or proxy needed.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net'),http=require('node:http'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process'),{WebSocket}=require('ws'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),fixture=fs.mkdtempSync(path.join(os.tmpdir(),'facet-cdp-worker-main-')),dataDir=path.join(fixture,'data');
const token=crypto.randomBytes(32).toString('base64url'),checks=[],samples=[];
let apiPort,cdpPort,server,launcher,browsers=[],sockets=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,label,ms=30000){const deadline=Date.now()+ms;let last;while(Date.now()<deadline){try{const value=await fn();if(value)return value;}catch(e){last=e;}await sleep(80);}throw Error(label+': timeout'+(last?' ('+last.message+')':''));}
function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(error=>error?reject(error):resolve(port));});});}
async function api(route,method='GET',body){const r=await fetch(`http://127.0.0.1:${apiPort}${route}`,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert(r.ok&&v.ok,route+': '+(v.error||r.status));return v.value;}
async function json(route,options){const r=await fetch(`http://127.0.0.1:${cdpPort}${route}`,options);assert.equal(r.status,200,route);return r.json();}
async function rpc(url){
 const socket=new WebSocket(url),pending=new Map();let sequence=0;
 sockets.push(socket);
 socket.on('message',raw=>{const m=JSON.parse(raw);const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Object.assign(Error(m.error.message),m.error)):p.resolve(m.result);});
 socket.on('close',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('CDP disconnected'));}pending.clear();});
 await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
 return {socket,send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP test timeout: '+method));},25000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}};
}
const firstSource=`({patched:!!globalThis.__arenaFingerprintV3Applied,ua:navigator.userAgent,platform:navigator.platform,cpu:navigator.hardwareConcurrency,memory:navigator.deviceMemory,language:navigator.language,languages:Array.from(navigator.languages),tz:Intl.DateTimeFormat().resolvedOptions().timeZone})`;
const hintsSource=`navigator.userAgentData?navigator.userAgentData.getHighEntropyValues(['architecture','bitness','platformVersion','fullVersionList']):null`;
async function start(cli=false){
 launcher=spawn(process.execPath,[path.join(root,'scripts/launch-electron.cjs'),'.','--user-data-dir='+dataDir,...(cli?['--remote-debugging-port=0','--remote-debugging-address=127.0.0.1']:[])],{cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true});
 launcher.stdout.on('data',b=>process.stdout.write(b));launcher.stderr.on('data',b=>process.stderr.write(b));
 await wait(async()=>(await api('/v1/status')).running,'formal main API startup');
 await wait(()=>json('/json/version'),'CDP gateway startup');
}
async function connect(){const b=await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);browsers.push(b);return b;}
async function targetPage(browser,id){
 const target=await wait(async()=>(await api('/v1/targets')).find(x=>x.instanceId===id&&x.type==='page'),'instance target');
 return wait(async()=>{
  for(const page of browser.contexts().flatMap(c=>c.pages())){
   const session=await page.context().newCDPSession(page);
   try{if((await session.send('Target.getTargetInfo')).targetInfo.targetId===target.targetId)return page;}finally{await session.detach();}
  }
 },'Playwright page selected by instance targetId');
}
async function sample(page,env,label,count=1){
 const main=await page.evaluate(`(async()=>({...${firstSource},hints:await (${hintsSource})}))()`);
 const expected={patched:true,ua:env.userAgent,platform:env.platform,cpu:env.cpu,memory:env.fingerprint.memory,language:env.language,languages:[env.language],tz:env.timezone};
 for(const [key,value]of Object.entries(expected))assert.deepEqual(main[key],value,label+': page '+key);
 const workers=await page.evaluate(async count=>{
  const results=[];
  for(let i=0;i<count;i++)results.push(await new Promise((resolve,reject)=>{
   const w=new SharedWorker('/shared-worker.js?'+crypto.randomUUID());const timer=setTimeout(()=>reject(Error('SharedWorker timeout')),15000);
   w.port.onmessage=e=>{clearTimeout(timer);w.port.close();resolve(e.data);};w.onerror=e=>{clearTimeout(timer);reject(Error(e.message||'SharedWorker error'));};w.port.start();
  }));return results;
 },count);
 for(const actual of workers){for(const [key,value]of Object.entries(expected))assert.deepEqual(actual[key],value,label+': first statement '+key);assert.deepEqual(actual.hints,main.hints,label+': worker UA-CH');}
 samples.push({label,count,first:workers[0]});checks.push(label);
}
async function stopAll(ids){for(const id of ids)await api(`/v1/instances/${id}/stop`,'POST');assert((await api('/v1/instances')).filter(x=>ids.includes(x.id)).every(x=>x.status==='stopped'));}
async function disconnect(){for(const b of browsers)await b.close().catch(()=>{});browsers=[];for(const s of sockets)s.terminate();sockets=[];}
async function shutdown(){
 const native=await rpc((await json('/json/version')).webSocketDebuggerUrl);
 await native.send('Browser.close').catch(()=>{});
 await wait(()=>launcher.exitCode!==null||launcher.signalCode!==null,'graceful process exit');
 assert.equal(launcher.exitCode,0,'formal main exits normally');launcher=null;
 await disconnect();
}
async function main(){
 apiPort=await freePort();do{cdpPort=await freePort();}while(apiPort===cdpPort);
 fs.mkdirSync(dataDir);fs.writeFileSync(path.join(dataDir,'control-api.json'),JSON.stringify({version:1,enabled:true,apiPort,cdpPort,token}));
 server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.url.startsWith('/shared-worker.js')){res.setHeader('Content-Type','text/javascript');res.end(`const first=${firstSource};const hints=${hintsSource};onconnect=e=>Promise.resolve(hints).then(hints=>e.ports[0].postMessage({...first,hints}));`);return;}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Formal main CDP worker regression</title><p>Disposable local fixture</p>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/`;
 await start();const version=await json('/json/version'),chrome=version.Browser.split('/')[1];assert.match(chrome,/^\d+\.\d+\.\d+\.\d+$/);
 const {environment}=require('../src/main/environment.cjs'),{preset}=require('../src/main/fingerprint.cjs');
 const envs=['en-US','ja-JP'].map((language,i)=>{const p=preset('win-intel-fhd',{language,timezone:i?'Asia/Tokyo':'America/New_York'},'external-worker-'+i);return environment({...p,userAgent:p.userAgent.replace(/Chrome\/[\d.]+/,'Chrome/'+chrome),cpu:i?12:7,fingerprint:{...p.fingerprint,memory:i?8:4}});});
 const browser=await connect(),second=await connect();
 const ids=[];for(let i=0;i<2;i++){const created=await api('/v1/instances','POST',{name:'CDP隔离回归'+i,start:true,environment:envs[i]});ids.push(created.id);await api(`/v1/instances/${created.id}/navigate`,'POST',{url});}
 const pages=await Promise.all(ids.map(id=>targetPage(browser,id)));
 await Promise.all(pages.map((p,i)=>sample(p,envs[i],'two Playwright clients / instance '+i,8)));
 const contextIds=[];
 for(const page of pages){const session=await page.context().newCDPSession(page);try{contextIds.push((await session.send('Target.getTargetInfo')).targetInfo.browserContextId);}finally{await session.detach();}}
 assert(contextIds.every(Boolean));assert.notEqual(contextIds[0],contextIds[1],'separate Chromium BrowserContexts');
 await pages[0].evaluate(()=>{document.cookie='isolation=A;path=/;max-age=3600';localStorage.setItem('isolation','A');});
 assert.deepEqual(await pages[1].evaluate(()=>[document.cookie,localStorage.getItem('isolation')]),['',null]);
 await pages[1].evaluate(()=>{document.cookie='isolation=B;path=/;max-age=3600';localStorage.setItem('isolation','B');});
 assert.deepEqual(await pages[0].evaluate(()=>[document.cookie,localStorage.getItem('isolation')]),['isolation=A','A']);checks.push('distinct Chromium context IDs, Cookie and localStorage isolation');
 const stored=JSON.parse(fs.readFileSync(path.join(dataDir,'instances.json'),'utf8')).instances;
 for(let i=0;i<2;i++)assert.deepEqual(stored.find(x=>x.id===ids[i]).environment,envs[i]);checks.push('real API settings persisted to disk');
 const listed=await json('/json/list'),pageTarget=listed.find(x=>x.url===url&&x.type==='page');assert(pageTarget);
 const direct=await rpc(pageTarget.webSocketDebuggerUrl);await direct.send('Runtime.enable');
 const long=await direct.send('Runtime.evaluate',{expression:'new Promise(r=>setTimeout(()=>r(42),5500))',awaitPromise:true,returnByValue:true});assert.equal(long.result.value,42);checks.push('direct page WebSocket and evaluation longer than internal 5s timeout');
 await assert.rejects(direct.send('Facet.nonexistent'),e=>e.code===-32601);checks.push('CDP error codes preserved');
 assert.equal(await new Promise((resolve,reject)=>{const request=http.get({hostname:'127.0.0.1',port:cdpPort,path:'/json/version',headers:{host:'untrusted.example'}},r=>{r.resume();resolve(r.statusCode);});request.on('error',reject);}),403);
 await new Promise((resolve,reject)=>{const denied=new WebSocket(version.webSocketDebuggerUrl,{origin:'https://untrusted.example'});denied.on('unexpected-response',(_req,r)=>{try{assert.equal(r.statusCode,403);r.resume();resolve();}catch(e){reject(e);}});denied.on('open',()=>{denied.terminate();reject(Error('foreign Origin accepted'));});denied.on('error',()=>{});});checks.push('foreign Host and WebSocket Origin rejected');
 await second.close();browsers=browsers.filter(x=>x!==second);
 await sample(pages[0],envs[0],'other client disconnect does not release setup',3);
 await disconnect();const reconnected=await connect();await sample(await targetPage(reconnected,ids[1]),envs[1],'Playwright reconnect',3);
 const changed=environment({...envs[0],cpu:9,language:'fr-FR',timezone:'Europe/Paris'});
 await api('/v1/actions','POST',{action:'settings',id:ids[0],patch:{environment:changed}});await api(`/v1/instances/${ids[0]}/start`,'POST');
 await sample(await targetPage(reconnected,ids[0]),changed,'environment changed while external CDP connected',3);envs[0]=changed;
 await api('/v1/actions','POST',{action:'toggle-devtools',id:ids[0]});
 await sample(await targetPage(reconnected,ids[0]),envs[0],'docked DevTools and external CDP coexist',2);
 await api('/v1/actions','POST',{action:'toggle-devtools',id:ids[0]});
 await stopAll(ids);await shutdown();checks.push('graceful full application shutdown');
 await start();const afterRestart=await connect();
 for(let i=0;i<2;i++){await api(`/v1/instances/${ids[i]}/start`,'POST');const page=await targetPage(afterRestart,ids[i]);await sample(page,envs[i],'fresh main-process restart / instance '+i,3);const marker=i?'B':'A';assert.deepEqual(await page.evaluate(()=>[document.cookie,localStorage.getItem('isolation')]),['isolation='+marker,marker]);}
 await stopAll(ids);await shutdown();checks.push('restart preserves instance settings and CDP functionality');
 const settings=JSON.parse(fs.readFileSync(path.join(dataDir,'control-api.json'),'utf8'));settings.cdpPort=null;fs.writeFileSync(path.join(dataDir,'control-api.json'),JSON.stringify(settings));
 // The CLI port-zero entry used by existing packaged-app checks still produces
 // DevToolsActivePort, and also goes through initialization coordination.
 launcher=spawn(process.execPath,[path.join(root,'scripts/launch-electron.cjs'),'.','--user-data-dir='+dataDir,'--remote-debugging-port=0'],{cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true});
 launcher.stdout.on('data',b=>process.stdout.write(b));launcher.stderr.on('data',b=>process.stderr.write(b));
 const portFile=path.join(dataDir,'DevToolsActivePort');await wait(()=>fs.existsSync(portFile),'CLI DevToolsActivePort');cdpPort=Number(fs.readFileSync(portFile,'utf8').split('\n')[0]);
 const cliBrowser=await connect();await api(`/v1/instances/${ids[0]}/start`,'POST');await sample(await targetPage(cliBrowser,ids[0]),envs[0],'legacy command-line port-zero gateway');await stopAll(ids);await shutdown();
}
async function cleanup(){
 await disconnect();
 if(launcher?.pid){try{execFileSync('taskkill',['/PID',String(launcher.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});}catch{}}
 if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
 // Remove disposable profiles including generated API credentials, even after
 // a failed assertion. Keep only the credential-free test report.
 await sleep(500);fs.rmSync(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
let error;
main().catch(e=>{error=e.stack||String(e);console.error(error);process.exitCode=1;}).finally(async()=>{
 try{await cleanup();}catch(e){error=error||e.stack;process.exitCode=1;}
 const report=path.join(fixture,'report.json');fs.writeFileSync(report,JSON.stringify({passed:!error,checks,samples,error},null,2));console.log(JSON.stringify({passed:!error,checks,report},null,2));
});
