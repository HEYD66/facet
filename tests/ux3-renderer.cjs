'use strict';
// UX batch 3 renderer regression: navigation de-duplication, text size/contrast, remembered state and keyboard use.
// Actual Chromium controls with a self-contained simulated IPC bridge (no main-process modules, no network, no real instances).
// Optional env: PW_CHROMIUM=<chromium executable>, RENDERER_DIR=<dir containing index.html>.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const rendererDir=process.env.RENDERER_DIR||path.resolve(__dirname,'../src/renderer');
const pageURL='file://'+path.join(rendererDir,'index.html').replace(/\\/g,'/').replace(/^\/?/,'/');
const LONG='超长实例名称用于检查截断与布局稳定性——Research Workspace Alpha Beta Gamma Delta Epsilon 0123456789';
const SIZES=[[1024,768],[1280,800],[1440,960]];
const VIEWS=['browser','environment','logs','overview','proxies','global-logs','extensions','global','settings'];

function fixture({instances=15,nodes=43}={}){
 const nodeNames=Array.from({length:nodes},(_,i)=>`Node ${String(i+1).padStart(2,'0')} · ${['HK','JP','SG','US'][i%4]} ${i%7===0?'带有较长备注的节点名称':''}`.trim());
 const statuses=['running','stopped','error','starting','stopped'];
 const list=Array.from({length:instances},(_,i)=>({id:'inst-'+(i+1),name:i===1?LONG:`工作实例 ${i+1}`,url:'https://example.test/',status:i===0?'running':statuses[i%statuses.length],
  network:i===0||i%3?{mode:'direct',nodeName:''}:{mode:'mihomo',nodeName:nodeNames[0]},environment:{language:'zh-CN',timezone:'Asia/Tokyo'},
  nodes:i===0?[]:i===3?nodeNames:[],logs:[{at:new Date(0).toISOString(),level:'INFO',text:'合成日志'}],assignment:{status:'未关联来源'},pageState:'未打开网页',error:i%5===2?'合成启动故障':'',currentURL:'https://example.test/'}));
 const endedAt=new Date(0).toISOString();
 return {versions:{app:'test',electron:'simulated IPC'},coreInstalled:true,activeId:null,creationProgress:null,quickLinks:[],extensions:[],favorites:{ips:[],nodes:[]},
  library:nodes?[{id:'src-1',name:'合成订阅 · '+LONG,host:'sub.example.test',updatedAt:endedAt,subscription:true,excludedCount:0,nodes:nodeNames.map((name,i)=>({name,type:['http','vmess','trojan','ss'][i%4],hint:false}))}]:[],
  diagnostics:{job:null,lastJob:{id:'task-1',kind:'latency',total:4,cancelled:true,endedAt,items:nodeNames.slice(0,4).map((name,i)=>({sourceId:'src-1',name,state:['success','failed','cancelled','cancelled'][i]}))},
   results:nodeNames.slice(0,2).map((name,i)=>({sourceId:'src-1',name,taskId:'task-1',kind:'latency',at:endedAt,ok:i===0,latencyMs:12,error:i?'检测目标无法完成请求':''}))},
  events:[{id:'e1',at:endedAt,level:'ERROR',scope:'diagnostic',text:'检测失败：检测目标无法完成请求',sourceId:'src-1',taskId:'task-1'},{id:'e2',at:endedAt,level:'WARN',scope:'diagnostic',text:'检测已取消',sourceId:'src-1',taskId:'task-1'},{id:'e3',at:endedAt,level:'INFO',scope:'instance',text:'实例已停止',instanceId:'inst-1'}],
  instances:list};
}

