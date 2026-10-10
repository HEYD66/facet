'use strict';
// 扩展中心（以扩展为主）+ 浏览页地址栏右侧的扩展图标与拼图菜单。
// 启用/停用会停止目标实例：先勾选，再在同一条待应用栏里一次确认。
let extensionConfirm=null,extensionBusy=false,extensionTargetId=null,extensionMenuFor=null;
const extensionPending=new Map();// extensionId -> Map(instanceId -> enabled)

function extensionInfo(row,id){return row.instances.find(i=>i.id===id)||{enabled:false,loaded:false,error:''};}
function extensionIconHTML(row,cls='ext-icon'){const letter=esc((row.name.trim()[0]||'?').toUpperCase());return row.icon?`<img class="${cls}" src="${esc(row.icon)}" alt="" draggable="false">`:`<span class="${cls} ext-letter" aria-hidden="true">${letter}</span>`;}
function extensionWanted(row,id){const p=extensionPending.get(row.id);return p?.has(id)?p.get(id):extensionInfo(row,id).enabled;}
function extensionChangeList(row){const p=extensionPending.get(row.id);if(!p)return [];return [...p].map(([id,enabled])=>({id,enabled,instance:state.instances.find(x=>x.id===id)})).filter(x=>x.instance);}
function pruneExtensionPending(){for(const [key,p] of extensionPending){const row=(state.extensions||[]).find(x=>x.id===key);if(!row){extensionPending.delete(key);continue;}for(const [id,enabled] of p){if(!state.instances.some(x=>x.id===id)||extensionInfo(row,id).enabled===enabled)p.delete(id);}if(!p.size)extensionPending.delete(key);}}

// ── 扩展中心（参考 Chrome 扩展程序页）：网格卡片 +「启用于」弹层 + 详情页。 ──
let extensionDetailId=null,extensionPopFor=null,extensionQuery='';
function resetExtensionView(){extensionDetailId=null;extensionPopFor=null;}
function extSize(b){b=Number(b)||0;return b>=1024**3?(b/1024**3).toFixed(1)+' GB':b>=1024**2?(b/1024**2).toFixed(b>=100*1024**2?0:1).replace(/\.0$/,'')+' MB':Math.max(1,Math.ceil(b/1024))+' KB';}
function extTime(t){if(!t)return '—';const d=new Date(t);return isNaN(d)?'—':d.toLocaleString();}
function extensionStateOf(row,inst){const info=extensionInfo(row,inst.id);return info.error?{cls:'error',text:info.error}:info.loaded?{cls:'loaded',text:'已加载'}:info.enabled?{cls:'waiting',text:`已启用 · 等待启动（${statusText(inst)}）`}:{cls:'off',text:'未启用'};}
function extensionErrors(row){return (state.instances||[]).map(inst=>({inst,info:extensionInfo(row,inst.id)})).filter(x=>x.info.error);}
function extensionRefreshTitle(row){return row.source?'从原文件夹重新读取并检查新版本：'+row.source:'选择原解压文件夹并检查新版本（之后会记住位置）';}
function extensionToggleHTML(row,inst){const info=extensionInfo(row,inst.id),on=extensionWanted(row,inst.id),changed=on!==info.enabled,st=extensionStateOf(row,inst);
 return `<button type="button" class="ext-chip ext-toggle-row ${on?'on':''} ${changed?'changed':''}" aria-pressed="${on}" data-extension="toggle" data-extension-id="${esc(row.id)}" data-instance-id="${esc(inst.id)}" title="${esc(inst.name+' · '+(changed?(on?'待启用':'待停用'):st.text))}"><span class="ext-check" aria-hidden="true">${on?'✓':''}</span><span class="ext-chip-name">${esc(inst.name)}</span><small class="ext-toggle-state ${changed?'changed':st.cls}">${esc(changed?(on?'待启用':'待停用'):st.cls==='error'?'加载失败':st.cls==='waiting'?'等待启动':st.text)}</small><i class="ext-state ${st.cls}" aria-hidden="true"></i></button>`;}
