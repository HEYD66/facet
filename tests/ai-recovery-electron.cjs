'use strict';
// Real Electron, production IPC, trusted page input, HTTP/SSE and encrypted storage.
// A local deterministic provider validates execution and recovery, not model reasoning.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const root=process.argv.find(a=>a.startsWith('--test-profile='))?.slice(15)||fs.mkdtempSync(path.join(os.tmpdir(),'facet-ai-recovery-'));
app.setPath('userData',root);const reports=[],requests=[];let win,c,server,mode='plan',stage=0,limited=false,hits=0,target='';
const wait=async(fn,ms=20000)=>{const until=Date.now()+ms;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out: '+fn);};
const timer=setTimeout(()=>app.exit(2),120000);const call=(name,args)=>({id:'step-'+stage,type:'function',function:{name,arguments:JSON.stringify(args)}});
const plan=(first,second,third)=>({steps:[{id:'inspect',title:'观察计数页面',status:first},{id:'click',title:'点击一次计数按钮',status:second},{id:'verify',title:'核对页面及实际请求',status:third}]});
const reply=(res,message)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});const delta=message.tool_calls?{tool_calls:message.tool_calls.map((t,index)=>({index,...t}))}:{content:message.content};res.write('data: '+JSON.stringify({choices:[{index:0,delta,finish_reason:message.tool_calls?'tool_calls':'stop'}]})+'\n\n');res.end('data: [DONE]\n\n');};
app.whenReady().then(async()=>{let error;try{
 win=new BrowserWindow({show:!process.argv.includes('--resume'),width:1280,height:900,webPreferences:{preload:path.join(__dirname,'../src/main/preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 c=new(require('../src/main/controller.cjs').Controller)(win,root,'');require('../src/main/ipc.cjs').installIPC(win,c);const agent=c.aiAgent;
 const ui=async code=>{try{return await win.webContents.executeJavaScript(code);}catch(e){throw Error('Renderer fixture: '+code+'\n'+e.message);}};await win.loadFile(path.join(__dirname,'../src/renderer/index.html'));await ui("document.querySelector('#aiToggle').click()");
 if(process.argv.includes('--resume')){
  assert.equal(agent.run.busy,false);assert.equal(agent.run.permission,'confirm');assert.equal(agent.run.plan.steps[0].status,'blocked');
  await wait(()=>ui("!document.querySelector('#aiPlan').hidden&&document.querySelector('#aiPlan').textContent.includes('等待页面恢复')"));
  assert.equal(agent.snapshot().task.retry,null);assert(agent.sessions.rows.length>=2);assert(agent.memory.turns.length>0);
  reports.push('Fresh Electron process restores the selected session plan, history and blocked state without resuming actions or retry timers');
 }else{
  server=http.createServer(async(req,res)=>{
   if(req.url==='/hit'){hits++;res.end(String(hits));return;}
   if(req.url!=='/v1/chat/completions'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Recovery fixture</title><h1>Counter <span id="count">0</span></h1><button onclick="fetch(\'/hit\').then(r=>r.text()).then(n=>document.querySelector(\'#count\').textContent=n)">Increment once</button>');return;}
   let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push({mode,body});
   if(mode==='deny'){res.writeHead(401);res.end('DO_NOT_ECHO_SERVICE_BODY');return;}
   if(mode==='empty'){reply(res,{content:null});return;}
   if(mode==='stop'){res.writeHead(429,{'Retry-After':'30'});res.end();return;}
   if(mode==='blocked'){
    if(stage++===0)reply(res,{tool_calls:[call('update_plan',{explanation:'仍需核对页面',steps:[{id:'waiting',title:'等待页面恢复',status:'blocked'}]})]});
    else reply(res,{content:'页面尚未恢复，本次计划仍受阻。'});return;
   }
   if(stage===4&&!limited){limited=true;res.writeHead(429,{'Retry-After':'2'});res.end();return;}
   let message;
   if(stage===0)message={tool_calls:[call('update_plan',plan('in_progress','pending','pending'))]};
   else if(stage===1)message={tool_calls:[call('observe',{instanceId:target})]};
   else if(stage===2)message={tool_calls:[call('update_plan',plan('completed','in_progress','pending'))]};
   else if(stage===3){const observed=body.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content)).find(m=>m.elements);const ref=observed?.elements.match(/(e\d+) button "Increment once"/)?.[1];assert(ref);message={tool_calls:[call('act',{instanceId:target,ref,action:'click'})]};}
   else if(stage===4)message={tool_calls:[call('update_plan',plan('completed','completed','in_progress'))]};
   else if(stage===5)message={tool_calls:[call('observe',{instanceId:target})]};
   else if(stage===6){const observed=JSON.parse(body.messages.findLast(m=>m.role==='tool').content);assert(observed.text.includes('Counter 1'));message={tool_calls:[call('update_plan',plan('completed','completed','completed'))]};}
   else message={content:'已核对计数为 1，只点击了一次。'};
   stage++;reply(res,message);
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const instance=c.store.list()[0];target=instance.id;c.store.update(target,{url:base+'/page'});await c.start(target);await ui(`route('browser',${JSON.stringify(target)})`);
  const wc=c.runtimes.get(target).view.webContents;win.setAlwaysOnTop(true);win.show();win.moveTop();
  await wait(async()=>c.runtimes.get(target).view.getVisible()&&await wc.executeJavaScript('document.visibilityState==="visible"&&innerWidth>300&&!!document.querySelector("button")'));
  await new Promise(r=>setTimeout(r,300));agent.save({baseURL:base+'/v1',model:'local-recovery-fixture'});
  await ui("document.querySelector('#aiPermission').value='full';document.querySelector('#aiPrompt').value='只点击一次并核对结果';document.querySelector('#aiSend').click()");
  await wait(()=>agent.run?.retry?.phase==='waiting');assert.equal(hits,1);
  await wait(()=>ui("document.querySelector('#aiStatus').textContent.includes('重试')&&document.querySelector('#aiPlan .in_progress')?.textContent.includes('点击一次')"));
  await ui("document.documentElement.dataset.theme='dark';new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");fs.writeFileSync(path.join(root,'plan-dark.png'),(await win.webContents.capturePage()).toPNG());
  await wait(()=>!agent.run.busy);assert.equal(agent.run.status,'已完成');assert.equal(hits,1);assert.equal(await wc.executeJavaScript('document.querySelector("#count").textContent'),'1');
  const retried=requests.filter(r=>r.mode==='plan'&&r.body.messages.some(m=>m.role==='tool'&&m.content.includes('"action":"click"')));
  assert(retried.length>=2);assert.deepEqual(retried[0].body,retried[1].body,'retry preserves the complete prior tool transcript');
  assert.equal(agent.run.entries.filter(e=>e.kind==='tool'&&e.text.startsWith('act：')).length,1);assert.equal(agent.pending,null);
  assert(agent.run.plan.steps.every(s=>s.status==='completed'));await wait(()=>ui("document.querySelector('#aiPlan summary').textContent.includes('3 / 3')"));
  await ui("document.documentElement.dataset.theme='light';new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");fs.writeFileSync(path.join(root,'plan-light.png'),(await win.webContents.capturePage()).toPNG());
  reports.push('UI send → plan → observe → trusted click → HTTP 429 countdown → retry → verify → completed plan; page and upstream counter are both exactly 1');
  const planSession=agent.sessions.selectedId;
  for(const scenario of ['deny','empty']){
   mode=scenario;const before=requests.length;agent.begin({prompt:'检查失败收尾',ids:[target],permission:'full'});await wait(()=>!agent.run.busy);
   assert.equal(agent.run.status,'失败');assert.equal(requests.length-before,1);const answer=agent.run.entries.filter(e=>e.kind==='assistant').at(-1).text;
   assert(answer.includes('本次任务未完成'));assert(!answer.includes('DO_NOT_ECHO'));assert(agent.memory.context([target]).some(m=>m.role==='assistant'&&m.content===answer));
   await wait(()=>ui("document.querySelector('#aiHistory').textContent.includes('本次任务未完成')"));
  }
  reports.push('HTTP 401 and empty replies produce a visible persisted assistant answer, with no blind retry or service body exposure');
  mode='stop';const beforeStop=requests.length;agent.begin({prompt:'检查等待中的停止',ids:[target],permission:'full'});await wait(()=>agent.run.retry?.phase==='waiting');
  await wait(()=>ui("!document.querySelector('#aiStop').disabled"));await ui("document.querySelector('#aiStop').click()");await wait(()=>!agent.run.busy);assert.equal(agent.run.status,'已停止');assert.equal(requests.length-beforeStop,1);assert.equal(agent.snapshot().task.retry,null);
  reports.push('The real Stop button cancels retry waiting; no second request or repeated action is sent');
  mode='blocked';stage=0;agent.begin({prompt:'保留未完成计划',ids:[target],permission:'read'});await wait(()=>!agent.run.busy);assert.equal(agent.run.status,'已回复（计划未完成）');
  await wait(()=>ui("document.querySelector('#aiPlan .blocked')?.textContent.includes('等待页面恢复')"));
  await ui("document.querySelector('#aiClear').click()");await wait(()=>agent.sessions.selectedId!==planSession);
  await wait(()=>ui("document.querySelector('#aiPlan').hidden"));assert.equal(agent.snapshot().task,null);
  agent.sessions.select(planSession);await wait(()=>ui("!document.querySelector('#aiPlan').hidden&&document.querySelector('#aiPlan .blocked')!==null"));
  assert.equal(agent.run.plan.steps[0].status,'blocked');assert.equal(hits,1);
  const envelope=fs.readFileSync(agent.conversation.file,'utf8');assert(!envelope.includes('等待页面恢复'));assert(!envelope.includes('只点击一次'));
  reports.push('Blocked plans stay unfinished; New Task starts with no plan; switching sessions restores the correct plan, with encrypted persistence');
 }
}catch(e){error=e.stack;}finally{
 try{await c?.closeAll();}catch(e){error??=e.stack;}win?.destroy();server?.closeAllConnections();server?.close();clearTimeout(timer);
 const report={passed:!error,root,verification:'Isolated Electron and local HTTP/SSE fixture',reports,error};fs.writeFileSync(path.join(root,process.argv.includes('--resume')?'resume-report.json':'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(error?1:0);
}});