async function openApp(browser,{size=[1440,960],data=fixture(),storage=null}={}){
 const context=await browser.newContext({viewport:{width:size[0],height:size[1]}});const page=await context.newPage();const errors=[],calls=[];let snap=data;
 page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('__ux3Request',async(action,m={})=>{calls.push({action,...m});switch(action){case 'snapshot':return {ok:true,value:snap};case 'activate':case 'layout':return {ok:true};
  case 'update-status':return {ok:true,value:{supported:false,status:'unsupported',currentVersion:'test',error:'源码运行请更新项目代码'}};
  case 'stop':snap={...snap,instances:snap.instances.map(x=>x.id===m.id?{...x,status:'stopped'}:x)};return {ok:true};
  case 'settings':await new Promise(r=>setTimeout(r,40));snap={...snap,instances:snap.instances.map(x=>x.id===m.id?{...x,...m.patch,status:'stopped'}:x)};return {ok:true,value:{changed:true}};
  case 'environment-timezone':return {ok:true,value:{timezone:'Asia/Tokyo'}};case 'tab-activate':case 'tab-new':case 'tab-close':{snap={...snap,instances:snap.instances.map(x=>{if(x.id!==m.id)return x;let tabs=(x.tabs||[]).map(t=>({...t}));if(action==='tab-new')tabs=[...tabs.map(t=>({...t,active:false})),{id:'tab-new-'+(tabs.length+1),title:'',url:'about:blank',active:true}];else if(action==='tab-close'){tabs=tabs.filter(t=>t.id!==m.tabId);if(tabs.length&&!tabs.some(t=>t.active))tabs[tabs.length-1].active=true;}else tabs=tabs.map(t=>({...t,active:t.id===m.tabId}));return {...x,tabs,activeTabId:tabs.find(t=>t.active)?.id||null};})};return {ok:true};}default:return {ok:false,error:'Unmocked action '+action};}});
 await page.addInitScript(saved=>{if(saved!==null&&!sessionStorage.getItem('ux3-seeded')){localStorage.setItem('arena.ui.state.v1',saved);sessionStorage.setItem('ux3-seeded','1');}window.facet={request:(a,p)=>window.__ux3Request(a,p),onState:fn=>{(window.__stateListeners||=[]).push(fn);window.__stateListener=s=>window.__stateListeners.forEach(l=>l(s));return ()=>{};},onExternalFocus:()=>()=>{},onPageFind:()=>()=>{}};},storage);
 await page.goto(pageURL);await page.waitForSelector('#sidebar .nav');
 return {context,page,errors,calls};
}
const go=(page,v)=>page.evaluate(async v=>{await route(v);},v);
const settle=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));

// Visible text audit: minimum computed size and WCAG contrast against the effective background.
async function readability(page){return page.evaluate(()=>{
 const parse=c=>{const m=c.match(/rgba?\(([^)]+)\)/);if(!m)return null;const p=m[1].split(/[ ,/]+/).filter(Boolean).map(Number);return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};};
 const lum=({r,g,b})=>{const f=v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4;};return .2126*f(r)+.7152*f(g)+.0722*f(b);};
 const blend=(top,bottom)=>({r:top.r*top.a+bottom.r*(1-top.a),g:top.g*top.a+bottom.g*(1-top.a),b:top.b*top.a+bottom.b*(1-top.a),a:1});
 const background=el=>{const layers=[];for(let n=el;n&&n.nodeType===1;n=n.parentElement){const c=parse(getComputedStyle(n).backgroundColor);if(c&&c.a>0){layers.push(c);if(c.a>=1)break;}}let base={r:255,g:255,b:255,a:1};for(const c of layers.reverse())base=blend(c,base);return base;};
 const small=[],low=[];let min=99,count=0;
 const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
 const seen=new Set();
 while(walker.nextNode()){const t=walker.currentNode;if(!t.textContent.trim())continue;const el=t.parentElement;if(!el||seen.has(el))continue;seen.add(el);
  if(el.closest('[hidden],[aria-hidden="true"],option,script,style,.modal-backdrop[hidden],svg'))continue;
  const r=el.getBoundingClientRect(),cs=getComputedStyle(el);if(!r.width||!r.height||cs.visibility==='hidden'||Number(cs.opacity)===0)continue;
  if(r.bottom<0||r.right<0||r.top>innerHeight||r.left>innerWidth)continue;
  if(el.closest('button:disabled,input:disabled,select:disabled,[aria-disabled="true"],fieldset:disabled'))continue;
  count++;const size=parseFloat(cs.fontSize);min=Math.min(min,size);const label=(el.id?'#'+el.id:el.tagName.toLowerCase()+(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\s+/).join('.'):''))+' "'+t.textContent.trim().slice(0,24)+'"';
  if(size<11)small.push(label+' '+size+'px');
  const fg=parse(cs.color);if(!fg)continue;let opacity=1;for(let n=el;n&&n.nodeType===1;n=n.parentElement)opacity*=Number(getComputedStyle(n).opacity);
  const bg=background(el),f=blend({...fg,a:fg.a*opacity},bg);const ratio=(Math.max(lum(f),lum(bg))+.05)/(Math.min(lum(f),lum(bg))+.05);
  const large=size>=24||size>=18.66&&Number(cs.fontWeight)>=700;if(ratio<(large?3:4.5))low.push(label+' '+ratio.toFixed(2)+' '+cs.color+' on rgb('+[bg.r,bg.g,bg.b].map(Math.round)+')');}
 return {min,count,small,low};});}

