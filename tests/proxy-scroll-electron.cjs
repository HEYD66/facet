'use strict';
// Real renderer, IPC, persistent library and Mihomo; upstream traffic stays on loopback.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=process.env.FACET_SCROLL_ROOT;if(!root)throw Error('Use proxy-scroll-runner.cjs');
app.setPath('userData',root);app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-background-networking');
const {Controller}=require('../src/main/controller.cjs'),{installIPC}=require('../src/main/ipc.cjs'),{TARGETS}=require('../src/main/diagnostics.cjs');
const sockets=new Set(),passes=[];let c,win,dispose,server,error;
const wait=async(fn,label)=>{for(let i=0;i<700;i++){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('Timeout: '+label);};
const pass=label=>{passes.push(label);console.log('PASS '+label);};
setTimeout(()=>app.exit(2),120000).unref();
app.whenReady().then(async()=>{try{
 const respond=(url,res)=>{const body=url.includes('/ip')?JSON.stringify({success:true,ip:'203.0.113.18',country:'Japan',country_code:'JP',timezone:{id:'Asia/Tokyo'}}):'ip=203.0.113.18\n';setTimeout(()=>res.end(body),80);};
 server=http.createServer((req,res)=>respond(req.url,res));
 server.on('connect',(_req,socket)=>{socket.on('error',()=>{});socket.write('HTTP/1.1 200 Connection established\r\n\r\n');let raw='';const receive=chunk=>{raw+=chunk.toString();if(!raw.includes('\r\n\r\n'))return;socket.removeListener('data',receive);respond(raw.split(' ')[1],{end(body){socket.end('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: '+Buffer.byteLength(body)+'\r\nConnection: close\r\n\r\n'+body);}});};socket.on('data',receive);});
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 TARGETS.latency='http://scroll-fixture.invalid/latency';TARGETS.ip='http://scroll-fixture.invalid/ip';
 win=new BrowserWindow({show:false,width:1400,height:800,webPreferences:{preload:path.resolve('src/main/preload.cjs'),sandbox:true,nodeIntegration:false,contextIsolation:true}});
 c=new Controller(win,root,path.resolve('resources/mihomo/mihomo.exe'));dispose=installIPC(win,c);await win.loadFile(path.resolve('src/renderer/index.html'));
 const ui=code=>win.webContents.executeJavaScript(code);
 await wait(()=>ui('!!window.facet && state.instances.length>0'),'renderer');
 const nodes=Array.from({length:125},(_,i)=>({name:'JP scroll '+String(i).padStart(3,'0'),type:'http',server:'127.0.0.1',port:server.address().port}));
 const sourceId=await c.library.save({name:'滚动验证 A',text:JSON.stringify({proxies:nodes})});
 const otherId=await c.library.save({name:'滚动验证 B',text:JSON.stringify({proxies:nodes.slice(0,110).map(node=>({...node,name:node.name.replace('JP','HK')}))})});
 c.emit();await ui("route('proxies')");await wait(()=>ui('document.querySelectorAll("[data-library-node]").length===100'),'first node page');await new Promise(resolve=>setTimeout(resolve,150));
 const position=()=>ui('({outer:document.querySelector("#content").scrollTop,top:document.querySelector(".library-table").scrollTop,left:document.querySelector(".library-table").scrollLeft})');
 const assertPosition=async(expected,label)=>{await new Promise(resolve=>setTimeout(resolve,150));const actual=await position();for(const key of ['outer','top','left'])assert(Math.abs(actual[key]-expected[key])<=1,label+': '+JSON.stringify({expected,actual}));};
 const lower=async()=>{await ui(`document.querySelector('[data-library-node="${nodes[85].name}"]').closest('tr').scrollIntoView({block:'center'});document.querySelector('#content').scrollTop=document.querySelector('#content').scrollHeight`);const current=await position();assert(current.outer>0&&current.top>1000,JSON.stringify(current));return current;};
 const click=selector=>ui(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw Error('Missing action');element.focus({preventScroll:true});element.click();})()`);
 const confirm=async()=>{await wait(()=>ui('modal?.type==="library-confirm"'),'confirmation dialog');await click('#modal [data-action=confirm]');await wait(()=>ui('!modal'),'dialog closed');};
 let expected=await lower();
 // Rebuilding the same list used to reset its inner scrollTop to zero.
 await ui('render(true)');await assertPosition(expected,'same-view redraw');pass('Forced same-view redraw preserves both outer page and inner node-list positions');
 await click(`[data-library-node="${nodes[85].name}"]`);assert.equal(await ui('librarySelected.size'),1);
 await click(`[data-node="${nodes[85].name}"][data-lib=ip]`);await confirm();await wait(()=>!c.diagnostics.work&&[...c.diagnostics.results.values()].some(row=>row.name===nodes[85].name&&row.kind==='ip'&&row.ok),'real IP request');await assertPosition(expected,'single-node IP completion');assert.equal(await ui('document.querySelectorAll("[data-library-node]:checked").length'),1);c.diagnostics.history.flush();assert.equal(new (require('../src/main/diagnostic-history.cjs').DiagnosticHistory)(root).list().some(row=>row.name===nodes[85].name),true);pass('A real IP query, confirmation and persisted diagnostic result keep the lower node position and selection');
 await click(`[data-node="${nodes[85].name}"][data-lib=favorite]`);await wait(()=>c.workspace.data.nodes.some(row=>row.name===nodes[85].name),'favorite persisted');await assertPosition(expected,'favorite');pass('Favoriting a lower node preserves both scroll containers');
 for(const node of nodes.slice(86,88))await click(`[data-library-node="${node.name}"]`);
 await click('[data-lib=batch-latency]');await confirm();await wait(()=>!c.diagnostics.work&&c.diagnostics.lastJob?.kind==='latency','batch completes');assert.equal(c.diagnostics.lastJob.done,3);await assertPosition(expected,'batch completion');pass('A three-node real connectivity batch preserves the lower position through progress and final redraw');
 await click(`[data-node="${nodes[86].name}"][data-lib=delete-node]`);await confirm();assert(!c.library.summaries().find(source=>source.id===sourceId).nodes.some(node=>node.name===nodes[86].name));await assertPosition(expected,'delete completion');pass('Confirmed node removal persists and keeps the remaining list at its previous position');
 if(process.env.FACET_SCROLL_ARTIFACTS){fs.mkdirSync(process.env.FACET_SCROLL_ARTIFACTS,{recursive:true});win.show();await new Promise(resolve=>setTimeout(resolve,200));fs.writeFileSync(path.join(process.env.FACET_SCROLL_ARTIFACTS,'lower-node-after-operation.png'),(await win.webContents.capturePage()).toPNG());}
 await click('[data-lib=next]');assert.equal(await ui('document.querySelector(".library-table").scrollTop'),0);assert.equal(await ui('libraryPageIndex'),1);pass('Explicit pagination starts the new node page at its top');
 await ui(`document.querySelector('#librarySource').value=${JSON.stringify(otherId)};document.querySelector('#librarySource').dispatchEvent(new Event('change',{bubbles:true}))`);assert.equal(await ui('libraryPageIndex'),0);assert.equal(await ui('document.querySelector(".library-table").scrollTop'),0);assert((await ui('document.querySelector(".node-name").textContent')).startsWith('HK'));pass('Changing the source opens the requested source at the first page and does not reuse another source scroll');
 await c.closeAll();assert.equal(c.diagnostics.cores.size,0);assert([...c.runtimes.values()].every(runtime=>!runtime.core?.child));pass('All proxy processes owned by this test are reclaimed');
}catch(caught){error=caught;console.error(caught.stack);}finally{
 try{await c?.closeAll();}catch(caught){error=error||caught;}dispose?.();if(win&&!win.isDestroyed())win.destroy();for(const socket of sockets)socket.destroy();if(server)await new Promise(resolve=>server.close(resolve));
 if(process.env.FACET_SCROLL_ARTIFACTS){fs.mkdirSync(process.env.FACET_SCROLL_ARTIFACTS,{recursive:true});fs.writeFileSync(path.join(process.env.FACET_SCROLL_ARTIFACTS,'result.json'),JSON.stringify({passes,error:error?.stack||null},null,2));}app.exit(error?1:0);
}});
