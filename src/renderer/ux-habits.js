'use strict';
// UX batch 3: remembered interface state, UI-only keyboard shortcuts and focus continuity.
// Loaded before app.js. Never starts instances; stale ids, unknown views and unknown option values are ignored.
const UI_STATE_KEY='arena.ui.state.v1';
const uiInstanceViews=['browser','environment','logs'];
const uiKnownViews=['browser','environment','logs','overview','global','settings','proxies','global-logs','extensions','grid'];
const uiScrollTargets=['#content','.library-table','.ip-table-scroll','.extension-assign-table','.quick-manager-list','.instance-details'];
const uiScrollMemory=new Map();
let uiReady=false,uiSaveTimer=null,advancedEnvironmentOpen=false,lastFocusInfo=null;

function readUiState(){try{const value=JSON.parse(localStorage.getItem(UI_STATE_KEY)||'null');return value&&typeof value==='object'&&value.v===1?value:null;}catch{return null;}}
function uiOneOf(value,list,fallback){return list.includes(value)?value:fallback;}
function uiText(value,fallback){return typeof value==='string'?value.slice(0,200):fallback;}
function restoreUiState(){
 const saved=readUiState();uiReady=true;if(!saved)return false;
 const ids=new Set(state.instances.map(x=>x.id));
 if(Array.isArray(saved.localOpen)){localOpen.clear();saved.localOpen.filter(id=>ids.has(id)).forEach(id=>localOpen.add(id));}
 if(ids.has(saved.activeId))activeId=saved.activeId;
 let next=saved.view==='runtime-output'?'global-logs':uiOneOf(saved.view,uiKnownViews,'browser');
 if(uiInstanceViews.includes(next)&&!ids.has(activeId))next='overview';
 view=next;
 const f=saved.filters&&typeof saved.filters==='object'?saved.filters:{};
 globalLogTab=saved.view==='runtime-output'?'debug':uiOneOf(f.globalLogTab,['operations','debug'],'operations');
 runtimeOutputChannel=uiOneOf(f.runtimeOutputChannel,['all','stdout','stderr'],'all');
 runtimeOutputSearch=uiText(f.runtimeOutputSearch,'');
 const sources=new Set([...(state.library||[]).map(x=>x.id),...(state.events||[]).map(x=>x.sourceId).filter(Boolean)]);
 librarySort=uiOneOf(f.librarySort,['original','latency','favorite','name'],librarySort);
 libraryOnly=uiOneOf(f.libraryOnly,['all','favorites','available'],libraryOnly);
 libraryConcurrency=uiOneOf(f.libraryConcurrency,[1,2,3,4,5,6,8,10,12,16],libraryConcurrency);
 libraryMinSuccess=uiOneOf(f.libraryMinSuccess,[0,1,2,3,5,10],libraryMinSuccess);
 if(typeof f.libraryIncludeHints==='boolean')libraryIncludeHints=f.libraryIncludeHints;
 if(f.librarySource==='*'&&(state.library||[]).length>1||(state.library||[]).some(x=>x.id===f.librarySource))librarySource=f.librarySource;
 librarySearch=uiText(f.librarySearch,librarySearch);
 globalLogLevel=uiOneOf(f.globalLogLevel,['all','INFO','WARN','ERROR'],globalLogLevel);
 globalLogScope=uiOneOf(f.globalLogScope,['all','application','instance','subscription','diagnostic'],globalLogScope);
 if(f.globalLogInstance==='all'||ids.has(f.globalLogInstance))globalLogInstance=f.globalLogInstance;
 if(f.globalLogSource==='all'||sources.has(f.globalLogSource))globalLogSource=f.globalLogSource;
 filter=uiOneOf(f.filter,['all','running','error','stopped'],filter);
 search=uiText(f.search,search);
 favoriteTab=uiOneOf(f.favoriteTab,['ips','nodes'],favoriteTab);
 advancedEnvironmentOpen=saved.advancedEnvironmentOpen===true;
 return true;
}
function saveUiState(){
 clearTimeout(uiSaveTimer);uiSaveTimer=null;if(!uiReady)return;
 const value={v:1,savedAt:new Date().toISOString(),localOpen:[...localOpen],activeId,view:view==='favorites'?'proxies':view,advancedEnvironmentOpen,
  filters:{globalLogTab,runtimeOutputChannel,runtimeOutputSearch,librarySort,libraryOnly,libraryConcurrency,libraryMinSuccess,libraryIncludeHints,librarySource,librarySearch,globalLogLevel,globalLogScope,globalLogInstance,globalLogSource,filter,search,favoriteTab}};
 try{localStorage.setItem(UI_STATE_KEY,JSON.stringify(value));}catch{}
}
function scheduleUiSave(){if(!uiReady)return;clearTimeout(uiSaveTimer);uiSaveTimer=setTimeout(saveUiState,200);}
function applyUiDetails(){const d=document.querySelector('#content details.advanced-environment');if(d&&advancedEnvironmentOpen&&!d.open)d.open=true;}