function extensionPendingHTML(row){const changes=extensionChangeList(row);if(!changes.length)return '';const on=changes.filter(x=>x.enabled),off=changes.filter(x=>!x.enabled),running=changes.filter(x=>x.instance.status==='running'||x.instance.status==='starting');
 return `<div class="ext-pending" role="group" aria-label="待应用的更改"><div><strong>${on.length?'将启用：'+on.map(x=>esc(x.instance.name)).join('、'):''}${on.length&&off.length?'；':''}${off.length?'将停用：'+off.map(x=>esc(x.instance.name)).join('、'):''}</strong><small>${running.length?`会停止运行中的 ${running.map(x=>esc(x.instance.name)).join('、')}，`:'涉及的实例都未运行，'}保存后需手动启动；其他实例不受影响。</small></div><div class="subscription-actions"><button class="btn subtle tiny" data-extension="cancel" data-extension-id="${esc(row.id)}" ${extensionBusy?'disabled':''}>撤销</button><button class="btn primary tiny" data-extension="confirm" data-mode="apply" data-extension-id="${esc(row.id)}" ${extensionBusy?'disabled':''}>${extensionBusy?'正在应用…':'应用更改（'+changes.length+'）'}</button></div></div>`;}
function extensionRemoveHTML(row){return extensionConfirm?.action==='extension-remove'&&extensionConfirm.payload.extensionId===row.id?`<div class="ext-pending danger"><div><strong>${esc(extensionConfirm.text)}</strong><small>${esc(extensionConfirm.detail)}</small></div><div class="subscription-actions"><button class="btn subtle tiny" data-extension="cancel" ${extensionBusy?'disabled':''}>取消</button><button class="btn danger tiny" data-extension="confirm" ${extensionBusy?'disabled':''}>${extensionBusy?'正在移除…':'确认移除'}</button></div></div>`:'';}
function extensionRemoveButton(row,cls){return `<button class="btn tiny ${cls}" data-extension="remove" data-extension-id="${esc(row.id)}" ${extensionBusy?'disabled':''} title="确认后在全部实例中停用并移除扩展程序文件">移除</button>`;}
function extensionSelectAllHTML(row){const instances=state.instances||[],all=instances.length>0&&instances.every(x=>extensionWanted(row,x.id));return `<div class="subscription-actions ext-select-all"><button class="btn subtle tiny" data-extension="select-all" data-extension-id="${esc(row.id)}" ${extensionBusy||!instances.length||all?'disabled':''}>全选</button><button class="btn subtle tiny" data-extension="select-none" data-extension-id="${esc(row.id)}" ${extensionBusy||!instances.some(x=>extensionWanted(row,x.id))?'disabled':''}>取消全选</button><small>已选 ${instances.filter(x=>extensionWanted(row,x.id)).length}/${instances.length}</small></div>`;}

