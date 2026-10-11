'use strict';
// 代理管理进阶：批量分配（节点不足时循环共用）、代理断开提醒（只提醒、不切换、不直连）、地区/协议筛选、延迟趋势。
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),net=require('node:net'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'arena-proxy-adv-'));app.setPath('userData',root);app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');app.commandLine.appendSwitch('disable-background-networking');if(process.platform==='linux')app.commandLine.appendSwitch('disable-gpu');
const {Controller}=require('../src/main/controller.cjs'),{installIPC}=require('../src/main/ipc.cjs');
let win,c,proxy;const results=[],errors=[];const pause=(ms=160)=>new Promise(r=>setTimeout(r,ms));const wait=async(fn,label,n=300)=>{for(let i=0;i<n;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Timeout '+label);};const ok=name=>{results.push(name);console.log('PASS '+name);};setTimeout(()=>app.exit(2),150000).unref();
app.whenReady().then(async()=>{try{
 // 可用的上游代理：CONNECT 后直接返回一个页面。
 proxy=http.createServer((_q,res)=>res.end('<title>Proxy OK</title>OK'));proxy.on('connect',(_req,socket)=>{socket.write('HTTP/1.1 200 Connection established\r\n\r\n');socket.once('data',()=>{const body='<title>Proxy OK</title><h1>OK</h1>';socket.end('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: '+Buffer.byteLength(body)+'\r\nConnection: close\r\n\r\n'+body);});});await new Promise(r=>proxy.listen(0,'127.0.0.1',r));const good=proxy.address().port;
 const deadPort=await new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
 win=new BrowserWindow({width:1440,height:960,show:true,webPreferences:{preload:path.join(__dirname,'../src/main/preload.cjs'),sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});c=new Controller(win,root,path.join(__dirname,'../resources/mihomo',process.platform==='win32'?'mihomo.exe':'mihomo'));installIPC(win,c);
 const a=c.store.list()[0]||c.store.create('实例 A'),b=c.store.create('实例 B'),d=c.store.create('实例 C');
 const nodes=[['香港 01',good,'http'],['香港 02',good,'http'],['日本 东京 01',deadPort,'http'],['JP02 Osaka',good,'socks5'],['US-LA 01',good,'http']].map(([name,port,type])=>({name,type,server:'127.0.0.1',port}));
 await c.library.save({name:'进阶测试',text:JSON.stringify({proxies:nodes})});const sid=c.library.summaries()[0].id;
 await win.loadFile(path.join(__dirname,'../src/renderer/index.html'));const ui=code=>win.webContents.executeJavaScript(code);await wait(()=>ui('typeof current==="function"&&!!current()'),'initialize');await ui("route('proxies')");await pause(400);
 // 地区 / 协议
 const chips=await ui("[...document.querySelectorAll('[data-lib=region]')].map(b=>b.textContent)");assert.deepEqual(chips,['全部5','香港2','日本2','美国1']);
 assert.deepEqual(await ui("[...document.querySelectorAll('[data-lib=protocol]')].map(b=>b.textContent)"),['全部5','http4','socks51']);
 await ui("document.querySelector('[data-lib=region][data-value=\"日本\"]').click()");await pause();assert.deepEqual(await ui("[...document.querySelectorAll('[data-library-node]')].map(e=>e.dataset.libraryNode)"),['日本 东京 01','JP02 Osaka']);
 await ui("document.querySelector('[data-lib=protocol][data-value=\"socks5\"]').click()");await pause();assert.deepEqual(await ui("[...document.querySelectorAll('[data-library-node]')].map(e=>e.dataset.libraryNode)"),['JP02 Osaka']);assert.equal(await ui("document.querySelector('[data-lib=region][data-value=\"日本\"]').getAttribute('aria-pressed')"),'true');
 await ui("document.querySelector('[data-lib=region][data-value=\"\"]').click()");await pause();await ui("document.querySelector('[data-lib=protocol][data-value=\"\"]').click()");await pause();assert.equal(await ui("document.querySelectorAll('[data-library-node]').length"),5);
 ok('Region and protocol chips count nodes, filter the table together and reset');
 // 延迟趋势
 const at=i=>new Date(Date.now()-60000*(5-i)).toISOString();[120,90,null,150,110].forEach((ms,i)=>c.diagnostics.history.record(ms===null?{sourceId:sid,name:'香港 01',kind:'latency',ok:false,error:'连接超时',at:at(i)}:{sourceId:sid,name:'香港 01',kind:'latency',ok:true,latencyMs:ms,provider:'test',at:at(i)}));c.emit();
 await wait(()=>ui("!!document.querySelector('[data-result-node=\"香港 01\"][data-result-kind=latency] svg.connectivity-bars')"),'row history bars');assert.equal(await ui("document.querySelector('[data-result-node=\"香港 01\"][data-result-kind=latency] svg.connectivity-bars .connectivity-bar.failed')?1:0"),1);
 assert.equal(await ui("Math.round(document.querySelector('[data-result-node=\"香港 01\"] svg.connectivity-bars').getBoundingClientRect().width)"),76,'row history bars keeps its size');assert(await ui("document.querySelector('[data-result-node=\"香港 01\"]').closest('tr').getBoundingClientRect().height<=44"),'row stays compact');assert.equal(await ui("document.querySelector('[data-result-node=\"香港 01\"]').textContent.includes('110 ms')"),true);
 await ui("document.querySelector('[data-result-node=\"香港 01\"][data-result-kind=latency] button').click()");await pause();assert.equal(await ui("document.querySelectorAll('#modal .trend-list li').length"),5);assert(await ui("document.querySelector('#modal svg.connectivity-bars-large').getBoundingClientRect().width>=300"),'detail trend is large');assert.equal(await ui("document.querySelector('#modal .trend-list li b').textContent"),'110 ms');await ui("document.querySelector('[data-action=modal-close]').click()");await pause();
 assert.equal(c.snapshot().diagnostics.history,undefined,'history is not pushed with every state update');ok('Last 10 latency results show as a row history bars and a detailed trend');
 // 批量分配：2 个节点 → 3 个实例，第 3 个共用
 await ui("document.querySelector('[data-library-node=\"香港 01\"]').click();document.querySelector('[data-library-node=\"日本 东京 01\"]').click()");await pause();assert.equal(await ui("document.querySelector('[data-lib=assign-many]').disabled"),false);
 await ui("document.querySelector('[data-lib=assign-many]').click()");await pause();assert.equal(await ui("document.querySelector('#modal [data-action=confirm]').disabled"),true);
 await ui("document.querySelector('[data-assign-all]').click()");await pause();const desc=await ui("document.querySelector('#modal .description').textContent");assert(desc.includes('2 个节点')&&desc.includes('3 个实例')&&desc.includes('1 个实例会与其他实例共用'),desc);
 assert.deepEqual(await ui("[...document.querySelectorAll('[data-plan-for]')].map(e=>e.textContent)"),['→ 香港 01','→ 日本 东京 01','→ 香港 01（共用）']);
 await ui("document.querySelector('#modal [data-action=confirm]').click()");await wait(()=>[a,b,d].every(x=>c.store.get(x.id).network.mode==='mihomo'),'batch assigned');
 assert.deepEqual([a,b,d].map(x=>c.store.get(x.id).network.nodeName),['香港 01','日本 东京 01','香港 01']);assert.equal(c.workspace.events.filter(e=>e.text.includes('批量分配节点')).length,1);
 ok('Batch assignment spreads selected nodes over several instances and cycles when nodes run out');
 // 单个网站失败只记录页面错误，不升级为全局代理告警；内核连续报告三次才提醒。
 await c.start(b.id);const rb=c.runtimes.get(b.id);await c.navigate(b.id,'https://unreachable.facet.test/').catch(()=>{});await wait(()=>rb.loadFailed===true,'page failure recorded',200);assert.ok(!rb.proxyAlert,'single-site failure is not a global proxy alert');c.noteProxyIssue(b.id,rb,'测试内核错误 1',false);c.noteProxyIssue(b.id,rb,'测试内核错误 2',false);c.noteProxyIssue(b.id,rb,'测试内核错误 3',false);assert.ok(!rb.proxyAlert,'core errors alone do not blame the node');c.notePageFailure(b.id,rb,-100,'https://one.example/');c.notePageFailure(b.id,rb,-100,'https://two.example/');await wait(()=>!!rb.proxyAlert,'proxy alert raised after different sites fail',200);
 assert.equal(c.store.get(b.id).network.mode,'mihomo');assert.equal(c.store.get(b.id).network.nodeName,'日本 东京 01');assert.equal(rb.status,'running');
 const snap=c.snapshot().instances.find(x=>x.id===b.id);assert(snap.proxyAlert.includes('代理'),snap.proxyAlert);
 await ui(`localOpen.add(${JSON.stringify(b.id)});route('browser',${JSON.stringify(b.id)})`);c.emit();await wait(()=>ui("!!document.querySelector('.tab-alert')&&!!document.querySelector('#sidebar .proxy-alert')"),'alert shown in tab and sidebar');
 assert.equal(c.workspace.events.filter(e=>e.instanceId===b.id&&e.text.startsWith('代理可能已断开')).length,1,'logged once');
 ok('A dead node raises a visible proxy alert once, without switching node or falling back to direct');
 // 恢复：A 使用可用节点，页面经代理成功加载后自动清除提醒
 await c.start(a.id);const ra=c.runtimes.get(a.id);c.notePageFailure(a.id,ra,-100,'https://one.example/');c.notePageFailure(a.id,ra,-100,'https://two.example/');assert(ra.proxyAlert);await c.navigate(a.id,'http://ok.facet.test/');await wait(()=>!ra.proxyAlert,'alert cleared after a successful proxied load',200);
 assert(c.workspace.events.some(e=>e.instanceId===a.id&&e.text.startsWith('代理连接已恢复')));await c.stop(b.id);assert.equal(c.snapshot().instances.find(x=>x.id===b.id).proxyAlert,'');
 ok('The alert clears when a page loads through the proxy and is not shown for stopped instances');
 // 全部节点源：合并显示、标出来源；同名节点按来源区分；跨订阅删除和批量分配
 await c.library.save({name:'第二订阅',text:JSON.stringify({proxies:[{name:'香港 01',type:'http',server:'127.0.0.1',port:good},{name:'新加坡 01',type:'http',server:'127.0.0.1',port:good}]})});const sid2=c.library.summaries().find(x=>x.id!==sid).id;c.emit();
 await ui("route('proxies')");await wait(()=>ui("!!document.querySelector('#librarySource option[value=\"*\"]')&&!!document.querySelector('[data-source-group=\"*\"]')"),'all-sources entries');
 await ui("const s=document.querySelector('#librarySource');s.value='*';s.dispatchEvent(new Event('change',{bubbles:true}))");await pause(300);
 assert.equal(await ui("document.querySelectorAll('[data-library-node]').length"),7);assert.equal(await ui("document.querySelectorAll('tr[data-source] .node-source').length"),7);assert.equal(await ui("document.querySelector('[data-source-group=\"*\"]').open"),true);
 assert.deepEqual(await ui("[...document.querySelectorAll('[data-lib=region]')].slice(0,2).map(b=>b.textContent)"),['全部7','香港3']);
 assert.equal(await ui(`document.querySelector('tr[data-source="${sid2}"] .node-source').title`),'来自：第二订阅');
 await ui("document.querySelectorAll('[data-library-node=\"香港 01\"]').forEach(e=>e.click())");await pause();assert.equal(await ui("document.querySelector('#librarySelectionCount').textContent"),'2');
 await ui("document.querySelector('[data-lib=delete-selected]').click()");await pause();assert((await ui("document.querySelector('#modal .description').textContent")).includes('2 个节点源'));
 await ui("document.querySelector('#modal [data-action=confirm]').click()");await wait(()=>c.library.summaries().every(x=>(x.excludedCount||0)>=1),'deleted across sources');
 await wait(()=>ui("document.querySelectorAll('[data-library-node]').length===5"),'rows after delete');
 await ui(`document.querySelector('tr[data-source="${sid}"] [data-library-node="JP02 Osaka"]').click();document.querySelector('tr[data-source="${sid2}"] [data-library-node="新加坡 01"]').click()`);await pause();
 await ui("document.querySelector('[data-lib=assign-many]').click()");await pause();await ui("document.querySelector('[data-assign-all]').click()");await pause();
 assert.deepEqual(await ui("[...document.querySelectorAll('[data-plan-for]')].map(e=>e.textContent)"),['→ JP02 Osaka','→ 新加坡 01','→ JP02 Osaka（共用）']);
 await ui("document.querySelector('#modal [data-action=confirm]').click()");await wait(()=>c.store.get(b.id).network.nodeName==='新加坡 01'&&c.store.get(a.id).network.nodeName==='JP02 Osaka'&&c.store.get(d.id).network.nodeName==='JP02 Osaka','cross-source assign');
 assert.deepEqual([a,b,d].map(x=>c.store.get(x.id).network.nodeName),['JP02 Osaka','新加坡 01','JP02 Osaka']);
 ok('All sources view merges nodes with a source mark and works across subscriptions');
}catch(e){errors.push(e.stack||String(e));console.error(e);}finally{try{await c?.closeAll();}catch(e){errors.push(e.message);}win?.destroy();proxy?.close();const report={platform:process.platform,electron:process.versions.electron,passed:results.length,results,errors};const reportPath=process.env.PROXY_HISTORY_OUTPUT?path.join(process.env.PROXY_HISTORY_OUTPUT,'result.json'):path.join(__dirname,`proxy-advanced-${process.platform}.json`);fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));app.exit(errors.length?1:0);}});