// Scroll positions are remembered per view (and per instance for instance views) for this run only.
function uiScrollKey(key){const name=String(key||'').split(':')[0];return globalViews.includes(name)?name:key;}
function uiScrollElement(selector){return selector==='#content'?$('#content'):document.querySelector('#content '+selector);}
function rememberScroll(key){if(!key)return;const record={};for(const selector of uiScrollTargets){const el=uiScrollElement(selector);if(el&&el.scrollTop>0)record[selector]=el.scrollTop;}uiScrollMemory.set(uiScrollKey(key),record);}
function restoreScroll(key){const record=uiScrollMemory.get(uiScrollKey(key))||{'#content':0};const apply=()=>{for(const [selector,top] of Object.entries(record)){const el=uiScrollElement(selector);if(el)el.scrollTop=top;}};apply();requestAnimationFrame(apply);}

// Keep keyboard focus when render() rebuilds the tab strip, sidebar or workspace header.
const uiFocusAttributes=['data-tab','data-close','data-view','data-action','data-ux','data-filter'];
function focusInfo(el){if(!el||el===document.body||!el.isConnected||!el.getAttribute)return null;const scope=el.closest('#tabs,#sidebar,#workspaceHead,.tab-end,.titlebar,#content');const info={scope:scope?.id?'#'+scope.id:scope?.classList.contains('tab-end')?'.tab-end':scope?.classList.contains('titlebar')?'.titlebar':null};for(const attr of uiFocusAttributes){const value=el.getAttribute(attr);if(value!==null)return {...info,attr,value};}return el.id?{...info,id:el.id}:null;}
function findByFocusInfo(info){if(!info)return null;if(info.id)return document.getElementById(info.id);const root=info.scope?document.querySelector(info.scope):document;return root?.querySelector(`[${info.attr}="${CSS.escape(info.value)}"]`)||null;}
function focusByInfo(info){const el=findByFocusInfo(info);if(el&&!el.disabled&&el.getClientRects().length){el.focus({preventScroll:true});return true;}return false;}
function focusLost(){const el=document.activeElement;return !el||el===document.body||!el.isConnected;}
function captureShellFocus(){const el=document.activeElement;if(!el?.closest?.('#tabs,#sidebar,#workspaceHead'))return ()=>{};const info=focusInfo(el);return ()=>{if(!focusLost())return;if(!focusByInfo(info)&&info?.scope==='#sidebar')$('#sidebar .nav.active')?.focus({preventScroll:true});};}
function rememberModalFocus(){lastFocusInfo=focusInfo(document.activeElement);}
function restoreModalFocus(){if(lastFocus?.isConnected&&!lastFocus.disabled){lastFocus.focus({preventScroll:true});return;}if(!focusByInfo(lastFocusInfo))$('#tabs [aria-selected="true"]')?.focus({preventScroll:true});}

// After a successful save the page is rebuilt; move focus to the save status instead of losing it.
if(typeof saveEnvironment==='function'){const baseSaveEnvironment=saveEnvironment;saveEnvironment=async function(...args){const ok=await baseSaveEnvironment(...args);if(ok&&focusLost()){const info=$('#environmentSaveInfo');if(info){info.tabIndex=-1;info.focus({preventScroll:true});}}return ok;};}

