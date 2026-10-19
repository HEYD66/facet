'use strict';
// Local protocol/proxy fixtures exercise the real agent, Mihomo, storage and Chromium; no user nodes or accounts.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-ai-random-'));app.setPath('userData',root);app.disableHardwareAcceleration();
const {Controller}=require('../src/main/controller.cjs'),{TARGETS}=require('../src/main/diagnostics.cjs'),{Store}=require('../src/main/store.cjs');
const reports=[],servers=[],sockets=new Set();let c,win,modelSource,hold=false,held=false,proxyHits=0,failNextIP=false;
const wait=async(fn,label)=>{for(let i=0;i<1500;i++){if(await fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Timed out: '+label);};
async function serve(handler){
 const server=http.createServer(handler);server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
 server.on('connect',(_req,socket)=>{
  socket.on('error',()=>{});socket.write('HTTP/1.1 200 Connection established\r\n\r\n');
  let request='';const receive=chunk=>{request+=chunk.toString();if(!request.includes('\r\n\r\n'))return;socket.removeListener('data',receive);
   handler({url:request.split(' ')[1]},{end:body=>{body=String(body||'');socket.end('HTTP/1.1 200 OK\r\nContent-Length: '+Buffer.byteLength(body)+'\r\nConnection: close\r\n\r\n'+body);}});
  };socket.on('data',receive);
 });servers.push(server);await new Promise(r=>server.listen(0,'127.0.0.1',r));return server;
}
setTimeout(()=>app.exit(2),120000).unref();
app.whenReady().then(async()=>{try{
 const nodes=[];
 for(let i=0;i<2;i++){
  const proxy=await serve((req,res)=>{proxyHits++;if(hold){held=true;return;}
   if(failNextIP&&req.url.includes('/ip')){failNextIP=false;res.end('{}');return;}
   res.end(req.url.includes('/ip')?JSON.stringify({success:true,ip:'203.0.113.'+(50+i),country:i?'United States':'Japan',country_code:i?'US':'JP',timezone:{id:i?'America/New_York':'Asia/Tokyo'}}):req.url.includes('/latency')?'ip=203.0.113.'+(50+i)+'\n':'<!doctype html><title>Random instance verified</title><body>Local verification</body>');});
  nodes.push({name:i?'日本标签实际美国':'美国标签实际日本',type:'http',server:'127.0.0.1',port:proxy.address().port});
 }
 TARGETS.latency='http://diagnostic.invalid/latency';TARGETS.ip='http://diagnostic.invalid/ip';TARGETS.fallback='http://diagnostic.invalid/fallback';
 const model=await serve(async(req,res)=>{let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);
  assert(body.messages[0].content.includes('random:true'));
  assert(body.tools.find(t=>t.function.name==='facet_action').function.description.includes('最多换5个节点'));
  const done=body.messages.slice(body.messages.findLastIndex(m=>m.role==='user')).some(m=>m.role==='tool');
  const message=done?{role:'assistant',content:'请以工具返回的实测结果为准。'}:{role:'assistant',content:null,tool_calls:[{id:'random-create',type:'function',function:{name:'facet_action',arguments:JSON.stringify({action:'create',params:{name:hold?'Cancelled random':'AI random one',sourceId:modelSource,random:true,start:false}})}}]};
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message}]}));
 });
 win=new BrowserWindow({show:false,webPreferences:{offscreen:true,preload:path.join(__dirname,'../src/main/preload.cjs'),sandbox:true,contextIsolation:true}});
 c=new Controller(win,root,path.join(__dirname,'../resources/mihomo/mihomo.exe'));require('../src/main/ipc.cjs').installIPC(win,c);
 const agent=c.aiAgent,original=c.store.list()[0];modelSource=await c.library.save({name:'Local test nodes',text:JSON.stringify({proxies:nodes})});
 agent.save({baseURL:'http://127.0.0.1:'+model.address().port+'/v1',model:'random-contract-fixture'});
 agent.begin({prompt:'新建随机实例',ids:[original.id],permission:'full'});await wait(()=>!agent.run.busy,'agent create');
 const created=c.store.list().find(x=>x.name==='AI random one');assert(created,JSON.stringify(agent.run.entries));assert.equal(created.network.mode,'mihomo');assert(created.environment.fingerprint.enabled);assert(created.environment.fingerprint.hardware);assert(created.environment.fingerprint.canvas);assert(created.environment.fingerprint.audio);assert(created.environment.fingerprint.webgl);
 const output=JSON.parse(agent.run.entries.find(e=>e.kind==='tool').text.slice('facet_action：'.length)).result;assert(output.verified);assert(output.connectivity.ok);assert(proxyHits>=2);assert(output.exitLocale.cached===false);assert.equal(created.environment.language,output.exitLocale.countryCode==='JP'?'ja-JP':'en-US');assert.equal(created.environment.timezone,output.exitLocale.timezone);assert(agent.run.scope.includes(created.id));
 assert.deepEqual(new Store(root).get(created.id),created);reports.push('Actual model tool request creates a persisted random fingerprint and freshly measured proxy with matching IP locale; misleading node names ignored');
 c.store.update(created.id,{url:'http://random-page.invalid/'});await c.start(created.id);await wait(()=>c.runtimes.get(created.id).view.webContents.getTitle()==='Random instance verified','proxy page');
 const observed=await c.runtimes.get(created.id).view.webContents.executeJavaScript('({language:navigator.language,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})');assert.equal(observed.language,created.environment.language);assert.equal(observed.timezone,created.environment.timezone);await c.stop(created.id);reports.push('Real Chromium page loads through assigned Mihomo and exposes the matched language/timezone');
 const second=await agent.tool('facet_action',{action:'create',params:{name:'AI random two',random:true,sourceId:modelSource}});assert(second.result.verified);assert.notEqual(second.result.environment.seed,created.environment.fingerprint.seed);
 const evidence=c.diagnostics.results.get(JSON.stringify([modelSource,second.result.assignment.nodeName,'ip']));assert(evidence.ok);assert.equal(evidence.ip,second.result.exitLocale.ip);
 failNextIP=true;const fallback=await agent.tool('facet_action',{action:'create',params:{name:'AI random replacement',random:true,sourceId:modelSource}});assert(fallback.result.verified);assert.equal(fallback.result.connectivity.attempted,2);reports.push('A failed fresh exit lookup retries a different node; successful measurements are available to subsequent context queries');
 const before=c.store.list().length;
 await assert.rejects(agent.tool('facet_action',{action:'create',params:{name:'Forbidden override',random:true,sourceId:modelSource,syncLocale:false}}),/请勿/);
 agent.run.permission='read';await assert.rejects(agent.tool('facet_action',{action:'create',params:{name:'Denied',random:true}}),/仅可查看/);agent.run.permission='full';assert.equal(c.store.list().length,before);
 reports.push('Repeated random creation generates independent seeds; disabling IP matching and read-only mutation are rejected');
 const broken=await serve((req,res)=>res.end(req.url.includes('/latency')?'ip=203.0.113.80\n':JSON.stringify({success:true,ip:'203.0.113.80',country_code:'JP'})));
 const brokenSource=await c.library.save({name:'Incomplete exit data',text:JSON.stringify({proxies:[{name:'Broken region',type:'http',server:'127.0.0.1',port:broken.address().port}]})});
 await assert.rejects(agent.tool('facet_action',{action:'create',params:{name:'Must not create',random:true,sourceId:brokenSource}}),/未创建实例/);assert.equal(c.store.list().length,before);reports.push('Incomplete measured IP locale blocks creation without direct fallback');
 hold=true;agent.begin({prompt:'取消检测测试',ids:[original.id],permission:'full'});await wait(()=>held,'held proxy request');agent.stop();await wait(()=>!agent.run.busy,'cancelled agent');assert.equal(c.store.list().length,before);assert.equal(c.diagnostics.cores.size,0);assert.equal(c.diagnostics.standalone.size,0);reports.push('Stop cancels live proxy probes and cleans child cores without creating an instance');
 fs.writeFileSync(path.join(root,'report.json'),JSON.stringify({passed:true,reports,model:'Local deterministic protocol fixture'},null,2));console.log(JSON.stringify({passed:true,root,reports}));
 }catch(e){console.error(e);process.exitCode=1;}finally{await c?.closeAll();win?.destroy();for(const socket of sockets)socket.destroy();for(const server of servers)server.close();app.exit(process.exitCode||0);}});
