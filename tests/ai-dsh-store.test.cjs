'use strict';
// Facet's encrypted DSH session-persistence backend driven by the official DSH loop:
// create, resume across contexts, injected context, cancellation, torn tails, corruption.
// A reversible test codec stands in for Electron safeStorage (covered by the Electron suites).
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const store=require('../src/main/ai-dsh-store.cjs');
const PACKAGES=['cordis','dsh-llm','dsh-session','dsh-session-projection','dsh-system-prompt','dsh-tools','dsh-agent','dsh-agent-loop','dsh-session-persistence'];
const codec={encode:t=>Buffer.from(t,'utf8').reverse().toString('base64'),decode:l=>Buffer.from(l,'base64').reverse().toString('utf8')};
const text=b=>(b||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');

async function harness(){
 const [{Context},llm,session,projection,prompt,tools,registry,loop,persistence]=await Promise.all(PACKAGES.map(n=>import('@deepseek-ai/'+n)));
 const backend=store.define(persistence),dir=fs.mkdtempSync(path.join(os.tmpdir(),'facet-dsh-store-')),requests=[];
 class Fake extends llm.LlmAdapter{
  async resolveModel(provider,id){return {provider,id,name:id,context:{contextWindow:100000}};}
  async *stream(options){
   requests.push(options.messages.map(m=>m.role+':'+text(m.content)));
   const last=text(options.messages.at(-1).content);
   if(last==='HANG')await new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason||Error('aborted')),{once:true}));
   if(last==='TOOL'){const block={type:'tool-call',id:llm.ToolCallId('t1'),name:'echo',arguments:'{}'};yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id:block.id,name:block.name,argumentsDelta:'{}'};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:'tool-calls'}};return;}
   const reply='re:'+last;
   yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:reply};yield {type:'block-end',index:0,block:{type:'text',text:reply}};yield {type:'finish',reason:{kind:'stop'}};
  }
 }
 const id=session.SessionId('facet-test');
 const msg=t=>llm.createUserMessage({content:[{type:'text',text:t}],source:{kind:'user'}});
 const derive=a=>a.session.deriveMessages().filter(m=>m.role!=='system').map(m=>m.role+':'+text(m.content));
 // One Facet task: a fresh context resumes (or creates) the stored session, runs, flushes, disposes.
 async function task(fn){
  const ctx=new Context();
  await ctx.plugin(backend,{dir,codec});
  for(const p of [llm.default,session.default,projection.default,prompt.default,tools.default,registry.default])await ctx.plugin(p);
  await ctx.plugin(loop.default,{agents:[],maxParallelToolCalls:1});
  ctx.llm.registerAdapter(['facet'],new Fake());
  ctx.systemPrompt.section({name:'facet',order:0,text:'SYS',interpolate:false,complete:true});
  ctx.tools.register({name:'echo',description:'echo',parameters:{type:'object',properties:{}},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},async execute(){return 'echoed';}});
  let handle;
  try{
   const stored=await ctx.sessionPersistence.stat(id),agentOptions={provider:'facet',model:'m'};
   handle=stored?await ctx.agents.resume({resumeSessionId:id,agentOptions}):await ctx.agents.create({sessionId:id,agentOptions});
   const out=await fn(handle.agent,!!stored);
   await handle.agent.whenIdle();await ctx.sessions.flush(handle.agent.session);
   return out;
  }finally{await handle?.dispose();await ctx.fiber.dispose();}
 }
 return {dir,requests,task,msg,derive,file:store.fileOf(dir,id),cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}

test('one conversation is one DSH session: tasks resume it, injected context precedes the prompt, logs are ciphertext',async()=>{
 const h=await harness();
 try{
  assert.equal(await h.task(async(a,stored)=>{assert.equal(stored,false);a.followup(h.msg('FIRST_SECRET'));await a.whenIdle();return a.session.deriveMessages().length;}),3);
  const second=await h.task(async(a,stored)=>{assert.equal(stored,true);a.inject(h.msg('NOTE'));a.followup(h.msg('SECOND'));await a.whenIdle();return h.derive(a);});
  assert.deepEqual(second,['user:FIRST_SECRET','assistant:re:FIRST_SECRET','user:NOTE','user:SECOND','assistant:re:SECOND']);
  assert.deepEqual(h.requests.at(-1).slice(1),['user:FIRST_SECRET','assistant:re:FIRST_SECRET','user:NOTE','user:SECOND']);
  const third=await h.task(async a=>{a.followup(h.msg('TOOL'));await a.whenIdle();return h.derive(a).slice(-4);});
  assert.deepEqual(third,['user:TOOL','assistant:','tool:echoed','assistant:re:echoed']);
  const raw=fs.readFileSync(h.file,'utf8');assert(!raw.includes('FIRST_SECRET')&&!raw.includes('user/message'));assert(raw.endsWith('\n'));
 }finally{h.cleanup();}
});

test('a cancelled turn is closed by DSH and the next task continues the same history',async()=>{
 const h=await harness();
 try{
  await h.task(async a=>{a.followup(h.msg('HANG'));await new Promise(r=>setTimeout(r,200));a.cancel({kind:'user'});await a.whenIdle();});
  const next=await h.task(async a=>{a.followup(h.msg('AFTER'));await a.whenIdle();return h.derive(a);});
  assert.deepEqual(next,['user:HANG','user:AFTER','assistant:re:AFTER']);
 }finally{h.cleanup();}
});

test('a torn final write is dropped and repaired; a damaged complete record refuses the session',async()=>{
 const h=await harness();
 try{
  await h.task(async a=>{a.followup(h.msg('KEEP'));await a.whenIdle();});
  fs.appendFileSync(h.file,'dG9ybi10YWls');
  const after=await h.task(async a=>{a.followup(h.msg('NEXT'));await a.whenIdle();return h.derive(a);});
  assert.deepEqual(after,['user:KEEP','assistant:re:KEEP','user:NEXT','assistant:re:NEXT']);
  const raw=fs.readFileSync(h.file,'utf8');assert(!raw.includes('dG9ybi10YWls'));assert(raw.endsWith('\n'));
  fs.appendFileSync(h.file,'@@not-a-record@@\n');const before=fs.readFileSync(h.file);
  await assert.rejects(h.task(async()=>{}),e=>e.name==='SessionPersistenceCorruptionError');
  assert.deepEqual(fs.readFileSync(h.file),before,'a refused log is left untouched');
  store.removeLog(h.dir,'facet-test');assert(!fs.existsSync(h.file));
  assert.throws(()=>store.fileOf(h.dir,'../escape'),/invalid DSH session id/);
 }finally{h.cleanup();}
});
