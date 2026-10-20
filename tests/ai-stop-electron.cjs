'use strict';
// Local deterministic provider exercises real HTTP/SSE, Chromium tools and encrypted storage.
// It tests host behavior, not the reasoning quality of a third-party model.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const root=process.argv.find(x=>x.startsWith('--test-profile='))?.slice(15)||fs.mkdtempSync(path.join(os.tmpdir(),'facet-ai-stop-'));
app.setPath('userData',root);
const {Controller}=require('../src/main/controller.cjs');
const {AIAgent}=require('../src/main/ai-agent.cjs');
let win,c,server,mode='normal',target,round=0,summaryCount=0,requests=[],summaryStarted=false;
const results=[];
const wait=async fn=>{const end=Date.now()+35000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('Timed out');};
const call=(id,name,args)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const timer=setTimeout(()=>app.exit(2),150000);
app.whenReady().then(async()=>{let error;try{
 win=new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'../src/main/preload.cjs'),sandbox:true,contextIsolation:true}});
 c=new Controller(win,root,path.join(root,'no-core'));
 if(process.argv.includes('--resume')){
  c.aiAgent=new AIAgent(c);
  assert(c.aiAgent.run.entries.some(x=>x.kind==='assistant'&&x.text.includes('页面连续为空')));
  assert(JSON.stringify(c.aiAgent.memory.export()).includes('页面连续为空'));
  assert.equal(c.aiAgent.run.busy,false);results.push('Fresh Electron process restores final answer and memory without resuming execution');
 }else{
  server=http.createServer(async(req,res)=>{if(req.url!=='/v1/chat/completions'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Empty audit page</title><body></body>');return;}
   let body='';for await(const chunk of req)body+=chunk;const payload=JSON.parse(body);requests.push(payload);
   if(!payload.tools){summaryStarted=true;summaryCount++;
    const lastGroup=payload.messages.findLast(x=>x.tool_calls?.length);for(const t of lastGroup.tool_calls)assert(payload.messages.some(x=>x.role==='tool'&&x.tool_call_id===t.id));
    if(mode==='failure'){res.writeHead(503);res.end();return;}
    if(mode==='timeout'||mode==='abort'){req.on('close',()=>res.destroy());return;}
    res.setHeader('Content-Type','text/event-stream');
    const delta=mode==='empty'?{}:mode==='unexpected-tool'?{tool_calls:[{index:0,...call('unexpected','stop_instance',{instanceId:target})}]}:{content:'本次未完成：页面连续为空，已停止操作。下一步检查页面访问结果。'};
    res.write('data: '+JSON.stringify({choices:[{index:0,delta,finish_reason:mode==='unexpected-tool'?'tool_calls':'stop'}]})+'\n\n');res.end('data: [DONE]\n\n');return;
   }
   round++;
   const calls=mode==='limit'?[call('read-'+round,'cdp_command',{instanceId:target,method:'Page.getLayoutMetrics',params:{}})]:[call('read-'+round,'read_page',{instanceId:target})];
   if(round===3&&mode!=='limit')calls.push(call('skipped-fill','fill',{instanceId:target,selector:'#should-not-run',text:'no'}));
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:null,tool_calls:calls}}]}));
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port,a=c.store.list()[0];target=a.id;c.store.update(a.id,{url:base+'/blank'});await c.start(a.id);
  require('../src/main/ipc.cjs').installIPC(win,c);await win.loadFile(path.join(__dirname,'../src/renderer/index.html'));
  const agent=c.aiAgent;agent.save({baseURL:base+'/v1',model:'local-stop-protocol'});
  for(const scenario of ['normal','failure','empty','unexpected-tool','timeout','abort','limit','unbounded','normal']){
   mode=scenario==='unbounded'?'limit':scenario;round=0;summaryCount=0;summaryStarted=false;requests=[];agent.clear();
   agent.save({baseURL:base+'/v1',model:'local-stop-protocol',maxRounds:scenario==='limit'?5:0});assert.equal(agent.settings().maxRounds,scenario==='limit'?5:0);
   agent.begin({prompt:'Read the test page',ids:[target],permission:'full'});
   if(mode==='abort'){await wait(()=>summaryStarted);agent.stop();}
   await wait(()=>!agent.run.busy);
   assert.equal(summaryCount,1);assert.equal(round,scenario==='limit'?5:scenario==='unbounded'?20:3);
   assert.equal(agent.run.status,mode==='abort'?'已停止':scenario==='limit'?'已达到 5 轮上限':'已停止：无进展');
   if(scenario==='unbounded')assert(agent.run.entries.some(x=>x.kind==='system'&&x.text.includes('原地循环')));
   assert(!agent.run.entries.some(x=>x.kind==='tool'&&x.text.startsWith('fill：')));
   if(mode!=='abort'){
    const answer=agent.run.entries.filter(x=>x.kind==='assistant').at(-1)?.text;assert(answer?.trim());
    if(['failure','empty','unexpected-tool','timeout'].includes(mode))assert(answer.includes('千面提供的停止说明'));
    else assert(answer.includes('页面连续为空'));
    const restored=new AIAgent(c);assert(restored.run.entries.some(x=>x.kind==='assistant'&&x.text===answer));
    assert(restored.memory.turns.some(t=>t.messages.some(m=>m.role==='assistant'&&m.content===answer)));assert.equal(restored.memory.turns.length,1);
   }
   if(mode!=='limit')assert(JSON.stringify(requests.at(-1).messages).includes('此操作未执行'));
   results.push(scenario+': tools stop, final response/fallback or explicit cancellation, complete tool protocol and persistence verified');
  }
  await win.webContents.executeJavaScript("document.querySelector('#aiToggle').click()");
  await wait(()=>win.webContents.executeJavaScript("document.querySelector('#aiHistory').textContent.includes('页面连续为空')"));
  results.push('Production AI panel renders the final assistant answer');
 }
 }catch(e){error=e.stack;}finally{try{await c?.closeAll();}catch(e){error??=e.stack;}win?.destroy();server?.closeAllConnections();server?.close();clearTimeout(timer);const report={passed:!error,results,error,root};fs.writeFileSync(path.join(root,process.argv.includes('--resume')?'resume-report.json':'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(error?1:0);}});