const uiShortcuts=[['Ctrl + L','定位到当前实例的地址栏'],['Ctrl + Enter','在「环境配置」页保存配置'],['Ctrl + Tab / Ctrl + Shift + Tab','切换当前实例的下一个 / 上一个网页标签'],['Ctrl + 1 … 9','切换到第 N 个标签（9 为最后一个）'],['Ctrl + T','新建网页标签'],['Ctrl + W','关闭当前网页标签'],['Ctrl + Shift + N','新建实例'],['← / →、Home / End','在网页标签栏内移动焦点'],['Esc','关闭当前对话框']];
function shortcutListHTML(){return `<section class="settings-card full"><h3>键盘快捷键</h3><div class="inner"><dl class="shortcut-list">${uiShortcuts.map(([k,d])=>`<div><dt><kbd>${esc(k)}</kbd></dt><dd>${esc(d)}</dd></div>`).join('')}</dl><p class="actions-note">关闭网页标签不会停止实例。停止实例请使用左侧的停止按钮。</p></div></section>`;}
function uiOpenTabs(){return [...document.querySelectorAll('.browser-tab-select')];}
async function uiGoToTab(index){const tabs=current()?.tabs||[];if(!tabs.length)return;const target=tabs[(index+tabs.length)%tabs.length];await browserTabAction('tab-activate',target.id);}

async function uiFocusAddress(){if(!current()){toast('请先打开或新建一个实例');return;}if(view!=='browser')await route('browser');const field=$('#addressField');if(!field)return;if(field.disabled){toast('当前实例未运行，启动后才能输入网址');$('#sidebar [data-action="toggle"]')?.focus();return;}field.focus();field.select();}
function uiBlocked(){return !!modal||!!document.querySelector('dialog[open]');}
document.addEventListener('keydown',async e=>{
 if(e.defaultPrevented||e.altKey||e.metaKey||uiBlocked())return;
 const tab=e.target.closest?.('.browser-tab-select');
 if(tab&&!e.ctrlKey&&!e.shiftKey&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){const list=uiOpenTabs(),i=list.indexOf(tab);const next=e.key==='Home'?0:e.key==='End'?list.length-1:(i+(e.key==='ArrowRight'?1:-1)+list.length)%list.length;e.preventDefault();list[next]?.focus();list[next]?.scrollIntoView({block:'nearest',inline:'nearest'});return;}
 if(!e.ctrlKey)return;const key=e.key.length===1?e.key.toLowerCase():e.key;
 if(key==='Tab'){e.preventDefault();const tabs=current()?.tabs||[];const at=tabs.findIndex(i=>i.active);await uiGoToTab(at<0?(e.shiftKey?-1:0):at+(e.shiftKey?-1:1));return;}
 if(e.shiftKey&&key==='n'){e.preventDefault();openModal('new');return;}if(e.shiftKey)return;
 if(/^[1-9]$/.test(key)){e.preventDefault();const count=current()?.tabs?.length||0;await uiGoToTab(key==='9'?count-1:Math.min(Number(key)-1,count-1));return;}
 if(key==='l'){e.preventDefault();await uiFocusAddress();return;}
 if(key==='t'){e.preventDefault();await browserTabAction('tab-new');return;}if(key==='w'){e.preventDefault();await browserTabAction('tab-close',current()?.activeTabId);return;}
 if(key==='Enter'&&view==='environment'){const save=$('[data-ux="save-environment"]');if(!save)return;e.preventDefault();if(save.disabled)toast(savingEnvironments.has(activeId)?'正在保存，请稍候':'没有需要保存的修改');else save.click();}
});
document.addEventListener('wheel',e=>{const tabs=e.target.closest?.('#tabs');if(!tabs||e.ctrlKey||Math.abs(e.deltaY)<=Math.abs(e.deltaX)||tabs.scrollWidth<=tabs.clientWidth)return;tabs.scrollLeft+=e.deltaY;e.preventDefault();},{passive:false});
document.addEventListener('toggle',e=>{if(e.target.matches?.('details.advanced-environment')){advancedEnvironmentOpen=e.target.open;scheduleUiSave();}},true);
for(const type of ['click','change','input'])document.addEventListener(type,scheduleUiSave,true);
window.addEventListener('beforeunload',saveUiState);
window.addEventListener('pagehide',saveUiState);