function extensionCard(row){
 const instances=state.instances||[],used=row.instances.filter(i=>i.enabled),changes=extensionChangeList(row),errs=extensionErrors(row),open=extensionPopFor===row.id;
 const problem=errs.length?`${errs.length} 个实例加载失败`:row.compatibilityNotice||'';
 return `<article class="ext-card ${open?'popping':''}" data-extension-card="${esc(row.id)}">
  <div class="ext-card-main">${extensionIconHTML(row)}<div class="ext-card-text"><h4><span class="ext-name" title="${esc(row.name)}">${esc(row.name)}</span><span class="ext-version">${esc(row.version)}</span></h4><p class="ext-desc">${row.description?esc(row.description):'<span class="ext-muted">此扩展没有描述</span>'}</p>
  <p class="ext-meta">ID：${row.chromeId?esc(row.chromeId):'<span class="ext-muted">启动启用它的实例后显示</span>'}</p><p class="ext-meta ext-source" title="${esc(row.source||'')}">来源：${row.source?esc(row.source):'<span class="ext-muted">未记录（点 ↻ 选择原文件夹）</span>'}</p></div></div>
  ${extensionRemoveHTML(row)}
  <div class="ext-card-foot"><button class="btn tiny ext-pill" data-extension="detail" data-extension-id="${esc(row.id)}">详情</button>${extensionRemoveButton(row,'ext-pill')}${problem?`<button class="btn tiny ext-pill ext-error-pill" data-extension="detail" data-extension-id="${esc(row.id)}" data-focus="errors" title="${esc(problem)}">错误</button>`:''}<span class="ext-foot-gap"></span>
   <button type="button" class="ext-icon-btn" data-extension="refresh" data-extension-id="${esc(row.id)}" ${extensionBusy?'disabled':''} title="${esc(extensionRefreshTitle(row))}" aria-label="刷新「${esc(row.name)}」">${icon('refresh')}</button>
   <button type="button" class="ext-enable ${used.length?'on':''} ${changes.length?'changed':''}" data-extension="enable-menu" data-extension-id="${esc(row.id)}" aria-haspopup="true" aria-expanded="${open}" title="选择要启用的实例">启用于 ${used.length}/${instances.length}${changes.length?` · 待应用 ${changes.length}`:''}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>
  ${open?`<div class="ext-pop" role="group" aria-label="选择要启用「${esc(row.name)}」的实例"><header><strong>启用于</strong><small>每个实例独立存储</small></header>${extensionSelectAllHTML(row)}<div class="ext-pop-list">${instances.map(inst=>extensionToggleHTML(row,inst)).join('')||'<p class="ext-pop-note">还没有实例</p>'}</div>${extensionPendingHTML(row)||'<p class="ext-pop-note">勾选后点「应用更改」；会停止相关实例，需手动启动。</p>'}</div>`:''}
 </article>`;
}
function extensionDetailHTML(row){
 const instances=state.instances||[],errs=extensionErrors(row),tags=list=>list?.length?list.map(x=>`<span class="ext-tag">${esc(x)}</span>`).join(''):'<span class="ext-muted">无</span>';
 const instRows=instances.map(inst=>{const info=extensionInfo(row,inst.id),ready=info.loaded&&inst.status==='running';return `<div class="ext-inst-row">${extensionToggleHTML(row,inst)}<span class="ext-inst-actions">${ready?[['popup','面板'],['options','设置']].filter(([k])=>row.entries[k]).map(([k,label])=>`<button class="btn subtle tiny" data-extension="open" data-extension-id="${esc(row.id)}" data-instance-id="${esc(inst.id)}" data-kind="${k}">${label}</button>`).join('')||'<span class="ext-muted">无面板，已在网页中自动运行</span>':''}</span></div>`;}).join('')||'<p class="ext-muted">还没有实例</p>';
 const problems=[row.compatibilityNotice?`<p>${esc(row.compatibilityNotice)}</p>`:'',...errs.map(x=>`<p><b>${esc(x.inst.name)}</b>：${esc(x.info.error)}</p>`)].join('');
 return `<div class="ext-detail" data-extension-card="${esc(row.id)}">
  <div class="ext-detail-top"><button class="btn ghost tiny" data-extension="back">${icon('back')}扩展中心</button></div>
  <header class="ext-detail-head">${extensionIconHTML(row,'ext-icon ext-icon-lg')}<div class="ext-detail-title"><h3>${esc(row.name)} <span class="ext-version">${esc(row.version)}</span></h3><p>${row.description?esc(row.description):'<span class="ext-muted">此扩展没有描述</span>'}</p></div>
   <div class="subscription-actions"><button class="btn tiny" data-extension="refresh" data-extension-id="${esc(row.id)}" ${extensionBusy?'disabled':''} title="${esc(extensionRefreshTitle(row))}">${icon('refresh')}刷新</button><button class="btn tiny" data-extension="reveal" data-extension-id="${esc(row.id)}" ${row.source?'':'disabled'} title="${esc(row.source||'未记录来源文件夹')}">打开来源文件夹</button>${extensionRemoveButton(row,'danger')}</div></header>
  ${extensionRemoveHTML(row)}
  ${problems?`<section class="ext-detail-section ext-detail-errors" id="extErrors"><h4>错误</h4>${problems}</section>`:''}
  <section class="ext-detail-section"><h4>实例</h4><p class="ext-section-note">勾选要启用的实例，再点「应用更改」；会停止相关的运行中实例，需手动启动。面板和设置在实例运行后可用。</p>${extensionSelectAllHTML(row)}<div class="ext-inst-list">${instRows}</div>${extensionPendingHTML(row)}</section>
  <section class="ext-detail-section"><h4>信息</h4><dl class="ext-kv"><dt>ID</dt><dd>${row.chromeId?esc(row.chromeId):'<span class="ext-muted">启动启用它的实例后显示</span>'}</dd><dt>来源文件夹</dt><dd>${row.source?esc(row.source):'<span class="ext-muted">未记录；点「刷新」选择一次后会记住</span>'}</dd><dt>大小</dt><dd>${extSize(row.bytes)}${row.files?` · ${row.files} 个文件和目录`:''}</dd><dt>清单版本</dt><dd>MV${esc(row.manifestVersion)}</dd><dt>导入时间</dt><dd>${esc(extTime(row.importedAt))}</dd>${row.updatedAt?`<dt>最近更新</dt><dd>${esc(extTime(row.updatedAt))}</dd>`:''}${row.skipped?.length?`<dt>导入时跳过</dt><dd>${row.skipped.map(x=>esc(x.name)+'（'+extSize(x.size)+'）').join('、')}</dd>`:''}</dl></section>
  <section class="ext-detail-section"><h4>权限与网页范围</h4><dl class="ext-kv"><dt>声明权限</dt><dd>${tags(row.permissions)}</dd><dt>可选权限</dt><dd>${tags(row.optionalPermissions)}</dd><dt>内容脚本范围</dt><dd>${tags(row.matches)}</dd></dl></section>
  ${(row.warnings||[]).length?`<section class="ext-detail-section"><h4>兼容性提示</h4>${row.warnings.map(w=>`<p class="ext-section-note">${esc(w)}</p>`).join('')}</section>`:''}
 </div>`;
}
function extensionGridHTML(rows){const q=extensionQuery.trim().toLowerCase(),shown=q?rows.filter(r=>[r.name,r.description,r.chromeId,r.version].join(' ').toLowerCase().includes(q)):rows;
 return shown.map(extensionCard).join('')||(rows.length?`<div class="empty-list">没有匹配「${esc(extensionQuery.trim())}」的扩展。</div>`:'<div class="empty-list">尚未导入扩展。点「导入解压扩展」选择包含 manifest.json 的文件夹，导入后在卡片上选择要启用的实例。</div>');}
