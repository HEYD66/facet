'use strict';
// Encrypted backend for the official DSH session-persistence seam. Each DSH session is one
// append-only file <dir>/<session id>.log. Every line is one encrypted record: line 1 holds
// the session header, each later line one contiguous event batch. DSH (resume, compaction,
// pruning, token metering) owns the history; this file only stores ciphertext.
// Live events reach storage through the documented routing: session/event buffers into the
// session's single write handle, session/flush is the durability barrier and
// session/disposed drains and closes the handle.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path');
const BATCH_MS=200,HEADER_PROBE=64*1024;
const ID=/^[A-Za-z0-9_-]{1,120}$/;
function fileOf(dir,id){if(!ID.test(String(id)))throw TypeError('invalid DSH session id');return path.join(dir,id+'.log');}
// safeStorage-backed codec. Plaintext fallbacks (basic_text) are refused, never written.
function safeCodec(){
 const {safeStorage}=require('electron');
 return {
  encode(text){if(!safeStorage.isEncryptionAvailable()||safeStorage.getSelectedStorageBackend?.()==='basic_text')throw Error('系统加密不可用，无法安全保存会话记录');return safeStorage.encryptString(text).toString('base64');},
  decode(line){return safeStorage.decryptString(Buffer.from(line,'base64'));}
 };
}
async function writeLines(file,lines,flag){
 const fh=await fsp.open(file,flag);
 try{await fh.write(lines.map(x=>x+'\n').join(''));await fh.datasync();}finally{await fh.close();}
}
// Removes the stored DSH log of a deleted or cleared Facet conversation. Safe only while no
// task runs; the caller guarantees that.
function removeLog(dir,id){try{fs.rmSync(fileOf(dir,id),{force:true});}catch{/* best effort: an orphan log is unreadable without its conversation */}}

