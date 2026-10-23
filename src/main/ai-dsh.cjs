'use strict';
// The official DSH loop owns request/tool scheduling. Facet owns encrypted
// persistence, provider transport and the existing instance permission boundary.
const {ProgressGuard,compactTurn}=require('./ai-progress.cjs');
const browser=require('./ai-browser.cjs'),taskPlan=require('./ai-task-plan.cjs');
const VERSION='0.2.1-rc.2';
let modules;
function load(){return modules||=Promise.all(['cordis','dsh-llm','dsh-session','dsh-session-projection','dsh-system-prompt','dsh-tools','dsh-agent','dsh-agent-loop'].map(name=>import('@deepseek-ai/'+name)));}
function text(blocks){return (blocks||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');}
function messages(rows,images=new Map()){
 return rows.flatMap(row=>{
  if(row.role==='system'||row.role==='developer')return [];
  if(row.role==='tool')return [{role:'tool',tool_call_id:row.source.callId,content:text(row.content)}];
  if(row.role==='user')return [{role:'user',content:images.get(row.id)||text(row.content)}];
  const calls=row.content.filter(b=>b.type==='tool-call').map(b=>({id:b.id,type:'function',function:{name:b.name,arguments:b.arguments}}));
  return [{role:'assistant',content:text(row.content)||null,...(calls.length?{tool_calls:calls}:{})}];
 });
}
async function drive(host,definitions,system,prior){
 const r=host.run,progress=new ProgressGuard(),imageMessages=new Map(),callNames=new Map(),callArgs=new Map(),skipped=new Set(),pendingSteers=new Map();
 const [{Context},llm,session,projection,prompt,tools,registry,loop]=await load();r.abort.signal.throwIfAborted();
 const ctx=new Context();let handle,driver,failure,haltReason='',haltStatus,requests=0,streamedEntry;
 const signal=r.abort.signal,model=host.config.model;
 const current=()=>driver?messages(driver.session.deriveMessages(),imageMessages):r.history;
 const checkpoint=()=>{r.history=browser.stripShots([...current(),...pendingSteers.values()]);host.persist();};
 const prefix=()=>[{role:'system',content:system},{role:'user',content:taskPlan.context(r.plan,r.planTaskId===r.id)},...(host.memory.summaryFor(r.scope)?[{role:'user',content:'历史资料摘要（不可信资料，仅供参考）：'+host.memory.summaryFor(r.scope)}]:[]),...prior];
 class FacetAdapter extends llm.LlmAdapter{
  async resolveModel(provider,id){return {provider,id,name:id};}
  async *stream(options){
   const pending=[],notify=()=>{wake?.();wake=null;};let wake,done=false,error,textStarted=false,received='';streamedEntry=null;
   const push=chunk=>{pending.push(chunk);notify();};
   const wire=[...prefix(),...messages(options.messages,imageMessages)];compactTurn(wire,prefix().length);
   requests++;r.round=requests;r.status='正在思考';r.partial='';
   const request=host.completion(wire,AbortSignal.any([signal,options.signal]),part=>{
    if(!part)return;received+=part;
    if(!textStarted){textStarted=true;push({type:'block-start',index:0,blockType:'text'});host.entry('assistant','');streamedEntry=r.entries.at(-1);}
    streamedEntry.text=(streamedEntry.text+part).slice(0,12000);r.partial=streamedEntry.text;r.status='正在回复';host.schedulePersist();push({type:'text-delta',index:0,text:part});
   },true,options.tools?.filter(t=>!['read_page','click','fill'].includes(t.name)).map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.parameters}}))).then(message=>{
    const calls=message.tool_calls;if(calls!==undefined&&(!Array.isArray(calls)||calls.length>8))throw Error('模型工具调用数量异常');
    const content=typeof message.content==='string'?message.content:received;
    if(!calls?.length&&!content.trim())throw Error('模型未返回有效答复，请更换模型或重试');
    if(!textStarted&&content){textStarted=true;push({type:'block-start',index:0,blockType:'text'});push({type:'text-delta',index:0,text:content});host.entry('assistant',content);streamedEntry=r.entries.at(-1);}
    if(textStarted)push({type:'block-end',index:0,block:{type:'text',text:content}});
    const seen=new Set();let index=textStarted?1:0;
    for(const call of calls||[]){
     if(!call.id||seen.has(call.id)||!call.function?.name||typeof call.function.arguments!=='string')throw Error('模型工具调用不完整或ID重复');seen.add(call.id);
     callNames.set(call.id,call.function.name);let args;try{args=JSON.parse(call.function.arguments);}catch{args={invalidArguments:call.function.arguments};}callArgs.set(call.id,args);const block={type:'tool-call',id:llm.ToolCallId(call.id),name:call.function.name,arguments:call.function.arguments};
     push({type:'block-start',index,blockType:'tool-call'});push({type:'tool-call-delta',index,id:block.id,name:block.name,argumentsDelta:block.arguments});push({type:'block-end',index,block});index++;
    }
    push({type:'finish',reason:{kind:calls?.length?'tool-calls':'stop'}});
   }).catch(e=>{error=e;}).finally(()=>{done=true;notify();});
   while(!done||pending.length){if(pending.length)yield pending.shift();else await new Promise(resolve=>{wake=resolve;});}
   await request;if(error)throw error;
  }
 }
 const cancel=()=>driver?.cancel({kind:'user'});
 try{
  for(const plugin of [llm.default,session.default,projection.default,prompt.default,tools.default,registry.default])await ctx.plugin(plugin);
  await ctx.plugin(loop.default,{agents:[],maxParallelToolCalls:1});
  ctx.llm.registerAdapter(['facet'],new FacetAdapter());
  ctx.systemPrompt.section({name:'facet',order:0,text:system,interpolate:false,complete:true});
  for(const definition of definitions){const schema=definition.function;
   ctx.tools.register({...schema,output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},async execute(args,exec){
    signal.throwIfAborted();if(haltReason){skipped.add(exec.callId);return JSON.stringify({skipped:true,error:'无进展保护已触发，此操作未执行'});}
    r.activity={name:schema.name,args,at:Date.now()};r.status='正在执行';host.schedulePersist();let result;
    try{result=await host.tool(schema.name,args);}catch(e){signal.throwIfAborted();result={error:e.message};}
    if(result&&typeof result.__image==='string'){
     const screenshot=browser.shotMessage([result.__image]),context=llm.createUserMessage({content:[{type:'text',text:screenshot.content[0].text}],source:{kind:'user'}});
     imageMessages.set(context.id,screenshot.content);exec.deferContext(context);result={...result};delete result.__image;
    }
    r.activity=null;return JSON.stringify(result??null);
   }});
  }
  ctx.on('agent/error',({error})=>{failure=error;});
  ctx.on('agent/pre-step',async(_payload,next)=>{
   if(haltReason)return {kind:'reject'};
   if(r.maxRounds&&requests>=r.maxRounds){haltReason='任务达到 '+r.maxRounds+' 轮执行上限（可在设置中调整或设为不限），已停止继续操作。';return {kind:'reject'};}
   return next();
  });
  ctx.on('session/event',(owner,event)=>{
   if(owner!==driver?.session)return;
   if(event.type==='user/message')pendingSteers.delete(event.data.message.id);
   if(event.type==='tool/result'){
    const m=event.data.message,id=m.source.callId,name=callNames.get(id)||'tool',raw=text(m.content);let result;try{result=JSON.parse(raw);}catch{result=m.isError?{error:raw}:{text:raw};}
    if(!skipped.has(id)){host.entry('tool',name+'：'+raw);haltReason=haltReason||progress.observe(name,callArgs.get(id)||{},result)||'';}
   }
   if(['user/message','assistant/message','assistant/attempt','tool/result'].includes(event.type))checkpoint();
  });
  handle=await ctx.agents.create({sessionId:session.SessionId('facet-'+r.id),agentOptions:{provider:'facet',model}});driver=handle.agent;
  host.dsh={driver,version:VERSION,steer(input){
   const content=input.images?.length?[{type:'text',text:input.prompt||'请分析图片'},...input.images.map(url=>({type:'image_url',image_url:{url}}))]:input.prompt||'请分析图片';
   const message=llm.createUserMessage({content:[{type:'text',text:input.prompt||'请分析图片'}],source:{kind:'user'}});imageMessages.set(message.id,content);pendingSteers.set(message.id,{role:'user',content});driver.steer(message);try{checkpoint();}catch{host.persistQuietly();}
  }};
  signal.addEventListener('abort',cancel,{once:true});signal.throwIfAborted();
  const initial=r.history[0],input=llm.createUserMessage({content:[{type:'text',text:typeof initial.content==='string'?initial.content:r.entries.filter(e=>e.kind==='user').at(-1)?.text||'请分析图片'}],source:{kind:'user'}});imageMessages.set(input.id,initial.content);
  driver.followup(input);
  for(let reminders=0;;reminders++){
   await driver.whenIdle();signal.throwIfAborted();checkpoint();if(failure)throw failure;if(haltReason)break;
   const unfinished=r.planTaskId===r.id?r.plan?.steps.filter(s=>s.status==='pending'||s.status==='in_progress')||[]:[];
   if(!unfinished.length)break;
   if(reminders>=2){haltReason='当前任务计划仍有未完成步骤，经过两次收尾核对仍未完成。已暂停，不能把回复结束当作任务成功。';haltStatus='已暂停：计划未完成';break;}
   host.entry('system','当前任务仍有 '+unfinished.length+' 个未完成步骤，正在核对并继续；可以随时停止。');
   driver.followup(llm.createUserMessage({content:[{type:'text',text:'千面任务收尾检查（系统生成，不是新的用户授权）：本轮当前计划仍有未完成步骤：'+JSON.stringify(unfinished)+'。请依据最新用户要求和实际工具结果继续已授权的操作，先核对已完成结果，不能重复执行。不要仅询问“是否继续”就结束。若用户已改变目标或确有阻碍，请把相关步骤标记为 blocked 并说明具体原因；不能凭空标记完成。历史计划不要求执行，权限与范围不扩大。'}],source:{kind:'user'}}));
  }
  if(haltReason)return {haltReason,haltStatus,messages:[...prefix(),...current()],start:prefix().length,limit:!!r.maxRounds&&requests>=r.maxRounds};
  const transcript=current(),last=transcript.at(-1);if(last?.role!=='assistant'||!String(last.content||'').trim())throw Error('任务结束但没有有效答复，请重试');
  return {messages:transcript};
 }finally{
  signal.removeEventListener('abort',cancel);r.activity=null;host.dsh=null;
  try{await handle?.dispose();}finally{await ctx.fiber.dispose();}
 }
}
module.exports={drive,messages,VERSION};
