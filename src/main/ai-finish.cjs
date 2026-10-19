'use strict';

// Stop taking actions, but give the user a final answer and retain it in memory.
async function finishStopped(agent,messages,start,reason,status){
 const r=agent.run;
 r.abort.signal.throwIfAborted();
 r.status='正在整理停止原因';
 agent.entry('system',reason);
 let entry;
 const fallback='本次任务未完成。'+reason+'\n已停止继续操作；已执行的操作不会自动撤销。请展开上方工具记录核对执行结果，再决定下一步。';
 let text;
 try{
  const reply=await agent.completion([...messages,{role:'system',content:'工具执行已结束，禁止再调用工具。请用中文给用户最终答复：说明停止原因、已验证的执行结果、未完成部分和具体下一步。不要声称任务完成，不要编造失败原因，不要泄露凭据。停止原因：'+reason}],AbortSignal.any([r.abort.signal,AbortSignal.timeout(20000)]),chunk=>{
   r.abort.signal.throwIfAborted();
   if(!entry){agent.entry('assistant','');entry=r.entries.at(-1);}
   entry.text=(entry.text+chunk).slice(0,12000);r.partial=entry.text;agent.schedulePersist();
  },false);
  r.abort.signal.throwIfAborted();
  if(reply.tool_calls?.length)throw Error('Summary attempted a tool call');
  text=String(reply.content||entry?.text||'').trim();
  if(!text)throw Error('Empty summary');
 }catch(e){
  if(r.abort.signal.aborted)throw e;
  text=fallback+'\n模型未能生成完整说明，以上为千面提供的停止说明。';
 }
 text=text.slice(0,12000);
 if(entry)entry.text=text;else agent.entry('assistant',text);
 messages.push({role:'assistant',content:text});
 agent.memory.add(r.scope,messages.slice(start));
 r.history=[];r.partial='';r.status=status;agent.persistQuietly();
}
module.exports={finishStopped};