function define(p){
 const {SessionPersistence,SessionAlreadyExistsError,SessionAlreadyOwnedError,SessionHandleClosedError,SessionPersistenceNotFoundError,SessionPersistenceCorruptionError,SessionReadOnlyError,SessionPersistenceRevision,assertContiguous,assertStoredId,assertVersion,materializeAppendBatch,materializeCreateHeader,validateStoredEvents}=p;
 const corrupt=(id,why,cause)=>new SessionPersistenceCorruptionError('stored session "'+id+'" is unreadable: '+why,cause?{cause}:undefined);
 // Decode one stored file. A final line without its newline is a torn write: it is never
 // returned and the next append truncates it. Any complete line that fails to decode is
 // corruption and refuses the whole log.
 async function readLog(dir,id,codec){
  let raw;try{raw=await fsp.readFile(fileOf(dir,id),'utf8');}catch(e){if(e.code==='ENOENT')return undefined;throw e;}
  const lines=raw.split('\n'),events=[];let header,inherited=0,offset=0,torn;
  for(let i=0;i<lines.length;i++){
   const line=lines[i];
   if(i===lines.length-1){if(line)torn=offset;break;}
   let record;try{record=JSON.parse(codec.decode(line));}catch(e){throw corrupt(id,'record '+i+' failed to decrypt',e);}
   if(i===0){
    if(!record||typeof record!=='object'||!record.header)throw corrupt(id,'missing header');
    header=record.header;inherited=record.inheritedEventCount||0;assertStoredId(id,header);assertVersion(header);
   }else{if(!Array.isArray(record))throw corrupt(id,'record '+i+' is not an event batch');events.push(...record);}
   offset+=line.length+1;
  }
  if(!header){if(torn===undefined)return undefined;throw corrupt(id,'header write was torn');}
  try{assertContiguous(id,events,0);}catch(e){throw corrupt(id,'event sequence is not contiguous',e);}
  validateStoredEvents(header,events);
  return {header,inherited,events,torn};
 }
 async function readHeader(dir,id,codec){
  let fh;try{fh=await fsp.open(fileOf(dir,id),'r');}catch(e){if(e.code==='ENOENT')return undefined;throw e;}
  try{
   const info=await fh.stat(),buf=Buffer.alloc(Math.min(HEADER_PROBE,info.size)),{bytesRead}=await fh.read(buf,0,buf.length,0);
   const text=buf.subarray(0,bytesRead).toString('utf8'),end=text.indexOf('\n');if(end<0)return undefined;
   let record;try{record=JSON.parse(codec.decode(text.slice(0,end)));}catch(e){throw corrupt(id,'header failed to decrypt',e);}
   assertStoredId(id,record.header);
   return {header:record.header,revision:SessionPersistenceRevision('file:'+info.size+':'+info.mtimeMs),sizeBytes:info.size};
  }finally{await fh.close();}
 }
 class Handle{
  constructor(store,id,header,access,state){this.store=store;this.id=id;this.header=header;this.access=access;this.state=state;this.chain=Promise.resolve();this.closing=undefined;this.buffered=[];this.timer=undefined;this.paused=false;this.draining=undefined;}
  get inheritedEventCount(){return this.state.inherited;}
  async read(offset=0,length=Number.MAX_SAFE_INTEGER,options){
   this.assertOpen('read');
   if(!Number.isSafeInteger(offset)||offset<0)throw TypeError('read offset must be a non-negative safe integer');
   if(!Number.isSafeInteger(length)||length<0)throw TypeError('read length must be a non-negative safe integer');
   options?.signal?.throwIfAborted();
   if(this.state.primed)return {eventState:'shared-frozen',events:this.state.primed.slice(offset,offset+length)};
   if(!this.state.materialized)return {eventState:'detached',events:[]};
   const log=await readLog(this.store.dir,this.id,this.store.codec);
   if(!log){if(this.store.pending.has(this.id))return {eventState:'detached',events:[]};throw new SessionPersistenceNotFoundError(this.id);}
   return {eventState:'shared-frozen',events:log.events.slice(offset,offset+length)};
  }
  append(events,options){
   this.assertOpen('append');const batch=materializeAppendBatch(events);
   return this.run('append',async()=>{options?.signal?.throwIfAborted();await this.persist(batch);});
  }
  flush(options){
   return this.run('flush',async()=>{
    options?.signal?.throwIfAborted();if(this.access!=='write')throw new SessionReadOnlyError(this.id,'flush');
    if(this.state.materialized)return;
    await writeLines(fileOf(this.store.dir,this.id),[this.headerLine()],'wx');this.state.materialized=true;this.store.pending.delete(this.id);
   });
  }
  headerLine(){return this.store.codec.encode(JSON.stringify({header:this.header,inheritedEventCount:this.state.inherited}));}
  async persist(batch){
   if(this.access!=='write')throw new SessionReadOnlyError(this.id,'append');
   if(!batch.length)return;
   assertContiguous(this.id,batch,this.state.cursor);
   const file=fileOf(this.store.dir,this.id),line=this.store.codec.encode(JSON.stringify(batch));
   if(this.state.torn!==undefined){await fsp.truncate(file,this.state.torn);this.state.torn=undefined;}
   if(this.state.materialized)await writeLines(file,[line],'a');
   else{await writeLines(file,[this.headerLine(),line],'wx');this.state.materialized=true;this.store.pending.delete(this.id);}
   this.state.cursor+=batch.length;this.state.primed=undefined;
  }
  enqueueLive(event,report){
   this.buffered.push(structuredClone(event));
   if(this.timer!==undefined||this.paused)return;
   this.timer=setTimeout(()=>{this.timer=undefined;this.drainLive().catch(report);},BATCH_MS);
  }
  drainLive(){return this.draining??=this.drainBuffered().finally(()=>{this.draining=undefined;});}
  async drainBuffered(){
   if(this.timer!==undefined){clearTimeout(this.timer);this.timer=undefined;}
   this.paused=false;
   while(this.buffered.length){
    await this.enqueue(async()=>{
     const batch=this.buffered.splice(0);
     try{await this.persist(materializeAppendBatch(batch));}catch(e){this.buffered=batch.concat(this.buffered);this.paused=true;throw e;}
    });
   }
  }
  close(){
   return this.closing??=(async()=>{
    let failure;
    for(;;){try{await this.drainLive();}catch(e){failure=e;break;}await this.chain;if(!this.buffered.length)break;}
    await this.chain;this.store.release(this);
    if(failure)throw failure;
   })();
  }
  [Symbol.asyncDispose](){return this.close();}
  enqueue(op){const next=this.chain.then(op);this.chain=next.catch(()=>{});return next;}
  run(operation,op){this.assertOpen(operation);return this.enqueue(async()=>{this.assertOpen(operation);return op();});}
  assertOpen(operation){if(this.closing!==undefined)throw new SessionHandleClosedError(this.id,operation);}
 }
 // In-process bookkeeping shared by the routing listeners and the service: one active write
 // handle per session id (also the live event route) and created-but-unwritten sessions.
 class Tracker{
  constructor(dir,codec){this.dir=dir;this.codec=codec;this.writers=new Map();this.pending=new Map();this.open=new Set();this.counter=0;}
  adopt(handle){this.open.add(handle);if(handle.access==='write')this.writers.set(handle.id,handle);return handle;}
  release(handle){this.open.delete(handle);if(handle.access!=='write')return;this.writers.delete(handle.id);if(!handle.state.materialized)this.pending.delete(handle.id);}
  install(ctx){
   const self=this;
   return ctx.effect(function*(){
    yield async()=>{const errors=[];for(const h of [...self.open]){try{await h.close();}catch(e){errors.push(e);}}if(errors.length)throw new AggregateError(errors,'facet session persistence dispose failed');};
    yield ctx.on('session/event',(session,event)=>{const w=self.writers.get(session.id);if(w)w.enqueueLive(event,error=>ctx.logger.warn('facet session persistence: background write failed (events retained): '+String(error?.message||error)));});
    yield ctx.on('session/flush',session=>{const w=self.writers.get(session.id);if(!w)return undefined;return (async()=>{await w.drainLive();await w.flush();})();});
    yield ctx.on('session/disposed',session=>{const w=self.writers.get(session.id);if(w)w.close().catch(error=>ctx.logger.warn('facet session persistence: final drain failed: '+String(error?.message||error)));});
   },'facet session persistence routing');
  }
 }
 class FacetSessionPersistence extends SessionPersistence{
  name='facet-session-persistence';
  constructor(ctx,tracker){super(ctx);this.tracker=tracker;}
  async create(header,options){
   options?.signal?.throwIfAborted();
   const snapshot=materializeCreateHeader(header),t=this.tracker,inherited=options?.inheritedEventCount??0;
   fileOf(t.dir,snapshot.id);
   if(t.writers.has(snapshot.id)||t.pending.has(snapshot.id)||fs.existsSync(fileOf(t.dir,snapshot.id)))throw new SessionAlreadyExistsError(snapshot.id);
   await fsp.mkdir(t.dir,{recursive:true});
   t.pending.set(snapshot.id,{header:snapshot,revision:SessionPersistenceRevision('memory:'+(++t.counter))});
   return t.adopt(new Handle(t,snapshot.id,snapshot,'write',{cursor:0,materialized:false,inherited}));
  }
  async open(id,access,options){
   options?.signal?.throwIfAborted();const t=this.tracker;
   if(access==='read'){
    const pending=t.pending.get(id);if(pending)return t.adopt(new Handle(t,id,pending.header,'read',{cursor:0,materialized:false,inherited:0}));
    const log=await readLog(t.dir,id,t.codec);if(!log)throw new SessionPersistenceNotFoundError(id);
    return t.adopt(new Handle(t,id,log.header,'read',{cursor:log.events.length,materialized:true,inherited:log.inherited,primed:log.events}));
   }
   if(t.writers.has(id))throw new SessionAlreadyOwnedError(id);
   t.writers.set(id,null);
   try{
    const log=await readLog(t.dir,id,t.codec);if(!log)throw new SessionPersistenceNotFoundError(id);
    options?.signal?.throwIfAborted();
    return t.adopt(new Handle(t,id,log.header,'write',{cursor:log.events.length,materialized:true,inherited:log.inherited,primed:log.events,torn:log.torn}));
   }catch(e){t.writers.delete(id);throw e;}
  }
  async flush(){
   const errors=[];
   for(const w of [...this.tracker.writers.values()]){if(!w)continue;try{await w.drainLive();await w.flush();}catch(e){if(!(e instanceof SessionHandleClosedError))errors.push(e);}}
   if(errors.length)throw new AggregateError(errors,'facet session persistence flush failed');
  }
  async stat(id,options){
   options?.signal?.throwIfAborted();const t=this.tracker,pending=t.pending.get(id);
   if(pending)return {header:pending.header,revision:pending.revision};
   return readHeader(t.dir,id,t.codec);
  }
  async list(options){
   const t=this.tracker,out=[],seen=new Set(),pending=[...t.pending.entries()];let names=[];
   try{names=await fsp.readdir(t.dir);}catch(e){if(e.code!=='ENOENT')throw e;}
   for(const name of names){
    options?.signal?.throwIfAborted();if(!name.endsWith('.log'))continue;const id=name.slice(0,-4);if(!ID.test(id))continue;
    try{const s=await readHeader(t.dir,id,t.codec);if(s){out.push(s);seen.add(id);}}catch{/* unreadable logs are reported by open/stat */}
   }
   for(const [id,entry] of pending)if(!seen.has(id))out.push({header:entry.header,revision:entry.revision});
   return out;
  }
 }
 // Cordis plugin mirroring the official backends: routing and handle teardown live on the
 // plugin context and outlast the service, so consumers unload before handles close.
 return {
  name:'facet-session-persistence',
  async apply(ctx,config){
   let service;
   ctx.effect(function*(){
    const tracker=new Tracker(config.dir,config.codec);
    yield tracker.install(ctx);
    service=ctx.plugin({name:'facet-session-persistence-service',apply(serviceCtx){new FacetSessionPersistence(serviceCtx,tracker);}});
    yield service.dispose;
   },'facet session persistence resources');
   await service.await();
  }
 };
}
module.exports={define,removeLog,safeCodec,fileOf};
