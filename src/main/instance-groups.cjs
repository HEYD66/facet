'use strict';

const {randomUUID} = require('node:crypto');

function groupName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 40 || /[\u0000-\u001f]/.test(name)) throw Error('分组名称须为 1–40 个字符');
  if (name === '全部' || name === '未分组') throw Error('该分组名称已保留');
  return name;
}

function validateGroups(groups) {
  if (!Array.isArray(groups)) throw Error('实例分组配置无效');
  const ids = new Set(), names = new Set();
  for (const group of groups) {
    if (!group || typeof group.id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(group.id) || ids.has(group.id)) throw Error('实例分组 ID 无效或重复');
    const name = groupName(group.name);
    if (name !== group.name || names.has(name)) throw Error('实例分组名称无效或重复');
    ids.add(group.id);
    names.add(name);
  }
}

function snapshot(data) {
  const remaining = new Set(data.instances.map(row => row.id));
  const saved = Array.isArray(data.instanceOrder) ? data.instanceOrder : [];
  const order = saved.filter(id => remaining.delete(id)).concat([...remaining]);
  return {groups: data.instanceGroups ?? [], order};
}

function getGroup(groups, id) {
  if (id !== null && !groups.some(group => group.id === id)) throw Error('分组不存在，请刷新后重试');
  return id;
}

function instanceIds(value) {
  if (!Array.isArray(value) || !value.length || value.some(id => typeof id !== 'string') || new Set(value).size !== value.length) throw Error('实例列表无效');
  return new Set(value);
}

function relocate(ids, {id, targetId, position}) {
  if (!ids.includes(id) || !ids.includes(targetId) || id === targetId || !['before', 'after'].includes(position)) throw Error('排序位置无效，请重试');
  const updated = ids.filter(value => value !== id);
  updated.splice(updated.indexOf(targetId) + (position === 'after' ? 1 : 0), 0, id);
  return updated;
}

function update(store, message) {
  const data = store.data;
  const {groups, order} = snapshot(data);

  switch (message.action) {
    case 'instance-group-create': {
      const name = groupName(message.name);
      if (groups.some(group => group.name === name)) throw Error('分组名称重复');
      const group = {id: randomUUID(), name};
      store.commit({...data, instanceGroups: [...groups, group]});
      return group;
    }
    case 'instance-group-reorder': {
      const byId = new Map(groups.map(group => [group.id, group]));
      const ids = relocate([...byId.keys()], message);
      store.commit({...data, instanceGroups: ids.map(id => byId.get(id))});
      return {saved: true};
    }
    case 'instance-group-move': {
      const groupId = getGroup(groups, message.groupId);
      const ids = instanceIds(message.ids);
      const rows = data.instances.filter(row => ids.has(row.id));
      if (rows.length !== ids.size) throw Error('部分实例已不存在，请刷新后重试');
      const moved = new Set(rows.filter(row => (row.groupId ?? null) !== groupId).map(row => row.id));
      if (!moved.size) return {moved: 0};
      const instances = data.instances.map(row => moved.has(row.id) ? {...row, groupId} : row);
      const instanceOrder = order.filter(id => !moved.has(id)).concat(order.filter(id => moved.has(id)));
      store.commit({...data, instances, instanceOrder});
      return {moved: moved.size};
    }
    case 'instance-row-reorder': {
      const groupId = message.groupId === 'all' ? 'all' : getGroup(groups, message.groupId);
      const ids = instanceIds(message.ids);
      const rows = data.instances.filter(row => ids.has(row.id) && (groupId === 'all' || (row.groupId ?? null) === groupId));
      const current = order.filter(id => ids.has(id));
      if (rows.length !== ids.size || current.some((id, index) => id !== message.ids[index])) throw Error('实例列表已变化，请重试');
      const reordered = relocate(current, message);
      let index = 0;
      const instanceOrder = order.map(id => ids.has(id) ? reordered[index++] : id);
      store.commit({...data, instanceOrder});
      return {saved: true};
    }
    default: throw Error('未知的分组操作');
  }
}

module.exports = {snapshot, update, validateGroups};
