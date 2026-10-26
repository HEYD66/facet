'use strict';
// Conversation memory = one encrypted DSH session per conversation (real Electron, DPAPI, IPC).
const {app,BrowserWindow,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [root,phase,origin]=process.argv.slice(2);
app.disableHardwareAcceleration();app.setPath('userData',root);
const {AIAgent}=require('../src/main/ai-agent.cjs');
const {history}=require('../src/main/ai-dsh.cjs');
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
 const stored=()=>history(agent.dshDir,agent.thread.sessionId);
 const logs=()=>fs.existsSync(agent.dshDir)?fs.readdirSync(agent.dshDir).filter(n=>n.endsWith('.log')):[];
 if(phase==='write'){
  // A small window makes DSH compaction-basic run across tasks of this one conversation.
  agent.save({baseURL:origin+'/v1',model:'memory-fixture',contextWindow:16384});
  for(let i=0;i<3;i++)await run('LONG_HISTORY '+i+'前置约束'.repeat(2500));
  const png=nativeImage.createFromBitmap(Buffer.from([255,0,0,255]),{width:1,height:1}).toDataURL();
  await run('图片保留标记',{images:[png]});
  assert(agent.thread.compactions>0,'DSH compacted the conversation');assert(agent.run.entries.some(e=>e.kind==='system'&&e.text.includes('整理为摘要')));
  assert.equal(agent.thread.turns,4);assert.deepEqual(logs(),[agent.thread.sessionId+'.log']);
  const messages=await stored();assert(messages.some(m=>m.role==='user'&&String(m.content).includes('持久摘要')),'summary is part of the stored session');
  for(const file of [agent.conversation.file,path.join(agent.dshDir,logs()[0])]){const bytes=fs.readFileSync(file,'utf8');for(const plain of ['图片保留标记','LONG_HISTORY','持久摘要',png.slice(22,60)])assert(!bytes.includes(plain),plain+' stored as plaintext in '+path.basename(file));}
  assert(!fs.existsSync(agent.conversation.file+'.bak'));
 }else if(phase==='restore'){
  agent.save({baseURL:origin+'/v1',model:'memory-fixture',contextWindow:0});
  assert(agent.thread.compactions>0);assert(!agent.run.busy);assert.equal(agent.pending,null);
  assert((await stored()).some(m=>String(m.content).includes('持久摘要')));
  await wait(()=>ui("document.querySelector('#aiHistory').textContent.includes('图片保留标记')"));
  assert(await ui("document.querySelector('#aiMemory').title.includes('重启后保留')"));assert(await ui("document.querySelector('#aiMemory').textContent.includes('已压缩')"));
  const image=await win.webContents.capturePage();assert(!image.isEmpty());fs.writeFileSync(path.join(root,'restored.png'),image.toPNG());
  await run('AFTER_RESTART');const other=c.store.create('Other isolated scope');
  // One conversation keeps one history; the authorization of each task still comes only from its own scope.
  await run('NARROWED_CONTEXT',{ids:[other.id]});
  await run('RESTORE_SCOPE');
  const file=agent.conversation.file,before=fs.readFileSync(file),prior=agent.run,originalRename=fs.renameSync,sessionLog=path.join(agent.dshDir,agent.thread.sessionId+'.log'),logBefore=fs.readFileSync(sessionLog);
  // A failed atomic replacement must preserve both saved bytes, the DSH session and the live task.
  fs.renameSync=(from,to)=>{if(to===file){const e=Error('Injected disk failure');e.code='EACCES';throw e;}return originalRename(from,to);};
  try{assert.throws(()=>agent.clear(),/保存失败/);assert.equal(agent.run,prior);assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(fs.readFileSync(sessionLog),logBefore);assert.throws(()=>agent.begin({prompt:'Must not send',ids:[id]}),/保存失败/);assert.equal(agent.run,prior);}finally{fs.renameSync=originalRename;}
  assert(agent.snapshot().memory.error);agent.persist();assert(!agent.snapshot().memory.error);
  assert(!fs.readdirSync(root).some(name=>name.startsWith('ai-conversation.json.')&&name.endsWith('.tmp')));
  const corruptDir=path.join(root,'corrupt-case');fs.mkdirSync(corruptDir);
  const corruptFile=path.join(corruptDir,'ai-conversation.json');fs.writeFileSync(corruptFile,'corrupt content preserved');
  const broken=new AIAgent({...c,dir:corruptDir});assert(broken.conversation.blocked);assert.throws(()=>broken.begin({prompt:'blocked',ids:[id]}),/无法读取/);assert.equal(fs.readFileSync(corruptFile,'utf8'),'corrupt content preserved');broken.clear();assert.equal(new AIAgent({...c,dir:corruptDir}).thread.turns,0);
  // A damaged session log refuses the task with a clear error and is left untouched for recovery.
  fs.mkdirSync(path.join(root,'damaged-case'));const damaged=new AIAgent({...c,dir:path.join(root,'damaged-case')});damaged.save({baseURL:origin+'/v1',model:'memory-fixture'});
  fs.mkdirSync(damaged.dshDir,{recursive:true});const damagedLog=path.join(damaged.dshDir,damaged.thread.sessionId+'.log');fs.writeFileSync(damagedLog,'not-a-record\n');
  damaged.begin({prompt:'DAMAGED',ids:[id],permission:'read'});await wait(()=>!damaged.run.busy);assert.equal(damaged.run.status,'失败');assert(damaged.run.entries.some(e=>e.text.includes('会话记录无法打开')));assert.equal(fs.readFileSync(damagedLog,'utf8'),'not-a-record\n');
 }else if(phase==='interrupt'){
  agent.begin({prompt:'HOLD_TOOL',ids:[id],permission:'confirm'});await wait(()=>agent.pending);
  assert.notEqual(c.store.get(id).name,'Must never be applied');assert(agent.run.entries.some(e=>e.kind==='tool'&&e.text.startsWith('list_instances')));
  // Past DSH's 200 ms write window, then terminate without closeAll: the next process must recover.
  await new Promise(r=>setTimeout(r,600));
  app.exit(0);return;
 }else if(phase==='recover'){
  assert.equal(agent.run.busy,false);assert.equal(agent.pending,null);assert.match(agent.run.status,/中断/);
  assert.equal(agent.run.permission,'confirm');assert.equal(agent.run.allowGlobal,false);
  assert.notEqual(c.store.get(id).name,'Must never be applied');
  assert.match(agent.thread.note,/中断/);const turns=agent.thread.turns;assert.equal(new AIAgent(c).thread.turns,turns,'Recovery must not duplicate the interrupted task');
  await run('CHECK_INTERRUPTED');assert.notEqual(c.store.get(id).name,'Must never be applied');assert.equal(agent.thread.note,'');
 }else if(phase==='clear'){
  assert(agent.thread.turns>0);const previous=agent.thread.sessionId;await ui("document.querySelector('#aiClear').click()");await wait(()=>agent.run===null);
  assert.equal(agent.thread.turns,0);assert.equal(agent.thread.compactions,0);assert.notEqual(agent.thread.sessionId,previous);
  await wait(()=>ui("document.querySelector('#aiHistory').textContent.includes('准备好，开始任务')"));
  // Clearing the original conversation deletes its DSH session log.
  agent.sessions.select(agent.sessions.rows.find(r=>r.dsh.id+''!==agent.thread.id).id);assert.equal(agent.thread.sessionId,previous);
  agent.clear();assert(!logs().includes(previous+'.log'));assert.equal(agent.thread.turns,0);
 }else if(phase==='empty'){
  assert.equal(agent.run,null);assert.equal(agent.thread.turns,0);assert.deepEqual(agent.thread.images,[]);assert.equal(agent.thread.note,'');assert.equal(agent.conversation.error,'');assert.deepEqual(await stored(),[]);
 }else throw Error('Unknown phase');
 console.log('Verified '+phase);
 }catch(e){console.error(e);process.exitCode=1;}finally{if(phase!=='interrupt'||process.exitCode){await c?.closeAll();win?.destroy();app.exit(process.exitCode||0);}}});
