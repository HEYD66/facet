'use strict';
const crypto=require('node:crypto');
const {images}=require('./ai-memory.cjs');
const LIMIT=8,IMAGE_LIMIT=24*1024*1024;
function input(value){
 const prompt=String(value.prompt||'').trim(),attachments=images(value.images||[]);
 if((!prompt&&!attachments.length)||prompt.length>12000)throw Error('请输入任务（最多 12000 字）');
 return {prompt,images:attachments};
}
function restore(rows=[]){
 if(!Array.isArray(rows)||rows.length>LIMIT)throw Error('Invalid pending messages');
 const ids=new Set();let bytes=0;
 return rows.map(row=>{
  if(!row||typeof row.id!=='string'||ids.has(row.id)||typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt)))throw Error('Invalid pending message');ids.add(row.id);
  const value=input(row);bytes+=value.images.reduce((n,x)=>n+x.length,0);if(bytes>IMAGE_LIMIT)throw Error('Pending images too large');
  return {id:row.id,createdAt:row.createdAt,...value};
 });
}
function targetHost(agent,sessionId){
 const sid=sessionId||agent.sessions.selectedId;
 return agent.sessionHost(sid);
}
function selected(agent,sessionId){
 const host=targetHost(agent,sessionId);
 if(!host.run)throw Error('当前会话没有任务');return host;
}
function submit(agent,value){
 const host=selected(agent,value.sessionId),r=host.run;
 if(value.taskId&&value.taskId!==r.id)throw Error('任务已变化，请重新发送');
 // A task can finish between a renderer poll and the send click. Treat that
 // explicit click as a new turn, using the controls submitted with the message.
 if(!r.busy)return {mode:'run',...agent.begin({...value,sessionId:host.sessionId})};
 if(r.abort.signal.aborted)throw Error('任务正在停止，请稍后发送');
 const message=input(value);
 if(value.mode==='steer'){
  if(!host.dsh)throw Error('正在准备任务，请稍后补充或加入待办');
  host.dsh.steer(message);host.entry('user',message.prompt+(message.images.length?'\n[附图 '+message.images.length+' 张]':''));host.entry('system','补充已接收，将在下一步生效；当前已执行动作不会撤销。');host.persistQuietly();return {mode:'steer'};
 }
 if(value.mode!=='queue')throw Error('发送方式无效');
 const before=r.queue||[];if(before.length>=LIMIT)throw Error('最多保留 8 条待办，请先移除或完成部分消息');
 if([...before.flatMap(x=>x.images),...message.images].reduce((n,x)=>n+x.length,0)>IMAGE_LIMIT)throw Error('待办图片总大小超出限制，请先移除部分图片');
 const next=restore([...before,{id:crypto.randomUUID(),createdAt:new Date().toISOString(),...message}]);
 r.queue=next;try{agent.persist();}catch(e){r.queue=before;throw e;}return {mode:'queue',id:next.at(-1).id};
}
function remove(agent,id,sessionId){
 const host=selected(agent,sessionId),r=host.run,before=r.queue||[];if(!before.some(x=>x.id===id))throw Error('待办消息不存在');
 r.queue=before.filter(x=>x.id!==id);try{agent.persist();}catch(e){r.queue=before;throw e;}
}
function next(agent,authorization,automatic=false,sessionId){
 const host=automatic&&agent.sessionId?agent:selected(agent,sessionId);
 const r=host.run;if(!r||r.busy||!r.queue?.length)throw Error('没有可继续的待办');
 const [first,...remaining]=r.queue;r.queue=remaining;
 try{return agent.begin({...first,...authorization,sessionId:host.sessionId},{fromQueue:automatic});}catch(e){r.queue=[first,...remaining];agent.persistQuietly();throw e;}
}
module.exports={input,restore,submit,remove,next};
