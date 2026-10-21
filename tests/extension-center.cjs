'use strict';
// Extension center + address-bar extension icons. Real Chromium controls, self-contained simulated IPC (no main-process modules).
// Optional env: PW_CHROMIUM=<chromium executable>, RENDERER_DIR=<dir containing index.html>.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const rendererDir=process.env.RENDERER_DIR||path.resolve(__dirname,'../src/renderer');
const pageURL='file://'+path.join(rendererDir,'index.html').replace(/\\/g,'/').replace(/^\/?/,'/');
const ICON='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGPQqDjxnxLMMGrAqAGjBgwXAwAasGcfZXRQWAAAAABJRU5ErkJggg==';

function fixture({extra=0}={}){
 const instances=[['inst-1','主工作区','running'],['inst-2','2','stopped'],['inst-3','实例 1','stopped']].map(([id,name,status])=>({id,name,status,url:'https://example.test/',currentURL:'https://example.test/',network:{mode:'direct',nodeName:''},environment:{language:'zh-CN',timezone:'Asia/Tokyo'},nodes:[],logs:[],assignment:{status:'未关联来源'},pageState:'未打开网页',error:''}));
 const ext=(id,name,icon,enabled,{loaded=[],error={},entries={popup:'popup.html',options:'options.html'}}={})=>({id,name,icon,version:'1.8.0',manifestVersion:3,bytes:529408,permissions:['storage'],optionalPermissions:[],matches:['https://arena.ai/*'],entries,warnings:['Electron仅支持部分扩展API；已加载不代表功能全部兼容。'],compatibilityNotice:'',description:name+' 的描述：在网页上提供辅助功能。',source:'D:\\ext\\'+id,chromeId:loaded.length?'abcdefghijklmnopabcdefghijklmnop':'',files:12,importedAt:'2026-09-28T01:02:03.000Z',
  instances:instances.map(x=>({id:x.id,enabled:enabled.includes(x.id),loaded:loaded.includes(x.id),error:error[x.id]||''}))});
 const extensions=[ext('ext-a','Arena 模型抽卡助手',ICON,['inst-1','inst-3'],{loaded:['inst-1']}),ext('ext-b','Arena 对话导出',null,['inst-1','inst-3'],{loaded:['inst-1'],entries:{popup:'popup.html'}}),ext('ext-c','Unused Tool',null,[],{})];
 for(let i=0;i<extra;i++)extensions.push(ext('ext-x'+i,'Extra '+i,i%2?ICON:null,['inst-1'],{loaded:['inst-1']}));
 return {versions:{app:'test'},coreInstalled:true,quickLinks:[],favorites:{ips:[],nodes:[]},library:[],events:[],diagnostics:{job:null,lastJob:null,results:[]},extensions,instances};
}
async function openApp(browser,{size=[1440,960],data=fixture()}={}){
 const context=await browser.newContext({viewport:{width:size[0],height:size[1]}}),page=await context.newPage(),errors=[],calls=[];let snap=data;
 page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('__extRequest',async(action,m={})=>{calls.push({action,...m});switch(action){case 'snapshot':return {ok:true,value:snap};case 'activate':case 'layout':case 'extension-open':case 'extension-import':case 'extension-reveal':return {ok:true};case 'extension-refresh-all':return {ok:true,value:{updated:[{name:'Arena 对话导出',from:'1.8.0',version:'1.9.0'}],unchanged:[],noSource:[],failed:[],stopped:['主工作区'],restarted:['主工作区'],restartFailed:[]}};
  case 'extension-configure':{await new Promise(r=>setTimeout(r,30));const instance=snap.instances.find(x=>x.id===m.id),running=instance.status==='running';snap={...snap,extensions:snap.extensions.map(e=>e.id!==m.extensionId?e:{...e,instances:e.instances.map(i=>i.id===m.id?{...i,enabled:m.enabled,loaded:running&&m.enabled}:i)})};return {ok:true,value:{changed:true,restarted:running?[instance.name]:[],restartFailed:[]}};}
  case 'extension-remove':snap={...snap,extensions:snap.extensions.filter(e=>e.id!==m.extensionId)};return {ok:true};
  default:return {ok:false,error:'Unmocked action '+action};}});
 await page.addInitScript(()=>{window.facet={request:(a,p)=>window.__extRequest(a,p),onState:fn=>window.__stateListener=fn,onExternalFocus:()=>{}};});
 await page.goto(pageURL);await page.waitForSelector('#sidebar .nav');return {context,page,errors,calls};
}
const go=(page,v,id)=>page.evaluate(async([v,id])=>{await route(v,id);},[v,id]);
async function readability(page){return page.evaluate(()=>{
 const parse=c=>{const m=c.match(/rgba?\(([^)]+)\)/);if(!m)return null;const p=m[1].split(/[ ,/]+/).filter(Boolean).map(Number);return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};};
 const lum=({r,g,b})=>{const f=v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4;};return .2126*f(r)+.7152*f(g)+.0722*f(b);};
 const blend=(t,b)=>({r:t.r*t.a+b.r*(1-t.a),g:t.g*t.a+b.g*(1-t.a),b:t.b*t.a+b.b*(1-t.a),a:1});
 const bgOf=el=>{const layers=[];for(let n=el;n&&n.nodeType===1;n=n.parentElement){const c=parse(getComputedStyle(n).backgroundColor);if(c&&c.a>0){layers.push(c);if(c.a>=1)break;}}let base={r:255,g:255,b:255,a:1};for(const c of layers.reverse())base=blend(c,base);return base;};
 const out=[],seen=new Set(),w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
 while(w.nextNode()){const t=w.currentNode;if(!t.textContent.trim())continue;const el=t.parentElement;if(!el||seen.has(el))continue;seen.add(el);if(el.closest('[hidden],[aria-hidden="true"],option,script,style,svg,button:disabled'))continue;const r=el.getBoundingClientRect(),cs=getComputedStyle(el);if(!r.width||!r.height||cs.visibility==='hidden'||r.top>innerHeight||r.bottom<0)continue;
  const size=parseFloat(cs.fontSize),label=(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\s+/).join('.'):el.tagName)+' "'+t.textContent.trim().slice(0,20)+'"';if(size<11)out.push(label+' '+size+'px');
  const fg=parse(cs.color);let op=1;for(let n=el;n&&n.nodeType===1;n=n.parentElement)op*=Number(getComputedStyle(n).opacity);const bg=bgOf(el),f=blend({...fg,a:fg.a*op},bg),ratio=(Math.max(lum(f),lum(bg))+.05)/(Math.min(lum(f),lum(bg))+.05);if(ratio<4.5)out.push(label+' '+ratio.toFixed(2));}
 return out;});}

