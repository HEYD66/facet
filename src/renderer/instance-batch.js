'use strict';
let batchNodes=[],batchSelection=new Set();
function batchInputs(){const lookup=new Map(batchNodes.map(n=>[libKey(n.sourceId,n.name),n]));return {count:Number($('#batchCount').value),prefix:$('#batchPrefix').value,mode:$('#batchMode').value,allocation:$('#batchAllocation').value,start:$('#batchStart').checked,syncLocale:$('#batchLocale').checked,random:modal.batchRandom===true,nodes:[...batchSelection].map(key=>lookup.get(key)).filter(Boolean).map(n=>({sourceId:n.sourceId,name:n.name}))};}
function batchEligible(n){return $('#batchAllocation').value!=='unique'||n.available&&!n.usage;}
function batchRows(){
 const query=$('#batchNodeSearch').value.trim().toLowerCase(),only=$('#batchAvailable').checked;
 const eligible=new Set(batchNodes.filter(batchEligible).map(n=>libKey(n.sourceId,n.name)));batchSelection=new Set([...batchSelection].filter(key=>eligible.has(key)));
 $('#batchNetworkFields').hidden=$('#batchMode').value!=='mihomo';
 const visible=batchNodes.filter(n=>(!only||n.available&&batchEligible(n))&&[n.sourceName,n.name,n.ip,n.country].join(' ').toLowerCase().includes(query));
 $('#batchNodes').innerHTML=visible.map(n=>`<label class="batch-node"><input type="checkbox" data-batch-node="${esc(libKey(n.sourceId,n.name))}" ${batchSelection.has(libKey(n.sourceId,n.name))?'checked':''} ${batchEligible(n)?'':'disabled'}><span><b>${esc(n.name)}</b><small>${esc(n.sourceName)} · ${esc(n.ip||'出口 IP 未查询')}</small></span><span class="batch-node-state">${n.usage?`已分配 ${n.usage} 个实例 · `:''}${n.available?'检测可用':n.tested?'最近检测失败':'尚未检测'}</span></label>`).join('')||'<p class="actions-note">没有符合条件的节点。请在代理管理完成连通性检测后刷新；取消“只看可选节点”可查看不可选原因。</p>';
 $('#batchSelectedCount').textContent=`已选 ${batchSelection.size} 个节点`;
}
function invalidateBatch(){if(modal?.type!=='batch-create'||modal.busy)return;modal.batchPlan=null;$('#batchPreview').textContent='调整配置后，请生成草稿查看分配结果。';$('#batchError').textContent='';$('#batchProgress').textContent='';}
async function refreshBatchNodes(){const currentModal=modal;const rows=await request('instance-batch-options');if(modal!==currentModal)return;batchNodes=rows;const keys=new Set(rows.map(n=>libKey(n.sourceId,n.name)));batchSelection=new Set([...batchSelection].filter(k=>keys.has(k)));batchRows();}
function showBatchPlan(plan){
 const nodes=new Map(batchNodes.map(n=>[libKey(n.sourceId,n.name),n]));
 $('#batchPreview').innerHTML=`<p class="actions-note">草稿已生成：${plan.items.length} 个实例 · ${plan.random?'每个实例独立随机环境':'原生环境'} · ${plan.start?'创建后启动':'创建后保持停止'}</p><div class="batch-preview-table"><table class="data-table"><thead><tr><th>实例名称</th><th>出口</th><th>环境</th></tr></thead><tbody>${plan.items.slice(0,20).map(x=>{const node=nodes.get(libKey(x.sourceId,x.nodeName)),f=x.environment.fingerprint;return `<tr><td>${esc(x.name)}</td><td>${esc(x.localeError?(node?.name||'本机 IP 直连')+' · 查询失败':x.exitLocale?.ip||(node?(node.ip||node.name):'本机 IP 直连'))}</td><td>${x.localeError?`<span class="error">未取得地区，此项不创建</span><small>${esc(x.localeError)}</small>`:`${esc(f.enabled?`${f.template} · CPU ${x.environment.cpu} · 内存 ${f.memory}GB`:'原生浏览器环境')}<small>${esc(x.environment.language+' · '+x.environment.timezone)}</small><small>${esc(x.exitLocale?.provider||'')}${x.exitLocale?.cached?' · 复用 60 秒内查询结果':''}</small>`}</td></tr>`;}).join('')}</tbody></table></div>${plan.items.length>20?`<p class="actions-note">预览前 20 项，创建时执行全部 ${plan.items.length} 项。</p>`:''}`;
}
async function generateBatch(random){
 if(!modal||modal.busy||modal.batchPlanning)return;const target=modal;target.batchPlanning=true;target.newEnvironmentBusy=true;$('#batchProgress').textContent=$('#batchLocale').checked?'正在通过所选出口查询 IP、时区和语言…':'';if(random!==undefined)target.batchRandom=random;
 const buttons=[...$('#modal').querySelectorAll('input,select,button')];buttons.forEach(b=>b.disabled=true);
 try{const plan=await request('instance-batch-plan',batchInputs());if(modal!==target)return;target.batchPlan=plan;showBatchPlan(plan);$('#batchProgress').textContent=plan.syncLocale?'出口地区查询已结束；创建前会重新核对成功项目。':'';$('#batchError').textContent=plan.items.some(x=>x.localeError)?'部分出口查询失败，成功草稿已保留；失败项不创建，可重新生成草稿重试。'+[...new Set(plan.items.filter(x=>x.localeError).map(x=>x.nodeName||'本机直连'))].join('、'):'';}
 catch(error){if(modal===target){target.batchPlan=null;$('#batchProgress').textContent='出口地区查询已结束，未生成可创建草稿。';$('#batchError').textContent=error.message;}}
 finally{target.batchPlanning=false;target.newEnvironmentBusy=false;buttons.filter(b=>b.isConnected).forEach(b=>b.disabled=false);if(modal===target)batchRows();}
}
async function openBatchCreate(){
 openModal('new');modal.type='batch-create';modal.batchRandom=false;modal.batchPlan=null;batchSelection.clear();$('#modal').classList.add('batch-create-modal');
 $('#modal').innerHTML=`<div class="modal-head"><h2 id="modalTitle">批量创建实例</h2><button class="icon-btn" data-action="modal-close" aria-label="关闭">×</button></div><div class="batch-modal-body"><p class="description">选择数量和网络出口，为每个实例生成独立配置。确认后创建，已有实例保持原样。</p><div class="batch-form-grid"><label class="field"><span>名称前缀</span><input id="batchPrefix" maxlength="30" value="工作区"></label><label class="field"><span>创建数量</span><input id="batchCount" type="number" min="1" step="1" value="5"></label><label class="field"><span>连接方式</span><select id="batchMode"><option value="direct">本机 IP 直连</option><option value="mihomo">代理节点 / IP</option></select></label><label class="field"><span>节点分配</span><select id="batchAllocation"><option value="unique">未分配可用节点（随机不重复）</option><option value="cycle">按选择顺序循环分配（允许复用）</option></select></label></div><section id="batchNetworkFields" hidden><div class="batch-node-tools"><label><input id="batchAvailable" type="checkbox" checked> 只看可选节点</label><span id="batchSelectedCount">已选 0 个节点</span><button class="btn tiny" data-batch-action="refresh">刷新</button><button class="btn tiny" data-batch-action="select-available">全选可选</button><button class="btn tiny" data-batch-action="clear">清空</button></div><input id="batchNodeSearch" class="search" placeholder="搜索节点、来源或出口 IP" aria-label="搜索代理节点"><fieldset id="batchNodes"><legend class="visually-hidden">批量选择代理节点</legend></fieldset><p class="actions-note">默认从未被任何实例分配、最近连通检测可用的节点中随机选取，不按延迟排序；本批不重复，节点不足时不自动复用。未勾选节点时使用全部符合条件的节点，勾选后限定选择范围；停止的实例也保留节点分配。手动切换循环分配可复用节点；不同节点仍可能有相同出口 IP。</p></section><label class="batch-locale-option"><span><input id="batchLocale" type="checkbox" checked> 按实际出口 IP 匹配时区和语言</span><small>优先 IP.SB，失败切换 GeoJS / ipapi.co / ipwho.is。经所选代理查询，不回退直连；草稿可复用 60 秒内结果，创建前重新核对。查询失败的项目不创建。语言采用该地区默认值，多语言地区可在环境配置中调整；动态 IP 后续变化需要重新同步。</small></label><div class="batch-environment-tools"><button class="btn primary" data-batch-action="random">一键随机环境</button><button class="btn subtle" data-batch-action="native">原生环境草稿</button><label><input id="batchStart" type="checkbox"> 创建后启动</label></div><div id="batchPreview" class="batch-preview"><p class="actions-note">随机环境为每个实例生成独立方案，创建后可在环境配置中调整。</p></div><p id="batchProgress" class="actions-note" role="status"></p><div id="batchError" class="error" role="alert"></div></div><div class="modal-actions"><button class="btn subtle" data-action="modal-close">取消</button><button class="btn danger" data-batch-action="cancel" hidden>停止继续创建</button><button class="btn primary" data-action="confirm">创建实例</button></div>`;
 try{await refreshBatchNodes();}catch(error){if(modal?.type==='batch-create')$('#batchError').textContent=error.message;}$('#batchPrefix')?.focus();
}
async function submitBatch(){
 if(modal.busy||modal.batchPlanning)return;const target=modal;if(!target.batchPlan)await generateBatch();if(modal!==target||!target.batchPlan)return;
 target.busy=true;$('#modal').querySelectorAll('input,select,button').forEach(b=>b.disabled=true);const stop=$('[data-batch-action="cancel"]');stop.hidden=false;stop.disabled=false;
 try{
  const result=await request('instance-batch-create',{token:target.batchPlan.token});if(modal!==target)return;target.busy=false;target.batchPlan=null;
  result.results.filter(x=>x.created).forEach(x=>localOpen.add(x.id));
  $('#batchProgress').textContent=`已创建 ${result.created} 个实例，处理 ${result.done}/${result.total}，异常 ${result.failed} 个${result.cancelled?'；已停止继续创建':''}。已创建的实例已保存。`;
  $('#batchError').textContent=result.results.flatMap(x=>[x.error,x.configurationError,x.startError].filter(Boolean).map(e=>x.name+'：'+e)).join('；');
  $('#modal').querySelectorAll('[data-action="modal-close"]').forEach(b=>{b.disabled=false;b.textContent=b.classList.contains('icon-btn')?'×':'关闭';});stop.hidden=true;
  const confirmButton=$('#modal [data-action="confirm"]');confirmButton.textContent='查看实例';confirmButton.disabled=false;target.batchFinished=true;render(true);
 }catch(error){target.busy=false;target.batchPlan=null;$('#batchError').textContent=error.message;$('#modal').querySelectorAll('input,select,button').forEach(b=>b.disabled=false);stop.hidden=true;batchRows();}
}
document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-action="new-batch"], [data-batch-action], [data-action="confirm"]');if(!button||button.disabled)return;
 if(button.dataset.action==='new-batch'){event.stopImmediatePropagation();await openBatchCreate();return;}
 if(modal?.type!=='batch-create')return;event.stopImmediatePropagation();
 if(button.dataset.action==='confirm'){if(modal.batchFinished){closeModal(true);await route('overview');}else await submitBatch();return;}
 try{const action=button.dataset.batchAction;if(action==='cancel'){await request('instance-batch-cancel');button.disabled=true;button.textContent='正在停止…';return;}if(modal.busy)return;
  if(action==='random'||action==='native'){await generateBatch(action==='random');return;}
  if(action==='refresh')await refreshBatchNodes();
  if(action==='select-available')batchNodes.filter(n=>n.available&&batchEligible(n)).forEach(n=>batchSelection.add(libKey(n.sourceId,n.name)));
  if(action==='clear')batchSelection.clear();invalidateBatch();batchRows();
 }catch(error){$('#batchError').textContent=error.message;}
},true);
document.addEventListener('input',event=>{if(modal?.type!=='batch-create'||modal.busy)return;if(event.target.id==='batchNodeSearch'){batchRows();return;}if(event.target.closest('#modal'))invalidateBatch();});
document.addEventListener('change',event=>{if(modal?.type!=='batch-create'||modal.busy)return;const e=event.target;if(e.dataset.batchNode){e.checked?batchSelection.add(e.dataset.batchNode):batchSelection.delete(e.dataset.batchNode);}if(e.closest('#modal')){invalidateBatch();batchRows();}});
bridge?.onState(next=>{if(modal?.type!=='batch-create'||!modal.busy)return;const job=next.batchCreation;if(job)$('#batchProgress').textContent=`正在创建 ${job.done}/${job.total} · 已创建 ${job.created} 个 · 异常 ${job.failed} 个${job.cancelling?' · 正在停止…':''}`;});
