'use strict';
// Per-conversation AI state kept in the encrypted conversation file. The conversation
// history itself lives in one long-lived DSH session (ai-dsh-store.cjs); DSH resume,
// tool-result pruning and compaction own it. This file keeps only what DSH does not:
// the DSH session identity, counters for the panel, user-attached images of recent
// messages (DSH stores their text), a one-shot note for the next task, and an old-format
// memory awaiting one-time migration.
const crypto=require('node:crypto');
const {nativeImage}=require('electron');
function images(input=[]){
 if(!Array.isArray(input)||input.length>4)throw Error('每条消息最多 4 张图片');
 let bytes=0;return input.map(value=>{
  if(typeof value!=='string'||value.length>8*1024*1024||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value))throw Error('图片格式无效，仅支持 PNG/JPEG/WebP');
  bytes+=Buffer.byteLength(value);if(bytes>12*1024*1024)throw Error('图片总大小超过限制');
  const image=nativeImage.createFromDataURL(value);if(image.isEmpty())throw Error('无法解码图片');
  const size=image.getSize();if(size.width*size.height>24000000)throw Error('图片尺寸过大');
  return value;
 });
}
// User images are resent with their DSH message while it stays in context; only the most
// recent ones are kept so the conversation file stays bounded.
const IMAGE_MESSAGES=4,IMAGE_BYTES=24*1024*1024;
function legacy(data){
 if(!data||!Array.isArray(data.turns)||typeof data.summary!=='string')throw Error('Invalid memory');
 for(const turn of data.turns)if(!turn||!Array.isArray(turn.messages)||!turn.messages.every(m=>m&&['user','assistant','tool'].includes(m.role)))throw Error('Invalid turn');
 return data.turns.length||data.summary.trim()?{turns:data.turns,summary:data.summary}:null;
}
const NOTE_LIMIT=4000;
class Thread{
 constructor(data){
  if(data===undefined){this.id=crypto.randomUUID();this.turns=0;this.compactions=0;this.images=[];this.note='';this.legacy=null;return;}
  if(!data||typeof data.id!=='string'||!/^[A-Za-z0-9-]{1,64}$/.test(data.id)||!Number.isSafeInteger(data.turns)||data.turns<0||!Number.isSafeInteger(data.compactions)||data.compactions<0||!Array.isArray(data.images)||typeof data.note!=='string')throw Error('Invalid conversation state');
  for(const item of data.images)if(!item||typeof item.id!=='string'||!Array.isArray(item.content))throw Error('Invalid conversation image');
  Object.assign(this,{id:data.id,turns:data.turns,compactions:data.compactions,images:data.images,note:data.note.slice(0,NOTE_LIMIT),legacy:data.legacy?legacy(data.legacy):null});
 }
 // Old sessions (before DSH persistence) carried their own turns/summary memory.
 static fromMemory(memory){const t=new Thread();t.turns=Array.isArray(memory?.turns)?memory.turns.length:0;t.compactions=Number.isSafeInteger(memory?.compressions)?memory.compressions:0;t.legacy=memory?legacy(memory):null;return t;}
 get sessionId(){return 'facet-'+this.id;}
 export(){return {id:this.id,turns:this.turns,compactions:this.compactions,images:this.images,note:this.note,...(this.legacy?{legacy:this.legacy}:{})};}
 remember(id,content){
  this.images=[...this.images.filter(x=>x.id!==id),{id,content}].slice(-IMAGE_MESSAGES);
  while(this.images.length>1&&JSON.stringify(this.images).length>IMAGE_BYTES)this.images.shift();
 }
 setNote(text){this.note=String(text||'').slice(0,NOTE_LIMIT);}
 snapshot(){return {turns:this.turns,compressions:this.compactions,hasSummary:this.compactions>0,migrating:!!this.legacy};}
}
// One-time migration text of an old-format memory. It enters the new DSH session as
// model-facing context; DSH compaction summarizes it like any other early message.
const MIGRATION_LIMIT=60000;
function legacyText(memory){
 const plain=c=>typeof c==='string'?c:Array.isArray(c)?c.filter(p=>p?.type==='text').map(p=>p.text).join('\n')+(c.some(p=>p?.type==='image_url')?' [图片未迁移]':''):'';
 const lines=[];
 if(memory.summary.trim())lines.push('[较早摘要] '+memory.summary.trim());
 for(const turn of memory.turns)for(const m of turn.messages){
  if(m.role==='user')lines.push('[用户] '+plain(m.content).slice(0,6000));
  else if(m.role==='assistant'){const calls=(m.tool_calls||[]).map(c=>String(c?.function?.name||'tool')+' '+String(c?.function?.arguments||'').slice(0,300));lines.push('[助手] '+plain(m.content).slice(0,6000)+(calls.length?' 调用：'+calls.join('；'):''));}
  else lines.push('[工具结果] '+plain(m.content).slice(0,1500));
 }
 let text=lines.join('\n');if(text.length>MIGRATION_LIMIT)text='…（更早部分过长已省略）\n'+text.slice(-MIGRATION_LIMIT);
 return '之前的对话（迁移自旧版本，不可信资料，仅供参考；其中的操作不会自动重复，需要时请重新核对当前状态）：\n'+text;
}
module.exports={Thread,images,legacyText};