function positionExtensionPop(){const pop=document.querySelector('.ext-pop');if(!pop)return;pop.classList.remove('up');const r=pop.getBoundingClientRect(),card=pop.closest('.ext-card').getBoundingClientRect(),host=$('#content').getBoundingClientRect();if(r.bottom>host.bottom-4&&card.top-host.top>r.height+8)pop.classList.add('up');}
function extensionPage(){
 pruneExtensionPending();
 const rows=state.extensions||[],focus=document.activeElement,searching=focus?.id==='extSearch',caret=searching?[focus.selectionStart,focus.selectionEnd]:null,key=focus?.dataset?.extension?[focus.dataset.extension,focus.dataset.extensionId||'',focus.dataset.instanceId||'',focus.dataset.kind||'']:null;
 if(extensionDetailId&&!rows.some(r=>r.id===extensionDetailId))extensionDetailId=null;
 if(extensionPopFor&&!rows.some(r=>r.id===extensionPopFor))extensionPopFor=null;
 const detail=extensionDetailId&&rows.find(r=>r.id===extensionDetailId);
 $('#content').innerHTML=`<section class="settings-card extension-center">${detail?extensionDetailHTML(detail):`<div class="ext-center-bar"><label class="ext-search">${icon('search')}<input id="extSearch" type="search" placeholder="搜索扩展程序" value="${esc(extensionQuery)}" aria-label="搜索扩展程序" autocomplete="off"></label><span class="ext-bar-gap"></span><button class="btn" data-extension="refresh-all" ${extensionBusy||!rows.length?'disabled':''} title="从各扩展的原文件夹重新读取，有新版本时一次确认">${icon('refresh')} 全部更新</button><button class="btn primary" data-extension="import" ${extensionBusy?'disabled':''}>${icon('plus')} 导入解压扩展</button></div>
  <p class="ext-center-note">按实例启用：每个实例独立存储、沿用该实例的网络；启用或停用会停止目标实例，需手动启动。仅支持部分 Chrome 扩展 API，不支持商店和 CRX 直装。</p>
  <h4 class="ext-grid-title">所有扩展程序 <small>${rows.length}</small></h4><div class="ext-grid" id="extGrid">${extensionGridHTML(rows)}</div><p class="actions-note">只安装可信来源。扩展可读取或修改其权限范围内的网页；停用后重启可清除残留内容脚本，扩展已保存的数据会保留。</p>`}</section>`;
 positionExtensionPop();
 if(searching){const s=$('#extSearch');if(s){s.focus({preventScroll:true});try{s.setSelectionRange(...caret);}catch{}}}
 else if(key){const el=[...document.querySelectorAll('#content [data-extension]')].find(b=>b.dataset.extension===key[0]&&(b.dataset.extensionId||'')===key[1]&&(b.dataset.instanceId||'')===key[2]&&(b.dataset.kind||'')===key[3]);if(el&&!el.disabled)el.focus({preventScroll:true});}
}
document.addEventListener('input',e=>{if(e.target.id!=='extSearch')return;extensionQuery=e.target.value;extensionPopFor=null;const g=$('#extGrid');if(g)g.innerHTML=extensionGridHTML(state.extensions||[]);});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&extensionPopFor&&view==='extensions'&&!document.getElementById('extensionMenu')?.open){const id=extensionPopFor;e.preventDefault();extensionPopFor=null;extensionPage();document.querySelector(`[data-extension="enable-menu"][data-extension-id="${CSS.escape(id)}"]`)?.focus();}});
// Close the pop-over without re-rendering, so the click that follows still reaches its button.
document.addEventListener('mousedown',e=>{if(extensionPopFor&&view==='extensions'&&!e.target.closest('.ext-pop')&&!e.target.closest('[data-extension="enable-menu"]')){extensionPopFor=null;document.querySelector('.ext-pop')?.remove();document.querySelectorAll('.ext-card.popping').forEach(c=>c.classList.remove('popping'));document.querySelectorAll('[data-extension="enable-menu"][aria-expanded="true"]').forEach(b=>b.setAttribute('aria-expanded','false'));}},true);

