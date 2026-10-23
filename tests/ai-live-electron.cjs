'use strict';
// Explicit opt-in: uses an existing provider's encrypted configuration in memory.
// It visits only an isolated local page. It never prints or copies credentials.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const settings=process.argv.find(x=>x.startsWith('--settings='))?.slice(11);
if(!settings){console.error('Pass --settings=<existing encrypted ai-settings.json> to opt into a live model smoke test.');app.exit(2);}
const root=process.argv.find(x=>x.startsWith('--test-profile='))?.slice(15)||fs.mkdtempSync(path.join(os.tmpdir(),'facet-ai-live-'));app.setPath('userData',root);app.disableHardwareAcceleration();
let c,win,server,hits=0,uploaded='';const marker='FACET-'+require('node:crypto').randomBytes(5).toString('hex');
const wait=async(fn,timeout=120000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Live smoke test timed out');};
const timer=setTimeout(()=>app.exit(2),220000);
app.whenReady().then(async()=>{let error,report;try{
 win=new BrowserWindow({show:true,width:1280,height:900,webPreferences:{preload:path.join(__dirname,'../src/main/preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 c=new(require('../src/main/controller.cjs').Controller)(win,root,'');require('../src/main/ipc.cjs').installIPC(win,c);await win.loadFile(path.join(__dirname,'../src/renderer/index.html'));
 server=http.createServer(async(req,res)=>{if(req.url==='/probe'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({marker,status:'cooldown',retryAfterMs:25000}));return;}if(req.url==='/upload'){for await(const b of req)uploaded+=b;res.end('received');return;}if(req.url==='/increment'){hits++;res.end(String(hits));return;}res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>千面 Agent 实际验收</title><h1>校验码 '+marker+'</h1><p>计数：<span id="count">0</span></p><button id="increment">加一</button><input id="file" type="file"><script>window.clicks=[];document.querySelector("button").onclick=e=>{window.clicks.push(e.isTrusted);fetch("/increment").then(r=>r.text()).then(n=>document.querySelector("#count").textContent=n)}</script>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const target=c.store.list()[0].id;c.store.update(target,{url:'http://127.0.0.1:'+server.address().port+'/'});await c.start(target);
 await win.webContents.executeJavaScript(`route('browser',${JSON.stringify(target)});document.querySelector('#aiToggle').click()`);const wc=c.runtimes.get(target).view.webContents;await wait(()=>wc.getTitle()==='千面 Agent 实际验收');
 const config=JSON.parse(fs.readFileSync(settings,'utf8')),a=c.aiAgent;a.config=config;a.providers=config.providers||[config];a.maxRounds=8;
 a.begin({prompt:'这是隔离本机测试页。请观察当前授权实例的网页，点击“加一”按钮一次且仅一次，再观察并核对页面计数为1。最终回复网页上显示的校验码和计数。不要刷新页面、不要创建实例或访问其他网站。',ids:[target],permission:'full'});
 await wait(()=>!a.run.busy);assert.equal(a.run.status,'已完成',a.run.entries.filter(e=>e.kind==='system').map(e=>e.text).join('\n'));assert.equal(hits,1);assert.equal(await wc.executeJavaScript('document.querySelector("#count").textContent'),'1');assert.deepEqual(await wc.executeJavaScript('window.clicks'),[true]);
 assert(a.run.entries.some(e=>e.kind==='tool'&&e.text.startsWith('observe：')));assert(a.run.entries.some(e=>e.kind==='tool'&&e.text.startsWith('act：')));assert(a.run.entries.some(e=>e.kind==='assistant'&&e.text.includes(marker)));
 const restored=new(require('../src/main/ai-agent.cjs').AIAgent)(c);assert(restored.memory.context([target]).some(m=>m.role==='assistant'&&m.content?.includes(marker)));
 report={passed:true,model:config.model,engine:a.snapshot().engine,rounds:a.run.round,actualHTTPIncrements:hits,trustedClicks:1,verified:['live configured model','official DSH loop','real observe/act','exactly one trusted click','page plus HTTP counter both 1','real page marker in final answer','encrypted restored memory'],root};
 if(process.argv.includes('--capabilities')){
  const sample=path.join(root,'sample.txt');fs.writeFileSync(sample,'LIVE-'+marker);a.maxRounds=16;
  a.begin({prompt:'继续隔离本机验收，不再点击加一。请实际使用新工具：1. network_log start；2. cdp_command Runtime.evaluate 发起 fetch("/probe")（awaitPromise/returnByValue）；3. network_log read 找到请求，再 body 读取真实响应，报告 marker 和 retryAfterMs；4. upload_file 将 '+sample+' 填入 #file；5. Runtime.evaluate 读取 files[0].text() 后 fetch("/upload",{method:"POST",body:text}) 并核对返回 received。全部完成后回答实际结果。不要创建实例、访问外网、请求用户确认或声称不支持脚本。',ids:[target],permission:'full'});
  await wait(()=>!a.run.busy);assert.equal(a.run.status,'已完成');assert.equal(uploaded,'LIVE-'+marker);assert.equal(hits,1);
  const entries=a.run.entries.filter(e=>e.kind==='tool');for(const name of ['network_log','cdp_command','upload_file'])assert(entries.some(e=>e.text.startsWith(name+'：')),'Missing live '+name);
  assert(entries.some(e=>e.text.startsWith('network_log：')&&e.text.includes('retryAfterMs')));assert(a.run.entries.filter(e=>e.kind==='assistant').at(-1).text.includes(marker));assert(!a.pending);
  report.verified.push('live model executes Runtime.evaluate, network start/read/body, and real file upload without confirmation');report.capabilityRounds=a.run.round;
 }
 if(process.argv.includes('--history-greeting')){
  const ids=[target];for(let i=0;i<3;i++){const item=c.store.create('隔离问候验收 '+(i+1));c.store.update(item.id,{url:'http://127.0.0.1:'+server.address().port+'/'});await c.start(item.id);ids.push(item.id);}
  a.memory.add(ids,[{role:'user',content:'旧任务：核对6个实例。'},{role:'assistant',content:'上次有6个实例运行，完成其中1个，其余5个待处理。'}]);
  a.run.plan={steps:[{id:'old',title:'完成其余5个实例的打开与检测',status:'in_progress'}],explanation:'上次的旧计划',revision:1,updatedAt:'2026-10-21T17:30:13.185Z'};a.run.planTaskId=a.run.id;a.persist();
  const toolsBefore=a.run.entries.filter(e=>e.kind==='tool').length;
  a.begin({prompt:'hi',ids,permission:'read'});await wait(()=>!a.run.busy);
  assert.equal(a.run.status,'已完成');assert.equal(a.snapshot().task.planCurrent,false);
  const greetingTools=a.run.entries.filter(e=>e.kind==='tool').slice(toolsBefore);assert(greetingTools.every(e=>/^(list_instances|get_context)：/.test(e.text)));
  const answer=a.run.entries.filter(e=>e.kind==='assistant').at(-1).text;assert(!/6\s*个/.test(answer));assert(!/继续.*(?:检测|旧任务)|(?:检测|旧任务).*继续/.test(answer));assert.equal(hits,1);
  report.verified.push('live model greeting with stale six-instance history and four actual current instances: no stale count, old task replay or incomplete status');report.greetingRounds=a.run.round;report.currentInstances=ids.length;
 }
 }catch(e){error=e.message;report={passed:false,error,root};}finally{try{await c?.closeAll();}catch(e){error??=e.message;}win?.destroy();server?.closeAllConnections();server?.close();clearTimeout(timer);if(error){report.passed=false;report.error=error;}fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(error?1:0);}
});
