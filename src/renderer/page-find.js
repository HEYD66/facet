'use strict';
// 网页内查找栏（Ctrl+F）：显示在地址栏下方，只作用于当前实例的当前网页标签。
// 查找由主进程 findInPage 完成；这里只负责输入框、匹配数和上一个 / 下一个。
let pageFind=null,pageFindTimer=0;
function pageFindHTML(x){
 if(!pageFind||pageFind.id!==x?.id||x.status!=='running'||pageFind.tabId&&pageFind.tabId!==x.activeTabId)return '';
 return `<div class="page-find" id="pageFind" role="search" aria-label="在此页查找"><div class="page-find-input">${icon('search')}<input id="pageFindInput" value="${esc(pageFind.query)}" placeholder="在此页查找" aria-label="在此页查找" aria-describedby="pageFindCount" maxlength="200" autocomplete="off" spellcheck="false"></div><span class="page-find-count" id="pageFindCount" role="status" aria-live="polite">${esc(pageFindCount())}</span><button type="button" class="icon-btn" data-page-find="prev" title="上一个（Shift + Enter）" aria-label="上一个匹配">${icon('up')}</button><button type="button" class="icon-btn page-find-next" data-page-find="next" title="下一个（Enter）" aria-label="下一个匹配">${icon('up')}</button><button type="button" class="icon-btn" data-page-find="close" title="关闭（Esc）" aria-label="关闭查找">${icon('close')}</button></div>`;
}
function pageFindCount(){
 if(!pageFind?.query)return '';
 if(pageFind.pending&&!pageFind.matches)return '查找中…';
 if(!pageFind.searched)return '';
 return pageFind.matches?`${pageFind.active||1}/${pageFind.matches}`:'无结果';
}
function pageFindPaint(){
 const count=$('#pageFindCount');if(count)count.textContent=pageFindCount();
 $('#pageFind')?.classList.toggle('empty',!!pageFind?.searched&&!pageFind.pending&&!pageFind.matches&&!!pageFind.query);
}
function pageFindFocus(select=true){const input=$('#pageFindInput');if(!input)return;input.focus();if(select)input.select();}
// 查找栏出现或消失会改变网页区域高度；重绘浏览页面后由 layout() 同步原生视图位置。
function pageFindShow(id,tabId,query){
 const was=!!$('#pageFind');pageFind={id,tabId,query:query||'',matches:0,active:0,pending:!!query,searched:false};
 if(view==='browser'&&activeId===id){if(!was)render(true);else{const input=$('#pageFindInput');if(input)input.value=pageFind.query;pageFindPaint();}pageFindFocus(true);}
}
async function pageFindOpen(){
 const x=current();if(!x||x.status!=='running'){toast('当前实例未运行，启动后才能查找网页内容');return;}
 if(view!=='browser')await route('browser');
 if(pageFind?.id===x.id&&$('#pageFind')){pageFindFocus(true);return;}
 try{await request('page-find-open',{id:x.id});}catch(e){toast(e.message);}
}
function pageFindSearch(next=false,forward=true){
 if(!pageFind)return;const id=pageFind.id,query=$('#pageFindInput')?.value??pageFind.query;pageFind.query=query;
 clearTimeout(pageFindTimer);
 request('page-find',{id,query,next,forward}).catch(e=>{if(pageFind?.id===id)toast(e.message);});
}
async function pageFindClose({focusPage=true}={}){
 if(!pageFind)return;const id=pageFind.id;clearTimeout(pageFindTimer);pageFind=null;
 if($('#pageFind'))render(true);
 try{await request('page-find-close',{id,focusPage});}catch{}
}
window.facet?.onPageFind?.(e=>{
 if(!e||typeof e.id!=='string')return;
 if(e.type==='open'){pageFindShow(e.id,e.tabId,e.query);return;}
 if(!e.open){if(pageFind?.id===e.id){pageFind=null;if($('#pageFind'))render(true);}return;}
 if(pageFind?.id!==e.id)return;
 // 只采纳当前输入的结果；用户继续输入时，旧请求的回报不覆盖计数。
 if(e.query!==($('#pageFindInput')?.value??pageFind.query))return;
 Object.assign(pageFind,{tabId:e.tabId,matches:e.matches,active:e.active,pending:e.pending,searched:e.searched});pageFindPaint();
});
document.addEventListener('input',e=>{if(e.target.id!=='pageFindInput'||!pageFind)return;pageFind.query=e.target.value;pageFind.pending=!!e.target.value;pageFind.searched=false;pageFindPaint();clearTimeout(pageFindTimer);pageFindTimer=setTimeout(()=>pageFindSearch(false),120);});
document.addEventListener('keydown',e=>{
 if(e.target.id!=='pageFindInput'||e.isComposing)return;
 if(e.key==='Enter'){e.preventDefault();pageFindSearch(true,!e.shiftKey);}
 else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();void pageFindClose();}
});
document.addEventListener('click',e=>{const b=e.target.closest('[data-page-find]');if(!b||b.disabled)return;const action=b.dataset.pageFind;if(action==='close')void pageFindClose();else{pageFindSearch(true,action==='next');pageFindFocus(false);}});
