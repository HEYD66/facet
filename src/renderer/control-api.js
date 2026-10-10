'use strict';
function controlApiCardHTML(){
 const c=state.control||{enabled:false,running:false,apiPort:null,cdpPort:null,token:null,restartRequired:false};
 return `<section class="settings-card full" id="controlApiCard"><h3>${icon('monitor')}外部控制（本机 API + CDP）</h3><div class="inner"><div class="control-api-row"><label class="switch-row"><input id="controlApiEnabled" class="switch" type="checkbox" role="switch" ${c.enabled?'checked':''}><b>允许本机外部工具控制实例</b></label><span class="status ${c.running?'running':'stopped'}"><i class="dot ${c.running?'running':'stopped'}"></i>${c.running?'API 已运行':'已关闭'}</span></div><p class="actions-note">只监听 127.0.0.1。启用后可用 Playwright 通过 CDP 控制网页，并用本地 API 启停实例、跳转网址和查询实例对应的页面目标。</p>${c.enabled?`<div class="control-api-details"><div><span>API 地址</span><code>http://127.0.0.1:${c.apiPort||'—'}</code></div><div><span>CDP 端口</span><code>${c.cdpPort||'—'}</code></div><div><span>访问令牌</span><code>${esc(c.token||'')}</code></div></div><div class="row"><button class="btn subtle" type="button" id="controlApiRegenerate">重新生成令牌</button><button class="btn soft" type="button" id="controlApiCopy">复制连接信息</button></div><p class="actions-note">${c.restartRequired?'API 已可用；请重启千面后，CDP 端口才会开放。':'API 和 CDP 已可用。关闭开关后会立即停止 API，CDP 关闭需重启应用。'}</p>`:''}<p id="controlApiMessage" class="actions-note" role="status"></p></div></section>`;
}
async function controlApiMount(){
 const card=$('#controlApiCard');if(!card)return;
 const toggle=$('#controlApiEnabled');toggle?.addEventListener('change',async()=>{
  toggle.disabled=true;
  try{state.control=await request('control-save',{enabled:toggle.checked});settingsPage();}
  catch(error){toggle.checked=!toggle.checked;$('#controlApiMessage').textContent=error.message;toggle.disabled=false;}
 });
 $('#controlApiRegenerate')?.addEventListener('click',async()=>{try{state.control=await request('control-save',{enabled:true,regenerateToken:true});settingsPage();}catch(error){$('#controlApiMessage').textContent=error.message;}});
 $('#controlApiCopy')?.addEventListener('click',async()=>{const c=state.control||{};try{await request('control-copy',{text:`API: http://127.0.0.1:${c.apiPort}\nCDP: http://127.0.0.1:${c.cdpPort}\nToken: ${c.token}`});$('#controlApiMessage').textContent='连接信息和说明书入口已复制';}catch{$('#controlApiMessage').textContent='复制失败，请检查系统剪贴板权限';}});
}
