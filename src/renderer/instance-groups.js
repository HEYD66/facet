'use strict';

let instanceGroupFilter = 'all';
let instanceGroupingDrag = null;
let instanceGroupingBusy = false;

function instanceGroups() {
  return state.instanceManagement?.groups ?? [];
}

function instancesInGroup(group = instanceGroupFilter) {
  const byId = new Map(state.instances.map(row => [row.id, row]));
  const order = state.instanceManagement?.order ?? [...byId.keys()];
  return order.map(id => byId.get(id)).filter(row => row && (group === 'all' || (row.groupId ?? 'ungrouped') === group));
}

function groupBatchCandidates(rows, command) {
  return rows.filter(row => command === 'start'
    ? row.status === 'stopped' || row.status === 'error'
    : row.status === 'running' || row.status === 'starting');
}

function instanceGroupBar(groupRows) {
  const groups = [{id: 'all', name: '全部'}, {id: 'ungrouped', name: '未分组'}, ...instanceGroups()];
  return `<div class="instance-group-bar">
    <div class="instance-group-filters" role="group" aria-label="按分组筛选实例">
      ${groups.map(({id, name}) => {
        const custom = id !== 'all' && id !== 'ungrouped';
        return `<button type="button" class="btn tiny instance-group-tab" data-instance-group="${esc(id)}" ${custom ? 'draggable="true" aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"' : ''} aria-pressed="${id === instanceGroupFilter}" title="${esc(name)}${custom ? ' · 拖动排序或按 Alt 和左右方向键' : ''}">${esc(name)}</button>`;
      }).join('')}
    </div>
    <div class="instance-group-actions">
      ${instanceGroupFilter !== 'all' ? `<button type="button" class="btn tiny" data-group-command="start" ${groupBatchCandidates(groupRows, 'start').length ? '' : 'disabled'}>启动本组</button>
      <button type="button" class="btn tiny" data-group-command="stop" ${groupBatchCandidates(groupRows, 'stop').length ? '' : 'disabled'}>停止本组</button>` : ''}
      <button type="button" class="btn tiny" data-group-command="create">${icon('plus')}新建分组</button>
    </div>
  </div>`;
}

function instanceGroupLabel(row, names) {
  const name = names.get(row.groupId);
  return instanceGroupFilter === 'all' && name ? `<small class="instance-group-label" title="${esc(name)}">${esc(name)}</small>` : '';
}

function instanceDragHandle(row) {
  return `<button type="button" class="instance-drag-handle" data-instance-drag="${esc(row.id)}" draggable="true" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" aria-label="调整 ${esc(row.name)} 的顺序" title="拖动排序或移到分组，也可按 Alt 和上下方向键">${icon('grip')}</button>`;
}

function groupBatchDescription(batch, names) {
  return `「${batch.groupName}」 · ${batch.ids.length} 个实例${names ? '：' + names : ''}`;
}

function openInstanceGroupDialog(command, ids = []) {
  const creating = command === 'create';
  lastFocus = document.activeElement;
  rememberModalFocus();
  modal = {type: creating ? 'instance-group-create' : 'instance-group-move', ids};
  const field = creating
    ? '<label class="field"><span>分组名称</span><input id="instanceGroupName" maxlength="40" required></label>'
    : `<label class="field"><span>目标分组</span><select id="instanceGroupTarget" required><option value="" selected disabled>选择分组</option><option value="ungrouped">未分组</option>${instanceGroups().map(group => `<option value="${esc(group.id)}">${esc(group.name)}</option>`).join('')}</select></label>`;
  $('#modal').innerHTML = `<div class="modal-head"><h2 id="modalTitle">${creating ? '新建分组' : `移动 ${ids.length} 个实例到分组`}</h2><button type="button" class="icon-btn" data-action="modal-close" aria-label="取消">×</button></div>
    <form id="nameForm">${field}</form><p id="nameError" class="error" role="alert"></p>
    <div class="modal-actions"><button type="button" class="btn subtle" data-action="modal-close">取消</button><button type="button" class="btn primary" data-action="confirm">确认</button></div>`;
  $('#modalBackdrop').hidden = false;
  $('#instanceGroupName,#instanceGroupTarget').focus();
}

