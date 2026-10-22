"use strict";
let libraryTargetId = "";
const diagnosticConsent = new Set();
let libraryConcurrency = 3,
  librarySort = "original",
  libraryOnly = "all",
  libraryIncludeHints = false,
  libraryMinSuccess = 0,
  libraryRegion = "",
  libraryProtocol = "";
let librarySource = "",
  librarySearch = "",
  libraryPageIndex = 0,
  libraryBusy = false;
const librarySelected = new Set();
// 「全部节点源」：librarySource 为 "*" 时表格合并所有节点源；已选用「节点源ID + 节点名」区分不同订阅里的同名节点。
const LIBRARY_ALL = "*";
const libKey = (sourceId, name) => sourceId + "\u0001" + name;
function selectedItems() {
  return [...librarySelected].map((k) => {
    const i = k.indexOf("\u0001");
    return { sourceId: k.slice(0, i), name: k.slice(i + 1) };
  });
}
function rowSource(el) {
  return el?.closest?.("tr[data-source]")?.dataset.source || (librarySource === LIBRARY_ALL ? "" : librarySource);
}
function libraryPage() {
  const scroll = $("#content").scrollTop;
  if (!state.instances.some((x) => x.id === libraryTargetId))
    libraryTargetId = state.instances.some((x) => x.id === activeId)
      ? activeId
      : state.instances[0]?.id || "";
  const sources = state.library || [];
  if (librarySource === LIBRARY_ALL ? sources.length < 2 : !sources.some((s) => s.id === librarySource)) librarySource = sources[0]?.id || "";
  const all = librarySource === LIBRARY_ALL;
  const rows = (all ? sources : sources.filter((s) => s.id === librarySource)).flatMap((s) => s.nodes.map((n) => ({ ...n, sid: s.id })));
  const rowKeys = new Set(rows.map((n) => libKey(n.sid, n.name)));
  for (const key of librarySelected) if (!rowKeys.has(key)) librarySelected.delete(key);
  syncDiagnosticHistory();
  const latency = (n) => nodeOutcome(n.sid, n.name, "latency").r;
  const visible = rows.filter((n) => libraryIncludeHints || !n.hint);
  const regionCounts = countBy(visible, (n) => nodeRegion(n.name)),
    protocolCounts = countBy(visible, (n) => String(n.type || "").toLowerCase());
  if (libraryRegion && !regionCounts.has(libraryRegion)) libraryRegion = "";
  if (libraryProtocol && !protocolCounts.has(libraryProtocol)) libraryProtocol = "";
  const filtered = visible.filter(
    (n) =>
      (!libraryRegion || nodeRegion(n.name) === libraryRegion) &&
      (!libraryProtocol || String(n.type || "").toLowerCase() === libraryProtocol) &&
      (n.name + " " + n.type).toLowerCase().includes(librarySearch.toLowerCase()) &&
      (libraryOnly === "all" ||
        (libraryOnly === "favorites" && favoriteExists(n.sid, n.name)) ||
        (libraryOnly === "available" && latency(n)?.ok)) &&
      (!libraryMinSuccess || nodeStats(n.sid, n.name).ok >= libraryMinSuccess),
  );
  if (librarySort === "name") filtered.sort((a, b) => a.name.localeCompare(b.name));
  if (librarySort === "latency")
    filtered.sort(
      (a, b) =>
        (latency(a)?.ok ? latency(a).latencyMs : Infinity) -
        (latency(b)?.ok ? latency(b).latencyMs : Infinity),
    );
  if (librarySort === "favorite")
    filtered.sort(
      (a, b) => Number(favoriteExists(b.sid, b.name)) - Number(favoriteExists(a.sid, a.name)),
    );
  const pages = Math.max(1, Math.ceil(filtered.length / 100));
  libraryPageIndex = Math.min(libraryPageIndex, pages - 1);
  const nodes = filtered.slice(libraryPageIndex * 100, libraryPageIndex * 100 + 100);
  const help = (text, label = "说明") =>
    `<details class="inline-help"><summary>${icon("info")}<span>${esc(label)}</span></summary><p>${esc(text)}</p></details>`;
  $("#content").innerHTML =
    `<div id="libraryTaskbar" class="library-taskbar" role="status"></div><section class="settings-card proxy-workbench" id="librarySubscriptionCard"><aside class="proxy-sources"><div class="panel-head"><h3>节点源</h3><span class="tag">${sources.length} / 30</span></div><div class="library-sources">${(sources.length > 1 ? allSourcesHTML(sources) : "") + sources.map(sourceGroupHTML).join("") || '<p class="actions-note empty-sources">尚无订阅。在下方保存后即可选择节点。</p>'}</div><div class="source-add"><button class="btn soft wide" type="button" data-lib="add-source">${icon("plus")}添加节点源</button>${help("支持 Clash / Mihomo 订阅、本地 YAML/JSON 和单个 HTTP、HTTPS、SOCKS5 代理。剪贴板常见格式：用户名:密码@主机:端口、主机:端口:用户名:密码、用户名:密码:主机:端口、主机:端口@用户名:密码。更新或删除全局源不会修改已分配给实例的节点副本。")}</div></aside>
 <section class="library-nodes library-node-management"><div class="library-form node-filters"><label class="field"><span>节点源</span><select id="librarySource">${sources.length > 1 ? `<option value="${LIBRARY_ALL}" ${all ? "selected" : ""}>全部节点源（${sources.length}）</option>` : ""}${sources.map((s) => `<option value="${s.id}" ${s.id === librarySource ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label><label class="field"><span>搜索节点</span><input id="librarySearch" value="${esc(librarySearch)}" placeholder="名称 / 协议"></label></div><div class="library-controls"><label>并发 <select id="libraryConcurrency">${[1, 2, 3, 4, 5, 6, 8, 10, 12, 16].map((n) => `<option ${n === libraryConcurrency ? "selected" : ""}>${n}</option>`).join("")}</select></label><label>排序 <select id="librarySort">${[
   ["original", "订阅顺序"],
   ["latency", "延迟升序"],
   ["favorite", "收藏优先"],
   ["name", "节点名称"],
 ]
   .map(([v, l]) => `<option value="${v}" ${v === librarySort ? "selected" : ""}>${l}</option>`)
   .join("")}</select></label><label>筛选 <select id="libraryOnly">${[
   ["all", "全部"],
   ["favorites", "仅收藏"],
   ["available", "最近连通成功"],
 ]
   .map(([v, l]) => `<option value="${v}" ${v === libraryOnly ? "selected" : ""}>${l}</option>`)
   .join(
     "",
   )}</select></label><label>成功 <select id="libraryMinSuccess" title="连通性与出口 IP 的累计成功次数">${[
   [0, "不限"],
   [1, "≥1 次"],
   [2, "≥2 次"],
   [3, "≥3 次"],
   [5, "≥5 次"],
   [10, "≥10 次"],
 ]
   .map(([v, l]) => `<option value="${v}" ${v === libraryMinSuccess ? "selected" : ""}>${l}</option>`)
   .join("")}</select></label><label class="check-label"><input type="checkbox" id="libraryIncludeHints" ${libraryIncludeHints ? "checked" : ""}> 显示疑似订阅提示</label>${help("独立模式下检测使用独立临时内核；共享模式下检测复用节点端口。检测结束不影响其他使用者，无直连回退。延迟为访问 Cloudflare 的 HTTPS 首响应耗时，不是 ICMP Ping。IP 与地区来自 IP.SB 及备用服务，地区仅供参考。延迟柱条越短越快：≤300 ms 为绿色，301–800 ms 为黄色，超过 800 ms 为红色；柱长统一按 1000 ms 显示，超出则封顶，毫秒数保留。下载测速每次约 5 MB。结果显示在对应节点行，悬停可查看地区、错误原因和检测时间。", "检测说明")}</div><div id="nodePortService" class="node-port-service"></div>${nodeChipsHTML(visible.length, regionCounts, protocolCounts)}<div class="subscription-actions node-batch"><button class="btn tiny" data-lib="batch-latency">${icon("bolt")}批量连通性 / 延迟</button><button class="btn tiny" data-lib="batch-ip">${icon("globe")}批量出口 IP</button><button class="btn tiny" data-lib="assign-many" ${librarySelected.size ? "" : "disabled"} title="把已选节点分别分配给多个实例">分配给多个实例…</button><button class="btn ghost danger tiny" data-lib="delete-selected" ${librarySelected.size ? "" : "disabled"}>删除已选</button><span class="actions-note selection-count">已选 <span id="librarySelectionCount">${librarySelected.size}</span> · 共 ${filtered.length} 个节点</span></div><div class="library-table"><table class="logs-table compact-node-table"><thead><tr><th class="col-check"><input type="checkbox" id="librarySelectAll" aria-label="全选本页节点" title="全选 / 取消全选本页节点"></th><th>节点 / 协议</th><th>连通性 / 延迟</th><th>出口 IP</th><th>下载速度</th><th class="col-actions">操作</th></tr></thead><tbody>${nodes.map((n) => `<tr data-hint="${!!n.hint}" data-source="${n.sid}"><td><input type="checkbox" data-library-node="${esc(n.name)}" ${n.hint ? "disabled" : ""} ${librarySelected.has(libKey(n.sid, n.name)) ? "checked" : ""} aria-label="选择 ${esc(n.name)}"></td><td class="node-identity"><div class="node-heading"><button class="node-favorite" data-lib="favorite" data-node="${esc(n.name)}" title="${favoriteExists(n.sid, n.name) ? "取消收藏" : "收藏节点"}" ${n.hint ? "disabled" : ""}>${favoriteExists(n.sid, n.name) ? "★" : "☆"}</button>${all ? nodeSourceMark(sources.find((s) => s.id === n.sid)) : ""}<span class="node-name" title="${esc(n.name)}">${esc(n.name)}</span><small class="node-protocol">${esc(n.type)}</small></div><span class="node-metadata"><small class="node-origin" title="${esc(sources.find(s=>s.id===n.sid)?.name||'来源不可用')}">来源：${esc(sources.find(s=>s.id===n.sid)?.name||'来源不可用')}</small><small class="node-port" data-port-node="${esc(n.name)}"></small><small class="node-stat" data-stat-node="${esc(n.name)}"></small></span></td>${["latency", "ip", "speed"].map((kind) => `<td class="node-result" data-result-node="${esc(n.name)}" data-result-kind="${kind}">—</td>`).join("")}<td class="col-actions"><div class="row-actions"><button class="btn tiny" data-lib="assign" data-node="${esc(n.name)}" ${n.hint ? "disabled" : ""}>分配</button><details class="row-menu"><summary class="icon-btn" title="更多操作" aria-label="${esc(n.name)} 的更多操作">${icon("more")}</summary><div class="menu"><button class="menu-item" data-lib="latency" data-node="${esc(n.name)}">${icon("bolt")}连通性检测</button><button class="menu-item" data-lib="ip" data-node="${esc(n.name)}">${icon("globe")}查询出口 IP</button><button class="menu-item" data-lib="speed" data-node="${esc(n.name)}">${icon("download")}下载测速（约 5 MB）</button><hr><button class="menu-item" data-lib="copy-node-http" data-node="${esc(n.name)}">复制 HTTP 代理地址</button><button class="menu-item" data-lib="copy-node-socks" data-node="${esc(n.name)}">复制 SOCKS5 代理地址</button><hr><button class="menu-item danger" data-lib="delete-node" data-node="${esc(n.name)}">${icon("trash")}删除节点</button></div></details></div></td></tr>`).join("") || '<tr><td colspan="6" class="empty-list">没有匹配节点</td></tr>'}</tbody></table></div><div class="subscription-actions pager"><button class="btn tiny ghost" data-lib="prev" ${libraryPageIndex === 0 ? "disabled" : ""}>上一页</button><span>${libraryPageIndex + 1} / ${pages}</span><button class="btn tiny ghost" data-lib="next" ${libraryPageIndex + 1 >= pages ? "disabled" : ""}>下一页</button></div></section></section>`;
  renderDiagnostics();
  $("#content").scrollTop = scroll;
}
let proxyModePending = null;
function renderNodePorts() {
  const service = $("#nodePortService");
  if (!service) return;
  const status = state.nodePorts || {}, failures = status.lastResult?.failed || [], nodeMode = status.mode === "node" || status.enabled;
  if (proxyModePending === (nodeMode ? "node" : "instance") && !status.busy) proxyModePending = null;
  service.closest(".proxy-workbench").dataset.proxyMode = nodeMode ? "node" : "instance";
  const currentMode = nodeMode ? "node" : "instance";
  const modes = [
    ["instance", "独立代理", "每个实例单独运行", "每个代理实例一个内核，进程和内存开销较多。"],
    ["node", "共享代理", "每个节点分配端口", "节点共用内核，本机其他软件也能连接节点端口。"],
  ];
  service.innerHTML = `<div class="proxy-mode-heading"><strong>代理运行方式</strong><span class="actions-note">二选一 · 对全部代理实例生效</span></div>
    <div class="proxy-mode-options" role="group" aria-label="代理运行方式">${modes.map(([mode,label,subtitle,description])=>{
      const active = currentMode === mode, pending = proxyModePending === mode;
      return `<button type="button" class="proxy-mode-card${pending ? " is-pending" : ""}" data-lib="ports-mode" data-mode="${mode}" aria-pressed="${active}" ${status.busy ? "disabled" : ""}><span class="proxy-mode-card-heading"><span class="proxy-mode-card-title"><span class="proxy-mode-indicator" aria-hidden="true"></span>${label}<span class="proxy-mode-subtitle">${subtitle}</span></span><span class="proxy-mode-badge">${active ? "✓ 使用中" : pending ? "待确认" : "点击切换"}</span></span><span class="proxy-mode-description">${description}</span></button>`;
    }).join("")}</div>
    <div class="proxy-mode-status"><span class="actions-note" role="status">${status.switching ? "正在切换并恢复实例…" : status.busy ? "同步中…" : nodeMode ? `${status.listeners || 0} 个端口 · ${status.processes || 0} 个共享内核` : "当前：每个代理实例独立运行内核"}</span>${nodeMode ? `<button class="btn tiny" data-lib="ports-sync" ${status.busy ? "disabled" : ""}>同步 / 重试</button><button class="btn tiny" data-lib="copy-all-node-ports" ${!status.listeners || status.busy ? "disabled" : ""}>复制全部地址</button><span class="actions-note">仅本机 HTTP / SOCKS5 · 重启尽量保留端口</span>` : ""}</div>
    ${nodeMode ? `<p class="proxy-mode-isolation actions-note">仅共享代理进程，Cookie 和网站数据仍按实例隔离。</p>` : ""}
    ${nodeMode && failures.length ? `<details class="node-port-failures"><summary>${failures.length} 个启动失败</summary><ul>${failures.slice(0,50).map(row=>`<li>${esc(row.name)}：${esc(row.error)}</li>`).join("")}</ul></details>` : ""}
    ${proxyModePending ? `<div class="proxy-mode-confirm" role="alert"><span>即将切换为${proxyModePending === "node" ? "共享代理" : "独立代理"}。切换会取消检测、重启代理实例，未保存的网页输入可能丢失；切回独立模式会关闭供外部软件使用的节点端口。</span><button class="btn tiny primary" data-lib="ports-mode-confirm" ${status.busy ? "disabled" : ""}>确认切换</button><button class="btn tiny" data-lib="ports-mode-cancel" ${status.busy ? "disabled" : ""}>取消</button></div>` : ""}`;
  for (const cell of service.closest(".library-nodes").querySelectorAll("[data-port-node]")) {
    const sid = rowSource(cell), node = state.library?.find(source=>source.id===sid)?.nodes.find(row=>row.name===cell.dataset.portNode), proxy = node?.localProxy;
    cell.innerHTML = nodeMode && proxy?.port ? `<button class="node-port-copy ${proxy.running ? "is-active" : ""}" data-lib="copy-node-http" data-node="${esc(node.name)}" ${proxy.running ? "" : "disabled"} title="${proxy.running ? "HTTP / SOCKS5 共用此端口；点击复制 HTTP 地址" : "上次分配的端口；启动节点后可连接"}">所用端口：127.0.0.1:${proxy.port}${proxy.running ? "" : " · 未启动"}</button>` : nodeMode ? "所用端口：未分配" : node?.activeProxies?.length ? [...new Map(node.activeProxies.map(item=>[item.port,item])).values()].map(item=>`<span title="${esc(node.activeProxies.filter(row=>row.port===item.port).map(row=>row.instanceName).join('、'))}">所用端口：127.0.0.1:${item.port}（${esc(item.instanceName)}）</span>`).join(" · ") : "所用端口：未启动";
  }
}
function renderDiagnostics() {
  renderNodePorts();
  refreshIPBookmarks();
  if (!$("#libraryTaskbar")) return;
  syncDiagnosticHistory();
  const d = state.diagnostics || { results: [] },
    job = d.job;
  document.querySelectorAll("[data-source-stats]").forEach((el) => {
    if (el.dataset.sourceStats === LIBRARY_ALL) {
      el.textContent = allSourcesStatsText(state.library || []);
      return;
    }
    const s = state.library?.find((x) => x.id === el.dataset.sourceStats);
    if (!s) return;
    const hints = s.nodes.filter((n) => n.hint).length,
      favs = state.favorites?.nodes.filter((n) => n.sourceId === s.id).length || 0,
      ok = s.nodes.filter((n) => nodeOutcome(s.id, n.name, "latency").r?.ok).length;
    el.textContent = sourceStatsText(s, hints, favs, ok);
  });
  const bar = $("#libraryTaskbar");
  if (bar)
    bar.innerHTML = job
      ? `<div><strong>${job.cancelling ? "正在取消检测…" : "正在检测：" + esc(job.name)}</strong><small>${job.done} / ${job.total} · 并发 ${job.concurrency || 1} · ${esc({ latency: "连通性 / 延迟", ip: "出口 IP", speed: "下载测速" }[job.kind])}</small></div><button class="btn danger tiny" data-lib="cancel-test" ${job.cancelling ? "disabled" : ""}>取消检测</button>`
      : diagnosticSummaryHTML(d.lastJob);
  document
    .querySelectorAll(
      '[data-lib="latency"],[data-lib="ip"],[data-lib="speed"],[data-lib="batch-latency"],[data-lib="batch-ip"]',
    )
    .forEach((b) => (b.disabled = !!job || b.closest("tr")?.dataset.hint === "true"));
  document.querySelectorAll("[data-stat-node]").forEach((el) => {
    const st = nodeStats(rowSource(el), el.dataset.statNode);
    el.textContent = st.total ? `成功 ${st.ok}/${st.total}` : "";
    el.title = st.total
      ? `累计检测：连通性 ${st.latency.ok}/${st.latency.total} · 出口 IP ${st.ip.ok}/${st.ip.total}`
      : "";
    el.className = "node-stat" + (st.total ? (st.ok / st.total >= 0.8 ? " good" : st.ok / st.total < 0.4 ? " bad" : "") : "");
  });
  syncLibrarySelectAll();
  document.querySelectorAll("[data-result-node]").forEach((cell) => {
    const kind = cell.dataset.resultKind,
      name = cell.dataset.resultNode,
      sid = rowSource(cell),
      outcome = nodeOutcome(sid, name, kind),
      r = outcome.r,
      saved = outcome.saved;
    const queued =
      job?.kind === kind ? job.items?.find((x) => x.sourceId === sid && x.name === name) : null;
    const running = queued?.state === "running";
    cell.className =
      "node-result " +
      (running
        ? "pending"
        : r
          ? r.ok
            ? "success"
            : r.error === "已取消"
              ? "untested"
              : "failure"
          : "untested") +
      (saved && !running ? " saved" : "");
    let text = "—",
      detail = "尚未检测";
    if (r) {
      detail =
        new Date(r.at).toLocaleString() +
        " · " +
        (r.provider || "") +
        " · " +
        (r.ok
          ? r.kind === "ip"
            ? [r.country, r.region, r.city, r.isp].filter(Boolean).join(" / ")
            : r.kind === "speed"
              ? `${(r.bytes / 1000000).toFixed(1)} MB / ${(r.elapsedMs / 1000).toFixed(2)} 秒`
              : "可连接"
          : r.error) +
        (saved ? "（上次保存的结果）" : "");
      text = r.ok
        ? kind === "latency"
          ? r.latencyMs + " ms"
          : kind === "ip"
            ? r.ip
            : r.mbps + " Mbps"
        : diagnosticFailureLabel(r.error);
    }
    if (queued?.state === "queued") {
      text = "等待中";
      detail = "已加入检测队列";
    }
    if (running) {
      text = job.cancelling ? "取消中…" : "检测中…";
      detail = "当前检测进行中" + (r ? "；上次结果：" + detail : "");
    }
    cell.innerHTML = `<button class="node-result-value" data-lib="result-detail" data-node="${esc(name)}" data-kind="${kind}" title="${esc(detail)}" ${r ? "" : "disabled"}>${kind==='latency'?`<span class="latency-history"><b>${esc(text)}</b>${connectivityBars(nodeHistory(sid,name)?.latency?.recent,76,28)}</span>`:esc(text)}</button>${r?.ok && kind === "ip" ? `<button class="save-ip ${ipBookmark(r.ip) ? "is-saved" : ""}" data-lib="save-result-ip" data-ip="${esc(r.ip)}" data-node="${esc(name)}" aria-pressed="${!!ipBookmark(r.ip)}" title="${ipBookmark(r.ip) ? "已收藏，点击取消收藏" : "收藏此出口IP"}" ${ipBookmarkBusy.has(ipKey(r.ip)) ? "disabled" : ""}>${ipBookmarkBusy.has(ipKey(r.ip)) ? "保存中…" : ipBookmark(r.ip) ? "★ 已收藏" : "＋收藏"}</button>` : ""}`;
  });
}

function libraryConfirm(title, description, operation, payload) {
  openModal("library-confirm");
  $("#modalTitle").textContent = title;
  $("#modal .description").textContent = description;
  modal.operation = operation;
  modal.payload = payload;
}


document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-lib]");
  if (!button || button.disabled) return;
  const action = button.dataset.lib,
    sourceId = button.dataset.source || rowSource(button),
    source = state.library?.find((s) => s.id === sourceId);
  try {
    if (action === "ports-mode-cancel") { proxyModePending = null; renderNodePorts(); return; }
    if (action === "ports-mode") {
      if (button.dataset.mode === (state.nodePorts?.enabled ? "node" : "instance")) return;
      proxyModePending = button.dataset.mode; renderNodePorts(); return;
    }
    if (action === "ports-mode-confirm" || action === "ports-sync") {
      button.disabled = true;
      try {
        const result = await request(action === "ports-mode-confirm" ? "proxy-mode-set" : "node-ports-sync", action === "ports-mode-confirm" ? { mode: proxyModePending, confirmed: true } : {});
        proxyModePending = null;
        toast(result?.restartFailed?.length ? "模式已切换，部分实例未能恢复，请查看实例日志" : result?.failed?.length ? "部分节点端口启动失败，请查看端口服务详情" : "代理模式已更新");
      } finally { renderNodePorts(); }
      return;
    }
    if (action === "copy-all-node-ports") { const result = await request("node-ports-copy"); toast("已复制 " + result.count + " 个节点地址"); return; }
    if (action === "copy-node-http" || action === "copy-node-socks") {
      await request("node-port-copy", { sourceId, name: button.dataset.node, protocol: action === "copy-node-socks" ? "socks5" : "http" });
      toast("已复制本机代理地址"); return;
    }
    if (action === "add-source") { openProxyEntry(); return; }
    if (action === "region" || action === "protocol") {
      if (action === "region") libraryRegion = button.dataset.value || "";
      else libraryProtocol = button.dataset.value || "";
      libraryPageIndex = 0;
      librarySelected.clear();
      libraryPage();
      return;
    }
    if (action === "assign-many") {
      openAssignManyDialog();
      return;
    }
    if (action === "result-detail") {
      showDiagnosticDetail(sourceId, button.dataset.node, button.dataset.kind);
      return;
    }
    if (action === "refresh-order") {
      libraryPage();
      return;
    }
    if (action === "retry-failed") {
      const last = state.diagnostics?.lastJob;
      const items = (last?.items || [])
        .filter((x) => x.state === "failed")
        .map((x) => ({ sourceId: x.sourceId, name: x.name }));
      if (items.length) confirmDiagnostic(last.kind, items);
      return;
    }
    if (action === "favorite") {
      await request("favorite-node", { sourceId, name: button.dataset.node });
      button.textContent = favoriteExists(sourceId, button.dataset.node) ? "★" : "☆";
      button.title = favoriteExists(sourceId, button.dataset.node) ? "取消收藏" : "收藏节点";
      return;
    }
    if (action === "save-result-ip") {
      await toggleResultIP(button.dataset.ip, button.dataset.node);
      return;
    }
    if (action === "toggle-hint") {
      await request("library-hint", { sourceId, name: button.dataset.node });
      libraryPage();
      return;
    }
    if (action === "cancel-test") {
      await request("diagnostic-cancel");
      return;
    }
    if (action === "browse") {
      librarySource = sourceId;
      librarySearch = "";
      libraryPageIndex = 0;
      librarySelected.clear();
      libraryPage();
      return;
    }
    if (action === "prev" || action === "next") {
      libraryPageIndex += action === "next" ? 1 : -1;
      libraryPage();
      return;
    }
    if (action === "clear-stats") {
      libraryConfirm(
        "清空检测统计？",
        `清空「${source?.name || ""}」所有节点保存的成功次数、延迟和出口 IP。不影响节点和实例配置。`,
        "diagnostic-history-clear",
        { sourceId },
      );
      return;
    }
    if (action === "edit") { openProxyEntry(source); return; }
    if (action === "delete-node" || action === "delete-selected") {
      const items = action === "delete-node" ? [{ sourceId, name: button.dataset.node }] : selectedItems();
      if (!items.length) throw Error("请先勾选要删除的节点");
      const groups = [...new Set(items.map((x) => x.sourceId))].map((id) => ({ sourceId: id, names: items.filter((x) => x.sourceId === id).map((x) => x.name) }));
      libraryConfirm(
        `删除 ${items.length} 个节点？`,
        `从${groups.length > 1 ? ` ${groups.length} 个节点源各自` : "所属节点源"}的可用列表移除，后续更新仍保持隐藏。可通过“恢复已删节点”撤销。不会修改已分配给实例的节点副本。`,
        "library-delete-nodes",
        groups.length > 1 ? { groups } : groups[0],
      );
      return;
    }
    if (action === "restore") {
      libraryConfirm(
        "恢复已删节点？",
        "将此节点源中被本地删除隐藏的节点恢复到可用列表，不修改实例配置。",
        "library-restore-nodes",
        { sourceId },
      );
      return;
    }
    if (action === "remove") {
      libraryConfirm(
        "删除全局节点源？",
        "仅删除全局订阅和节点。现有实例保留已分配的节点副本，不停止任何实例。",
        "library-remove",
        { sourceId },
      );
      return;
    }
    if (action === "assign") {
      openAssignDialog(sourceId, button.dataset.node);
      return;
    }
    if (["latency", "ip", "speed", "batch-latency", "batch-ip"].includes(action)) {
      if (state.diagnostics?.job) throw Error("已有检测任务，请等待或取消");
      const items = action.startsWith("batch") ? selectedItems() : [{ sourceId, name: button.dataset.node }];
      if (!items.length || items.length > 100) throw Error("请选择 1–100 个节点");
      const kind = action.replace("batch-", "");
      confirmDiagnostic(kind, items);
      return;
    }
    if (action === "refresh-all") {
      if (libraryBusy) return;
      const subs = (state.library || []).filter((s) => s.subscription);
      if (!subs.length) throw Error("没有可更新的订阅");
      libraryBusy = true;
      button.disabled = true;
      const failed = [];
      try {
        for (const [i, s] of subs.entries()) {
          if (button.isConnected) button.textContent = `更新中 ${i + 1}/${subs.length}…`;
          try {
            await request("library-save", { sourceId: s.id });
          } catch (e) {
            failed.push(`${s.name}：${e.message}`);
          }
        }
      } finally {
        libraryBusy = false;
      }
      toast(failed.length ? `${subs.length - failed.length} 个订阅已更新，${failed.length} 个失败 · ${failed[0]}` : `${subs.length} 个订阅已更新；现有实例配置未改变`);
      render(true);
      return;
    }
    if (libraryBusy) return;
    libraryBusy = true;
    button.disabled = true;
    try {
      if (action === "refresh") await request("library-save", { sourceId });
      toast("代理库已更新；现有实例配置未改变");
      render(true);
    } finally {
      libraryBusy = false;
      if (button.isConnected) button.disabled = false;
    }
  } catch (error) {
    toast(error.message);
  }
});
document.addEventListener("change", (event) => {
  if (modal?.assignMany && (event.target.name === "assignOrder" || event.target.name === "assignManyTarget")) {
    if (event.target.name === "assignOrder") modal.assignMany.order = event.target.value;
    else event.target.checked ? modal.assignMany.picked.add(event.target.value) : modal.assignMany.picked.delete(event.target.value);
    updateAssignManyPlan();
    return;
  }
  if (event.target.name === "assignTarget" && modal?.operation === "library-assign") {
    modal.payload.id = event.target.value;
    libraryTargetId = event.target.value;
    updateAssignDescription();
    return;
  }
  if (event.target.id === "librarySelectAll") {
    const boxes = [...document.querySelectorAll("[data-library-node]:not(:disabled)")];
    boxes.forEach((el) => {
      el.checked = event.target.checked;
      const key = libKey(rowSource(el), el.dataset.libraryNode);
      event.target.checked ? librarySelected.add(key) : librarySelected.delete(key);
    });
    updateLibrarySelection();
    return;
  }
  if (event.target.id === "librarySource") {
    librarySource = event.target.value;
    libraryPageIndex = 0;
    librarySelected.clear();
    libraryPage();
  }
  if (event.target.matches("[data-library-node]")) {
    const name = libKey(rowSource(event.target), event.target.dataset.libraryNode);
    event.target.checked ? librarySelected.add(name) : librarySelected.delete(name);
    updateLibrarySelection();
  }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "librarySearch") {
    librarySearch = event.target.value;
    librarySelected.clear();
    libraryPageIndex = 0;
    const pos = event.target.selectionStart;
    libraryPage();
    $("#librarySearch").focus();
    $("#librarySearch").setSelectionRange(pos, pos);
  }
});

const SOURCE_COLORS = [
  "#4a51c7",
  "#0f766e",
  "#be185d",
  "#b45309",
  "#1d4ed8",
  "#7c3aed",
  "#15803d",
  "#9a3412",
  "#0e7490",
  "#a21caf",
];
function sourceColor(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SOURCE_COLORS[h % SOURCE_COLORS.length];
}
function sourceStatsText(s, hints, favorites, ok) {
  return `${s.nodes.length - hints} 个节点 · 收藏 ${favorites} · 连通 ${ok}`;
}
function allSourcesStatsText(sources) {
  let nodes = 0,
    ok = 0;
  for (const s of sources)
    for (const n of s.nodes)
      if (!n.hint) {
        nodes++;
        if (nodeOutcome(s.id, n.name, "latency").r?.ok) ok++;
      }
  return `${nodes} 个节点 · 收藏 ${state.favorites?.nodes.length || 0} · 连通 ${ok}`;
}
function allSourcesHTML(sources) {
  const subs = sources.filter((s) => s.subscription).length;
  return `<details class="source-group source-all" data-source-group="${LIBRARY_ALL}" ${librarySource === LIBRARY_ALL ? "open" : ""}><summary><span class="source-badge source-badge-all" aria-hidden="true">全</span><div><b>全部节点源</b><small data-source-stats="${LIBRARY_ALL}">${allSourcesStatsText(sources)}</small></div><span class="source-kind">${sources.length} 个</span><svg class="source-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></summary><div class="source-group-body"><div class="subscription-actions">${subs ? `<button class="btn tiny" data-lib="refresh-all" title="依次更新 ${subs} 个订阅；不修改已分配给实例的节点副本">全部更新</button>` : ""}<span class="actions-note">合并显示所有节点源，可跨订阅检测、分配和收藏</span></div></div></details>`;
}
function nodeSourceMark(s) {
  if (!s) return "";
  const initial = [...String(s.name || "?").trim()][0] || "?";
  return `<span class="node-source" style="background:${sourceColor(s.id)}" title="来自：${esc(s.name)}">${esc(initial.toUpperCase())}</span>`;
}
function sourceGroupHTML(s) {
  const hints = s.nodes.filter((n) => n.hint),
    ok = s.nodes.filter((n) => nodeOutcome(s.id, n.name, "latency").r?.ok).length,
    tested = diagnosticHistoryRows().some((h) => h.sourceId === s.id);
  const favorites = state.favorites?.nodes.filter((n) => n.sourceId === s.id).length || 0;
  const initial = [...String(s.name || "?").trim()][0] || "?";
  return (
    `<details class="library-source source-group" data-source-group="${s.id}" ${s.id === librarySource ? "open" : ""}><summary><span class="source-badge" style="background:${sourceColor(s.id)}" aria-hidden="true">${esc(initial.toUpperCase())}</span><div><b title="${esc(s.name)}">${esc(s.name)}</b><small data-source-stats="${s.id}">${sourceStatsText(s, hints.length, favorites, ok)}</small></div><span class="source-kind">${s.subscription ? "订阅" : "本地"}</span><svg class="source-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><time title="更新时间">${esc(new Date(s.updatedAt).toLocaleString())}</time></summary>` +
    `<div class="source-group-body" data-group-body="${s.id}"><div class="subscription-actions"><span class="source-host" title="${esc(s.host)}">${esc(s.host)}</span>${s.subscription ? `<button class="btn tiny" data-lib="refresh" data-source="${s.id}">更新</button>` : ""}<button class="btn tiny ghost" data-lib="edit" data-source="${s.id}">编辑</button>${s.excludedCount ? `<button class="btn tiny ghost" data-lib="restore" data-source="${s.id}">恢复已删 (${s.excludedCount})</button>` : ""}${tested ? `<button class="btn tiny ghost" data-lib="clear-stats" data-source="${s.id}" title="清空此节点源保存的检测次数、延迟和出口 IP">清空统计</button>` : ""}<button class="btn ghost danger tiny" data-lib="remove" data-source="${s.id}" title="删除此节点源">删除</button></div>` +
    `${s.changes ? `<p class="actions-note source-changes" title="已有实例保留旧副本，变化后需重新分配">最近更新：新增 ${s.changes.added} · 移除 ${s.changes.removed} · 变化 ${s.changes.changed}</p>` : ""}` +
    `${hints.length ? `<details class="source-hint"><summary><span class="source-hint-line" title="${esc(hints.map((n) => n.name).join("\n"))}">${hints.map((n) => esc(n.name)).join(" · ")}</span><em>${hints.length} 条订阅信息</em></summary><p>这些看起来是订阅信息，默认不参与检测；如果其实是节点，可以启用：</p>${hints.map((n) => `<div><span>${esc(n.name)}</span><button class="btn subtle tiny" data-lib="toggle-hint" data-source="${s.id}" data-node="${esc(n.name)}">作为节点启用</button></div>`).join("")}</details>` : ""}</div></details>`
  );
}
document.addEventListener(
  "toggle",
  (event) => {
    const el = event.target;
    if (
      !el.isConnected ||
      !el.matches("[data-source-group]") ||
      !el.open ||
      el.dataset.sourceGroup === librarySource
    )
      return;
    librarySource = el.dataset.sourceGroup;
    librarySelected.clear();
    libraryPageIndex = 0;
    librarySearch = "";
    libraryPage();
  },
  true,
);
document.addEventListener("change", (event) => {
  const id = event.target.id;
  if (id === "libraryConcurrency") {
    libraryConcurrency = Number(event.target.value);
    return;
  }
  if (id === "librarySort") librarySort = event.target.value;
  else if (id === "libraryOnly") {
    libraryOnly = event.target.value;
    librarySelected.clear();
  } else if (id === "libraryMinSuccess") {
    libraryMinSuccess = Number(event.target.value) || 0;
    librarySelected.clear();
  } else if (id === "libraryIncludeHints") {
    libraryIncludeHints = event.target.checked;
    librarySelected.clear();
  } else return;
  libraryPageIndex = 0;
  libraryPage();
});

function diagnosticFailureLabel(error) {
  if (error === "已取消") return "已取消";
  if (/HTTP 429/.test(error)) return "服务限流";
  if (/HTTP [45]\d\d/.test(error)) return "目标异常";
  if (/重新检测/.test(error)) return "需重测";
  if (/DNS/.test(error)) return "DNS失败";
  if (/超时/.test(error)) return "超时";
  if (/证书/.test(error)) return "证书异常";
  if (/路由不可达/.test(error)) return "路由不可达";
  if (/检测目标/.test(error)) return "目标未通过";
  return "失败";
}

function confirmDiagnostic(kind, items) {
  if (state.diagnostics?.job) {
    toast("已有检测任务，请等待或取消");
    return;
  }
  const payload = { kind, concurrency: libraryConcurrency, items };
  if (kind !== "speed" && diagnosticConsent.has(kind)) {
    request("diagnostic-start", payload).catch((e) => toast(e.message));
    return;
  }
  libraryConfirm(
    "开始代理检测？",
    `通过 ${items.length} 个节点访问 ${kind === "ip" ? "IP.SB 优先，GeoJS / ipapi.co / ipwho.is 备用查询出口 IP" : "Cloudflare 检测服务"}。服务可看到代理出口IP。${kind === "speed" ? "手动测速下载约5MB并消耗订阅流量。" : `最多${libraryConcurrency}路并发（可在「并发」中调整，上限16），可取消；连通性失败最多尝试一个备用目标。`}不改变实例网络配置。`,
    "diagnostic-start",
    payload,
  );
  if (kind !== "speed")
    $("#modal .description").insertAdjacentHTML(
      "afterend",
      '<label class="remember-consent"><input id="rememberDiagnosticConsent" type="checkbox"> 本次应用运行期间，不再确认此类检测</label>',
    );
}
function diagnosticSummaryHTML(last) {
  if (!last) return "<div><strong>检测空闲</strong><small>选择节点后执行检测；测速始终手动。</small></div>";
  const count = (s) => last.items.filter((x) => x.state === s).length;
  return `<div><strong>${last.cancelled ? "检测已取消" : "检测完成"} · ${last.total} 个节点</strong><small>成功 ${count("success")} / 失败 ${count("failed")} / 取消 ${count("cancelled")} · ${new Date(last.endedAt).toLocaleTimeString()}</small></div><div class="subscription-actions">${count("failed") ? '<button class="btn tiny soft" data-lib="retry-failed">重测失败项</button>' : ""}<button class="btn tiny subtle" data-lib="refresh-order">按新结果刷新排序</button><button class="btn tiny subtle" data-ux="related-logs" data-task="${esc(last.id)}">本次任务日志</button></div>`;
}
function showDiagnosticDetail(sourceId, name, kind) {
  const { r, saved } = nodeOutcome(sourceId, name, kind);
  if (!r) return;
  openModal("result-detail");
  $("#modalTitle").textContent = name + " · " + { latency: "连通性", ip: "出口IP", speed: "测速" }[kind];
  $("#modal .description").textContent = [
    new Date(r.at).toLocaleString(),
    r.provider,
    r.ok
      ? kind === "ip"
        ? [r.ip, r.country, r.region, r.city].filter(Boolean).join(" / ")
        : kind === "latency"
          ? r.latencyMs + " ms"
          : r.mbps + " Mbps"
      : r.error,
  ]
    .filter(Boolean)
    .join(" · ") + (saved ? "（上次保存的结果）" : "");
  const recent = (nodeHistory(sourceId, name)?.[kind]?.recent || []).slice().reverse();
  if (recent.length)
    $("#modal .description").insertAdjacentHTML(
      "afterend",
      `<div class="trend-detail">${kind === "latency" ? connectivityBars(recent.slice().reverse(), 400, 64, true) : ""}<ol class="trend-list" aria-label="最近 ${recent.length} 次检测">${recent
        .map(
          (e) =>
            `<li><time>${esc(new Date(e.at).toLocaleString())}</time><b class="${e.ok ? "ok" : "bad"}">${esc(e.ok ? (kind === "latency" ? e.ms + " ms" : e.ip || "成功") : diagnosticFailureLabel(e.error || "失败"))}</b></li>`,
        )
        .join("")}</ol></div>`,
    );
  $("#modal .modal-actions").innerHTML =
    `<button class="btn subtle" data-action="modal-close">关闭</button><button class="btn soft" data-ux="related-logs" data-source="${esc(sourceId)}" ${r.taskId ? `data-task="${esc(r.taskId)}"` : ""}>查看相关日志</button>`;
}

// 检测结果：本次运行的新结果优先（正常颜色）；没有新结果时显示保存的上次结果（淡色）。
// 检测统计只在版本变化时单独拉取，不随每次状态推送传输。
let diagHistoryCache = [],
  diagHistoryVersion = 0,
  diagHistoryLoading = false,
  diagHistoryIndex = null,
  diagHistoryIndexed = null;
function diagnosticHistoryRows() {
  return state.diagnostics?.history || diagHistoryCache;
}
function syncDiagnosticHistory() {
  const v = state.diagnostics?.historyVersion;
  if (!v || v === diagHistoryVersion || diagHistoryLoading || !window.facet?.request) return;
  diagHistoryLoading = true;
  window.facet
    .request("diagnostic-history")
    .then((res) => {
      if (res?.ok) {
        diagHistoryCache = res.value.rows || [];
        diagHistoryVersion = res.value.version;
      }
    })
    .catch(() => {})
    .finally(() => {
      diagHistoryLoading = false;
      if(view==='environment'){renderInstanceNodeActions();return;}
      if (view !== "proxies" || !$("#libraryTaskbar")) return;
      const dependent = libraryMinSuccess > 0 || libraryOnly === "available" || librarySort === "latency";
      if (dependent && !document.activeElement?.matches?.("input,textarea,select")) libraryPage();
      else renderDiagnostics();
    });
}
function nodeHistory(sourceId, name) {
  const rows = diagnosticHistoryRows();
  if (diagHistoryIndexed !== rows) {
    diagHistoryIndexed = rows;
    diagHistoryIndex = new Map(rows.map((h) => [h.sourceId + "\u0001" + h.name, h]));
  }
  return diagHistoryIndex.get(sourceId + "\u0001" + name);
}
function nodeOutcome(sourceId, name, kind) {
  const live = state.diagnostics?.results.find((x) => x.sourceId === sourceId && x.name === name && x.kind === kind);
  if (live && live.error !== "已取消") return { r: live, saved: false };
  const h = nodeHistory(sourceId, name)?.[kind],
    last = kind === "latency" ? h?.last : h?.lastOk || h?.last;
  if (last) return { r: { ...last, sourceId, name, kind, saved: true }, saved: true };
  return { r: live || null, saved: false };
}
function nodeStats(sourceId, name) {
  const h = nodeHistory(sourceId, name) || {},
    latency = { ok: h.latency?.ok || 0, total: h.latency?.total || 0 },
    ip = { ok: h.ip?.ok || 0, total: h.ip?.total || 0 };
  return { latency, ip, ok: latency.ok + ip.ok, total: latency.total + ip.total };
}
function syncLibrarySelectAll() {
  const all = $("#librarySelectAll");
  if (!all) return;
  const boxes = [...document.querySelectorAll("[data-library-node]:not(:disabled)")],
    on = boxes.filter((el) => librarySelected.has(libKey(rowSource(el), el.dataset.libraryNode))).length;
  all.disabled = !boxes.length;
  all.checked = !!boxes.length && on === boxes.length;
  all.indeterminate = on > 0 && on < boxes.length;
}
function updateLibrarySelection() {
  if ($("#librarySelectionCount")) $("#librarySelectionCount").textContent = librarySelected.size;
  if ($('[data-lib="delete-selected"]')) $('[data-lib="delete-selected"]').disabled = !librarySelected.size;
  if ($('[data-lib="assign-many"]')) $('[data-lib="assign-many"]').disabled = !librarySelected.size;
  syncLibrarySelectAll();
}
// 分配：在对话框里列出所有实例供选择，默认上次选择的实例。
function openAssignDialog(sourceId, name) {
  if (!state.instances.length) throw Error("请先创建实例");
  const pick = state.instances.some((x) => x.id === libraryTargetId)
    ? libraryTargetId
    : state.instances.some((x) => x.id === activeId)
      ? activeId
      : state.instances[0].id;
  libraryConfirm("分配给哪个实例？", "", "library-assign", { id: pick, sourceId, name });
  $("#modal .description").insertAdjacentHTML(
    "afterend",
    `<fieldset class="assign-targets"><legend class="visually-hidden">选择实例</legend>${state.instances
      .map((x) => {
        const same = x.network.mode === "mihomo" && x.network.nodeName === name;
        return `<label class="assign-target"><input type="radio" name="assignTarget" value="${x.id}" ${x.id === pick ? "checked" : ""}><span class="assign-name" title="${esc(x.name)}">${esc(x.name)}</span>${status(x)}<small title="${esc(networkText(x))}">${same ? "当前已使用同名节点" : esc(networkText(x))}</small></label>`;
      })
      .join("")}</fieldset>`,
  );
  updateAssignDescription();
}
function updateAssignDescription() {
  if (modal?.operation !== "library-assign") return;
  const t = state.instances.find((x) => x.id === modal.payload.id);
  const busy = ["running", "starting"].includes(t?.status);
  $("#modal .description").textContent = `将「${modal.payload.name}」分配给「${t?.name || ""}」：切换为代理模式${busy ? "并停止该实例" : ""}，之后请手动启动。其他实例不变。`;
}

// 地区：从节点名识别（国旗、中文、英文或两位代码）；识别不到归为「其他」。
const NODE_REGIONS = [
  ["香港", /香港|🇭🇰|hong\s?kong/i, "HK"],
  ["台湾", /台湾|台灣|台北|🇹🇼|taiwan/i, "TW"],
  ["日本", /日本|东京|東京|大阪|🇯🇵|japan|tokyo|osaka/i, "JP"],
  ["新加坡", /新加坡|狮城|🇸🇬|singapore/i, "SG"],
  ["美国", /美国|美國|洛杉矶|圣何塞|硅谷|纽约|西雅图|芝加哥|达拉斯|凤凰城|🇺🇸|united\s?states|america|los\s?angeles|san\s?jose/i, "US|USA"],
  ["韩国", /韩国|韓國|首尔|🇰🇷|korea|seoul/i, "KR"],
  ["英国", /英国|英國|伦敦|🇬🇧|united\s?kingdom|london/i, "UK|GB"],
  ["德国", /德国|德國|法兰克福|🇩🇪|germany|frankfurt/i, "DE"],
  ["法国", /法国|法國|巴黎|🇫🇷|france|paris/i, "FR"],
  ["荷兰", /荷兰|荷蘭|阿姆斯特丹|🇳🇱|netherlands|amsterdam/i, "NL"],
  ["加拿大", /加拿大|🇨🇦|canada/i, "CA"],
  ["澳大利亚", /澳大利亚|澳洲|悉尼|🇦🇺|australia|sydney/i, "AU"],
  ["俄罗斯", /俄罗斯|莫斯科|🇷🇺|russia|moscow/i, "RU"],
  ["印度", /印度(?!尼)|孟买|🇮🇳|india|mumbai/i, "IN"],
  ["土耳其", /土耳其|🇹🇷|turkey/i, "TR"],
  ["马来西亚", /马来西亚|吉隆坡|🇲🇾|malaysia/i, "MY"],
  ["泰国", /泰国|曼谷|🇹🇭|thailand/i, "TH"],
  ["越南", /越南|🇻🇳|vietnam/i, "VN"],
  ["菲律宾", /菲律宾|🇵🇭|philippines/i, "PH"],
  ["印尼", /印尼|🇮🇩|indonesia/i, ""],
  ["巴西", /巴西|🇧🇷|brazil/i, "BR"],
  ["阿根廷", /阿根廷|🇦🇷|argentina/i, "AR"],
].map(([label, words, codes]) => [label, words, codes ? new RegExp(`(?<![A-Za-z0-9])(?:${codes})(?![A-Za-z])`) : null]);
const nodeRegionCache = new Map();
function nodeRegion(name) {
  const key = String(name || "");
  if (!nodeRegionCache.has(key)) {
    if (nodeRegionCache.size > 20000) nodeRegionCache.clear();
    nodeRegionCache.set(key, (NODE_REGIONS.find(([, words]) => words.test(key)) || NODE_REGIONS.find(([, , code]) => code?.test(key)))?.[0] || "其他");
  }
  return nodeRegionCache.get(key);
}
function countBy(list, fn) {
  const m = new Map();
  for (const x of list) {
    const k = fn(x);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}
function nodeChipsHTML(total, regions, protocols) {
  if (!total) return "";
  const chip = (kind, value, label, n, active) =>
    `<button type="button" class="node-chip ${active ? "active" : ""}" data-lib="${kind}" data-value="${esc(value)}" aria-pressed="${active}">${esc(label)}<small>${n}</small></button>`;
  const sorted = (m) => [...m].sort((a, b) => (a[0] === "其他") - (b[0] === "其他") || b[1] - a[1]);
  const regionRow = regions.size > 1 ? `<div class="node-chip-row" role="group" aria-label="按地区筛选"><span class="node-chip-label">地区</span>${chip("region", "", "全部", total, !libraryRegion)}${sorted(regions).map(([k, n]) => chip("region", k, k, n, libraryRegion === k)).join("")}</div>` : "";
  const protocolRow = protocols.size > 1 ? `<div class="node-chip-row" role="group" aria-label="按协议筛选"><span class="node-chip-label">协议</span>${chip("protocol", "", "全部", total, !libraryProtocol)}${sorted(protocols).map(([k, n]) => chip("protocol", k, k, n, libraryProtocol === k)).join("")}</div>` : "";
  return regionRow || protocolRow ? `<div class="node-chips">${regionRow}${protocolRow}</div>` : "";
}
// 只画已有的最近检测，不补虚构记录；时间顺序左旧右新。
function connectivityBars(recent,w=76,h=28,large=false){
 const list=(Array.isArray(recent)?recent:[]).filter(e=>e&&e.error!=='已取消'&&!/重新检测/.test(e.error||'')).slice(-10);if(!list.length)return '';
 const pad=2,step=(w-pad*2)/10,bw=large?Math.min(22,step-5):5,maxHeight=h-pad*2;
 const summary='最近 '+list.length+' 次连通性检测，左旧右新；绿色成功，红色失败；成功柱高表示延迟，越低越快，超过 1000 ms 按满高显示';
 const bars=list.map((e,i)=>{const ms=Number(e.ms),valid=e.ms!=null&&Number.isFinite(ms)&&ms>=0,height=e.ok?(valid?Math.max(6,Math.min(1,ms/1000)*maxHeight):4):maxHeight,label=new Date(e.at).toLocaleString()+' · '+(e.ok?(valid?'连通成功 · '+Math.round(ms)+' ms':'连通成功 · 延迟未记录'):'检测失败 · '+(e.error||'未取得原因'));
 return '<rect class="connectivity-bar '+(e.ok?'connected':'failed')+'" x="'+(pad+i*step+(step-bw)/2).toFixed(2)+'" y="'+(h-pad-height).toFixed(2)+'" width="'+bw+'" height="'+height.toFixed(2)+'" rx="1" data-at="'+esc(e.at)+'" data-ok="'+Boolean(e.ok)+'"><title>'+esc(label)+'</title></rect>';}).join('');
 return '<svg class="connectivity-bars '+(large?'connectivity-bars-large':'')+'" viewBox="0 0 '+w+' '+h+'" width="'+w+'" height="'+h+'" role="img" aria-label="'+esc(summary)+'"><title>'+esc(summary)+'</title>'+bars+'</svg>'+(large?'<p class="actions-note">左旧右新 · 绿色：连通成功 · 红色：检测失败（不一定代表节点不可用） · 成功柱越低，延迟越小</p>':'');
}
// 批量分配：勾选实例，按顺序或随机把已选节点分给它们；节点不够时循环使用（会提示共用）。
function openAssignManyDialog() {
  const names = selectedItems().filter(({ sourceId, name }) =>
    state.library?.find((s) => s.id === sourceId)?.nodes.some((n) => n.name === name && !n.hint),
  );
  if (!names.length) throw Error("请先勾选节点");
  const sourceId = names[0].sourceId;
  if (!state.instances.length) throw Error("请先创建实例");
  libraryConfirm("分配给多个实例", "", "library-assign-many", { sourceId, assignments: [] });
  modal.assignMany = { names, order: "order", picked: new Set(), shuffled: null };
  $("#modal .description").insertAdjacentHTML(
    "afterend",
    `<div class="assign-many"><div class="assign-many-bar"><label><input type="radio" name="assignOrder" value="order" checked> 按顺序</label><label><input type="radio" name="assignOrder" value="random"> 随机</label><button type="button" class="btn ghost tiny" data-assign-reshuffle hidden>重新随机</button><span class="assign-many-fill"></span><button type="button" class="btn ghost tiny" data-assign-all>全选实例</button></div><fieldset class="assign-targets"><legend class="visually-hidden">选择实例</legend>${state.instances
      .map(
        (x) =>
          `<label class="assign-target"><input type="checkbox" name="assignManyTarget" value="${x.id}"><span class="assign-name" title="${esc(x.name)}">${esc(x.name)}</span>${status(x)}<small class="assign-plan-node" data-plan-for="${x.id}">${esc(networkText(x))}</small></label>`,
      )
      .join("")}</fieldset></div>`,
  );
  updateAssignManyPlan();
}
function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function updateAssignManyPlan() {
  const m = modal?.assignMany;
  if (!m) return;
  const targets = state.instances.filter((x) => m.picked.has(x.id));
  if (m.order === "random" && !m.shuffled) m.shuffled = shuffled(m.names);
  const order = m.order === "random" ? m.shuffled : m.names;
  const plan = targets.map((x, i) => ({ id: x.id, ...order[i % order.length] }));
  modal.payload.assignments = plan;
  const shared = Math.max(0, targets.length - order.length),
    busy = targets.filter((x) => ["running", "starting"].includes(x.status)).length;
  $("#modal .description").textContent = targets.length
    ? `把已选的 ${order.length} 个节点分配给 ${targets.length} 个实例，切换为代理模式${busy ? `；其中 ${busy} 个正在运行的实例会被停止` : ""}，之后请手动启动。${shared ? `节点比实例少：有 ${shared} 个实例会与其他实例共用节点（出口 IP 相同）。` : ""}`
    : `已选 ${order.length} 个节点。勾选要分配的实例（可多选）。`;
  for (const x of state.instances) {
    const el = document.querySelector(`[data-plan-for="${x.id}"]`);
    if (!el) continue;
    const p = plan.findIndex((q) => q.id === x.id);
    el.textContent = p >= 0 ? `→ ${plan[p].name}${p >= order.length ? "（共用）" : ""}` : networkText(x);
    el.classList.toggle("planned", p >= 0);
  }
  const reshuffle = document.querySelector("[data-assign-reshuffle]");
  if (reshuffle) reshuffle.hidden = m.order !== "random";
  const all = document.querySelector("[data-assign-all]");
  if (all) all.textContent = targets.length === state.instances.length ? "取消全选" : "全选实例";
  const confirm = document.querySelector('#modal [data-action="confirm"]');
  if (confirm) confirm.disabled = !targets.length;
}
document.addEventListener("click", (event) => {
  const m = modal?.assignMany;
  if (!m) return;
  if (event.target.closest("[data-assign-all]")) {
    const every = m.picked.size === state.instances.length;
    m.picked = new Set(every ? [] : state.instances.map((x) => x.id));
    document.querySelectorAll('input[name="assignManyTarget"]').forEach((el) => (el.checked = !every));
    updateAssignManyPlan();
  } else if (event.target.closest("[data-assign-reshuffle]")) {
    m.shuffled = null;
    updateAssignManyPlan();
  }
});
