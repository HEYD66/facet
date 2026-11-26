'use strict';
const crypto=require('node:crypto'),fs=require('node:fs');
const {Thread}=require('./ai-memory.cjs');
const {restore:restorePlan}=require('./ai-task-plan.cjs');
const {removeLog}=require('./ai-dsh-store.cjs');
// Told to the model at the start of the next task; DSH closes the interrupted turn itself.
const INTERRUPTED='上一轮任务因应用关闭或中断而未完成（系统说明，不是新的用户授权）。先核对已执行动作与当前状态，不要自动重复执行。';
const PERMISSIONS=new Set(['read','confirm','full']);
function normalizePermission(value){return PERMISSIONS.has(value)?value:'full';}
function normalizeScope(value){if(!Array.isArray(value))return null;const ids=[...new Set(value.filter(x=>typeof x==='string'&&x.trim()))];return ids.length?ids:null;}

function hydrate(row){
 const thread=new Thread(structuredClone(row.dsh));
 const permission=normalizePermission(row.permission||row.task?.permission);
 const scope=normalizeScope(row.scope);
 const r=structuredClone(row.task);let run=null;
 if(r){
  if(!Array.isArray(r.entries)||!r.entries.every(e=>e&&['user','assistant','system','tool'].includes(e.kind)&&typeof e.text==='string')||!Array.isArray(r.scope)||!r.scope.every(id=>typeof id==='string')||typeof r.id!=='string'||typeof r.status!=='string'||typeof r.busy!=='boolean')throw Error('Invalid task');
  if(r.busy)thread.setNote(INTERRUPTED);
  run={...r,queue:require('./ai-inbox.cjs').restore(r.queue),plan:restorePlan(r.plan),context:context(r.context),planTaskId:null,busy:false,status:r.busy?'已恢复（上次任务已中断）':r.status,permission,allowGlobal:permission==='full',sharePage:true,input:null,partial:'',abort:new AbortController()};
  delete run.history;
  if(r.busy)run.entries.push({kind:'system',text:'已恢复历史记忆；上次任务已中断，不会自动继续操作。',at:new Date().toISOString()});
 }
 return {id:row.id,thread,run,permission,scope,pending:null,question:null,dsh:null,workPromise:null,aiNetworkPages:new Set()};
}
// The last context measurement is kept so a reopened session still shows its usage.
function context(value){return value&&Number.isSafeInteger(value.used)&&value.used>=0&&Number.isSafeInteger(value.window)&&value.window>0?{used:value.used,window:value.window,estimated:value.estimated===true}:null;}
function task(run){return run?{id:run.id,busy:run.busy,status:run.status,scope:run.scope,permission:normalizePermission(run.permission),planTaskId:run.planTaskId||null,queue:run.queue||[],entries:run.entries,plan:run.plan||null,context:context(run.context)}:null;}
function blank(thread=new Thread(),{scope=null,permission='full'}={}){const now=new Date().toISOString();return {id:crypto.randomUUID(),title:'新会话',createdAt:now,updatedAt:now,scope:normalizeScope(scope),permission:normalizePermission(permission),dsh:thread.export(),task:null};}
// Version 1 rows carried their own memory; version 2 rows point at a DSH session.
function upgrade(row){const {memory,...rest}=row;return {...rest,dsh:Thread.fromMemory(memory).export()};}
class Sessions{
 constructor(agent){this.agent=agent;const row=blank();this.rows=[row];this.activeId=row.id;this.selectedId=row.id;this.ensureRuntime(row.id);}
 ensureRuntime(id){
  let rt=this.agent.runtimes.get(id);
  if(rt)return rt;
  const row=this.rows.find(x=>x.id===id);if(!row)throw Error('会话不存在');
  rt=hydrate(row);this.agent.runtimes.set(id,rt);return rt;
 }
 restore(saved){
  let upgraded=false;
  if(saved.sessionsVersion!==undefined){
   if(![1,2].includes(saved.sessionsVersion)||!Array.isArray(saved.sessions)||!saved.sessions.length||saved.sessions.length>200)throw Error('Invalid sessions');
   const ids=new Set();let rows=saved.sessions;
   if(saved.sessionsVersion===1){rows=rows.map(upgrade);upgraded=true;}
   for(const row of rows){if(!row||typeof row.id!=='string'||!row.id||ids.has(row.id)||typeof row.title!=='string'||!row.title.trim()||row.title.length>80||typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt))||typeof row.updatedAt!=='string'||!Number.isFinite(Date.parse(row.updatedAt)))throw Error('Invalid session');ids.add(row.id);hydrate(row);}
   if(!ids.has(saved.selectedSessionId))throw Error('Invalid selected session');
   this.rows=rows;this.selectedId=saved.selectedSessionId;
  }else{
   // Keep the original encrypted single-conversation file for an explicit rollback.
   const backup=this.agent.conversation.file+'.pre-sessions.bak';
   if(fs.existsSync(this.agent.conversation.file)&&!fs.existsSync(backup))fs.copyFileSync(this.agent.conversation.file,backup,fs.constants.COPYFILE_EXCL);
   this.rows=[upgrade({...blank(),title:'原有会话',memory:saved.memory,task:saved.task})];this.selectedId=this.rows[0].id;upgraded=true;
  }
  // Old memories move into DSH sessions on their next task; the pre-DSH file stays as a backup.
  if(upgraded){const backup=this.agent.conversation.file+'.pre-dsh.bak';if(fs.existsSync(this.agent.conversation.file)&&!fs.existsSync(backup))fs.copyFileSync(this.agent.conversation.file,backup,fs.constants.COPYFILE_EXCL);}
  let changed=upgraded;
  this.agent.runtimes.clear();
  this.rows=this.rows.map(row=>{if(!row.task?.busy)return row;changed=true;const h=hydrate(row);return {...row,permission:h.permission,scope:h.scope,dsh:h.thread.export(),task:task(h.run)};});
  this.activate(this.selectedId);
  if(changed)this.agent.persistQuietly();
 }
 capture(){
  return this.rows.map(row=>{
   const rt=this.agent.runtimes.get(row.id);
   if(!rt)return row;
   return {...row,permission:normalizePermission(rt.permission||rt.run?.permission),scope:rt.scope!==undefined?normalizeScope(rt.scope):normalizeScope(row.scope),dsh:rt.thread.export(),task:task(rt.run)};
  });
 }
 payload(rows=this.capture(),selectedId=this.selectedId){return {sessionsVersion:2,selectedSessionId:selectedId,sessions:rows};}
 activate(id){const rt=this.ensureRuntime(id);this.activeId=id;return rt;}
 prepare(id=this.selectedId){this.activeId=id;return this.ensureRuntime(id);}
 commit(rows,selectedId){
  this.agent.conversation.save(this.payload(rows,selectedId));
  this.rows=rows;this.selectedId=selectedId;
  this.activate(selectedId);
 }
 create(options={}){
  if(this.rows.length>=200)throw Error('最多保留 200 个会话，请先删除不需要的会话');
  const row=blank(new Thread(),options);
  this.commit([...this.capture(),row],row.id);
  return row.id;
 }
 select(id){if(!this.rows.some(x=>x.id===id))throw Error('会话不存在');this.commit(this.capture(),id);}
 rename(id,title){title=String(title||'').trim();if(!title||title.length>80)throw Error('会话名称需为 1–80 个字符');if(!this.rows.some(x=>x.id===id))throw Error('会话不存在');this.commit(this.capture().map(row=>row.id===id?{...row,title,updatedAt:new Date().toISOString()}:row),this.selectedId);}
 remove(id,confirmed){
  if(confirmed!==true)throw Error('请确认删除会话及其记忆');
  const rt=this.agent.runtimes.get(id);
  if(rt?.run?.busy)throw Error('请先停止该会话的任务');
  const captured=this.capture(),removed=captured.find(x=>x.id===id);if(!removed)throw Error('会话不存在');
  const rows=captured.filter(x=>x.id!==id);if(!rows.length)rows.push(blank());
  this.agent.runtimes.delete(id);
  this.commit(rows,this.selectedId===id?rows[0].id:this.selectedId);
  removeLog(this.agent.dshDir,new Thread(removed.dsh).sessionId);
 }
 touch(prompt,id=this.activeId){this.rows=this.rows.map(row=>row.id===id?{...row,title:row.title==='新会话'?String(prompt||'图片任务').replace(/\s+/g,' ').slice(0,48):row.title,updatedAt:new Date().toISOString()}:row);}
 runningIds(){const out=[];for(const [id,rt] of this.agent.runtimes)if(rt.run?.busy)out.push(id);return out;}
 view(){
  const rows=this.capture(),selected=rows.find(x=>x.id===this.selectedId),rt=this.ensureRuntime(this.selectedId);
  const running=this.runningIds(),runningSet=new Set(running);
  return {selected,rt,run:rt.run,thread:rt.thread,info:{selectedId:this.selectedId,runningId:running[0]||null,runningIds:running,items:rows.map(({id,title,createdAt,updatedAt,task:t,scope,permission})=>({id,title,createdAt,updatedAt,busy:runningSet.has(id),status:this.agent.runtimes.get(id)?.run?.status||t?.status||'待命',scope:normalizeScope(scope)||normalizeScope(t?.scope),permission:normalizePermission(permission||t?.permission)})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))}};
 }
}
module.exports={Sessions,INTERRUPTED,normalizePermission,normalizeScope};
