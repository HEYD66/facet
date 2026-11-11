'use strict';
// 代理管理 → 获取免费节点。任务在主进程运行，进度随状态快照下发；关闭对话框不会停止任务。
let freeNodesWatched = null;

function freeNodesButtonLabel() {
  const job = state.freeNodes;
  return job?.running ? `正在获取免费节点 ${job.usable} / ${job.target}…` : '获取免费节点';
}
function freeNodesSummary(job) {
  const result = job.result || {}, count = result.imported || 0;
  if (result.error) return count ? `已导入 ${count} 个免费节点；任务提前结束：${result.error}` : result.error;
  if (result.cancelled) return count ? `已停止，已导入验证通过的 ${count} 个免费节点` : '已停止，没有导入节点';
  if (count) return `完成：验证了 ${job.checked} 个候选，导入 ${count} 个节点到“免费节点”`;
  return `验证了 ${job.checked} 个候选，没有找到可用节点。免费节点存活率低，可以稍后再试，或调大“最多验证的候选数”`;
}
function freeNodesStatus(job) {
  if (!job.running) return freeNodesSummary(job);
  if (job.cancelling) return `正在停止… 已找到 ${job.usable} 个`;
  if (job.stage === 'fetch') return `正在下载公开列表 ${job.sources.filter(source => source.state !== 'loading').length} / ${job.sources.length}…`;
  if (job.stage === 'save') return `正在保存 ${job.usable} 个节点…`;
  return `正在验证 ${job.checked} / ${job.total} 个候选 · 已找到 ${job.usable} / ${job.target} 个（公开代理 ${job.plain} · 加密节点 ${job.encrypted}）`;
}
function freeNodesProgress(job) {
  if (!job.running) return 1;
  if (job.stage === 'fetch') return job.sources.length ? 0.1 * job.sources.filter(source => source.state !== 'loading').length / job.sources.length : 0;
  if (job.stage === 'save') return 1;
  return 0.1 + 0.9 * Math.min(1, Math.max(job.target ? job.usable / job.target : 0, job.total ? job.checked / job.total : 0));
}
function openFreeNodes() {
  openModal('library-confirm');
  const job = state.freeNodes, kinds = job?.kinds || ['plain', 'encrypted'];
  modal.freeNodes = { starting: false, sources: '' };
  $('#modal').classList.add('proxy-entry-modal');
  $('#modal').innerHTML = `<div class="modal-head"><div><h2 id="modalTitle">获取免费节点</h2><p class="actions-note">从公开列表下载候选节点，逐个通过内置 Mihomo 访问 HTTPS 并取得出口 IP，验证通过的才导入“免费节点”源。</p></div><button class="icon-btn" data-action="modal-close" aria-label="关闭">×</button></div>
  <p class="guide">免费节点由身份不明的第三方运营，存活时间短，速度和稳定性没有保证。公开 HTTP / SOCKS5 代理不加密，对方能看到并改动未加密的流量。请不要用免费节点登录重要账号。</p>
  <form id="freeNodesForm"><span class="entry-label">节点类型</span><div class="free-nodes-kinds"><label><input type="checkbox" id="freeNodesPlain" ${kinds.includes('plain') ? 'checked' : ''}> 公开 HTTP / SOCKS5 代理</label><label><input type="checkbox" id="freeNodesEncrypted" ${kinds.includes('encrypted') ? 'checked' : ''}> 加密协议节点（SS、VMess、VLESS、Trojan 等）</label></div>
  <div class="proxy-field-grid"><label class="field"><span>要找到的节点数（1–500）</span><input id="freeNodesTarget" inputmode="numeric" maxlength="3" autocomplete="off" value="${esc(job?.target || 30)}"></label><label class="field"><span>最多验证的候选数（1–2000）</span><input id="freeNodesLimit" inputmode="numeric" maxlength="4" autocomplete="off" value="${esc(job?.limit || 400)}"></label></div>
  <label class="free-nodes-replace"><input type="checkbox" id="freeNodesReplace" ${job?.replace ? 'checked' : ''}> 找到新节点后清空原有免费节点（默认保留原有节点，只追加新的）</label>
  <div id="freeNodesProgress" class="free-nodes-progress" hidden><p id="freeNodesStatus" role="status"></p><progress class="update-progress" id="freeNodesBar" max="1" value="0" aria-label="获取免费节点进度"></progress><ul id="freeNodesSources" class="free-nodes-sources" aria-label="公开列表"></ul></div>
  <p id="freeNodesError" class="error" role="alert" hidden></p>
  <div class="modal-actions"><button class="btn subtle" type="button" data-action="modal-close">关闭</button><button class="btn" type="button" data-free-nodes="view" hidden>查看节点</button><button class="btn danger" type="button" data-free-nodes="stop" hidden>停止</button><button class="btn primary" type="submit" data-free-nodes="start">开始获取</button></div></form>`;
  $('#freeNodesForm').addEventListener('submit', event => { event.preventDefault(); startFreeNodes(); });
  paintFreeNodes();
}
function paintFreeNodes() {
  const entry = modal?.freeNodes;
  if (!entry || !$('#freeNodesForm')) return;
  const job = state.freeNodes, running = !!job?.running, locked = running || entry.starting;
  for (const id of ['freeNodesPlain', 'freeNodesEncrypted', 'freeNodesTarget', 'freeNodesLimit', 'freeNodesReplace']) $('#' + id).disabled = locked;
  const start = $('[data-free-nodes="start"]'), stop = $('[data-free-nodes="stop"]'), view = $('[data-free-nodes="view"]');
  start.hidden = running; start.disabled = entry.starting; start.textContent = job ? '再获取一批' : '开始获取';
  stop.hidden = !running; stop.disabled = !!job?.cancelling; stop.textContent = job?.cancelling ? '正在停止…' : '停止';
  view.hidden = running || !job?.result?.sourceId;
  $('#freeNodesProgress').hidden = !job;
  if (!job) return;
  const status = $('#freeNodesStatus');
  status.textContent = freeNodesStatus(job);
  status.classList.toggle('error', !running && !!job.result?.error && !job.result.imported);
  $('#freeNodesBar').value = freeNodesProgress(job);
  const labels = { loading: '下载中', failed: '下载失败', cancelled: '已停止' };
  const sources = job.sources.map(source => `<li class="${esc(source.state)}"><b>${esc(source.name)}</b><span>${source.state === 'ok' ? source.candidates + ' 个候选' : labels[source.state] || ''}</span></li>`).join('');
  if (sources !== entry.sources) { entry.sources = sources; $('#freeNodesSources').innerHTML = sources; }
}
async function startFreeNodes() {
  const entry = modal?.freeNodes;
  if (!entry || entry.starting || state.freeNodes?.running) return;
  const error = $('#freeNodesError');
  error.hidden = true;
  const kinds = [['plain', 'freeNodesPlain'], ['encrypted', 'freeNodesEncrypted']].filter(([, id]) => $('#' + id).checked).map(([kind]) => kind);
  const target = Number($('#freeNodesTarget').value.trim()), limit = Number($('#freeNodesLimit').value.trim());
  const problem = !kinds.length ? '请至少选择一种节点类型'
    : !Number.isInteger(target) || target < 1 || target > 500 ? '要找到的节点数须为 1–500 的整数'
    : !Number.isInteger(limit) || limit < 1 || limit > 2000 ? '最多验证的候选数须为 1–2000 的整数'
    : limit < target ? '最多验证的候选数不能小于要找到的节点数' : '';
  if (problem) { error.textContent = problem; error.hidden = false; return; }
  entry.starting = true;
  paintFreeNodes();
  try {
    await request('library-free-start', { kinds, target, limit, replace: $('#freeNodesReplace').checked });
    state = await request('snapshot');
    if (state.freeNodes?.running) freeNodesWatched = state.freeNodes.id;
  } catch (failure) {
    if (modal?.freeNodes === entry) { error.textContent = failure.message; error.hidden = false; }
  } finally {
    entry.starting = false;
    if (modal?.freeNodes === entry) paintFreeNodes();
    paintFreeNodesButton();
  }
}
function paintFreeNodesButton() {
  const label = freeNodesButtonLabel();
  document.querySelectorAll('[data-free-nodes-label]').forEach(element => { if (element.textContent !== label) element.textContent = label; });
}
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-free-nodes]');
  if (!button || button.disabled || !modal?.freeNodes) return;
  const action = button.dataset.freeNodes;
  if (action === 'stop') {
    button.disabled = true;
    try { await request('library-free-cancel'); }
    catch (failure) { toast(failure.message); }
    return;
  }
  if (action === 'view') {
    const id = state.freeNodes?.result?.sourceId;
    if (id && state.library?.some(source => source.id === id)) { librarySource = id; librarySearch = ''; libraryRegion = ''; libraryProtocol = ''; libraryPageIndex = 0; librarySelected.clear(); }
    closeModal(true);
    render(true);
  }
});
bridge?.onState(next => {
  const job = next.freeNodes;
  if (job?.running) freeNodesWatched = job.id;
  else if (job && freeNodesWatched === job.id) {
    freeNodesWatched = null;
    // With the dialog open the result is already on screen.
    if (!modal?.freeNodes) toast(freeNodesSummary(job));
  }
  paintFreeNodes();
  paintFreeNodesButton();
});