(async()=>{const browser=await chromium.launch({headless:true,args:['--no-sandbox'],executablePath:process.env.PW_CHROMIUM||undefined});const results=[],ok=n=>{results.push(n);console.log('PASS',n);};let cur;
try{
 cur=await openApp(browser);let {page,errors,calls}=cur;const lastLayout=()=>[...calls].reverse().find(c=>c.action==='layout');
 // Address bar icons.
 assert.equal(await page.locator('.extension-toolbar').count(),0,'no separate extension row');
 const toggleLook=()=>page.locator('#sidebar [data-action="toggle"]').evaluate(b=>{const cs=getComputedStyle(b);return {text:b.innerText.trim(),cls:b.className,bg:cs.backgroundColor,color:cs.color};});
 const stop=await toggleLook();assert.match(stop.text,/停止当前实例/);assert.match(stop.cls,/danger/);assert.equal(stop.color,'rgb(255, 255, 255)');assert.notEqual(stop.bg,'rgba(0, 0, 0, 0)','stop is a filled button like start');
 await page.evaluate(()=>{document.documentElement.dataset.theme='dark';});await page.waitForTimeout(450);const stopDark=await toggleLook();assert.equal(stopDark.color,'rgb(255, 255, 255)');assert.notEqual(stopDark.bg,'rgba(0, 0, 0, 0)');await page.evaluate(()=>{document.documentElement.dataset.theme='light';});await page.waitForTimeout(450);
 assert.equal(await page.locator('#addressForm .ext-toolbar .ext-tool[data-extension="open"]').count(),2);
 assert.match(await page.locator('.ext-tool[data-extension-id="ext-a"] img').getAttribute('src'),/^data:image\/png;base64,/);
 assert.equal(await page.locator('.ext-tool[data-extension-id="ext-b"] .ext-letter').innerText(),'A');
 assert.equal(await page.locator('.ext-tool.idle').count(),0);
 const geo=await page.evaluate(()=>{const row=document.querySelector('#addressForm').getBoundingClientRect(),bar=document.querySelector('.ext-toolbar').getBoundingClientRect(),addr=document.querySelector('.address-input').getBoundingClientRect();return {inside:bar.right<=row.right+1&&bar.left>=addr.right,addr:addr.width,row:row.width};});
 assert(geo.inside,'toolbar sits right of the address field inside the row');assert(geo.addr<geo.row-120,'address field leaves room for extensions');
 await page.locator('.ext-tool[data-extension-id="ext-a"]').click();await page.waitForTimeout(50);
 assert.deepEqual(calls.filter(c=>c.action==='extension-open').map(({id,extensionId,kind})=>({id,extensionId,kind})),[{id:'inst-1',extensionId:'ext-a',kind:'popup'}]);
 await go(page,'browser','inst-3');assert.equal(await page.locator('.ext-tool.idle').count(),2);await page.locator('.ext-tool[data-extension-id="ext-a"]').click();
 assert.match(await page.locator('#toast').innerText(),/请先启动「实例 1」/);assert.equal(calls.filter(c=>c.action==='extension-open').length,1);
 await go(page,'browser','inst-2');assert.equal(await page.locator('.ext-tool[data-extension="open"]').count(),0);assert.equal(await page.locator('.ext-puzzle').count(),1);
 ok('Extensions live in the address row: real icon or letter, grey until started, click opens the panel directly');
 // Puzzle menu.
 await go(page,'browser','inst-1');await page.locator('.ext-puzzle').click();await page.waitForSelector('#extensionMenu[open]');
 assert.equal(lastLayout().bounds,null,'web view steps aside while the menu is open');
 assert.equal(await page.locator('#extensionMenu li').count(),2);assert.match(await page.locator('#extensionMenu footer').innerText(),/另有 1 个扩展[\s\S]*扩展中心/);
 await page.locator('#extensionMenu [data-extension-id="ext-a"][data-kind="options"]').click();await page.waitForTimeout(50);
 assert.equal(calls.filter(c=>c.action==='extension-open').at(-1).kind,'options');assert.equal(await page.locator('#extensionMenu[open]').count(),0);
 await page.locator('.ext-puzzle').click();await page.waitForSelector('#extensionMenu[open]');await page.evaluate(()=>window.__stateListener?.(state));await page.evaluate(()=>render());assert.equal(await page.locator('#extensionMenu[open]').count(),1,'menu survives re-render');
 await page.keyboard.press('Escape');assert.equal(await page.locator('#extensionMenu[open]').count(),0);assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('ext-puzzle')),true);assert.notEqual(lastLayout().bounds,null);
 await page.locator('.ext-puzzle').click();await page.locator('#extensionMenu [data-view="extensions"]').click();await page.waitForFunction(()=>view==='extensions');assert.equal(await page.locator('#extensionMenu[open]').count(),0);
 ok('Puzzle menu: panels and settings per extension, survives re-render, Esc returns focus, links to the extension center');
 // Extension center: Chrome-style grid.
 assert.match(await page.locator('#workspaceHead h1').innerText(),/扩展中心/);assert.match(await page.locator('#sidebar [data-view="extensions"]').innerText(),/扩展中心/);
 assert.equal(await page.locator('.ext-grid .ext-card').count(),3);assert.equal(await page.locator('.ext-card .ext-chip').count(),0,'instance toggles live in the pop-over');
 const cardA=page.locator('[data-extension-card="ext-a"]');
 assert.match(await cardA.locator('.ext-desc').innerText(),/描述/);assert.match(await cardA.locator('.ext-source').innerText(),/D:\\ext\\ext-a/);assert.match(await cardA.locator('.ext-enable').innerText(),/启用于 2\/3/);
 for(const sel of ['[data-extension="detail"]','[data-extension="remove"]','[data-extension="refresh"]','[data-extension="enable-menu"]'])assert.equal(await cardA.locator('.ext-card-foot '+sel).count()>=1,true,sel);
 await page.locator('#extSearch').fill('导出');assert.equal(await page.locator('.ext-grid .ext-card').count(),1);assert.equal(await page.evaluate(()=>document.activeElement.id),'extSearch','typing keeps focus');await page.evaluate(()=>render());assert.equal(await page.evaluate(()=>document.activeElement.id),'extSearch','re-render keeps focus');
 await page.locator('#extSearch').fill('nothing-matches');assert.match(await page.locator('.ext-grid').innerText(),/没有匹配/);await page.locator('#extSearch').fill('');assert.equal(await page.locator('.ext-grid .ext-card').count(),3);
 ok('Chrome-style grid: icon, name, version, description, ID and source; search filters without losing focus');
 await cardA.locator('[data-extension="enable-menu"]').click();assert.equal(await cardA.locator('.ext-pop .ext-chip').count(),3);assert.equal(await cardA.locator('[data-extension="enable-menu"]').getAttribute('aria-expanded'),'true');
 await cardA.locator('[data-extension="select-all"]').click();assert.equal(await cardA.locator('.ext-pop .ext-chip[aria-pressed=true]').count(),3);assert.equal(calls.filter(c=>c.action==='extension-configure').length,0);await cardA.locator('[data-extension="select-none"]').click();assert.equal(await cardA.locator('.ext-pop .ext-chip[aria-pressed=true]').count(),0);await cardA.locator('[data-extension="cancel"]').click();assert.equal(await cardA.locator('.ext-pop .ext-chip[aria-pressed=true]').count(),2);
 await cardA.locator('.ext-chip[data-instance-id="inst-2"]').click();await cardA.locator('.ext-chip[data-instance-id="inst-1"]').click();
 assert.match(await cardA.locator('.ext-pop .ext-pending').innerText(),/将启用：2；将停用：主工作区[\s\S]*会重启运行中的 主工作区/);assert.match(await cardA.locator('.ext-enable').innerText(),/待应用 2/);
 assert.equal(await page.evaluate(()=>document.activeElement.dataset.instanceId),'inst-1','focus stays on the toggled instance');
 await cardA.locator('[data-extension="cancel"]').click();assert.equal(await cardA.locator('.ext-pending').count(),0);assert.equal(calls.filter(c=>c.action==='extension-configure').length,0);assert.equal(await cardA.locator('.ext-pop').count(),1,'cancel keeps the pop-over open');
 await cardA.locator('.ext-chip[data-instance-id="inst-2"]').click();await cardA.locator('.ext-chip[data-instance-id="inst-2"]').click();assert.equal(await cardA.locator('.ext-pending').count(),0,'toggling back clears the change');
 await page.keyboard.press('Escape');assert.equal(await cardA.locator('.ext-pop').count(),0);assert.equal(await page.evaluate(()=>document.activeElement.dataset.extension),'enable-menu','Esc returns focus');
 await cardA.locator('[data-extension="enable-menu"]').click();await page.mouse.click(5,5);assert.equal(await cardA.locator('.ext-pop').count(),0,'outside click closes');
 await cardA.locator('[data-extension="enable-menu"]').click();await cardA.locator('.ext-chip[data-instance-id="inst-2"]').click();await cardA.locator('.ext-chip[data-instance-id="inst-1"]').click();await cardA.locator('[data-extension="confirm"]').click();
 await page.waitForFunction(()=>!extensionBusy);
 assert.deepEqual(calls.filter(c=>c.action==='extension-configure').map(({id,extensionId,enabled,confirmed})=>({id,extensionId,enabled,confirmed})),[{id:'inst-2',extensionId:'ext-a',enabled:true,confirmed:true},{id:'inst-1',extensionId:'ext-a',enabled:false,confirmed:true}]);
 assert.match(await page.locator('#toast').innerText(),/已保存.*已恢复运行：主工作区/);assert.equal(await cardA.locator('.ext-pop').count(),0,'pop-over closes after applying');assert.match(await cardA.locator('.ext-enable').innerText(),/启用于 2\/3/);
 ok('「启用于」pop-over: tick instances, one confirmation lists what gets restarted, cancel/Esc/outside click are free');
 // Detail page: the running instance remains available after applying.
 await page.evaluate(()=>{state.instances.find(x=>x.id==='inst-1').status='running';render(true);});
 await page.locator('[data-extension-card="ext-b"] [data-extension="detail"]').first().click();await page.waitForSelector('.ext-detail');
 assert.equal(await page.locator('.ext-grid').count(),0);assert.equal(await page.locator('.ext-detail .ext-inst-row').count(),3);assert.match(await page.locator('.ext-detail').innerText(),/abcdefghijklmnop[\s\S]*D:\\ext\\ext-b[\s\S]*storage[\s\S]*https:\/\/arena\.ai\/\*/);
 assert.equal(await page.locator('.ext-detail [data-extension="open"][data-instance-id="inst-1"][data-kind="popup"]').count(),1);await page.locator('.ext-detail [data-extension="open"][data-kind="popup"]').click();await page.waitForTimeout(50);assert.equal(calls.filter(c=>c.action==='extension-open').at(-1).extensionId,'ext-b');
 await page.locator('.ext-detail [data-extension="reveal"]').click();await page.waitForTimeout(50);assert(calls.some(c=>c.action==='extension-reveal'&&c.extensionId==='ext-b'));
 await page.locator('.ext-detail .ext-chip[data-instance-id="inst-2"]').click();assert.match(await page.locator('.ext-detail .ext-pending').innerText(),/将启用：2/);await page.locator('.ext-detail [data-extension="cancel"]').click();
 await page.evaluate(()=>render());assert.equal(await page.locator('.ext-detail').count(),1,'detail survives state updates');
 await page.locator('[data-extension="back"]').click();assert.equal(await page.locator('.ext-grid .ext-card').count(),3);assert.equal(await page.evaluate(()=>document.activeElement.dataset.extensionId),'ext-b','back returns focus to the card');
 await page.locator('[data-extension-card="ext-b"] [data-extension="detail"]').first().click();await go(page,'extensions');assert.equal(await page.locator('.ext-detail').count(),0,'navigating to the center shows the list');
 ok('Detail page: instances with enable state and panel/settings, ID, source folder, permissions; back returns to the grid');
 await page.locator('[data-extension="refresh-all"]').click();await page.waitForFunction(()=>!extensionBusy);assert(calls.some(c=>c.action==='extension-refresh-all'));assert.match(await page.locator('#toast').innerText(),/已更新 Arena 对话导出 1\.8\.0 → 1\.9\.0[\s\S]*已重启 主工作区/);
 assert.equal(await page.locator('[data-extension-card="ext-b"] [data-extension="remove"]').isDisabled(),false);await page.locator('[data-extension-card="ext-b"] [data-extension="remove"]').click();assert.match(await page.locator('[data-extension-card="ext-b"] .ext-pending').innerText(),/会停止.*正在运行.*不会删除/);await page.locator('[data-extension-card="ext-b"] [data-extension="cancel"]').click();
 await page.locator('[data-extension-card="ext-c"] [data-extension="remove"]').click();await page.locator('[data-extension-card="ext-c"] [data-extension="confirm"]').click();await page.waitForFunction(()=>!state.extensions.some(e=>e.id==='ext-c'));
 assert(calls.some(c=>c.action==='extension-remove'&&c.extensionId==='ext-c'));
 await page.locator('[data-extension="import"]').click();await page.waitForTimeout(50);assert(calls.some(c=>c.action==='extension-import'));
 ok('全部更新 reports versions and restarted instances; used extensions offer removal with affected-instance confirmation; import unchanged');
 // Readability, both themes, center + toolbar + menu.
 const audit=[];for(const theme of ['light','dark']){await page.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);await page.waitForTimeout(450);await go(page,'extensions');await page.locator('[data-extension-card="ext-b"] [data-extension="enable-menu"]').click();await page.locator('[data-extension-card="ext-b"] [data-instance-id="inst-2"]').click();audit.push(...(await readability(page)).map(x=>theme+'/center '+x));await page.locator('[data-extension-card="ext-b"] [data-extension="cancel"]').click();await page.keyboard.press('Escape');
  await page.locator('[data-extension-card="ext-a"] [data-extension="detail"]').first().click();audit.push(...(await readability(page)).map(x=>theme+'/detail '+x));await page.locator('[data-extension="back"]').click();
  await go(page,'browser','inst-1');await page.locator('.ext-puzzle').click();audit.push(...(await readability(page)).map(x=>theme+'/menu '+x));await page.keyboard.press('Escape');}
 assert.deepEqual(audit,[]);await page.evaluate(()=>{document.documentElement.dataset.theme='light';});
 ok('Extension center, toolbar and menu: text >= 11px and >= 4.5:1 in day and night');
 await go(page,'extensions');assert.equal(await page.locator('#sidebar [data-view="browser"]').count(),1);assert.equal(await page.locator('#sidebar .back-to-instance').count(),0);assert.deepEqual(await page.locator('#sidebar .nav.active').evaluateAll(n=>n.map(x=>x.dataset.view)),['extensions']);
 const running=await page.locator('#sidebar [data-action="toggle"]').evaluate(b=>({text:b.innerText.trim(),cls:b.className}));assert.match(running.text,/停止当前实例/);assert.match(running.cls,/danger/);
 ok('Global pages keep the same sidebar; 停止当前实例 is a filled button as prominent as 启动');
 assert.deepEqual(errors,[]);await cur.context.close();
 for(const size of [[1024,768],[1280,800],[1440,960]]){cur=await openApp(browser,{size,data:fixture({extra:6})});({page,errors}=cur);
  const row=await page.evaluate(()=>{const f=document.querySelector('#addressForm');return {over:f.scrollWidth-f.clientWidth,addr:document.querySelector('.address-input').getBoundingClientRect().width};});assert(row.over<=1,`${size}: address row overflows`);assert(row.addr>=100,`${size}: address field too small ${row.addr}`);
  await go(page,'extensions');const o=await page.evaluate(()=>document.querySelector('#content').scrollWidth-document.querySelector('#content').clientWidth);assert(o<=1,`${size}: center overflows`);
  assert.deepEqual(errors,[]);await cur.context.close();}
 ok('1024×768, 1280×800, 1440×960 with 8 enabled extensions: no overflow, address field stays usable');
 fs.writeFileSync(path.join(__dirname,'extension-center-results.json'),JSON.stringify({platform:process.platform,backend:'simulated IPC (self-contained)',passed:results.length,results},null,2)+'\n');console.log('All extension center tests passed:',results.length);
}catch(e){if(cur?.page)await cur.page.screenshot({path:path.join(__dirname,'extension-center-failure.png')}).catch(()=>{});console.error('Page errors',cur?.errors);throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
