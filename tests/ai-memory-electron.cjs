'use strict';
const {app,BrowserWindow,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [root,phase,origin]=process.argv.slice(2);
app.disableHardwareAcceleration();app.setPath('userData',root);
const {AIAgent}=require('../src/main/ai-agent.cjs');
const {Memory}=require('../src/main/ai-memory.cjs');
const {interruptedHistory}=require('../src/main/ai-conversation.cjs');
const wait=async fn=>{for(let i=0;i<500;i++){if(await fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Timed out');};
let c,win;
app.whenReady().then(async()=>{try{
 win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{offscreen:true,preload:path.join(__dirname,'../src/main/preload.cjs'),contextIsolation:true,sandbox:true}});
 c=new(require('../src/main/controller.cjs').Controller)(win,root,'');require('../src/main/ipc.cjs').installIPC(win,c);
 const agent=c.aiAgent,id=c.store.list()[0].id;
 await win.loadFile(path.join(__dirname,'../src/renderer/index.html'));
 const ui=s=>win.webContents.executeJavaScript(s);
 await wait(()=>ui("!!document.querySelector('#aiToggle')&&typeof state!=='undefined'&&state.instances.length>0"));
 await ui("document.querySelector('#aiToggle').click()");
 const run=async(prompt,extra={})=>{agent.begin({prompt,ids:[id],permission:'read',...extra});await wait(()=>!agent.run.busy);assert.equal(agent.run.status,'已完成');assert.equal(agent.conversation.error,'');};
 if(phase==='write'){
  agent.save({baseURL:origin+'/v1',model:'memory-fixture'});
  for(let i=0;i<3;i++)await run('LONG_HISTORY '+i+'前置约束'.repeat(2500));
  const png=nativeImage.createFromBitmap(Buffer.from([255,0,0,255]),{width:1,height:1}).toDataURL();
  await run('图片保留标记',{images:[png]});assert(agent.memory.compressions>0);
  const bytes=fs.readFileSync(agent.conversation.file,'utf8');assert(!bytes.includes('图片保留标记'));assert(!bytes.includes(png));assert(!bytes.includes('持久摘要'));
  assert(!fs.existsSync(agent.conversation.file+'.bak'));
 }else if(phase==='restore'){
  assert(agent.memory.compressions>0);assert(agent.memory.summary.includes('持久摘要'));assert(!agent.run.busy);assert.equal(agent.pending,null);
  await wait(()=>ui("document.querySelector('#aiHistory').textContent.includes('图片保留标记')"));
  assert(await ui("document.querySelector('#aiMemory').title.includes('重启后保留')"));
  const image=await win.webContents.capturePage();assert(!image.isEmpty());fs.writeFileSync(path.join(root,'restored.png'),image.toPNG());
  await run('AFTER_RESTART');const other=c.store.create('Other isolated scope');
  await run('NARROWED_CONTEXT',{ids:[other.id]});assert(agent.memory.turns.some(t=>JSON.stringify(t).includes('图片保留标记')));
  await run('RESTORE_SCOPE');
  // A failed atomic replacement must preserve both saved bytes and the live task.
  const file=agent.conversation.file,before=fs.readFileSync(file),prior=agent.run,originalRename=fs.renameSync;
  fs.renameSync=(from,to)=>{if(to===file){const e=Error('Injected disk failure');e.code='EACCES';throw e;}return originalRename(from,to);};
  try{assert.throws(()=>agent.clear(),/保存失败/);assert.equal(agent.run,prior);assert.deepEqual(fs.readFileSync(file),before);assert.throws(()=>agent.begin({prompt:'Must not send',ids:[id]}),/保存失败/);assert.equal(agent.run,prior);}finally{fs.renameSync=originalRename;}
  assert(agent.snapshot().memory.error);agent.persist();assert(!agent.snapshot().memory.error);
  assert(!fs.readdirSync(root).some(name=>name.startsWith('ai-conversation.json.')&&name.endsWith('.tmp')));
  const corruptDir=path.join(root,'corrupt-case');fs.mkdirSync(corruptDir);
  const corruptFile=path.join(corruptDir,'ai-conversation.json');fs.writeFileSync(corruptFile,'corrupt content preserved');
  const broken=new AIAgent({...c,dir:corruptDir});assert(broken.conversation.blocked);assert.throws(()=>broken.begin({prompt:'blocked',ids:[id]}),/无法读取/);assert.equal(fs.readFileSync(corruptFile,'utf8'),'corrupt content preserved');broken.clear();assert.equal(new AIAgent({...c,dir:corruptDir}).memory.turns.length,0);
  // Failed compression must never mutate the original memory.
  const memory=new Memory();memory.add(['a'],[{role:'user',content:'x'.repeat(50000)}]);memory.add(['b'],[{role:'user',content:'other'}]);memory.add(['a'],[{role:'user',content:'2'}]);memory.add(['a'],[{role:'user',content:'3'}]);
  const memoryBefore=JSON.stringify(memory.export());await assert.rejects(memory.compress({run:{abort:new AbortController()},completion:async()=>{throw Error('offline');}},['a']),/offline/);assert.equal(JSON.stringify(memory.export()),memoryBefore);
  await memory.compress({run:{abort:new AbortController()},completion:async()=>({content:'summary'})},['a']);assert.equal(memory.context(['b'])[0].content,'other');assert.equal(memory.summaryFor(['b']),'');
  const duplicateIdHistory=interruptedHistory([{role:'user',content:'test'},{role:'assistant',tool_calls:[{id:'same'}]},{role:'tool',tool_call_id:'same',content:'prior result'},{role:'assistant',tool_calls:[{id:'same'}]}],'中断');
  assert.equal(duplicateIdHistory.filter(m=>m.role==='tool').length,2);assert(duplicateIdHistory[4].content.includes('结果未保存'));
 }else if(phase==='interrupt'){
  agent.begin({prompt:'HOLD_TOOL',ids:[id],permission:'confirm'});await wait(()=>agent.pending);
  assert.notEqual(c.store.get(id).name,'Must never be applied');assert(agent.run.history.some(m=>m.role==='tool'));
  // Terminate without closeAll, so the next fresh process must recover an in-flight task.
  app.exit(0);return;
 }else if(phase==='recover'){
  assert.equal(agent.run.busy,false);assert.equal(agent.pending,null);assert.match(agent.run.status,/中断/);
  assert.equal(agent.run.permission,'confirm');assert.equal(agent.run.allowGlobal,false);
  assert.notEqual(c.store.get(id).name,'Must never be applied');
  const turns=agent.memory.turns.length;assert.equal(new AIAgent(c).memory.turns.length,turns,'Recovery must not duplicate interrupted turn');
  await run('CHECK_INTERRUPTED');assert.notEqual(c.store.get(id).name,'Must never be applied');
 }else if(phase==='clear'){
  assert(agent.memory.turns.length>0);await ui("document.querySelector('#aiClear').click()");await wait(()=>agent.run===null);
  assert.equal(agent.memory.turns.length,0);assert.equal(agent.memory.summary,'');assert.deepEqual(agent.memory.summaryScope,[]);
  await wait(()=>ui("document.querySelector('#aiHistory').textContent.includes('准备好，开始任务')"));
 }else if(phase==='empty'){
  assert.equal(agent.run,null);assert.deepEqual(agent.memory.export(),new Memory().export());assert.equal(agent.conversation.error,'');
 }else throw Error('Unknown phase');
 console.log('Verified '+phase);
 }catch(e){console.error(e);process.exitCode=1;}finally{if(phase!=='interrupt'||process.exitCode){await c?.closeAll();win?.destroy();app.exit(process.exitCode||0);}}});
