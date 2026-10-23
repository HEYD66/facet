'use strict';
// DSH backend plugins in the real Electron app: token-meter context pressure, ask_user_question
// through the panel, and compaction-basic with the Facet summarizer. The provider is a local
// deterministic protocol fixture (Chat Completions + usage), not a claim about model quality.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-dsh-plugins-'));
app.setPath('userData',root);app.disableHardwareAcceleration();
const reports=[],requests=[];let c,win,server,base,target;
const wait=async(fn,ms=30000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Timeout: '+String(fn));};
const reply=(res,message,usage)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',...message}}],...(usage?{usage}:{})}));};
const call=(name,args,id)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const SUMMARY_PROMPT='你是千面 Facet 浏览器助手的上下文压缩器',MARK='FACET_SUMMARY_MARK';
const page='<!doctype html><title>Long fixture</title><main>'+Array.from({length:50},(_,i)=>'<p>Paragraph '+i+' '+'facet context pressure fixture text '.repeat(3)+'</p>').join('')+'</main>';
const timer=setTimeout(()=>app.exit(2),240000);
app.whenReady().then(async()=>{let error;try{
 win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{offscreen:true,preload:path.join(__dirname,'../src/main/preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 c=new(require('../src/main/controller.cjs').Controller)(win,root,'');require('../src/main/ipc.cjs').installIPC(win,c);const a=c.aiAgent;
 await win.loadFile(path.join(__dirname,'../src/renderer/index.html'));const ui=code=>win.webContents.executeJavaScript(code);
 server=http.createServer(async(req,res)=>{
  if(req.url!=='/v1/chat/completions'){res.setHeader('Content-Type','text/html');res.end(page);return;}
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);
  const usage={prompt_tokens:Math.ceil(raw.length/3),completion_tokens:12,total_tokens:Math.ceil(raw.length/3)+12};
  if(!body.tools){
   if(String(body.messages[0]?.content).startsWith(SUMMARY_PROMPT)){reply(res,{content:'## 用户目标与要求\n- '+MARK+' 持续读取长页面\n## 下一步\n- 继续读取并给出结论'},usage);return;}
   reply(res,{content:'无工具请求'});return;
  }
  const tools=body.messages.filter(m=>m.role==='tool');
  // The original COMPACT prompt itself may be inside the compacted span; the checkpoint marks the task.
  if(body.messages.some(m=>m.role==='user'&&String(m.content).includes(MARK))){reply(res,{content:'压缩后继续完成，保留了最近 '+tools.length+' 次读取。'},usage);return;}
  const prompt=body.messages.find(m=>m.role==='user'&&/^(HELLO|ASK|ASK_SKIP|ASK_STOP|COMPACT)$/.test(String(m.content)))?.content;
  if(prompt==='HELLO'){reply(res,{content:'你好，已就绪。'},{prompt_tokens:20000,completion_tokens:12,total_tokens:20012,prompt_tokens_details:{cached_tokens:15000}});return;}
  if(prompt?.startsWith('ASK')){
   if(!tools.length){reply(res,{content:null,tool_calls:[call('ask_user_question',{questions:[{id:'net',header:'网络',question:'用哪种网络？',options:[{label:'代理（推荐）',description:'按出口 IP 匹配语言时区'},{label:'直连'}]},{id:'note',question:'还有其他要求吗？'}]},'ask-1')]},usage);return;}
   reply(res,{content:'已按你的回答处理：'+tools.at(-1).content},usage);return;
  }
  if(prompt==='COMPACT'){
   if(tools.length>=16){reply(res,{content:'NO_COMPACTION'},usage);return;}
   reply(res,{content:null,tool_calls:[call('observe',{instanceId:target,full_text:true},'obs-'+tools.length)]},usage);return;
  }
  reply(res,{content:'完成'},usage);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 target=c.store.list()[0].id;
 await ui("document.querySelector('#aiToggle').click()");await wait(()=>ui("!document.querySelector('#aiPanel').hidden"));
 a.save({baseURL:base+'/v1',model:'dsh-fixture'});assert.equal(a.contextWindow(),128000);
 assert.throws(()=>a.save({baseURL:base+'/v1',model:'dsh-fixture',contextWindow:100}),/上下文窗口/);

 // 1. token-meter: provider usage becomes the context baseline and the composer ring shows it.
 a.begin({prompt:'HELLO',ids:[target],permission:'read'});await wait(()=>!a.run.busy);
 assert.equal(a.run.status,'已完成');assert.deepEqual(requests[0].stream_options,{include_usage:true});
 const context=a.snapshot().task.context;assert.equal(context.estimated,false);assert.equal(context.window,128000);assert(context.used>=20012&&context.used<21000,JSON.stringify(context));
 assert.deepEqual(a.run.usage,{input:5000,cacheRead:15000,output:12,requests:1});
 await wait(()=>ui("!document.querySelector('#aiContextMeter').hidden"));
 const meter=await ui("(()=>{const m=document.querySelector('#aiContextMeter');return {text:m.lastElementChild.textContent,now:m.getAttribute('aria-valuenow'),title:m.title,dash:m.querySelector('.ai-meter-value').getAttribute('stroke-dasharray')}})()");
 assert.equal(meter.text,Math.round(context.used/1280)+'%');assert.equal(meter.now,String(Math.round(context.used/1280)));assert(meter.title.includes('按模型返回用量')&&meter.title.includes('缓存命中 15K'),meter.title);assert(/^\d+\.\d+ /.test(meter.dash));
 a.persist();assert.deepEqual(a.sessions.capture().find(x=>x.id===a.sessions.activeId).task.context,{used:context.used,window:128000,estimated:false});
 reports.push('Streamed usage is requested, mapped to DSH TokenUsage and drives token-meter context pressure; the ring shows '+meter.text+' and cache hits, and the measurement persists with the session');

 // 2. ask_user_question through the real panel card.
 a.clear();a.begin({prompt:'ASK',ids:[target],permission:'full'});
 await wait(()=>ui("!document.querySelector('#aiQuestion').hidden&&document.querySelectorAll('#aiQuestion input[type=radio]').length===2"));
 assert(requests.at(-1).tools.some(t=>t.function.name==='ask_user_question'));assert.equal(a.run.status,'等待你回答');
 const card=await ui("(()=>{const q=document.querySelector('#aiQuestion');return {text:q.textContent,chip:q.querySelector('.ai-question-chip')?.textContent,areas:q.querySelectorAll('textarea').length,activity:document.querySelector('#aiActivity').textContent}})()");
 assert(card.text.includes('用哪种网络？')&&card.text.includes('按出口 IP 匹配语言时区')&&card.text.includes('还有其他要求吗？'));assert.equal(card.chip,'网络');assert.equal(card.areas,2);assert(card.activity.startsWith('询问你'),card.activity);
 const before=requests.length;await ui("document.querySelector('[data-ai-answer=submit]').click()");
 await wait(()=>ui("document.querySelector('#aiError').textContent.includes('请回答')&&!document.querySelector('[data-ai-answer=submit]').disabled"));
 assert.equal(requests.length,before);assert(a.question);
 await ui("document.querySelector('#aiQuestion input[value=\"直连\"]').click();document.querySelectorAll('#aiQuestion textarea')[1].value='保持登录状态';document.querySelector('[data-ai-answer=submit]').click()");
 await wait(()=>!a.run.busy);assert.equal(a.run.status,'已完成');assert.equal(a.question,null);
 const answered=JSON.parse(requests.at(-1).messages.findLast(m=>m.role==='tool').content);
 assert.deepEqual(answered,{answers:[{id:'net',selected:['直连']},{id:'note',selected:[],custom:'保持登录状态'}]});
 const step=a.run.entries.find(e=>e.kind==='tool'&&e.text.startsWith('ask_user_question：'));assert.equal(step.ok,true);assert.equal(step.result,'已回答：直连；保持登录状态');assert.equal(step.args,'用哪种网络？ / 还有其他要求吗？');
 await wait(()=>ui("document.querySelector('#aiQuestion').hidden&&document.querySelector('#aiHistory').textContent.includes('询问你')"));
 reports.push('ask_user_question blocks the DSH tool call, the panel card validates an empty answer, and the selected option plus free text return to the model as the tool result');

 a.clear();a.begin({prompt:'ASK_SKIP',ids:[target],permission:'full'});await wait(()=>ui("!document.querySelector('#aiQuestion').hidden"));
 await ui("document.querySelector('[data-ai-answer=skip]').click()");await wait(()=>!a.run.busy);
 assert(JSON.parse(requests.at(-1).messages.findLast(m=>m.role==='tool').content).answers.every(x=>x.selected.length===0&&x.custom.includes('暂不回答')));
 a.clear();a.begin({prompt:'ASK_STOP',ids:[target],permission:'full'});await wait(()=>ui("!document.querySelector('#aiQuestion').hidden"));
 const stopAt=requests.length;await ui("document.querySelector('#aiStop').click()");await wait(()=>!a.run.busy);
 assert.equal(a.run.status,'已停止');assert.equal(a.question,null);assert.equal(requests.length,stopAt);await wait(()=>ui("document.querySelector('#aiQuestion').hidden"));
 assert.equal((await ui("bridge.request('ai-answer',{questionId:'stale',answers:[]})")).ok,false);
 reports.push('Skip tells the model the user declined; Stop while waiting cancels the question without another model request; stale answers are rejected');

 // 3. compaction-basic with the Facet summarizer under a small configured window.
 a.save({baseURL:base+'/v1',model:'dsh-fixture',contextWindow:24576});assert.equal(a.settings().contextWindow,24576);assert.equal(a.contextWindow(),24576);
 c.store.update(target,{url:base+'/page'});await c.start(target);await wait(()=>c.runtimes.get(target).view.webContents.getTitle()==='Long fixture');
 a.clear();const start=requests.length;a.begin({prompt:'COMPACT',ids:[target],permission:'read'});await wait(()=>!a.run.busy,120000);
 const run=requests.slice(start),summaryAt=run.findIndex(b=>!b.tools&&String(b.messages[0].content).startsWith(SUMMARY_PROMPT));
 assert.equal(a.run.status,'已完成',JSON.stringify(a.run.entries.slice(-3)));assert(summaryAt>0,'no summary request');assert.equal(run.filter(b=>!b.tools).length,1);
 assert(run[summaryAt].messages[1].content.includes('observe'),'summary input carries the compacted tool calls');
 const after=run.slice(summaryAt+1)[0],toolCount=b=>b.messages.filter(m=>m.role==='tool').length;
 assert(after.messages.some(m=>m.role==='user'&&String(m.content).includes(MARK)));assert(toolCount(after)<toolCount(run[summaryAt-1]),toolCount(after)+' vs '+toolCount(run[summaryAt-1]));
 assert(a.run.entries.some(e=>e.kind==='system'&&e.text.includes('已把较早的')));assert(a.run.entries.at(-1).text.startsWith('压缩后继续完成'));
 assert(a.run.context.window===24576&&a.run.context.used<24576*0.8,JSON.stringify(a.run.context));
 assert.equal(a.run.entries.filter(e=>e.kind==='tool').length,run.filter(b=>b.tools).length-1,'each observe is reported once even after its result is compacted');
 reports.push('Under a 24K window DSH compaction-basic summarizes '+(toolCount(run[summaryAt-1])-toolCount(after))+' older observe results with the Facet summarizer (one tool-free request), the next request carries the checkpoint and the task finishes below the threshold');

 await ui("document.documentElement.dataset.theme='dark'");a.clear();a.begin({prompt:'ASK',ids:[target],permission:'full'});await wait(()=>ui("!document.querySelector('#aiQuestion').hidden"));await new Promise(r=>setTimeout(r,300));
 const shot=await win.webContents.capturePage();fs.writeFileSync(path.join(root,'ask-card-dark.png'),shot.toPNG());
 const layout=await ui("(()=>{const p=document.querySelector('#aiPanel');return {overflow:p.scrollWidth>p.clientWidth+1,card:document.querySelector('#aiQuestion').getBoundingClientRect().height}})()");assert(!layout.overflow);assert(layout.card>60);
 await ui("document.querySelector('#aiStop').click()");await wait(()=>!a.run.busy);
 reports.push('Question card captured in dark mode without horizontal overflow');
 }catch(e){error=e.stack;}finally{
  try{await c?.closeAll();}catch(e){error??=e.stack;}win?.destroy();server?.closeAllConnections();server?.close();clearTimeout(timer);
  const report={passed:!error,root,verification:'Official DSH plugins, real Electron + isolated local protocol fixture',reports,error};fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(error?1:0);
 }});