async function confirmInstanceGroupDialog(data) {
  if (data.type === 'instance-group-create') {
    const group = await request(data.type, {name: $('#instanceGroupName').value});
    instanceGroupFilter = group.id;
    selected.clear();
  } else {
    const target = $('#instanceGroupTarget').value;
    if (!target) throw Error('请选择目标分组');
    const {moved} = await request(data.type, {ids: data.ids, groupId: target === 'ungrouped' ? null : target});
    data.ids.forEach(id => selected.delete(id));
    toast(moved ? `已移动 ${moved} 个实例` : '所选实例已在该分组');
  }
  closeModal(true);
  try { state = await request('snapshot'); }
  catch { toast('分组已保存，暂时无法刷新列表'); }
  if (view === 'overview') {
    overview();
    $(`[data-instance-group="${CSS.escape(instanceGroupFilter)}"]`)?.focus();
  }
}

document.addEventListener('click', event => {
  const tab = event.target.closest('[data-instance-group]');
  const button = event.target.closest('[data-group-command]');
  if (view !== 'overview' || modal || instanceGroupingBusy) return;
  if (tab && tab.dataset.instanceGroup !== instanceGroupFilter) {
    instanceGroupFilter = tab.dataset.instanceGroup;
    selected.clear();
    overview();
    $(`[data-instance-group="${CSS.escape(instanceGroupFilter)}"]`)?.focus();
  }
  if (!button || button.disabled) return;
  const command = button.dataset.groupCommand;
  if (command === 'start' || command === 'stop') {
    const groupName = instanceGroups().find(group => group.id === instanceGroupFilter)?.name ?? '未分组';
    const groupId = instanceGroupFilter === 'ungrouped' ? null : instanceGroupFilter;
    const ids = groupBatchCandidates(instancesInGroup(), command).map(row => row.id);
    if (ids.length) openModal(`batch-${command}`, null, {ids, groupName, groupId});
  } else {
    const ids = command === 'move-selected' ? [...selected] : command === 'move' ? [button.dataset.id] : [];
    openInstanceGroupDialog(command, ids);
  }
});

async function confirmInstanceBatch(data) {
  const command = data.type === 'batch-start' ? 'start' : 'stop';
  const grouped = data.groupId !== undefined;
  if (grouped) {
    const latest = await request('snapshot');
    const rows = latest.instances.filter(row => (row.groupId ?? null) === data.groupId);
    const candidates = new Set(groupBatchCandidates(rows, command).map(row => row.id));
    if (candidates.size !== data.ids.length || data.ids.some(id => !candidates.has(id))) throw Error('本组待操作的实例已变化，请关闭后重新确认');
  }
  const errors = [];
  for (const id of data.ids) {
    try { await request(command, {id, ...(grouped ? {expectedGroupId: data.groupId} : {})}); }
    catch (error) { errors.push(error.message); }
  }
  if (!grouped) selected.clear();
  if (errors.length) toast(errors.join('；'));
}

function rowReorderPayload(drag, targetId, position) {
  return {id: drag.id, ids: drag.ids, groupId: drag.groupId, targetId, position};
}

function rowDragData(id) {
  return {
    id,
    ids: [...document.querySelectorAll('[data-instance-row]')].map(row => row.dataset.instanceRow),
    groupId: instanceGroupFilter === 'ungrouped' ? null : instanceGroupFilter
  };
}

function clearGroupingDropMarker() {
  $('#content .instance-drop-marker')?.classList.remove('instance-drop-marker', 'drop-before', 'drop-after', 'drop-into');
}

function clearInstanceGroupingDrag() {
  instanceGroupingDrag = null;
  clearGroupingDropMarker();
}

