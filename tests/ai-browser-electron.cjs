'use strict';
// Real Electron fixture for observe/act/dialog: trusted input, cross-site iframe (OOPIF), open Shadow DOM,
// occlusion, offscreen element, SPA route change, alert, native select, custom checkbox, cursor:pointer div,
// fitted (scaled) viewport, permission modes, screenshot gating, and a full agent loop driven by a local
// deterministic model fixture (tests protocol and tool execution, not model intelligence).
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-ai-browser-'));app.setPath('userData',root);
setTimeout(()=>{console.error('Verification timed out');app.exit(2);},240000).unref();
const wait=async(fn,ms=10000)=>{const t=Date.now();while(Date.now()-t<ms){if(await fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('wait timeout: '+fn+' | recent logs: '+JSON.stringify(logs.slice(-8))+' | vis: '+JSON.stringify(logs.filter(x=>x.startsWith('vis'))));};
const reports=[],logs=[],payloads=[];let c,win,serverA,serverB,originA,originB,modelStep=0,trustedRef='';
const page=()=>`<!doctype html><html><head><title>Fixture</title><style>body{margin:0;font:16px sans-serif}#cover{position:fixed;left:0;top:0;width:320px;height:64px;background:#eee;z-index:9}.fake{cursor:pointer;display:inline-block;padding:6px;border:1px solid #888}.box{opacity:0;position:absolute;width:1px;height:1px}</style></head><body>
<button id="covered" style="position:fixed;left:12px;top:12px;z-index:1">Covered</button><input id="coveredInput" placeholder="Covered input" value="keep" style="position:fixed;left:12px;top:36px;z-index:1"><div id="cover">overlay</div>
<div style="height:80px"></div><h1>AI fixture</h1><p id="log" style="position:fixed;right:0;bottom:0;width:1px;height:1px;overflow:hidden;margin:0"></p>
<button id="trusted" onclick="log('trusted:'+event.isTrusted)">Trusted</button>
<form onsubmit="event.preventDefault();log('submitted:'+document.querySelector('#q').value)"><input id="q" placeholder="Search here" value="old"></form>
<select id="pick" onchange="log('picked:'+this.value)"><option value="a">Alpha</option><option value="b">Beta</option></select>
<label><input type="checkbox" id="agree" class="box" onchange="log('agree:'+this.checked)"><span>I agree</span></label>
<span class="fake" id="fake">Fake div button</span>
<div id="host"></div>
<button id="spa" onclick="history.pushState({},'','/page/next');setTimeout(()=>{const b=document.createElement('button');b.textContent='Next step';b.onclick=e=>log('next:'+e.isTrusted);document.body.insertBefore(b,document.querySelector('#host'));},400)">Go SPA</button>
<button id="alert" onclick="alert('Hello dialog');log('after-alert')">Alert</button>
<input type="password" id="pw" placeholder="Password">
<iframe id="xf" src="${originB}/frame" style="width:420px;height:160px;border:6px solid #ccc;margin-left:40px;display:block"></iframe>
<div style="height:2600px"></div><button id="far" onclick="log('far:'+event.isTrusted)">Far away</button>
<script>function log(s){document.querySelector('#log').textContent+=s+';';fetch('/log?'+encodeURIComponent(s)).catch(()=>{});}
const h=document.querySelector('#host').attachShadow({mode:'open'});h.innerHTML='<button>Shadow button</button>';h.querySelector('button').addEventListener('click',e=>log('shadow:'+e.isTrusted));
document.querySelector('#fake').addEventListener('click',e=>log('fake:'+e.isTrusted));log('vw:'+innerWidth);log('vis:'+document.visibilityState);document.addEventListener('visibilitychange',()=>log('vis:'+document.visibilityState));document.addEventListener('mousedown',e=>log('md:'+e.clientX+','+e.clientY));</script></body></html>`;
const frame=`<!doctype html><title>Frame</title><body style="margin:0"><script>document.addEventListener('mousedown',e=>fetch('/log?fmd:'+e.clientX+','+e.clientY+',iw'+innerWidth))</script><button onclick="fetch('/log?frame:'+event.isTrusted)">Frame button</button><input id="fi" placeholder="Frame input"><button onclick="fetch('/log?finput:'+encodeURIComponent(document.querySelector('#fi').value))">Send frame</button></body>`;
function handler(req,res){
 const u=new URL(req.url,'http://x');
 if(u.pathname==='/log'){logs.push(decodeURIComponent(u.search.slice(1)));res.end('ok');return;}
 if(u.pathname==='/frame'){res.setHeader('Content-Type','text/html');res.end(frame);return;}
 if(u.pathname==='/frame-redirect'){res.writeHead(302,{Location:originA+'/nested-frame'});res.end();return;}
 if(u.pathname==='/nested-frame'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Nested</title><iframe src="'+originB+'/frame"></iframe>');return;}
 if(u.pathname==='/nested-host'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Nested host</title><iframe src="'+originB+'/frame-redirect"></iframe>');return;}
 if(u.pathname==='/v1/chat/completions')return model(req,res);
 res.setHeader('Content-Type','text/html');res.end(page());
}
const refOf=(text,name)=>{const m=String(text).match(new RegExp('(e\\d+) \\S+ "'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'"'));if(!m)throw Error('no ref for '+name+' in\n'+text);return m[1];};
async function model(req,res){
 let text='';for await(const part of req)text+=part;const body=JSON.parse(text);payloads.push(body);
 const images=body.messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(x=>x.type==='image_url'):[]);
 const lastTool=[...body.messages].reverse().find(m=>m.role==='tool');
 let message;
 if(!body.tools){message={role:'assistant',content:'摘要'};}
 else if(modelStep===0){message={tool_calls:[{id:'c1',type:'function',function:{name:'observe',arguments:JSON.stringify({instanceId:body.__id||modelInstance,screenshot:true})}}]};}
 else if(modelStep===1){assert.equal(images.length,1,'screenshot attached after observe');trustedRef=refOf(JSON.parse(lastTool.content).elements,'Trusted');message={tool_calls:[{id:'c2',type:'function',function:{name:'act',arguments:JSON.stringify({instanceId:modelInstance,ref:trustedRef,action:'click'})}}]};}
 else if(modelStep===2){assert(JSON.parse(lastTool.content).done);message={tool_calls:[{id:'c3',type:'function',function:{name:'observe',arguments:JSON.stringify({instanceId:modelInstance,screenshot:true})}}]};}
 else if(modelStep===3){assert.equal(images.length,1,'old screenshot pruned, only latest kept');assert(body.messages.some(m=>typeof m.content==='string'&&m.content.includes('旧截图已移除')));message={content:'已点击 Trusted 按钮并核对页面。'};}
 else message={content:'done'};
 if(body.tools)modelStep++;
 res.setHeader('Content-Type','text/event-stream');
 const emit=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({choices:[{index:0,delta,finish_reason}]})+'\n\n');
 if(message.tool_calls){const t=message.tool_calls[0];emit({tool_calls:[{index:0,id:t.id,type:'function',function:{name:t.function.name,arguments:t.function.arguments}}]});emit({},'tool_calls');}
 else{emit({content:message.content});emit({},'stop');}
 res.end('data: [DONE]\n\n');
}
let modelInstance='';
app.whenReady().then(async()=>{try{
 serverA=http.createServer(handler);await new Promise(r=>serverA.listen(0,'127.0.0.1',r));originA='http://127.0.0.1:'+serverA.address().port;
 serverB=http.createServer(handler);await new Promise(r=>serverB.listen(0,r));originB='http://localhost:'+serverB.address().port; // different site → out-of-process iframe
 win=new BrowserWindow({show:true,width:1280,height:900,webPreferences:{preload:path.join(__dirname,'../src/main/preload.cjs'),sandbox:true,contextIsolation:true,backgroundThrottling:false}});
 c=new(require('../src/main/controller.cjs').Controller)(win,root,'');require('../src/main/ipc.cjs').installIPC(win,c);
 const agent=c.aiAgent,a=c.store.list()[0];c.store.update(a.id,{url:originA+'/page'});await c.start(a.id);
 await win.loadFile(path.join(__dirname,'../src/renderer/index.html'));const ui=s=>win.webContents.executeJavaScript(s);
 await wait(()=>ui('state.instances.length===1'));await ui(`route('browser',${JSON.stringify(a.id)})`);
 const wc=()=>c.runtimes.get(a.id).view.webContents;await wait(()=>wc().getTitle()==='Fixture'&&wc().mainFrame.framesInSubtree.length===2);
 // Real input needs a painted page: keep the fixture window on top so other desktop windows cannot occlude it.
 win.setAlwaysOnTop(true);win.show();win.moveTop();
 // The renderer can route before the freshly started view is attached; re-route until the page is actually displayed.
 for(let i=0;;i++){try{await wait(async()=>await wc().executeJavaScript('document.visibilityState')==='visible',3000);break;}catch(e){if(i>=5)throw e;await ui(`route('proxies')`).catch(()=>{});await new Promise(r=>setTimeout(r,300));await ui(`route('browser',${JSON.stringify(a.id)})`);}}
 // Wait until the instance view has its final layout (the page may first load while the view is still 0×0).
 await wait(async()=>{const w=await wc().executeJavaScript('innerWidth');const b=c.runtimes.get(a.id).view.getBounds();return w>300&&Math.abs(w-b.width)<2;});await new Promise(r=>setTimeout(r,300));
 const oopif=wc().mainFrame.frames[0];reports.push('Cross-site iframe process: '+(oopif.processId!==wc().mainFrame.processId?'separate (OOPIF)':'same'));
 agent.run={id:'t',busy:true,status:'',scope:[a.id],permission:'full',allowGlobal:false,sharePage:true,entries:[],history:[],abort:new AbortController()};
 const tool=(n,args)=>agent.tool(n,{instanceId:a.id,...args});
 const logged=s=>wait(()=>logs.includes(s),6000);

 let obs=await tool('observe',{});
 assert.equal(obs.untrusted,true);assert.equal(obs.title,'Fixture');
 for(const n of ['Trusted','Search here','Shadow button','Fake div button','Frame button','Go SPA','Alert','Far away'])refOf(obs.elements,n);
 assert(/password "Password"/.test(obs.elements));assert(/\[视口外\]/.test(refOf(obs.elements,'Far away')&&obs.elements.split('\n').find(l=>l.includes('Far away'))));
 assert(/-- 框架 http:\/\/localhost:\d+ --/.test(obs.elements),'frame section shown with coordinates');
 assert(!JSON.stringify(obs).includes('__facetAI'));
 assert.equal(await wc().executeJavaScript('Object.keys(window).some(k=>k.startsWith("__facetAI"))'),false,'main world sees no helper');
 reports.push('observe lists refs across main frame, open shadow DOM, cursor:pointer element and cross-site iframe; page world sees no helper');
 const ref=n=>refOf(obs.elements,n);

 let r=await tool('act',{ref:ref('Trusted'),action:'click'});await logged('trusted:true');assert.equal(r.done.action,'click');
 assert.equal((await tool('observe',{})).elements.includes(ref('Trusted')+' button "Trusted"'),true,'ref stable across observes');
 await assert.rejects(tool('act',{ref:ref('Covered'),action:'click'}),/遮挡/);assert(!logs.some(x=>x.startsWith('covered')));
 await assert.rejects(tool('act',{ref:ref('Covered input'),action:'type',text:'must not write'}),/遮挡/);
 await assert.rejects(tool('act',{ref:ref('Covered input'),action:'press',key:'Backspace'}),/遮挡/);
 assert.equal(await wc().executeJavaScript('document.querySelector("#coveredInput").value'),'keep');
 r=await tool('act',{ref:ref('Search here'),action:'type',text:'hello 世界',submit:true});assert.equal(r.done.value,'hello 世界');await logged('submitted:hello 世界');
 r=await tool('act',{ref:ref('pick'),action:'select',value:'Beta'});assert.equal(r.done.selected,'Beta');await logged('picked:b');
 r=await tool('act',{ref:ref('I agree'),action:'check'});assert.equal(r.done.checked,true);await logged('agree:true');
 await tool('act',{ref:ref('Shadow button'),action:'click'});await logged('shadow:true');
 await tool('act',{ref:ref('Fake div button'),action:'click'});await logged('fake:true');
 r=await tool('act',{ref:ref('Frame button'),action:'click'});await logged('frame:true');assert(!r.done.note,'frame click used real mouse');
 await tool('act',{ref:ref('Frame input'),action:'type',text:'xyz'});await tool('act',{ref:ref('Send frame'),action:'click'});await logged('finput:xyz');
 const oldFrameRef=ref('Frame button');
 await wc().executeJavaScript(`document.querySelector('iframe').src=${JSON.stringify(originB+'/frame?next=1')}`);
 await wait(()=>wc().mainFrame.frames[0]?.url.endsWith('/frame?next=1'));
 await wait(()=>wc().mainFrame.frames[0].executeJavaScript('document.readyState==="complete"'));
 obs=await tool('observe',{});assert.notEqual(ref('Frame button'),oldFrameRef);
 await assert.rejects(tool('act',{ref:oldFrameRef,action:'click'}),/失效/);
 r=await tool('act',{ref:ref('Far away'),action:'click'});await logged('far:true');
 reports.push('act sends trusted clicks/typing to main frame, shadow DOM, custom checkbox, native select, OOPIF and offscreen element; occluded element refused');
 r=await tool('act',{action:'scroll',direction:'up',amount:20000});assert(/^0\//.test(r.scroll));
 r=await tool('act',{action:'scroll',direction:'down',amount:700});assert(Number(r.scroll.split('/')[0])>0,'wheel scrolled page');
 await assert.rejects(tool('act',{ref:ref('Password'),action:'type',text:'x'}),/密码/);
 r=await tool('act',{ref:ref('Go SPA'),action:'click'});
 assert(JSON.stringify(r).includes('Next step'),'settle waited for delayed SPA render: '+JSON.stringify(r));assert(r.url.endsWith('/page/next'));
 obs=await tool('observe',{});await tool('act',{ref:ref('Next step'),action:'click'});await logged('next:true');
 reports.push('wheel scroll, password refusal, SPA route + delayed render captured by settle');
 r=await tool('act',{ref:ref('Alert'),action:'click'});assert.equal(r.dialog?.message,'Hello dialog',JSON.stringify(r));
 const blocked=await tool('observe',{});assert.equal(blocked.dialog.type,'alert');
 r=await tool('dialog',{accept:true});assert.equal(r.handled,true);await logged('after-alert');
 reports.push('alert detected without hanging; dialog tool accepts it and page continues');
 const stale=ref('Trusted');await c.navigate(a.id,originA+'/page');await wait(()=>wc().getURL().endsWith('/page')&&!wc().isLoading());
 await assert.rejects(tool('act',{ref:stale,action:'click'}),/失效/);
 obs=await tool('observe',{});assert.notEqual(ref('Trusted'),stale,'refs never reused after navigation');
 reports.push('refs invalidated on navigation and never reused');

 await c.navigate(a.id,originA+'/nested-host');await wait(()=>wc().mainFrame.framesInSubtree.length===3&&!wc().isLoading());
 obs=await tool('observe',{});assert(obs.elements.includes('Frame button'),'nested redirected frame remains observable when coordinates are unknown');
 await c.navigate(a.id,originA+'/page');await wait(()=>wc().getTitle()==='Fixture'&&!wc().isLoading());obs=await tool('observe',{});
 reports.push('child-frame navigation invalidates old refs; redirected nested frames remain readable');

 agent.run.permission='read';await assert.rejects(tool('act',{ref:ref('Trusted'),action:'click'}),/仅可查看/);
 agent.run.permission='confirm';await ui("document.querySelector('#aiToggle').click()");await wait(()=>ui("!document.querySelector('#aiPanel').hidden"));
 const before=logs.filter(x=>x==='trusted:true').length;const pending=tool('act',{ref:ref('Trusted'),action:'click'});
 await wait(()=>agent.pending);assert.equal(agent.pending.name,'act');assert.equal(agent.pending.args.element,'button "Trusted"');
 await wait(()=>ui("!document.querySelector('#aiApproval').hidden&&document.querySelector('#aiApproval').textContent.includes('目标元素：button')"));
 assert.equal(await ui("document.querySelector('#aiApproval').textContent.includes('undefined')"),false);
 await ui("document.querySelector('[data-ai-approval=yes]').click()");await pending;
 await wait(()=>logs.filter(x=>x==='trusted:true').length===before+1);
 const denied=tool('act',{ref:ref('Trusted'),action:'click'});const deniedCheck=assert.rejects(denied,/拒绝/);await wait(()=>agent.pending);
 await wait(()=>ui("!document.querySelector('#aiApproval').hidden&&document.querySelector('#aiApproval').dataset.id==="+JSON.stringify(agent.pending.id)));await ui("document.querySelector('[data-ai-approval=no]').click()");await deniedCheck;
 agent.run.permission='full';await ui("document.querySelector('#aiClose').click()");
 reports.push('read mode blocks act; confirm mode shows element label, approve executes and reject does not');

 obs=await tool('observe',{screenshot:true});assert(obs.screenshotNote&&!obs.__image);
 agent.run.busy=false;agent.save({baseURL:originA+'/v1',model:'fixture',key:'fixture-key',vision:true});agent.run.busy=true;assert.equal(agent.settings().vision,true);
 obs=await tool('observe',{screenshot:true});assert(obs.__image.startsWith('data:image/jpeg;base64,'));
 reports.push('screenshots only when provider vision flag is enabled');

 // Fitted viewport: fixed emulated width larger than the view → scale < 1. Clicks must still land.
 const b=c.store.create('Scaled');const env={...c.store.get(b.id).environment,width:2400,height:1600};c.store.update(b.id,{url:originA+'/page',environment:env});await c.start(b.id);
 await ui(`route('browser',${JSON.stringify(b.id)})`);const bwc=c.runtimes.get(b.id).view.webContents;await wait(()=>bwc.getTitle()==='Fixture'&&!bwc.isLoading());
 await wait(()=>logs.includes('vw:2400'));agent.run.scope=[a.id,b.id];reports.push('scaled instance viewportKey scale='+JSON.parse(String(c.runtimes.get(b.id).viewportKey).replace(/^tile:/,'')).scale);
 const bobs=await agent.tool('observe',{instanceId:b.id});const n0=logs.filter(x=>x==='far:true').length;
 await agent.tool('act',{instanceId:b.id,ref:refOf(bobs.elements,'Far away'),action:'click'});await wait(()=>logs.filter(x=>x==='far:true').length===n0+1);
 const fr=await agent.tool('act',{instanceId:b.id,ref:refOf(bobs.elements,'Frame button'),action:'click'});await logged('frame:false');assert(/缩放视口/.test(fr.done.note));
 await agent.tool('act',{instanceId:b.id,ref:refOf(bobs.elements,'Frame input'),action:'type',text:'scaled'});await agent.tool('act',{instanceId:b.id,ref:refOf(bobs.elements,'Send frame'),action:'click'});await logged('finput:scaled');
 reports.push('fitted viewport (innerWidth 2400 in a smaller view): trusted clicks land in main frame; cross-site iframe falls back to labelled script click and typing still works');
 agent.run.scope=[a.id];await ui(`route('browser',${JSON.stringify(a.id)})`);

 // Full loop with deterministic model fixture.
 agent.run=null;modelInstance=a.id;const t0=logs.filter(x=>x==='trusted:true').length;
 agent.begin({prompt:'点击 Trusted 按钮',ids:[a.id],permission:'full'});await wait(()=>!agent.run.busy,60000);
 assert.equal(agent.run.status,'已完成',JSON.stringify(agent.run.entries.slice(-3)));assert.equal(modelStep,4);
 await wait(()=>logs.filter(x=>x==='trusted:true').length===t0+1);
 const toolNames=payloads.find(p=>p.tools).tools.map(t=>t.function.name);assert(toolNames.includes('observe')&&toolNames.includes('act')&&toolNames.includes('dialog'));assert(!toolNames.includes('read_page')&&!toolNames.includes('click')&&!toolNames.includes('fill'));
 assert(!JSON.stringify(agent.memory.export()).includes('data:image/jpeg'),'screenshots not stored in memory');
 const saved=fs.readdirSync(root).filter(f=>/^ai-/.test(f)).map(f=>{try{return fs.readFileSync(path.join(root,f),'utf8');}catch{return '';}}).join('');assert(!saved.includes('data:image/jpeg'));
 reports.push('agent loop: observe(screenshot) → act(ref) → observe → answer; one image at a time; legacy tools hidden; images not persisted');
 await ui("document.querySelector('#aiToggle').click()");await wait(()=>ui("!document.querySelector('#aiPanel').hidden"));
 await wait(()=>ui("document.querySelector('#aiVision').checked===true"));assert.equal(await ui("document.querySelector('#aiMaxRounds').value"),'','default is unlimited');
 await ui("document.querySelector('#aiSettingsButton').click();document.querySelector('#aiMaxRounds').value='30';document.querySelector('#aiSave').click()");await wait(()=>agent.settings().maxRounds===30);
 assert.equal(JSON.parse(fs.readFileSync(agent.file,'utf8')).maxRounds,30);
 await ui("document.querySelector('#aiSettingsButton').click();document.querySelector('#aiMaxRounds').value='';document.querySelector('#aiSave').click()");await wait(()=>agent.settings().maxRounds===0);
 reports.push('settings UI: vision checkbox reflects saved flag; round cap saves 30 and blank restores unlimited');
 agent.save({providerId:'temporary-provider',baseURL:originA+'/v1',model:'fixture',maxRounds:30});agent.removeProvider('temporary-provider');
 const restored=new(require('../src/main/ai-agent.cjs').AIAgent)(c);assert.equal(restored.settings().maxRounds,30);assert.equal(restored.settings().vision,true);
 reports.push('global round limit and provider vision setting survive provider removal and settings reload');
 const report={passed:true,modelTest:'local deterministic protocol fixture only',reports};fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({root,...report},null,1));
}catch(e){console.error(e);if(win&&!win.isDestroyed())console.error('Fixture state: '+JSON.stringify({bounds:win.getBounds(),minimized:win.isMinimized(),activeId:c?.activeId,pageBounds:c?.bounds,runtimes:[...(c?.runtimes||[])].map(([id,r])=>({id,status:r.status,bounds:r.view?.getBounds(),visible:r.view?.getVisible()})),renderer:await win.webContents.executeJavaScript('({view,activeId,status:current()?.status,modal,host:document.querySelector("#browserHost")?.getBoundingClientRect().toJSON()})').catch(e=>({error:e.message}))}));process.exitCode=1;}finally{await c?.closeAll().catch(()=>{});win?.destroy();serverA?.close();serverB?.close();app.exit(process.exitCode||0);}});
