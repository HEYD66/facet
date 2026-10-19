'use strict';
const {app,BrowserWindow,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const root=process.argv.find(x=>x.startsWith('--test-profile='))?.slice(15)||fs.mkdtempSync(path.join(os.tmpdir(),'facet-ai-sessions-'));
app.setPath('userData',root);app.disableHardwareAcceleration();
const {Controller}=require('../src/main/controller.cjs'),{ConversationStore}=require('../src/main/ai-conversation.cjs'),{Memory}=require('../src/main/ai-memory.cjs');
const wait=async fn=>{const end=Date.now()+20000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('Timed out');};
let c,win,server,target;const results=[],payloads=[];const timer=setTimeout(()=>app.exit(2),120000);
app.whenReady().then(async()=>{let error;try{
 win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{offscreen:true,preload:path.join(__dirname,'../src/main/preload.cjs'),contextIsolation:true,sandbox:true}});
 c=new Controller(win,root,path.join(root,'no-core'));target=c.store.list()[0].id;
 if(!process.argv.includes('--resume')){
  const memory=new Memory(),png=nativeImage.createFromBitmap(Buffer.from([255,0,0,255]),{width:1,height:1}).toDataURL();
  memory.add([target],[{role:'user',content:[{type:'text',text:'LEGACY_CONTEXT'},{type:'image_url',image_url:{url:png}}]},{role:'assistant',content:'LEGACY_REPLY'}]);memory.summary='LEGACY_SUMMARY';memory.summaryScope=[target];memory.compressions=1;
  new ConversationStore(root).save({memory:memory.export(),task:{id:'legacy-task',scope:[target],busy:false,status:'已完成',entries:[{kind:'user',text:'LEGACY_CONTEXT'},{kind:'assistant',text:'LEGACY_REPLY'}],history:[],partial:''}});
 }
 require('../src/main/ipc.cjs').installIPC(win,c);const agent=c.aiAgent;
 await win.loadFile(path.join(__dirname,'../src/renderer/index.html'));const ui=code=>win.webContents.executeJavaScript(code);
 await ui("document.querySelector('#aiToggle').click()");await wait(()=>ui("!document.querySelector('#aiPanel').hidden"));
 if(process.argv.includes('--resume')){
  const expected=JSON.parse(fs.readFileSync(path.join(root,'expected.json'),'utf8'));
  assert.equal(agent.sessions.selectedId,expected.selected);assert.equal(agent.sessions.rows.length,3);assert(agent.run.entries.some(x=>x.text.includes('B_ONLY')));
  agent.sessions.select(expected.legacy);assert(agent.memory.summary.includes('LEGACY_SUMMARY'));assert(JSON.stringify(agent.memory.export()).includes('image_url'));
  agent.sessions.select(expected.running);assert.equal(agent.run.busy,false);assert(agent.memory.context([target]).some(x=>x.content==='RUNNING'));
  assert(!JSON.stringify(agent.memory.export()).includes('B_ONLY'));
  results.push('Fresh process restores selected session, three separate histories, legacy image/summary and completed background task');
  for(const row of [...agent.sessions.rows])agent.sessions.remove(row.id,true);
  assert.equal(agent.sessions.rows.length,1);assert.equal(agent.run,null);assert.equal(agent.memory.turns.length,0);
  const reopened=new (require('../src/main/ai-agent.cjs').AIAgent)(c);assert.equal(reopened.sessions.rows.length,1);assert.equal(reopened.run,null);
  results.push('Deleting the final idle session creates and persists an empty replacement');
 }else{
  const legacy=agent.sessions.selectedId;assert.equal(agent.sessions.rows[0].title,'原有会话');assert(agent.memory.summary.includes('LEGACY_SUMMARY'));
  const backup=fs.readFileSync(agent.conversation.file+'.pre-sessions.bak','utf8');assert(!backup.includes('LEGACY_CONTEXT'));
  server=http.createServer(async(req,res)=>{if(req.url!=='/v1/chat/completions'){res.end('<!doctype html><title>Session test</title><input id="value">');return;}
   let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body);payloads.push(data);const last=data.messages.findLastIndex(x=>x.role==='user'),prompt=data.messages[last].content;
   const done=data.messages.slice(last).some(x=>x.role==='tool');const message=prompt==='RUNNING'&&!done?{role:'assistant',content:null,tool_calls:[{id:'fill-once',type:'function',function:{name:'fill',arguments:JSON.stringify({instanceId:target,selector:'#value',text:'ACTUAL_FILL'})}}]}:{role:'assistant',content:'完成 '+prompt};
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message}]}));
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  agent.save({baseURL:base+'/v1',model:'session-protocol'});c.store.update(target,{url:base+'/page'});await c.start(target);await wait(()=>c.runtimes.get(target).view.webContents.getTitle()==='Session test');
  const click=selector=>ui('document.querySelector('+JSON.stringify(selector)+').click()');
  await click('#aiClear');await wait(()=>agent.sessions.selectedId!==legacy);const running=agent.sessions.selectedId;
  assert.equal(agent.memory.turns.length,0);assert.equal(agent.sessions.rows.length,2);
  agent.begin({prompt:'RUNNING',ids:[target],permission:'confirm'});await wait(()=>agent.pending);
  const pending=agent.pending.id;await click('#aiClear');await wait(()=>agent.sessions.selectedId!==running);const b=agent.sessions.selectedId;
  assert(agent.run.busy);assert.equal(agent.sessions.activeId,running);assert.equal(agent.snapshot().task,null);assert.equal(agent.pending.id,pending);
  assert.throws(()=>agent.begin({prompt:'cannot overlap',ids:[target]}),/已有任务/);
  await wait(()=>ui("document.querySelector('#aiSend').disabled"));
  assert.throws(()=>agent.sessions.remove(running,true),/先停止/);
  await click('#aiSessionsButton');await wait(()=>ui("!document.querySelector('#aiSessions').hidden"));
  await click('[data-session-open="'+running+'"]');await wait(()=>agent.sessions.selectedId===running);await wait(()=>ui("!document.querySelector('#aiApproval').hidden"));
  await click('[data-ai-approval="yes"]');await wait(()=>!agent.run.busy);assert.equal(await c.runtimes.get(target).view.webContents.executeJavaScript('document.querySelector("#value").value'),'ACTUAL_FILL');
  agent.sessions.select(b);agent.begin({prompt:'B_ONLY',ids:[target],permission:'read'});await wait(()=>!agent.run.busy);assert.equal(agent.run.status,'已完成');
  const bPayload=payloads.find(x=>x.messages.at(-1).content==='B_ONLY');assert(bPayload);assert(!JSON.stringify(bPayload).includes('RUNNING'));assert(!JSON.stringify(bPayload).includes('LEGACY_CONTEXT'));
  results.push('UI new session preserves old history; background confirmation survives switching; overlapping execution rejected; actual DOM fill finishes only in its originating session');
  await click('#aiSessionsButton');await wait(()=>ui('!!document.querySelector(\'[data-session-rename="'+b+'"]\')'));
  await click('[data-session-rename="'+b+'"]');await ui('document.querySelector("#aiSessionName").value="会话 B · 独立上下文"');await click('#aiSessionConfirm');await wait(()=>agent.sessions.rows.find(x=>x.id===b).title==='会话 B · 独立上下文');
  // Disk-write failure leaves all saved sessions and selection intact.
  const bytes=fs.readFileSync(agent.conversation.file),before=agent.sessions.rows,rename=fs.renameSync;
  fs.renameSync=(from,to)=>{if(to===agent.conversation.file)throw Error('Injected disk failure');return rename(from,to);};
  try{assert.throws(()=>agent.sessions.create(),/保存失败/);assert.equal(agent.sessions.rows,before);assert.deepEqual(fs.readFileSync(agent.conversation.file),bytes);}finally{fs.renameSync=rename;}agent.persist();
  const disposable=agent.sessions.create();agent.sessions.rename(disposable,'删除测试');
  assert.throws(()=>agent.sessions.remove(disposable,false),/确认/);
  await wait(()=>ui('!!document.querySelector(\'[data-session-delete="'+disposable+'"]\')'));
  await click('#aiSessionsButton');await click('[data-session-delete="'+disposable+'"]');assert(agent.sessions.rows.some(x=>x.id===disposable));
  await click('#aiSessionCancel');assert(agent.sessions.rows.some(x=>x.id===disposable));
  await click('[data-session-delete="'+disposable+'"]');await click('#aiSessionConfirm');await wait(()=>!agent.sessions.rows.some(x=>x.id===disposable));
  agent.sessions.select(b);await wait(()=>ui("document.querySelector('#aiHistory').textContent.includes('B_ONLY')"));
  await click('#aiSessionsButton');await wait(()=>ui("!document.querySelector('#aiSessions').hidden"));
  for(const theme of ['dark','light']){await ui('document.documentElement.dataset.theme='+JSON.stringify(theme));await new Promise(r=>setTimeout(r,150));const image=await win.webContents.capturePage();assert(!image.isEmpty());fs.writeFileSync(path.join(root,'sessions-'+theme+'.png'),image.toPNG());}
  const bounds=await ui("(()=>{const p=document.querySelector('#aiPanel'),h=p.querySelector('header'),s=document.querySelector('#aiSessions');return {header:h.scrollWidth<=h.clientWidth,list:s.scrollWidth<=s.clientWidth}})()");assert(bounds.header&&bounds.list);
  assert(!fs.readFileSync(agent.conversation.file,'utf8').includes('B_ONLY'));
  fs.writeFileSync(path.join(root,'expected.json'),JSON.stringify({legacy,running,selected:b}));
  results.push('UI rename, deletion confirmation/cancel, disk failure preservation, encrypted persistence and light/dark session-list rendering passed');
 }
 }catch(e){error=e.stack;console.log(JSON.stringify({status:c?.aiAgent?.run?.status,entries:c?.aiAgent?.run?.entries,payloadCount:payloads.length}));}finally{await c?.closeAll();win?.destroy();server?.closeAllConnections();server?.close();clearTimeout(timer);const report={passed:!error,results,error,root};fs.writeFileSync(path.join(root,process.argv.includes('--resume')?'resume-report.json':'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(error?1:0);}});