// Return the same destination for both the insertion marker and the operation on drop.
function groupingDrop(event) {
  const drag = instanceGroupingDrag;
  const tab = event.target.closest('[data-instance-group]');
  if (drag.kind === 'group') {
    if (!tab?.draggable || tab.dataset.instanceGroup === drag.id) return null;
    const rect = tab.getBoundingClientRect();
    const position = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    return {target: tab, marker: position, action: 'instance-group-reorder', payload: {id: drag.id, targetId: tab.dataset.instanceGroup, position}};
  }
  if (tab && tab.dataset.instanceGroup !== 'all') {
    const groupId = tab.dataset.instanceGroup === 'ungrouped' ? null : tab.dataset.instanceGroup;
    const row = state.instances.find(row => row.id === drag.id);
    if (!row || (row.groupId ?? null) === groupId) return null;
    return {target: tab, marker: 'into', action: 'instance-group-move', payload: {ids: [drag.id], groupId}};
  }
  const target = event.target.closest('[data-instance-row]');
  const targetId = target?.dataset.instanceRow;
  if (!targetId || targetId === drag.id) return null;
  const rect = target.getBoundingClientRect();
  const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  return {target, marker: position, action: 'instance-row-reorder', payload: rowReorderPayload(drag, targetId, position)};
}

async function saveGroupingDrop(action, payload, focusSelector) {
  instanceGroupingBusy = true;
  try {
    const result = await request(action, payload);
    if (result.moved) {
      payload.ids.forEach(id => selected.delete(id));
      toast(`已移动 ${result.moved} 个实例`);
    }
    state = await request('snapshot');
  } catch (error) {
    toast(error.message);
  } finally {
    instanceGroupingBusy = false;
    if (view === 'overview') {
      overview();
      if (focusSelector) $(focusSelector)?.focus();
    }
  }
}

document.addEventListener('dragstart', event => {
  const handle = event.target.closest('[data-instance-drag]');
  const tab = event.target.closest('[data-instance-group][draggable="true"]');
  if (!handle && !tab) return;
  if (modal || instanceGroupingBusy) { event.preventDefault(); return; }
  instanceGroupingDrag = handle ? {kind: 'row', ...rowDragData(handle.dataset.instanceDrag)} : {kind: 'group', id: tab.dataset.instanceGroup};
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('application/x-facet-instance-order', instanceGroupingDrag.id);
  const source = handle?.closest('tr') ?? tab;
  const rect = source.getBoundingClientRect();
  event.dataTransfer.setDragImage(source, event.clientX - rect.left, event.clientY - rect.top);
});

document.addEventListener('dragover', event => {
  if (!instanceGroupingDrag) return;
  const destination = view === 'overview' && groupingDrop(event);
  clearGroupingDropMarker();
  if (!destination) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  destination.target.classList.add('instance-drop-marker', `drop-${destination.marker}`);
});

document.addEventListener('dragleave', event => {
  if (instanceGroupingDrag && !event.relatedTarget) clearGroupingDropMarker();
});

document.addEventListener('drop', event => {
  if (!instanceGroupingDrag || view !== 'overview') return;
  const destination = groupingDrop(event);
  if (!destination) return;
  event.preventDefault();
  clearInstanceGroupingDrag();
  void saveGroupingDrop(destination.action, destination.payload);
});

document.addEventListener('dragend', () => {
  if (!instanceGroupingDrag) return;
  clearInstanceGroupingDrag();
  if (view === 'overview') overview();
});

document.addEventListener('keydown', event => {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || view !== 'overview' || modal || instanceGroupingBusy) return;
  const handle = event.target.closest('[data-instance-drag]');
  const tab = event.target.closest('[data-instance-group][draggable="true"]');
  if (!handle && !tab) return;
  const [previous, next] = handle ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
  if (event.key !== previous && event.key !== next) return;
  event.preventDefault();
  const drag = handle ? rowDragData(handle.dataset.instanceDrag) : {id: tab.dataset.instanceGroup, ids: instanceGroups().map(group => group.id)};
  const before = event.key === previous;
  const targetId = drag.ids[drag.ids.indexOf(drag.id) + (before ? -1 : 1)];
  if (!targetId) return;
  const position = before ? 'before' : 'after';
  const action = handle ? 'instance-row-reorder' : 'instance-group-reorder';
  const payload = handle ? rowReorderPayload(drag, targetId, position) : {id: drag.id, targetId, position};
  const attr = handle ? 'data-instance-drag' : 'data-instance-group';
  void saveGroupingDrop(action, payload, `[${attr}="${CSS.escape(drag.id)}"]`);
});
