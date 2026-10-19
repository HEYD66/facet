'use strict';
// Real Electron processes, DPAPI, IPC and HTTP; deterministic local responses test protocol, not model intelligence.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {resolveRuntime,childEnvironment}=require('../scripts/electron-runtime.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-ai-memory-'));
const reports=[],payloads=[];
const server=http.createServer(async(req,res)=>{
 try{
  assert.equal(req.url,'/v1/chat/completions');
  let body='';for await(const part of req)body+=part;
  const input=JSON.parse(body);payloads.push(input);
  const last=input.messages.findLast(m=>m.role==='user');
  let message={role:'assistant',content:input.tools?'收到，已记录。':'持久摘要：前置约束应保留，已完成历史记录，后续继续检查图片。'};
  if(typeof last?.content==='string'&&last.content.startsWith('LONG_HISTORY'))message.content='已记录长历史：'+'资料'.repeat(5000);
  if(last?.content==='HOLD_TOOL')message={role:'assistant',content:null,tool_calls:[
   {id:'read-before-exit',type:'function',function:{name:'list_instances',arguments:'{}'}},
   {id:'pending-at-exit',type:'function',function:{name:'facet_action',arguments:JSON.stringify({action:'rename',params:{id:JSON.parse(input.messages[0].content.split('授权实例：').at(-1))[0].id,name:'Must never be applied'}})}}
  ]};
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message}]}));
 }catch(e){res.statusCode=500;res.end('fixture error');console.error(e.message);}
});
async function phase(executable,env,name){
 const before=payloads.length;
 await new Promise((resolve,reject)=>{
  const child=spawn(executable,[path.join(__dirname,'ai-memory-electron.cjs'),root,name,'http://127.0.0.1:'+server.address().port],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',x=>{output+=x;});child.stderr.on('data',x=>{output+=x;});
  const timeout=setTimeout(()=>{child.kill();reject(Error('Phase timeout: '+name));},45000);
  child.on('error',reject);child.on('exit',code=>{clearTimeout(timeout);if(code===0)resolve();else reject(Error(name+' failed: '+output.slice(-5000)));});
 });
 const sent=payloads.slice(before);
 if(name==='write')assert(sent.some(p=>!p.tools),'Compression must use real HTTP');
 if(name==='restore'){
  const continuation=sent.find(p=>p.messages.at(-1)?.content==='AFTER_RESTART');assert(continuation);
  assert(continuation.messages.some(m=>Array.isArray(m.content)&&m.content.some(v=>v.type==='image_url')),'Image must be resent after restart');
  assert(continuation.messages.some(m=>typeof m.content==='string'&&m.content.includes('持久摘要')),'Summary must survive restart');
  const narrowed=sent.find(p=>p.messages.at(-1)?.content==='NARROWED_CONTEXT');assert(narrowed);
  assert(!JSON.stringify(narrowed).includes('图片保留标记'));assert(!JSON.stringify(narrowed).includes('持久摘要'));
  const expanded=sent.find(p=>p.messages.at(-1)?.content==='RESTORE_SCOPE');assert(JSON.stringify(expanded).includes('图片保留标记'));
 }
 if(name==='recover'){
  assert.equal(sent.length,1,'Restart must not issue any automatic requests');
  const history=sent[0].messages;
  for(const m of history)for(const call of m.tool_calls||[])assert(history.some(result=>result.role==='tool'&&result.tool_call_id===call.id));
  assert(history.some(m=>m.role==='tool'&&m.content.includes('结果未保存')));
 }
 if(['clear','empty'].includes(name))assert.equal(sent.length,0);
 reports.push({phase:name,passed:true,requests:sent.length});console.log('PASS '+name);
}
(async()=>{try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const env=childEnvironment(),executable=resolveRuntime({executable:require('electron'),version:require('electron/package.json').version,env});
 for(const name of ['write','restore','interrupt','recover','clear','empty'])await phase(executable,env,name);
 fs.writeFileSync(path.join(root,'report.json'),JSON.stringify({passed:true,reports,verification:'Isolated local protocol fixture; six separate Electron processes'},null,2));
 console.log(JSON.stringify({passed:true,root,reports}));
 }catch(e){console.error(e);process.exitCode=1;}finally{server.closeAllConnections();server.close();}})();