(async()=>{const browser=await chromium.launch({headless:true,args:['--no-sandbox'],executablePath:process.env.PW_CHROMIUM||undefined});const results=[];const ok=name=>{results.push(name);console.log('PASS',name);};let current;
try{
 // A. Navigation de-duplication.
 current=await openApp(browser);let {page,errors}=current;
 assert.equal(await page.locator('#manageTop').count(),0);assert.equal(await page.locator('.notice').count(),0);
 assert.match(await page.locator('#footerCore').textContent(),/内置 Mihomo · 已就绪/);assert.match(await page.locator('.footer-right').textContent(),/test/);
 const body=await page.locator('body').innerText();assert.doesNotMatch(body,/GLOBAL|INSTANCE/);
 assert.equal(await page.locator('#sidebar [data-view="environment"]').count(),1);assert.match(await page.locator('#sidebar').textContent(),/本机 IP 直连/);
 await page.locator('#allTabs').click();await page.waitForFunction(()=>view==='overview');
 assert.equal(await page.locator('#sidebar [data-view="environment"]').count(),1,'sidebar keeps the instance section on global pages');assert.equal(await page.locator('#sidebar [data-action="toggle"]').count(),1);assert.equal(await page.locator('#sidebar .back-to-instance').count(),0);
 assert.deepEqual(await page.locator('#sidebar .nav.active').evaluateAll(n=>n.map(x=>x.dataset.view)),['overview']);assert.match(await page.locator('#sidebar [data-view="overview"]').innerText(),/实例管理/);
 await page.locator('#sidebar [data-view="browser"]').click();await page.waitForFunction(()=>view==='browser'&&activeId==='inst-1');
 ok('One management entry; the sidebar stays the same on global pages and only the right side and highlight change; footer is version + Mihomo only');

 // B. Size and contrast, every view, day and night.
 const audit=new Set();
 for(const theme of ['light','dark']){await page.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);await page.waitForTimeout(450);
  for(const v of VIEWS){await go(page,v);if(v==='environment')await page.evaluate(()=>{const d=document.querySelector('details.advanced-environment');if(d)d.open=true;});await settle(page);const r=await readability(page);
   assert(r.count>5,`${theme}/${v}: too little text audited`);for(const x of r.small)audit.add(`${theme}/${v} <11px: ${x}`);for(const x of r.low)audit.add(`${theme}/${v} <4.5:1: ${x}`);}}
 if(audit.size)fs.writeFileSync(path.join(__dirname,'ux3-audit.json'),JSON.stringify([...audit],null,1));assert.deepEqual([...audit],[],'readability audit (full list in tests/ux3-audit.json)');
 await page.evaluate(()=>{document.documentElement.dataset.theme='light';});
 ok('All visible text is >= 11px and >= 4.5:1 in day and night themes across all nine views');
 // B2. Optional palettes (应用信息 → 外观主题): choosing one switches mode, persists, and every palette stays readable.
 await page.click('#sidebar .nav[data-view="global"]');await settle(page);{const info=await page.locator('#content').textContent();assert(!info.includes('独立新项目')&&!info.includes('明确的边界')&&info.includes('免责声明')&&info.includes('自行承担')&&info.includes('github.com/HEYD66/facet')&&info.includes('点 Star'),'app info omits removed sections and retains GitHub support CTA and disclaimer');}
 await page.click('#sidebar .nav[data-view="settings"]');await settle(page);assert.match(await page.locator('#workspaceHead h1').textContent(),/^应用设置/);assert.equal((await page.locator('#sidebar .nav[data-view="settings"]').textContent()).trim(),'应用设置');assert.equal(await page.locator('#sidebar .nav.active').getAttribute('data-view'),'settings');const pals=await page.evaluate(()=>window.facetAppearance.palettes);assert.equal(await page.locator('.theme-card [data-palette-mode]').count(),pals.light.length+pals.dark.length);assert(pals.light.length>=8&&pals.dark.length>=8,'at least 8 day and 8 night palettes');
 await page.click('[data-palette-mode="dark"][data-palette="gold"]');
 assert.deepEqual(await page.evaluate(()=>({theme:document.documentElement.dataset.theme,dark:document.documentElement.dataset.darkPalette,stored:localStorage.getItem('arena.ui.palette.dark'),checked:document.querySelector('[data-palette-mode="dark"][data-palette="gold"]').getAttribute('aria-checked'),live:document.querySelector('[data-theme-row="dark"]').classList.contains('is-live')})),{theme:'dark',dark:'gold',stored:'gold',checked:'true',live:true});
 const audit2=new Set();
 for(const [theme,ids] of ['light','dark'].map(m=>[m,pals[m].map(p=>p.id).filter(i=>i!=='indigo')]))for(const id of ids){await page.evaluate(([t,i])=>{const r=document.documentElement;r.dataset.theme=t;r.dataset[t==='dark'?'darkPalette':'lightPalette']=i;},[theme,id]);await page.waitForTimeout(450);
  for(const v of ['environment','overview','proxies','settings']){await go(page,v);await settle(page);const r=await readability(page);for(const x of r.small)audit2.add(`${theme}:${id}/${v} <11px: ${x}`);for(const x of r.low)audit2.add(`${theme}:${id}/${v} <4.5:1: ${x}`);}}
 await page.evaluate(()=>{const r=document.documentElement;r.dataset.theme='light';r.dataset.lightPalette='indigo';r.dataset.darkPalette='indigo';localStorage.removeItem('arena.ui.palette.dark');localStorage.setItem('arena.ui.theme','light');});await page.waitForTimeout(450);
 assert.deepEqual([...audit2],[],'palette readability audit');
 ok('Theme picker switches and remembers palettes; every alternative palette (including tinted title bar/sidebar) keeps audited text >= 11px and >= 4.5:1');
 await go(page,'proxies');await settle(page);const rows=await page.$$eval('#content .compact-node-table tbody tr',rs=>rs.filter(r=>r.getClientRects().length).map(r=>Math.round(r.getBoundingClientRect().height)));
 assert(rows.length>=20,'node rows rendered: '+rows.length);assert(rows.every(h=>h<=64)&&Math.max(...rows)-Math.min(...rows)<=2,'compact two-line rows stay uniform and <=64px: '+rows.join(','));
 ok('43-node compact table keeps uniform two-line rows (<=64px) after the size increase');
 assert.deepEqual(errors,[]);await current.context.close();

 // C. Remembered state.
 current=await openApp(browser);({page,errors}=current);
 // The tab strip lists running instances only (runningTabs); inst-6 is running in the fixture.
 await page.locator('[data-close="inst-6"]').click();await page.waitForSelector('#modal [data-action="confirm"]');await page.locator('#modal [data-action="confirm"]').click();await page.waitForFunction(()=>!localOpen.has('inst-6'));
 await go(page,'overview');await page.locator('[data-filter="error"]').click();await page.locator('#instanceSearch').fill('实例');
 await go(page,'proxies');await page.selectOption('#librarySort','name');await page.selectOption('#libraryOnly','available');await page.selectOption('#libraryConcurrency','5');await page.locator('#libraryIncludeHints').check();
 await go(page,'global-logs');await page.selectOption('#globalLogLevel','ERROR');await page.selectOption('#globalLogScope','diagnostic');await page.selectOption('#globalLogSource','src-1');
 await page.evaluate(async()=>{await route('environment','inst-4');document.querySelector('details.advanced-environment').open=true;});await page.waitForTimeout(80);
 await go(page,'proxies');await page.waitForTimeout(260);
 const startCallsBefore=current.calls.filter(c=>c.action==='start').length;
 await page.reload();await page.waitForSelector('#sidebar .nav');
 const restored=await page.evaluate(()=>({view,activeId,open:[...localOpen],filter,search,librarySort,libraryOnly,libraryConcurrency,libraryIncludeHints,librarySource,globalLogLevel,globalLogScope,globalLogSource}));
 assert.equal(restored.view,'proxies');assert.equal(restored.activeId,'inst-4');assert(!restored.open.includes('inst-6'));assert.equal(restored.open.length,14);
 assert.deepEqual([restored.filter,restored.search,restored.librarySort,restored.libraryOnly,restored.libraryConcurrency,restored.libraryIncludeHints,restored.librarySource],['error','实例','name','available',5,true,'src-1']);
 assert.deepEqual([restored.globalLogLevel,restored.globalLogScope,restored.globalLogSource],['ERROR','diagnostic','src-1']);
 assert.equal(await page.locator('#librarySort').inputValue(),'name');assert.equal(current.calls.filter(c=>c.action==='start').length,startCallsBefore);
 await go(page,'environment');assert.equal(await page.locator('details.advanced-environment').evaluate(d=>d.open),true);
 ok('Tabs, active instance, page, filters, sort, concurrency and advanced section survive a restart; nothing is started');
 await go(page,'proxies');await page.evaluate(()=>{const c=document.querySelector('#content');c.scrollTop=Math.min(320,c.scrollHeight-c.clientHeight);});const top=await page.evaluate(()=>document.querySelector('#content').scrollTop);
 await go(page,'overview');await go(page,'proxies');await settle(page);assert(Math.abs(await page.evaluate(()=>document.querySelector('#content').scrollTop)-top)<=2,'scroll restored');
 ok('Scroll position is remembered per page within the run');
 const stoppedId=await page.evaluate(()=>state.instances.find(i=>i.status==='stopped').id);await page.evaluate(id=>{localOpen.add(id);render(true);},stoppedId);const stopsBefore=current.calls.filter(c=>c.action==='stop').length;
 // A stopped instance has no tab (the strip lists running instances only), so there is nothing to close or stop.
 assert.equal(await page.locator(`[data-close="${stoppedId}"]`).count(),0);assert.equal(await page.locator('#modalBackdrop').isHidden(),true);assert.equal(current.calls.filter(c=>c.action==='stop').length,stopsBefore);
 ok('A stopped instance shows no tab even when it was opened; nothing is stopped');
 assert.deepEqual(errors,[]);await current.context.close();
 current=await openApp(browser,{storage:JSON.stringify({v:1,view:'no-such-view',activeId:'gone',localOpen:['gone','inst-2'],filters:{librarySort:'evil',libraryConcurrency:99,librarySource:'gone',globalLogInstance:'gone',filter:'x',favoriteTab:'?'}})});({page,errors}=current);
 const stale=await page.evaluate(()=>({view,activeId,open:[...localOpen],librarySort,libraryConcurrency,librarySource,globalLogInstance,filter,favoriteTab}));
 // A stale saved active id keeps the startup default (the first instance; running in the fixture, so it has a tab).
 assert.deepEqual(stale,{view:'browser',activeId:'inst-1',open:['inst-2'],librarySort:'original',libraryConcurrency:3,librarySource:'',globalLogInstance:'all',filter:'all',favoriteTab:'ips'});
 await current.context.close();
 current=await openApp(browser,{storage:'{not json'});assert.equal(await current.page.evaluate(()=>view),'browser');assert.deepEqual(current.errors,[]);await current.context.close();
 // Since 28af9a7 tabs follow running instances: an instance page is restored whenever the instance still exists, whatever was open.
 current=await openApp(browser,{storage:JSON.stringify({v:1,view:'logs',activeId:'inst-1',localOpen:[]})});assert.deepEqual(await current.page.evaluate(()=>({view,open:localOpen.size})),{view:'logs',open:0});
 await current.context.close();current=await openApp(browser,{storage:JSON.stringify({v:1,view:'logs',activeId:'gone',localOpen:[]})});assert.equal(await current.page.evaluate(()=>view),'logs');assert.equal(await current.page.evaluate(()=>activeId),'inst-1','a missing instance falls back to the first one');await current.context.close();
 ok('Stale ids, unknown views, invalid values and corrupt storage fall back safely');

 // D. Keyboard. Since d75750a, Ctrl+1..9 / Ctrl+Tab and the arrow keys act on the current instance's web page tabs;
 // Ctrl+T opens a web page tab, Ctrl+W closes only the page tab, Ctrl+Shift+N opens the new-instance dialog.
 const kb=fixture();kb.instances[0]={...kb.instances[0],activeTabId:'t1',tabs:[1,2,3,4].map(n=>({id:'t'+n,title:'网页 '+n,url:'https://example.test/'+n,active:n===1}))};
 current=await openApp(browser,{data:kb});({page,errors}=current);const key=async k=>{await page.keyboard.press(k);await page.waitForTimeout(60);};
 const activeTab=()=>page.evaluate(()=>current()?.tabs?.find(t=>t.active)?.id);
 await page.evaluate(()=>route('browser','inst-1'));await settle(page);await page.locator('#content').click({position:{x:5,y:5}}).catch(()=>{});
 await key('Control+2');assert.equal(await activeTab(),'t2');await key('Control+Tab');assert.equal(await activeTab(),'t3');await key('Control+Shift+Tab');assert.equal(await activeTab(),'t2');
 await key('Control+9');assert.equal(await activeTab(),'t4');await key('Control+Tab');assert.equal(await activeTab(),'t1','Ctrl+Tab wraps around');
 const inView=await page.evaluate(()=>{const t=document.querySelector('.browser-tabs [aria-selected="true"]').getBoundingClientRect(),s=document.querySelector('.browser-tabs').getBoundingClientRect();return t.left>=s.left-1&&t.right<=s.right+1;});assert(inView,'active page tab scrolled into view');
 const focused=()=>page.evaluate(()=>document.activeElement?.dataset?.browserTab);
 await page.locator('.browser-tab-select[data-browser-tab="t1"]').focus();await key('ArrowRight');assert.equal(await focused(),'t2');await key('End');assert.equal(await focused(),'t4');await key('Home');assert.equal(await focused(),'t1');await key('ArrowLeft');assert.equal(await focused(),'t4');
 await key('Enter');await page.waitForFunction(()=>current()?.tabs?.find(t=>t.active)?.id==='t4');await settle(page);assert.equal(await focused(),'t4','focus survives the re-render');
 ok('Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+1..9 and arrow/Home/End switch and move between the current instance\'s web page tabs; focus survives re-render');
 await page.evaluate(()=>route('browser','inst-2'));await settle(page);await key('Control+l');assert.match(await page.locator('#toast').innerText(),/未运行/);assert.equal(await page.evaluate(()=>document.activeElement.dataset.action),'toggle');
 await page.evaluate(()=>route('browser','inst-1'));await go(page,'overview');await key('Control+l');assert.equal(await page.evaluate(()=>view),'browser');assert.equal(await page.evaluate(()=>activeId),'inst-1');assert.equal(await page.evaluate(()=>document.activeElement.id),'addressField');
 await page.locator('#newTab').focus();await key('Enter');await page.waitForSelector('#nameInput');await key('Escape');assert.equal(await page.evaluate(()=>!!modal),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'newTab');
 await key('Control+Shift+N');await page.waitForSelector('#nameInput');await key('Escape');assert.equal(await page.evaluate(()=>!!modal),false);
 let mark=current.calls.length;await page.locator('#content').click({position:{x:5,y:5}}).catch(()=>{});await key('Control+t');await page.waitForFunction(()=>current()?.tabs?.length===5);
 assert.deepEqual(current.calls.slice(mark).filter(c=>c.action==='tab-new').map(c=>c.id),['inst-1']);assert.equal(await page.evaluate(()=>document.activeElement.id),'addressField','a new page tab focuses the address bar');
 await page.locator('#sidebar [data-view="logs"]').focus();await key('Enter');await page.waitForFunction(()=>view==='logs');assert.equal(await page.evaluate(()=>document.activeElement.dataset.view),'logs');
 mark=current.calls.length;const closing=await page.evaluate(()=>current().activeTabId);await key('Control+w');await page.waitForFunction(()=>current()?.tabs?.length===4);
 assert.deepEqual(current.calls.slice(mark).filter(c=>c.action==='tab-close').map(c=>c.tabId),[closing]);assert.equal(current.calls.slice(mark).filter(c=>c.action==='stop').length,0,'Ctrl+W never stops the instance');
 ok('Ctrl+L, Ctrl+T (new page tab), Ctrl+W (closes only the page tab), Ctrl+Shift+N, Esc returns focus to the opener, sidebar focus kept after navigation');
 await go(page,'environment');await key('Control+Enter');assert.match(await page.locator('#toast').innerText(),/没有需要保存的修改/);
 await page.locator('#timezone').fill('Europe/London');await page.locator('#timezone').dispatchEvent('input');await page.locator('#timezone').dispatchEvent('change');await key('Control+Enter');
 await page.waitForFunction(()=>!document.querySelector('[data-ux="save-environment"]')?.textContent.includes('保存中'));await page.waitForTimeout(120);
 assert(current.calls.some(c=>c.action==='settings'),'Ctrl+Enter saved');assert.notEqual(await page.evaluate(()=>document.activeElement.tagName),'BODY');
 assert.match(await page.locator('[data-ux="save-environment"]').getAttribute('title'),/Ctrl \+ Enter/);
 await go(page,'global');assert.match(await page.locator('.shortcut-list').innerText(),/Ctrl \+ L[\s\S]*Ctrl \+ Enter[\s\S]*Ctrl \+ Tab/);
 const rings=[];for(const theme of ['light','dark']){await page.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);await page.keyboard.press('Tab');await page.locator('#tabs [data-tab]').first().focus();rings.push(await page.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle));}
 assert.deepEqual(rings,['solid','solid']);
 ok('Ctrl+Enter saves only when something changed, focus is not lost, shortcuts listed, focus ring visible in both themes');
 assert.deepEqual(errors,[]);await current.context.close();

 // E. Window sizes, long names, 15 instances, 43 nodes, no nodes, zero instances, failed/cancelled tasks.
 const busy=fixture();busy.instances.forEach(x=>{x.status='running';});
 for(const size of SIZES){current=await openApp(browser,{size,data:busy});({page,errors}=current);
  for(const v of VIEWS){await go(page,v);await settle(page);const o=await page.evaluate(()=>({doc:document.documentElement.scrollWidth-document.documentElement.clientWidth,side:[...document.querySelectorAll('#sidebar *')].some(el=>el.getBoundingClientRect().right>document.querySelector('#sidebar').getBoundingClientRect().right+1),head:document.querySelector('#workspaceHead').scrollWidth-document.querySelector('#workspaceHead').clientWidth}));
   assert(o.doc<=1,`${size}/${v}: page scrolls horizontally`);assert(!o.side,`${size}/${v}: sidebar content overflows`);assert(o.head<=1,`${size}/${v}: header overflows`);}
  await page.evaluate(async()=>{await route('overview','inst-2');});assert.match(await page.locator('#sidebar .instance-card h2').textContent(),/超长实例名称/);
  assert(await page.evaluate(()=>{const t=document.querySelector('#tabs');return t.scrollWidth>t.clientWidth&&getComputedStyle(t).overflowX!=='hidden';}),'15 running-instance tabs scroll horizontally');
  await go(page,'proxies');assert.match(await page.locator('#libraryTaskbar').innerText(),/检测已取消/);await go(page,'global-logs');assert.match(await page.locator('#content').innerText(),/检测失败/);
  assert.deepEqual(errors,[]);await current.context.close();}
 ok('1024×768, 1280×800, 1440×960: no horizontal overflow with a long name, 15 tabs, 43 nodes and failed/cancelled tasks');
 current=await openApp(browser,{data:fixture({instances:0,nodes:0})});({page,errors}=current);
 for(const v of ['overview','proxies','global-logs','global'])await go(page,v);await go(page,'overview');assert.match(await page.locator('#sidebar .instance-card').textContent(),/暂无实例/);assert.equal(await page.locator('#sidebar [data-action="toggle"]').isDisabled(),true);
 await page.keyboard.press('Control+l');await page.waitForTimeout(60);assert.match(await page.locator('#toast').innerText(),/请先打开或新建/);await page.keyboard.press('Control+Tab');
 assert.deepEqual(errors,[]);await current.context.close();
 current=await openApp(browser,{data:fixture({instances:3,nodes:0})});({page,errors}=current);await go(page,'environment');await go(page,'proxies');assert.match(await page.locator('#sidebar').innerText(),/实例管理/);assert.deepEqual(errors,[]);await current.context.close();
 ok('Zero instances and no nodes: no errors, clear guidance, shortcuts degrade to a hint');
 fs.writeFileSync(path.join(__dirname,'ux3-renderer-results.json'),JSON.stringify({platform:process.platform,backend:'simulated IPC (self-contained)',passed:results.length,results},null,2)+'\n');console.log('All UX batch 3 renderer tests passed:',results.length);
}catch(e){if(current?.page)await current.page.screenshot({path:path.join(__dirname,'ux3-failure.png')}).catch(()=>{});console.error('Page errors',current?.errors);throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
