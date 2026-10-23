'use strict';
// Real Chromium, HTTP requests, uploads and official DSH; isolated userData only.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-ai-capabilities-'));app.setPath('userData',root);app.disableHardwareAcceleration();
let c,win,server,target,requests=0,uploaded='',endpoint='',fixtureError;const reports=[];
const wait=async(fn,ms=30000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Timeout: '+String(fn));};
const timer=setTimeout(()=>app.exit(2),120000);
app.whenReady().then(async()=>{let error;try{
 server=http.createServer(async(req,res)=>{try{
  if(req.url==='/v1/chat/completions'){
   let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);requests++;
   const rows=body.messages.filter(m=>m.role==='tool');let message;
   if(!rows.length)message={tool_calls:Array.from({length:9},(_,i)=>({id:'batch-'+i,type:'function',function:{name:'list_instances',arguments:'{}'}}))};
   else {assert.equal(rows.length,9);message={content:'九个工具调用均已完成。'};}
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',...message}}]}));return;
  }
  if(req.url.startsWith('/api/pulse')){res.setHeader('Content-Type','application/json');res.setHeader('X-Probe','actual-network');res.end(JSON.stringify({status:'cooldown',retryAfterMs:25000}));return;}
  if(req.url==='/upload'){for await(const b of req)uploaded+=b;res.end('received '+uploaded.length);return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>Capability audit</title><h1>Live capabilities</h1><input type="password" id="pw" placeholder="Password"><input type="file" id="file"><div id="status">initial</div>');
 }catch(e){fixtureError=e;res.statusCode=500;res.end('fixture failure');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));endpoint='http://127.0.0.1:'+server.address().port;
 win=new BrowserWindow({show:true,width:1280,height:900,webPreferences:{sandbox:true,contextIsolation:true,preload:path.join(__dirname,'../src/main/preload.cjs')}});
 c=new(require('../src/main/controller.cjs').Controller)(win,root,'');require('../src/main/ipc.cjs').installIPC(win,c);const agent=c.aiAgent;
 await win.loadFile(path.join(__dirname,'../src/renderer/index.html'));target=c.store.list()[0].id;c.store.update(target,{url:endpoint+'/page'});await c.start(target);
 const wc=c.runtimes.get(target).view.webContents;await wait(()=>wc.getTitle()==='Capability audit');await win.webContents.executeJavaScript(`route('browser',${JSON.stringify(target)})`);
 agent.save({baseURL:endpoint+'/v1',model:'capability-protocol'});agent.begin({prompt:'九个工具调用',ids:[target],permission:'full'});await wait(()=>!agent.run.busy);if(fixtureError)throw fixtureError;
 assert.equal(agent.run.status,'已完成');assert.equal(requests,2);assert.equal(agent.run.entries.filter(x=>x.kind==='tool'&&x.text.startsWith('list_instances：')).length,9);reports.push('Official DSH accepts and executes nine tool calls in one response without the previous eight-call cutoff');
 agent.run.abort=new AbortController();agent.run.permission='full';agent.run.sharePage=true;
 const tool=(name,args)=>agent.tool(name,{instanceId:target,...args});
 const cmd=(method,params)=>tool('cdp_command',{method,params});
 const layout=await cmd('Page.getLayoutMetrics');assert(layout.result.cssLayoutViewport.clientWidth>0);
 const evaluated=await cmd('Runtime.evaluate',{expression:'document.querySelector("#status").textContent="script ran"; document.querySelector("#status").textContent',returnByValue:true});assert.equal(evaluated.result.result.value,'script ran');assert.equal(await wc.executeJavaScript('document.querySelector("#status").textContent'),'script ran');assert(!agent.pending);
 const dom=await cmd('DOM.getDocument',{depth:0});assert(dom.result.root.nodeId>0);reports.push('Internal Runtime.evaluate changes the real page and DOM.getDocument works with no external CDP port or approval in full mode');
 const count=wc.debugger.listenerCount('message');await tool('network_log',{action:'start'});assert.equal(wc.debugger.listenerCount('message'),count+1);await tool('network_log',{action:'start'});assert.equal(wc.debugger.listenerCount('message'),count+1);
 await cmd('Runtime.evaluate',{expression:'fetch("/api/pulse?token=fixture-sensitive",{headers:{"X-Probe":"ai-capability"}}).then(r=>r.json())',returnByValue:true,awaitPromise:true});
 let logs;await wait(async()=>{logs=await tool('network_log',{action:'read'});return logs.items.some(x=>x.url.includes('/api/pulse')&&x.finished);});const req=logs.items.find(x=>x.url.includes('/api/pulse'));
 assert.equal(req.status,200);assert.equal(req.method,'GET');assert(!req.url.includes('fixture-sensitive'));assert.equal(req.responseHeaders['X-Probe'],'actual-network');
 const body=await tool('network_log',{action:'body',requestId:req.requestId});assert.deepEqual(JSON.parse(body.body),{status:'cooldown',retryAfterMs:25000});assert.equal((await tool('network_log',{action:'read',after:logs.cursor})).items.length,0);
 reports.push('Network capture finds a real fetch URL/status/headers and reads actual cooldown/retryAfterMs response content with cursor pagination');
 const sample=path.join(root,'upload.txt');fs.writeFileSync(sample,'FACET_REAL_UPLOAD');await tool('upload_file',{selector:'#file',files:[sample]});assert(!agent.pending);
 const sent=await cmd('Runtime.evaluate',{expression:'document.querySelector("#file").files[0].text().then(text=>fetch("/upload",{method:"POST",body:text})).then(r=>r.text())',awaitPromise:true,returnByValue:true});assert.equal(uploaded,'FACET_REAL_UPLOAD');assert.equal(sent.result.result.value,'received 17');
 reports.push('upload_file fills a real Chromium file input; the local HTTP server receives the exact file bytes');
 const observation=await tool('observe',{}),ref=observation.elements.match(/(e\d+) password "Password"/)[1];const typed=await tool('act',{action:'type',ref,text:'local-only-password'});assert.equal(await wc.executeJavaScript('document.querySelector("#pw").value'),'local-only-password');assert(!JSON.stringify(typed).includes('local-only-password'));assert(!(await tool('observe',{})).elements.includes('local-only-password'));
 reports.push('Password input succeeds with real browser input events and is not echoed in observe or act results');
 agent.run.permission='read';assert((await cmd('Page.getFrameTree')).result.frameTree);await assert.rejects(cmd('Runtime.evaluate',{expression:'document.title="forbidden"'}),/仅可查看/);await assert.rejects(tool('upload_file',{selector:'#file',files:[sample]}),/仅可查看/);assert.equal(wc.getTitle(),'Capability audit');
 agent.run.permission='confirm';const confirm=cmd('Runtime.evaluate',{expression:'document.querySelector("#status").textContent="confirmed"',returnByValue:true});await wait(()=>!!agent.pending);assert.equal(await wc.executeJavaScript('document.querySelector("#status").textContent'),'script ran');agent.approve(agent.pending.id,true);await confirm;assert.equal(await wc.executeJavaScript('document.querySelector("#status").textContent'),'confirmed');
 await assert.rejects(agent.tool('cdp_command',{instanceId:'outside',method:'Page.getFrameTree'}),/授权范围/);reports.push('User-selected scope and read/confirm/full modes retain their actual behavior; full operations do not ask again');
 await tool('network_log',{action:'clear'});assert.equal((await tool('network_log',{action:'read'})).items.length,0);const beforeStop=wc.debugger.listenerCount('message');await tool('network_log',{action:'stop'});assert.equal(wc.debugger.listenerCount('message'),beforeStop-1);assert(wc.debugger.isAttached());
 await tool('network_log',{action:'start'});require('../src/main/ai-project-tools.cjs').cleanup(agent);assert.equal(wc.debugger.listenerCount('message'),beforeStop-1);reports.push('Stop and task cleanup remove only the capture listener; existing debugger and network listeners stay attached');
 agent.run.permission='full';const hanging=cmd('Runtime.evaluate',{expression:'new Promise(()=>{})',awaitPromise:true});setTimeout(()=>agent.run.abort.abort(),100);await assert.rejects(hanging);reports.push('Manual stop interrupts a waiting CDP tool without waiting for an unresolved page promise');
 }catch(e){error=e.stack;}finally{try{await c?.closeAll();}catch(e){error??=e.stack;}win?.destroy();server?.closeAllConnections();server?.close();clearTimeout(timer);const result={passed:!error,reports,error,root};fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));app.exit(error?1:0);}});
