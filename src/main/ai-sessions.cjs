'use strict';
const crypto=require('node:crypto'),fs=require('node:fs');
const {Memory}=require('./ai-memory.cjs');
const {interruptedHistory}=require('./ai-conversation.cjs');

function hydrate(row){
 const memory=new Memory();memory.restore(structuredClone(row.memory));
 const r=structuredClone(row.task);let run=null;
 if(r){
  if(!Array.isArray(r.entries)||!r.entries.every(e=>e&&['user','assistant','system','tool'].includes(e.kind)&&typeof e.text==='string')||!Array.isArray(r.scope)||!r.scope.every(id=>typeof id==='string')||typeof r.id!=='string'||typeof r.status!=='string'||typeof r.busy!=='boolean'||!Array.isArray(r.history))throw Error('Invalid task');
  if(r.busy)memory.add(r.scope,interruptedHistory(r.history,'应用关闭或中断',r.partial));
  run={...r,busy:false,status:r.busy?'已恢复（上次任务已中断）':r.status,permission:'confirm',allowGlobal:false,sharePage:false,images:[],history:[],partial:'',abort:new AbortController()};
  if(r.busy)run.entries.push({kind:'system',text:'已恢复历史记忆；上次任务已中断，不会自动继续操作。',at:new Date().toISOString()});
 }
 return {memory,run};
}
function task(run){return run?{id:run.id,busy:run.busy,status:run.status,scope:run.scope,entries:run.entries,history:run.history||[],partial:run.partial||''}:null;}
function blank(){const now=new Date().toISOString();return {id:crypto.randomUUID(),title:'新会话',createdAt:now,updatedAt:now,memory:new Memory().export(),task:null};}
class Sessions{
 constructor(agent){this.agent=agent;const row=blank();this.rows=[row];this.activeId=row.id;this.selectedId=row.id;}
 restore(saved){
  if(saved.sessionsVersion!==undefined){
   if(saved.sessionsVersion!==1||!Array.isArray(saved.sessions)||!saved.sessions.length||saved.sessions.length>200)throw Error('Invalid sessions');
   const ids=new Set();
   for(const row of saved.sessions){if(!row||typeof row.id!=='string'||!row.id||ids.has(row.id)||typeof row.title!=='string'||!row.title.trim()||row.title.length>80||typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt))||typeof row.updatedAt!=='string'||!Number.isFinite(Date.parse(row.updatedAt)))throw Error('Invalid session');ids.add(row.id);hydrate(row);}
   if(!ids.has(saved.selectedSessionId))throw Error('Invalid selected session');
   this.rows=saved.sessions;this.selectedId=saved.selectedSessionId;
  }else{
   // Keep the original encrypted single-conversation file for an explicit rollback.
   const backup=this.agent.conversation.file+'.pre-sessions.bak';
   if(fs.existsSync(this.agent.conversation.file)&&!fs.existsSync(backup))fs.copyFileSync(this.agent.conversation.file,backup,fs.constants.COPYFILE_EXCL);
   this.rows=[{...blank(),title:'原有会话',memory:saved.memory,task:saved.task}];this.selectedId=this.rows[0].id;
  }
  let recovered=false;
  this.rows=this.rows.map(row=>{const h=hydrate(row);if(!row.task?.busy)return row;recovered=true;return {...row,memory:h.memory.export(),task:task(h.run)};});
  this.activate(this.selectedId);
  if(recovered)this.agent.persistQuietly();
 }
 capture(){
  const a=this.agent;
  return this.rows.map(row=>row.id===this.activeId?{...row,memory:a.memory.export(),task:task(a.run)}:row);
 }
 payload(rows=this.capture(),selectedId=this.selectedId){return {sessionsVersion:1,selectedSessionId:selectedId,sessions:rows};}
 activate(id){const row=this.rows.find(x=>x.id===id);if(!row)throw Error('会话不存在');const h=hydrate(row);this.activeId=id;this.agent.memory=h.memory;this.agent.run=h.run;this.agent.pending=null;}
 prepare(){if(this.activeId!==this.selectedId){this.rows=this.capture();this.activate(this.selectedId);}}
 commit(rows,selectedId){
  this.agent.conversation.save(this.payload(rows,selectedId));
  this.rows=rows;this.selectedId=selectedId;
  if(!this.agent.run?.busy)this.activate(selectedId);
 }
 create(){if(this.rows.length>=200)throw Error('最多保留 200 个会话，请先删除不需要的会话');const row=blank();this.commit([...this.capture(),row],row.id);return row.id;}
 select(id){if(!this.rows.some(x=>x.id===id))throw Error('会话不存在');this.commit(this.capture(),id);}
 rename(id,title){title=String(title||'').trim();if(!title||title.length>80)throw Error('会话名称需为 1–80 个字符');if(!this.rows.some(x=>x.id===id))throw Error('会话不存在');this.commit(this.capture().map(row=>row.id===id?{...row,title,updatedAt:new Date().toISOString()}:row),this.selectedId);}
 remove(id,confirmed){
  if(confirmed!==true)throw Error('请确认删除会话及其记忆');
  if(id===this.activeId&&this.agent.run?.busy)throw Error('请先停止该会话的任务');
  if(!this.rows.some(x=>x.id===id))throw Error('会话不存在');
  const rows=this.capture().filter(x=>x.id!==id);if(!rows.length)rows.push(blank());
  this.commit(rows,this.selectedId===id?rows[0].id:this.selectedId);
 }
 touch(prompt){this.rows=this.rows.map(row=>row.id===this.activeId?{...row,title:row.title==='新会话'?String(prompt||'图片任务').replace(/\s+/g,' ').slice(0,48):row.title,updatedAt:new Date().toISOString()}:row);}
 view(){
  const rows=this.capture(),selected=rows.find(x=>x.id===this.selectedId),memory=new Memory();memory.restore(selected.memory);
  const running=this.agent.run?.busy?this.activeId:null;
  return {selected,run:this.selectedId===this.activeId?this.agent.run:selected.task,memory,info:{selectedId:this.selectedId,runningId:running,items:rows.map(({id,title,createdAt,updatedAt,task})=>({id,title,createdAt,updatedAt,busy:id===running,status:task?.status||'待命'})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))}};
 }
}
module.exports={Sessions};
