'use strict';
// AI panel conversation (DSH-style): Markdown via the main-process DSH parser, untrusted-content
// safety, links opening inside an instance, grouped tool steps with privacy-safe summaries,
// incremental DOM reuse while a reply grows, and the empty-state call to action.
// Real Electron, IPC, Controller, official DSH engine; the model is a local protocol fixture.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-ai-panel-'));app.setPath('userData',root);app.disableHardwareAcceleration();
const reports=[],hits=[];let c,win,server,target;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(fn,label,ms=30000)=>{const end=Date.now()+ms;while(Date.now()<end){try{if(await fn())return;}catch{}await sleep(25);}throw Error('Timeout: '+label);};
const reply=(res,message)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',...message}}]}));};
const call=(name,args,id)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
setTimeout(()=>app.exit(2),150000).unref();
app.whenReady().then(async()=>{let error;try{
 win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{offscreen:true,preload:path.join(__dirname,'../src/main/preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 c=new(require('../src/main/controller.cjs').Controller)(win,root,'');require('../src/main/ipc.cjs').installIPC(win,c);const a=c.aiAgent;
 await win.loadFile(path.join(__dirname,'../src/renderer/index.html'));const ui=code=>win.webContents.executeJavaScript(code);
 let base;
 server=http.createServer(async(req,res)=>{
  if(req.url!=='/v1/chat/completions'){hits.push(req.url);res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Panel fixture</title><h1>Panel fixture</h1><input id="pw" type="password" aria-label="密码"><button>登录</button>');return;}
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),tools=body.messages.filter(m=>m.role==='tool');
  if(!tools.length){reply(res,{tool_calls:[call('observe',{instanceId:target},'o1')]});return;}
  if(tools.length===1){const ref=/(e\d+)[^\n]*密码/.exec(tools[0].content)?.[1]||'e1';reply(res,{tool_calls:[call('act',{instanceId:target,ref,action:'type',text:'secret-123'},'a1')]});return;}
  if(tools.length===2){reply(res,{tool_calls:[call('cdp_command',{instanceId:target,method:'Nope.notAMethod',params:{}},'c1')]});return;}
  reply(res,{content:['## 检查结果','','**“正常”**加载，**没有报错**。','','| 项目 | 结果 |','| --- | ---: |','| 状态 | 200 |','','```js','document.title','```','','<img src=x onerror="window.pwned=1"><script>window.pwned=2</script>','','[恶意](javascript:window.pwned=3) [外链]('+base+'/linked?q=1) ![标志]('+base+'/logo.png)'].join('\n')});
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 target=c.store.list()[0].id;c.store.update(target,{name:'面板实例',url:base+'/page'});

 await ui("document.querySelector('#aiToggle').click()");await wait(()=>ui("!document.querySelector('#aiPanel').hidden"),'panel');
 await wait(()=>ui("!!document.querySelector('#aiHistory [data-ai-setup]')"),'setup call to action');
 await ui("document.querySelector('#aiHistory [data-ai-setup]').click()");await wait(()=>ui("!document.querySelector('#aiSettings').hidden"),'settings opened');
 await ui("document.querySelector('#aiSettingsDone').click()");
 assert.equal((await ui("bridge.request('ai-markdown',{texts:'not-an-array'})")).ok,false);
 reports.push('Unconfigured empty state offers 配置模型, which opens settings; ai-markdown rejects malformed requests');

 a.save({baseURL:base+'/v1',model:'panel-fixture'});await c.start(target);await wait(()=>c.runtimes.get(target)?.view?.webContents.getTitle()==='Panel fixture','instance page');
 await wait(()=>ui("document.querySelectorAll('#aiHistory [data-ai-example]').length===3"),'examples');
 await ui("document.querySelector('#aiHistory [data-ai-example]').click()");assert.match(await ui("document.querySelector('#aiPrompt').value"),/检查当前网页/);
 reports.push('Configured empty state lists example tasks that fill the composer');

 await ui(`document.querySelector('#aiScope').value=${JSON.stringify(target)};const p=document.querySelector('#aiPermission');p.value='full';p.dispatchEvent(new Event('change'))`);
 assert.equal(await ui("document.querySelector('#aiPermission').dataset.level"),'full');
 await ui("document.querySelector('#aiPrompt').value='检查面板';document.querySelector('#aiSend').click()");await wait(()=>a.run&&!a.run.busy,'task done',60000);
 assert.equal(a.run.status,'已完成');
 await wait(()=>ui("!!document.querySelector('#aiHistory .ai-md h2')"),'markdown rendered');
 const md=await ui(`(()=>{const m=[...document.querySelectorAll('#aiHistory .ai-md')].at(-1);return {h2:m.querySelector('h2')?.textContent,strong:[...m.querySelectorAll('strong')].map(x=>x.textContent),rows:m.querySelectorAll('table tbody tr').length,align:m.querySelector('table td:last-child')?.style.textAlign,code:m.querySelector('.ai-md-pre pre')?.textContent,lang:m.querySelector('.ai-md-pre-head span')?.textContent,img:document.querySelectorAll('#aiHistory img').length,script:document.querySelectorAll('#aiHistory script').length,pwned:window.pwned??null,rawShown:m.textContent.includes('<script>window.pwned=2</script>'),links:[...m.querySelectorAll('[data-ai-href]')].map(x=>[x.textContent,x.dataset.aiHref]),bad:m.textContent.includes('恶意')&&![...m.querySelectorAll('[data-ai-href]')].some(x=>x.dataset.aiHref.startsWith('javascript'))};})()`);
 assert.equal(md.h2,'检查结果');assert.deepEqual(md.strong,['“正常”','没有报错']);assert.equal(md.rows,1);assert.equal(md.align,'right');assert.equal(md.code,'document.title');assert.equal(md.lang,'js');
 assert.equal(md.img,0);assert.equal(md.script,0);assert.equal(md.pwned,null);assert.equal(md.rawShown,true);assert.equal(md.bad,true);
 assert.deepEqual(md.links,[['外链',base+'/linked?q=1'],['图片：标志',base+'/logo.png']]);
 assert(!hits.includes('/logo.png'),'images are never fetched by the control window');
 reports.push('Assistant Markdown renders headings, CJK strong, aligned GFM table and code; raw HTML stays text, javascript links are inert, images become links and are never fetched');

 const tools=await ui(`(()=>{const g=document.querySelectorAll('#aiHistory details.ai-tools');const last=g[g.length-1];return {groups:g.length,title:last.querySelector(':scope>summary').textContent,steps:[...last.querySelectorAll('.ai-step')].map(s=>({cls:s.className,text:s.querySelector('summary').textContent})),open:last.open,history:document.querySelector('#aiHistory').textContent};})()`);
 assert.equal(tools.groups,1);assert.match(tools.title,/执行了 3 步/);assert.match(tools.title,/1 步失败/);assert.equal(tools.open,false);
 assert.deepEqual(tools.steps.map(s=>s.cls),['ai-step ok','ai-step ok','ai-step fail']);
 assert.match(tools.steps[0].text,/观察网页.*面板实例/);assert.match(tools.steps[1].text,/输入 10 个字符/);assert.match(tools.steps[2].text,/Nope\.notAMethod/);
 assert(!tools.history.includes('secret-123'),'typed text never appears in the conversation');
 assert(!JSON.stringify(a.run.entries).includes('secret-123'),'typed text is not stored in tool entries');
 reports.push('Consecutive tool calls form one collapsed group with per-step status, target instance and argument summary; typed password text is neither shown nor stored');

 const before=await ui("document.querySelector('#aiHistory .ai-md h2').closest('[data-md-block]').dataset.mdBlock");
 await ui("window.__firstBlock=[...document.querySelectorAll('#aiHistory .ai-md')].at(-1).firstElementChild");
 const entry=a.run.entries.findLast(e=>e.kind==='assistant');entry.text+='\n\n追加的**第三段**';
 await wait(()=>ui("[...document.querySelectorAll('#aiHistory .ai-md')].at(-1).textContent.includes('追加的第三段')"),'appended text');
 assert.equal(await ui("[...document.querySelectorAll('#aiHistory .ai-md')].at(-1).firstElementChild===window.__firstBlock"),true);
 assert.equal(await ui("document.querySelector('#aiHistory .ai-md h2').closest('[data-md-block]').dataset.mdBlock"),before);
 reports.push('A growing reply re-renders only changed blocks; earlier block elements are reused');

 await ui("document.querySelector('#aiHistory [data-ai-href]').click()");
 await wait(()=>hits.includes('/linked?q=1'),'link opened in instance');
 const r=c.runtimes.get(target);await wait(()=>r.view.webContents.getURL()===base+'/linked?q=1','active tab shows the link');assert(r.tabs.size>=2);await wait(async()=>await ui('view')==='browser','UI follows the instance');
 reports.push('A Markdown link opens as a new tab in the running instance (its proxy and session), and the UI follows it');
}catch(e){error=e;console.error(e.stack||e);}finally{
 try{await c?.closeAll();}catch{}win?.destroy();server?.close();
 const report={passed:!error,reports,error:error?String(error.stack||error):null};fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,root},null,2));
 app.exit(error?1:0);
}});