// 浏览页：地址栏右侧的扩展图标 + 拼图按钮。
function extensionToolbarHTML(x){
 const enabled=(state.extensions||[]).filter(row=>extensionInfo(row,x.id).enabled);
 const icons=enabled.map(row=>{const info=extensionInfo(row,x.id),kind=row.entries.popup?'popup':row.entries.options?'options':'';const ready=info.loaded&&x.status==='running';const tip=info.error?`${row.name} · ${info.error}`:ready?(kind?`${row.name} · 点击打开${kind==='popup'?'面板':'设置'}`:`${row.name} · 已加载（无面板）`):`${row.name} · 等待实例启动`;
  return `<button type="button" class="ext-tool ${ready?'':'idle'} ${info.error?'error':''}" data-extension="open" data-extension-id="${esc(row.id)}" data-instance-id="${esc(x.id)}" data-kind="${kind}" title="${esc(tip)}" aria-label="${esc(tip)}">${extensionIconHTML(row,'ext-tool-icon')}${info.error?'<b class="ext-badge">!</b>':''}</button>`;}).join('');
 return `<div class="ext-toolbar" role="toolbar" aria-label="此实例的扩展">${icons}<button type="button" class="ext-tool ext-puzzle" data-extension="menu" data-instance-id="${esc(x.id)}" aria-haspopup="dialog" aria-expanded="${extensionMenuFor===x.id}" title="扩展" aria-label="扩展菜单">${extensionPuzzleSVG()}</button></div>`;
}
function extensionPuzzleSVG(){return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3.5a2 2 0 0 1 4 0V5h3.5A1.5 1.5 0 0 1 19 6.5V10h-1.5a2 2 0 0 0 0 4H19v3.5a1.5 1.5 0 0 1-1.5 1.5H14v-1.5a2 2 0 0 0-4 0V19H6.5A1.5 1.5 0 0 1 5 17.5V14h1.5a2 2 0 0 0 0-4H5V6.5A1.5 1.5 0 0 1 6.5 5H10z"/></svg>';}
function extensionMenuDialog(){let d=document.getElementById('extensionMenu');if(!d){d=document.createElement('dialog');d.id='extensionMenu';d.className='ext-menu';d.setAttribute('data-browser-overlay','');d.setAttribute('aria-label','此实例的扩展');document.body.append(d);}return d;}
// 扩展菜单：在桌面应用里用原生浮层显示（网页保持实时，不再截图冻结）；浏览器预览中仍用 HTML 对话框。
function nativeExtensionMenu(){return !!window.facet?.onOverlay;}
let nativeMenuOpen=false,nativeMenuClosedAt=0,nativeMenuHTML='';
function extensionMenuOpen(){return nativeExtensionMenu()?nativeMenuOpen:!!document.getElementById('extensionMenu')?.open;}
function extensionMenuHTML(x){
 const rows=state.extensions||[],enabled=rows.filter(row=>extensionInfo(row,x.id).enabled),others=rows.length-enabled.length;
 return `<header><strong>扩展</strong><small>${esc(x.name)}</small></header>${enabled.length?`<ul>${enabled.map(row=>{const info=extensionInfo(row,x.id),ready=info.loaded&&x.status==='running';return `<li>${extensionIconHTML(row,'ext-menu-icon')}<div><b>${esc(row.name)}</b><small class="${info.error?'extension-error':''}">${esc(info.error||(ready?'已加载':'等待实例启动'))}</small></div><span class="subscription-actions">${[['popup','面板'],['options','设置']].filter(([k])=>row.entries[k]).map(([k,label])=>`<button class="btn subtle tiny" data-extension="open" data-extension-id="${esc(row.id)}" data-instance-id="${esc(x.id)}" data-kind="${k}" ${ready?'':'disabled'}>${label}</button>`).join('')}</span></li>`;}).join('')}</ul>`:'<p class="ext-menu-empty">此实例还没有启用扩展。</p>'}${x.status!=='running'&&enabled.length?'<p class="ext-menu-note">扩展随实例启动加载；启动后可打开面板和设置。</p>':''}<footer>${others?`<small>另有 ${others} 个扩展未在此实例启用</small>`:'<small></small>'}<button class="btn soft tiny" data-view="extensions">${icon('box')}扩展中心</button></footer>`;
}
function renderExtensionMenu(){
 if(!extensionMenuOpen())return;const x=state.instances.find(i=>i.id===extensionMenuFor);if(!x||view!=='browser'||x.id!==activeId){closeExtensionMenu();return;}
 const html=extensionMenuHTML(x);if(nativeExtensionMenu()){if(html!==nativeMenuHTML){nativeMenuHTML=html;sendExtensionMenu(true);}return;}
 document.getElementById('extensionMenu').innerHTML=html;
}
function extensionMenuAttrs(){const o={};for(const a of document.documentElement.attributes)if(a.name==='class'||a.name==='style'||a.name.startsWith('data-'))o[a.name]=a.value;return o;}
function sendExtensionMenu(update){const b=$('.ext-puzzle');if(!b)return Promise.resolve();const r=b.getBoundingClientRect();return window.facet.request('overlay-show',{html:nativeMenuHTML,anchor:{right:r.right,bottom:r.bottom},width:Math.min(340,innerWidth-16),attrs:extensionMenuAttrs(),label:'此实例的扩展',update}).catch(()=>{});}
function positionExtensionMenu(){if(nativeExtensionMenu()){if(nativeMenuOpen)closeExtensionMenu();return;}const d=document.getElementById('extensionMenu'),b=$('.ext-puzzle');if(!d?.open||!b)return;const r=b.getBoundingClientRect(),w=Math.min(340,innerWidth-16);d.style.width=w+'px';d.style.left=Math.max(8,Math.min(r.right-w,innerWidth-w-8))+'px';d.style.top=(r.bottom+6)+'px';}
function openExtensionMenu(id){
 closePrivacySitesMenu();
 if(nativeExtensionMenu()){const x=state.instances.find(i=>i.id===id);if(!x)return;extensionMenuFor=id;nativeMenuOpen=true;nativeMenuHTML=extensionMenuHTML(x);$('.ext-puzzle')?.setAttribute('aria-expanded','true');return sendExtensionMenu(false);}
 const d=extensionMenuDialog();extensionMenuFor=id;if(!d.open)d.show();renderExtensionMenu();positionExtensionMenu();layout();$('.ext-puzzle')?.setAttribute('aria-expanded','true');(d.querySelector('button:not([disabled])'))?.focus();}
function closeExtensionMenu(returnFocus=false){
 if(nativeExtensionMenu()){const was=nativeMenuOpen;extensionMenuFor=null;nativeMenuOpen=false;$('.ext-puzzle')?.setAttribute('aria-expanded','false');if(was){window.facet.request('overlay-hide').catch(()=>{});if(returnFocus)$('.ext-puzzle')?.focus();}return;}
 const d=document.getElementById('extensionMenu');const was=d?.open;extensionMenuFor=null;if(was)d.close();$('.ext-puzzle')?.setAttribute('aria-expanded','false');if(was){layout();if(returnFocus)$('.ext-puzzle')?.focus();}}
// 浮层关闭（失去焦点 / Esc）或点击了浮层里的按钮：按钮交给原有的点击处理。
window.facet?.onOverlay?.(e=>{if(e?.type==='closed'){if(nativeMenuOpen){nativeMenuOpen=false;extensionMenuFor=null;nativeMenuClosedAt=Date.now();$('.ext-puzzle')?.setAttribute('aria-expanded','false');if(e.reason==='escape')$('.ext-puzzle')?.focus();}return;}if(e?.type!=='action')return;const b=document.createElement('button');b.type='button';b.hidden=true;for(const [k,v] of Object.entries(e.data||{}))if(['extension','extensionId','instanceId','kind','view'].includes(k))b.dataset[k]=String(v);document.body.append(b);try{b.click();}finally{b.remove();}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.getElementById('extensionMenu')?.open){e.preventDefault();e.stopPropagation();closeExtensionMenu(true);}},true);
document.addEventListener('mousedown',e=>{const d=document.getElementById('extensionMenu');if(d?.open&&!d.contains(e.target)&&!e.target.closest('.ext-puzzle'))closeExtensionMenu();},true);
window.addEventListener('resize',positionExtensionMenu);

