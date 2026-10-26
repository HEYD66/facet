'use strict';
// Official DSH + real Electron/IPC/storage. The local provider is a deterministic
// protocol fixture, not a claim about an external model's reasoning quality.
const {app,BrowserWindow,nativeImage}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=process.argv.find(x=>x.startsWith('--test-profile='))?.slice(15)||fs.mkdtempSync(path.join(os.tmpdir(),'facet-dsh-'));
app.setPath('userData',root);app.disableHardwareAcceleration();
const resume=process.argv.includes('--resume'),reports=[],requests=[];
let c,win,server,held,target,base;
const wait=async(fn,ms=30000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Timeout: '+String(fn));};
const reply=(res,message)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',...message}}]}));};
const call=(name,args,id)=>({id,type:'function',function:{name,arguments:typeof args==='string'?args:JSON.stringify(args)}});
const timer=setTimeout(()=>app.exit(2),150000);
app.whenReady().then(async()=>{let error;try{
 win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{offscreen:true,preload:path.join(__dirname,'../src/main/preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 c=new(require('../src/main/controller.cjs').Controller)(win,root,'');require('../src/main/ipc.cjs').installIPC(win,c);const a=c.aiAgent;
 await win.loadFile(path.join(__dirname,'../src/renderer/index.html'));const ui=code=>win.webContents.executeJavaScript(code);
 const ipc=async(action,payload={})=>{const result=await ui(`bridge.request(${JSON.stringify(action)},${JSON.stringify(payload)})`);assert.equal(result.ok,true,result.error);return result.value;};
 server=http.createServer(async(req,res)=>{
  if(req.url!=='/v1/chat/completions'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>DSH real page</title><h1>DSH browser fixture</h1><input id="text"><button>Inspect</button>');return;}
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);
  const latest=body.messages.findLast(m=>m.role==='user'),prompt=Array.isArray(latest.content)?latest.content.find(b=>b.type==='text')?.text:latest.content;
  if(!body.tools){reply(res,{content:'已停止，工具不被支持，未修改网页。'});return;}
  const planned=body.messages.find(m=>m.role==='user'&&['PLAN_FOLLOWTHROUGH','PLAN_STUCK','PLAN_LIMIT'].includes(m.content));
  if(planned){
   const results=body.messages.filter(m=>m.role==='tool'),reminders=body.messages.filter(m=>m.role==='user'&&String(m.content).startsWith('千面任务收尾检查')).length,reminded=reminders>0;
   const step=status=>({steps:[{id:'inspect',title:'读取并核对真实网页',status}]});
   if(!results.length)reply(res,{tool_calls:[call('update_plan',step('in_progress'),'plan-start')]});
   else if(!reminded||planned.content==='PLAN_LIMIT'||planned.content==='PLAN_STUCK'&&reminders<4)reply(res,{content:'先到这里，需要我继续吗？'});
   else if(!results.some(m=>m.content.includes('DSH browser fixture')))reply(res,{tool_calls:[call('observe',{instanceId:target,full_text:true},'plan-observe')]});
   else if(results.filter(m=>m.content.includes('"changed":true')).length<2)reply(res,{tool_calls:[call('update_plan',step('completed'),'plan-finish')]});
   else reply(res,{content:'已读取并核对真实网页，任务完成。'});
   return;
  }
  if(prompt==='FIRST'||prompt==='HOLD_STOP'||prompt==='HOLD_BOUND'){held={res,body};req.on('close',()=>{});return;}
  if(prompt?.startsWith('立即补充')){
   const lastUser=body.messages.lastIndexOf(latest),done=body.messages.slice(lastUser).some(m=>m.role==='tool');
   reply(res,done?{content:'补充已执行，已读取真实网页。'}:{content:null,tool_calls:[call('read_page',{instanceId:target},'inspect-steer')]});return;
  }
  if(prompt==='UNKNOWN'||prompt==='INVALID'){
   const n=body.messages.filter(m=>m.role==='tool').length;if(n>=6){reply(res,{content:'错误已核对，六次尝试后正常回复。'});return;}
   reply(res,{content:null,tool_calls:[call(prompt==='UNKNOWN'?'nonexistent_tool':'read_page',prompt==='UNKNOWN'?{}:'{broken',prompt+'-'+n)]});return;
  }
  reply(res,{content:'完成 '+prompt});
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 target=c.store.list()[0].id;
 await ui("document.querySelector('#aiToggle').click()");await wait(()=>ui("!document.querySelector('#aiPanel').hidden&&document.querySelector('#aiEngine').textContent.includes('DeepSeek Harness')"));
 assert.equal(a.snapshot().engine.version,'0.2.1-rc.2');
 if(resume){
  assert.equal(requests.length,0);assert.equal(a.run.busy,false);assert.equal(a.run.permission,'confirm');assert.equal(a.run.queue[0].prompt,'RESUME_AFTER_RESTART');assert.equal(a.run.queue[0].images.length,1);
  assert(a.run.plan);assert.equal(a.snapshot().task.planCurrent,false);
  await wait(()=>ui("document.querySelector('#aiQueue').textContent.includes('RESUME_AFTER_RESTART')&&!!document.querySelector('#aiQueueNext')"));
  reports.push('Fresh process restores encrypted pending text/image and resets permission; no model request or action resumes automatically');
  a.save({baseURL:base+'/v1',model:'dsh-fixture'});await ui("document.querySelector('#aiPermission').value='read';document.querySelector('#aiQueueNext').click()");await wait(()=>requests.length&&a.run&&!a.run.busy);
  assert.equal(a.run.permission,'read');assert.equal(a.run.queue.length,0);
  // The restored conversation continues its own DSH session: the stopped task, the stop note and the new answer are one history.
  const stored=await require('../src/main/ai-dsh.cjs').history(a.dshDir,a.thread.sessionId),latest=requests.at(-1).messages;
  assert(stored.some(m=>m.role==='assistant'&&String(m.content).includes('RESUME_AFTER_RESTART')));assert(stored.some(m=>m.role==='user'&&m.content==='HOLD_BOUND'));
  assert(latest.some(m=>m.role==='user'&&m.content==='HOLD_BOUND'));assert(latest.some(m=>m.role==='user'&&String(m.content).startsWith('上一轮任务被用户停止')));
  reports.push('Real Continue Pending button authorizes the current read-only mode and completes one restored message with its image');
 }else{
  a.save({baseURL:base+'/v1',model:'dsh-fixture'});c.store.update(target,{url:base+'/page'});await c.start(target);await wait(()=>c.runtimes.get(target).view.webContents.getTitle()==='DSH real page');
  await wait(()=>ui("!document.querySelector('#aiSend').disabled"));
  await ui("document.querySelector('#aiPermission').value='full';document.querySelector('#aiPrompt').value='FIRST';document.querySelector('#aiSend').click()");await wait(()=>held&&a.dsh);
  const originalSession=a.sessions.activeId,taskId=a.run.id;
  await wait(()=>ui("!document.querySelector('#aiSendOptions').hidden&&!document.querySelector('#aiSend').disabled"));
  await ui("document.querySelector('#aiPrompt').value='SECOND';document.querySelector('#aiSend').click()");await wait(()=>a.run.queue.length===1);
  assert.equal(requests.length,1);assert.equal(a.run.queue[0].prompt,'SECOND');
  await wait(()=>ui("!document.querySelector('#aiSend').disabled"));
  await ui("document.querySelector('#aiSendMode').value='steer';document.querySelector('#aiPrompt').value='立即补充：读取真实网页，保持页面不变';document.querySelector('#aiSend').click()");await wait(()=>a.run.entries.some(e=>e.kind==='system'&&e.text.includes('下一步生效')));
  const steerImage=nativeImage.createFromBitmap(Buffer.from([0,0,255,255]),{width:1,height:1}).toDataURL();
  await ipc('ai-message',{taskId:a.run.id,mode:'steer',prompt:'立即补充：读取真实网页并参考附图',images:[steerImage]});
  await ipc('ai-clear');const viewedSession=a.sessions.selectedId;assert.notEqual(viewedSession,originalSession);
  reply(held.res,{content:'首步完成'});held=null;await wait(()=>!a.run.busy&&a.run.entries.some(e=>e.text==='完成 SECOND'));
  assert.equal(a.sessions.selectedId,viewedSession);assert.equal(a.sessions.activeId,originalSession);assert.equal(a.run.queue.length,0);assert.equal(a.run.permission,'full');
  const calls=requests.flatMap(p=>p.messages.filter(m=>m.role==='tool'));assert(calls.some(m=>m.content.includes('DSH browser fixture')));
  const second=requests.find(p=>p.messages.at(-1)?.content==='SECOND');assert(second&&second.messages.some(m=>String(m.content).includes('补充已执行')));
  assert(requests.some(p=>p.messages.some(m=>Array.isArray(m.content)&&m.content.some(b=>b.type==='image_url'&&b.image_url.url===steerImage))));
  assert.equal(a.sessions.rows.find(x=>x.id===viewedSession).task,null);
  await ipc('ai-session-select',{sessionId:originalSession});await wait(()=>ui("document.querySelector('#aiHistory').textContent.includes('完成 SECOND')"));
  reports.push('Real composer queues a follow-up and steers the official DSH next step; browser tool executes, order/history/permission stay correct while another session is viewed');
  assert.equal((await ui(`bridge.request('ai-message',{taskId:${JSON.stringify(taskId)},mode:'queue',prompt:'stale'})`)).ok,false);
  await ipc('ai-message',{taskId:a.run.id,mode:'queue',prompt:'POLL_FINISH_RACE',ids:[target],permission:'read'});await wait(()=>!a.run.busy);assert.equal(a.run.permission,'read');assert(a.run.entries.some(e=>e.text==='完成 POLL_FINISH_RACE'));
  reports.push('A send click racing with task completion starts a new turn once, with the explicitly selected permission');
  a.clear();a.begin({prompt:'PLAN_FOLLOWTHROUGH',ids:[target],permission:'read'});await wait(()=>!a.run.busy);
  assert.equal(a.run.status,'已完成');assert(a.run.plan.steps.every(s=>s.status==='completed'));assert(a.run.entries.some(e=>e.kind==='system'&&e.text.includes('正在核对并继续')));
  assert(a.run.entries.some(e=>e.kind==='tool'&&e.text.startsWith('observe：')));assert.equal(a.snapshot().task.planCurrent,true);
  reports.push('Official DSH continues an unfinished current plan after a premature text-only reply, reads the real page and verifies completion');
  const old=structuredClone(a.run.plan);old.steps=[{id:'old',title:'核对旧的6个实例',status:'in_progress'}];a.run.plan=old;a.persist();const beforeGreeting=requests.length;
  a.begin({prompt:'hi',ids:[target],permission:'read'});await wait(()=>!a.run.busy);assert.equal(a.run.status,'已完成');assert.equal(requests.length,beforeGreeting+1);assert.equal(a.snapshot().task.planCurrent,false);assert.deepEqual(a.run.plan,old);
  const greeting=requests.at(-1);assert(greeting.messages[0].content.includes('本轮开始时授权数量为 1 个'));assert(greeting.messages.some(m=>String(m.content).startsWith('历史任务计划')));
  await wait(()=>ui("document.querySelector('#aiPlan summary')?.textContent.includes('历史计划')&&document.querySelector('#aiContinue').textContent==='继续旧任务'"));
  assert.equal(await ui("document.querySelector('#aiPlan').open"),false);
  reports.push('Greeting preserves an old six-instance plan as collapsed history; current scope stays authoritative, no old operation resumes and the reply is not falsely marked unfinished');
  a.clear();a.begin({prompt:'PLAN_STUCK',ids:[target],permission:'read'});await wait(()=>!a.run.busy);assert.equal(a.run.status,'已完成');assert(a.run.plan.steps.every(s=>s.status==='completed'));
  assert.equal(a.run.entries.filter(e=>e.kind==='system'&&e.text.includes('正在核对并继续')).length,4);
  reports.push('Current task continues beyond two reminders and finishes the real page inspection without an artificial follow-through cutoff');
  a.clear();a.maxRounds=2;a.begin({prompt:'PLAN_LIMIT',ids:[target],permission:'read'});await wait(()=>!a.run.busy);assert.equal(a.run.status,'已达到 2 轮上限');a.maxRounds=0;
  reports.push('Configured round limit remains effective during plan follow-through');
  for(const prompt of ['UNKNOWN','INVALID']){
   a.clear();const before=requests.length;a.begin({prompt,ids:[target],permission:'full'});await wait(()=>!a.run.busy);assert.equal(a.run.status,'已完成');assert.equal(requests.length-before,7);assert(a.run.entries.some(e=>e.kind==='assistant'&&e.text.includes('六次')));
  }
  reports.push('Six repeated tool or argument errors reach the model for correction without a host-imposed no-progress stop');
  a.clear();a.begin({prompt:'HOLD_BOUND',ids:[target],permission:'read'});await wait(()=>held&&a.dsh);
  await a.tool('update_plan',{steps:[{id:'pending',title:'等待后续核对',status:'pending'}]});
  for(let i=0;i<8;i++)await ipc('ai-message',{taskId:a.run.id,mode:'queue',prompt:'BOUND_'+i});
  assert.equal((await ui(`bridge.request('ai-message',{taskId:${JSON.stringify(a.run.id)},mode:'queue',prompt:'OVERFLOW'})`)).ok,false);
  for(const item of a.run.queue.slice())await ipc('ai-queue-remove',{messageId:item.id});
  const png=nativeImage.createFromBitmap(Buffer.from([0,255,0,255]),{width:1,height:1}).toDataURL();
  await ipc('ai-message',{taskId:a.run.id,mode:'queue',prompt:'RESUME_AFTER_RESTART',images:[png]});
  const n=requests.length;await ipc('ai-stop');await wait(()=>!a.run.busy);held.res.destroy();held=null;assert.equal(a.run.queue.length,1);assert.equal(requests.length,n);
  const raw=fs.readFileSync(a.conversation.file,'utf8');assert(!raw.includes('RESUME_AFTER_RESTART')&&!raw.includes(png));
  await wait(()=>ui("!!document.querySelector('#aiQueueNext')&&!document.querySelector('#aiContinue').hidden"));
  reports.push('Queue limit, removal, stale-task rejection and Stop verified; queued text/image persist as ciphertext and never auto-run after Stop');
  await ui("document.documentElement.dataset.theme='dark'");await new Promise(r=>setTimeout(r,300));const image=await win.webContents.capturePage();assert(!image.isEmpty());fs.writeFileSync(path.join(root,'dsh-panel-dark.png'),image.toPNG());
  const layout=await ui("(()=>{const p=document.querySelector('#aiPanel'),q=document.querySelector('#aiQueue'),c=document.querySelector('.ai-compose');return {panel:p.getBoundingClientRect().width,overflow:p.scrollWidth>p.clientWidth+1,queue:q.getBoundingClientRect().height,composer:c.getBoundingClientRect().height}})()");assert(!layout.overflow);assert(layout.queue>0&&layout.composer>0);
  reports.push('Real production DSH panel captured in dark mode; pending controls visible and panel has no horizontal overflow');
 }
 }catch(e){error=e.stack;}finally{
  try{await c?.closeAll();}catch(e){error??=e.stack;}win?.destroy();server?.closeAllConnections();server?.close();clearTimeout(timer);
  const report={passed:!error,root,verification:'Official DSH, real Electron + isolated local protocol fixture',reports,error};fs.writeFileSync(path.join(root,resume?'resume-report.json':'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(error?1:0);
 }});