document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-extension]');
 if(!b||b.disabled)return;
 const action=b.dataset.extension;
 if(action==='menu'){if(nativeExtensionMenu()&&!nativeMenuOpen&&Date.now()-nativeMenuClosedAt<350)return;if(extensionMenuFor===b.dataset.instanceId&&extensionMenuOpen())closeExtensionMenu(true);else openExtensionMenu(b.dataset.instanceId);return;}
 if(b.closest('#extensionMenu')&&action!=='open')return;
 if(action==='enable-menu'){extensionConfirm=null;extensionPopFor=extensionPopFor===b.dataset.extensionId?null:b.dataset.extensionId;extensionPage();return;}
 if(action==='detail'){extensionDetailId=b.dataset.extensionId;extensionPopFor=null;extensionConfirm=null;extensionPage();$('#content').scrollTop=0;if(b.dataset.focus==='errors')document.getElementById('extErrors')?.scrollIntoView({block:'nearest'});return;}
 if(action==='back'){const was=extensionDetailId;resetExtensionView();extensionConfirm=null;extensionPage();document.querySelector(`[data-extension="detail"][data-extension-id="${CSS.escape(was||'')}"]`)?.focus();return;}
 if(extensionBusy)return;
 const row=(state.extensions||[]).find(x=>x.id===b.dataset.extensionId);
 const instanceId=b.dataset.instanceId||extensionTargetId||activeId;
 const targetInstance=state.instances.find(x=>x.id===instanceId);
 if(action==='cancel'){if(row)extensionPending.delete(row.id);extensionConfirm=null;extensionTargetId=null;extensionPage();return;}
 if(action==='toggle'&&row&&targetInstance){extensionConfirm=null;const p=extensionPending.get(row.id)||new Map(),next=!extensionWanted(row,targetInstance.id);if(next===extensionInfo(row,targetInstance.id).enabled)p.delete(targetInstance.id);else p.set(targetInstance.id,next);if(p.size)extensionPending.set(row.id,p);else extensionPending.delete(row.id);extensionPage();return;}
 if((action==='select-all'||action==='select-none')&&row){extensionConfirm=null;const on=action==='select-all',p=new Map();for(const instance of state.instances)if(extensionInfo(row,instance.id).enabled!==on)p.set(instance.id,on);if(p.size)extensionPending.set(row.id,p);else extensionPending.delete(row.id);extensionPage();return;}
 if(action==='remove'&&row){extensionPending.delete(row.id);extensionPopFor=null;const used=state.instances.filter(x=>{const info=extensionInfo(row,x.id);return info.enabled||info.loaded;});extensionConfirm={action:'extension-remove',payload:{extensionId:row.id,confirmed:true,instanceIds:used.map(x=>x.id)},text:`移除「${row.name}」${used.length?'并在 '+used.length+' 个实例中停用':''}？`,detail:(used.length?'涉及：'+used.map(x=>x.name).join('、')+'。会停止其中正在运行的实例，移除后需手动启动。':'')+'不会删除实例登录数据、扩展已保存的数据或来源文件夹。'};extensionPage();return;}
 if(action==='open'){
  if(!row||!targetInstance)return;const info=extensionInfo(row,targetInstance.id),kind=b.dataset.kind;
  if(info.error){toast(`「${row.name}」加载失败：${info.error}`);return;}
  if(!info.loaded||targetInstance.status!=='running'){toast(`请先启动「${targetInstance.name}」，扩展会随实例加载`);return;}
  if(!kind){toast(`「${row.name}」没有面板或设置页，已在网页中自动运行`);return;}
  closeExtensionMenu();
  try{await request('extension-open',{id:targetInstance.id,extensionId:row.id,kind});}catch(err){toast(err.message);}
  return;
 }
 if(action==='confirm'&&b.dataset.mode==='apply'&&row){
  const changes=extensionChangeList(row);if(!changes.length)return;extensionBusy=true;extensionPage();const failed=[];
  for(const change of changes){try{await request('extension-configure',{id:change.id,extensionId:row.id,enabled:change.enabled,confirmed:true});extensionPending.get(row.id)?.delete(change.id);}catch(err){failed.push(`${change.instance.name}：${err.message}`);}}
  if(!extensionPending.get(row.id)?.size){extensionPending.delete(row.id);if(extensionPopFor===row.id)extensionPopFor=null;}
  try{state=await request('snapshot');}catch{}
  extensionBusy=false;toast(failed.length?'部分实例未能保存：'+failed.join('；'):`已保存「${row.name}」的启用范围；相关实例需手动启动`);if(view==='extensions')extensionPage();else render(true);return;
 }
 if(action==='reveal'&&row){try{await request('extension-reveal',{extensionId:row.id});}catch(err){toast(err.message);}return;}
 if(action==='refresh-all'){extensionBusy=true;extensionPopFor=null;extensionPage();
  try{const r=await request('extension-refresh-all');if(r&&!r.cancelled){const parts=[r.updated?.length?'已更新 '+r.updated.map(u=>`${u.name} ${u.from} → ${u.version}`).join('、'):'没有发现新版本'];if(r.stopped?.length)parts.push(`已停止 ${r.stopped.join('、')}，请手动启动`);if(r.noSource?.length)parts.push(`${r.noSource.join('、')} 未记录来源，请在卡片上单独刷新`);if(r.failed?.length)parts.push('读取失败：'+r.failed.join('；'));toast(parts.join('；'));}state=await request('snapshot');}
  catch(err){toast(err.message);}
  finally{extensionBusy=false;if(view==='extensions')extensionPage();else render(true);}
  return;}
 if(action==='refresh'&&row){extensionBusy=true;extensionPage();
  try{const r=await request('extension-refresh',{extensionId:row.id});if(r?.unchanged)toast(`「${row.name}」已是最新（${r.version}），原文件夹没有变化`);else if(r?.updated)toast(`已更新「${row.name}」${r.from} → ${r.version}`+(r.stopped?.length?`；已停止 ${r.stopped.join('、')}，请手动启动`:''));state=await request('snapshot');}
  catch(err){toast(err.message);}
  finally{extensionBusy=false;if(view==='extensions')extensionPage();else render(true);}
  return;}
 let op,payload={};
 if(action==='import')op='extension-import';
 else if(action==='confirm'&&extensionConfirm){op=extensionConfirm.action;payload=extensionConfirm.payload;}
 else return;
 extensionBusy=true;
 if(view==='extensions')extensionPage();
 try{const result=await request(op,payload);extensionConfirm=null;extensionTargetId=null;state=await request('snapshot');if(op==='extension-remove')toast('扩展已移除'+(result?.stopped?.length?'；已停止 '+result.stopped.join('、')+'，请手动启动':'')+(result?.cleanupPending?'；程序临时副本未能清理，实例数据已保留':''));}
 catch(err){toast(err.message);}
 finally{extensionBusy=false;if(view==='extensions')extensionPage();else if(view==='browser')render(true);}
});
