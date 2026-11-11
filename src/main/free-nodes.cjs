'use strict';
// "获取免费节点": downloads public node lists, verifies candidates through a throwaway
// Mihomo core and stores the ones that returned an exit IP in the library's free source.
// One task at a time; it keeps running when the dialog is closed and stops with the app.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const {chooseSources, candidatesFrom, pickCandidates, kindOf, signature, KINDS} = require('./free-node-catalog.cjs');
const {verifyBatch, BATCH_SIZE, PROBE_PROVIDER} = require('./free-node-scan.cjs');
const {hintNode} = require('./library.cjs');

const DEFAULT_TARGET = 30, MAX_TARGET = 500, DEFAULT_LIMIT = 400, MAX_LIMIT = 2000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function options(value = {}) {
  const kinds = value.kinds === undefined ? KINDS : value.kinds;
  if (!Array.isArray(kinds) || !kinds.length || kinds.some(kind => !KINDS.includes(kind))) throw Error('请至少选择一种节点类型');
  const number = (input, fallback, max, label) => {
    const result = input === undefined || input === null || input === '' ? fallback : Number(input);
    if (!Number.isInteger(result) || result < 1 || result > max) throw Error(`${label}须为 1–${max} 的整数`);
    return result;
  };
  const target = number(value.target, DEFAULT_TARGET, MAX_TARGET, '目标数量');
  const limit = number(value.limit, Math.max(DEFAULT_LIMIT, target), MAX_LIMIT, '最多验证数量');
  if (limit < target) throw Error('最多验证数量不能小于目标数量');
  return {kinds: KINDS.filter(kind => kinds.includes(kind)), target, limit, replace: value.replace === true};
}
// Uses the system network like a subscription download: public addresses only, 2 MB cap, no redirects to private hosts.
async function downloadList(url, signal) {
  signal.throwIfAborted();
  const download = require('./subscription.cjs').downloadSubscription(url, {timeoutMs: 15000});
  download.catch(() => {});
  let onAbort;
  const aborted = new Promise((_, reject) => { onAbort = () => reject(Error('已取消')); signal.addEventListener('abort', onAbort, {once: true}); });
  try { return (await Promise.race([download, aborted])).text; }
  finally { signal.removeEventListener('abort', onAbort); }
}
function regionName(code) {
  try { const name = new Intl.DisplayNames(['zh-CN'], {type: 'region'}).of(code); return name && name !== code ? name : ''; }
  catch { return ''; }
}
// Lists that carry names keep them; a bare endpoint is named by its measured exit country, protocol and address.
function nodeName(found) {
  const given = String(found.candidate.node.name || '').trim();
  if (given && !hintNode(given)) return given.slice(0, 72);
  const node = found.node;
  const label = node.type === 'http' ? (node.tls ? 'HTTPS' : 'HTTP') : String(node.type).toUpperCase();
  return [found.geo?.countryCode || found.countryCode, label, (net.isIPv6(node.server) ? `[${node.server}]` : node.server) + ':' + node.port].filter(Boolean).join(' ').slice(0, 72);
}

class FreeNodes {
  constructor(controller, {fetchText = downloadList, verify = verifyBatch, batchSize = BATCH_SIZE} = {}) {
    this.controller = controller;
    this.fetchText = fetchText;
    this.verify = verify;
    this.batchSize = batchSize;
    this.state = null;
    this.work = null;
    this.abort = null;
    this.closing = false;
    this.timer = null;
  }
  snapshot() { return this.state; }
  // Progress arrives for every candidate; the control window only needs a few updates a second.
  changed() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.controller.emit(); }, 250);
    this.timer.unref?.();
  }
  start(value) {
    const controller = this.controller;
    if (this.work) throw Error('已有免费节点获取任务，请等待完成或先停止');
    if (controller.disposing || this.closing) throw Error('应用正在退出');
    if (controller.proxyModeSwitching) throw Error(require('./proxy-mode.cjs').busyMessage);
    const settings = options(value);
    if (controller.nodeNetwork?.warning) throw Error(controller.nodeNetwork.warning);
    if (!fs.existsSync(controller.binary)) throw Error('内置 Mihomo 缺失，请先运行 npm run setup:core；不会调用其他客户端');
    const free = controller.library.freeSource();
    if (!free && controller.library.data.sources.length >= 30) throw Error('最多保存 30 个订阅或本地节点源，请先删除一个再获取免费节点');
    if (free && !settings.replace && free.nodes.length - (free.excluded || []).length >= 3000) throw Error('免费节点源已满（3000 个），请先删除不用的节点');
    const id = crypto.randomUUID();
    this.abort = new AbortController();
    this.state = {id, running: true, cancelling: false, stage: 'fetch', ...settings, startedAt: new Date().toISOString(), endedAt: null, sources: [], total: 0, checked: 0, usable: 0, plain: 0, encrypted: 0, result: null};
    controller.workspace.log('subscription', `开始获取免费节点：目标 ${settings.target} 个，最多验证 ${settings.limit} 个`, 'INFO', null, {taskId: id});
    controller.emit();
    this.work = this.run(settings).catch(() => {
      this.state.result ||= {imported: 0, sourceId: null, cancelled: false, error: '获取免费节点失败'};
    }).finally(() => {
      this.state = {...this.state, running: false, cancelling: false, stage: 'done', endedAt: new Date().toISOString()};
      this.work = null;
      this.abort = null;
      clearTimeout(this.timer);
      this.timer = null;
      controller.emit();
    });
    return {started: true, id};
  }
  cancel() {
    if (!this.work || !this.abort) return {cancelled: false};
    this.abort.abort();
    this.state.cancelling = true;
    this.controller.emit();
    return {cancelled: true};
  }
  // Every step of a run watches the abort signal; the cap only keeps a stuck step from holding up app exit.
  async close(waitMs = 10000) {
    this.closing = true;
    this.abort?.abort();
    if (!this.work) return;
    let timer;
    await Promise.race([this.work.catch(() => {}), new Promise(resolve => { timer = setTimeout(resolve, waitMs); })]);
    clearTimeout(timer);
  }
  async run(settings) {
    const controller = this.controller, signal = this.abort.signal, state = this.state, found = [];
    let error = '';
    try {
      const sources = chooseSources(settings.kinds);
      state.sources = sources.map(source => ({name: source.name, state: 'loading', candidates: 0}));
      this.changed();
      const lists = await Promise.all(sources.map(async (source, index) => {
        let nodes = [], loaded = false;
        // Mirrors of the same file, tried in order; a mirror with unreadable content counts as failed.
        for (const url of source.urls) {
          if (signal.aborted) break;
          try {
            const text = await this.fetchText(url, signal);
            await new Promise(resolve => setImmediate(resolve));
            nodes = candidatesFrom(text, source);
            loaded = true;
            break;
          } catch {}
        }
        state.sources[index] = {name: source.name, state: loaded ? 'ok' : signal.aborted ? 'cancelled' : 'failed', candidates: nodes.length};
        this.changed();
        return nodes;
      }));
      signal.throwIfAborted();
      // Endpoints already in the library, including ones the user deleted from a source, are not verified again.
      const known = controller.library.data.sources.flatMap(source => source.nodes.map(signature));
      const picks = pickCandidates(lists, sources, settings.kinds, settings.limit, known);
      state.total = picks.length;
      state.stage = 'verify';
      this.changed();
      if (!picks.length) throw Error(state.sources.some(source => source.state === 'ok') ? '这批公开列表里没有新的候选节点，请稍后再试' : '公开节点列表全部下载失败，请检查网络后重试');
      for (let offset = 0; offset < picks.length && found.length < settings.target; offset += this.batchSize) {
        signal.throwIfAborted();
        await this.verify(picks.slice(offset, offset + this.batchSize).map(node => ({node})), {
          binary: controller.binary, root: path.join(controller.dir, 'diagnostic-runtime'), signal,
          prepare: (node, cancel) => controller.nodeNetwork.prepare(node, cancel),
          done: () => found.length >= settings.target,
          onResult: (candidate, outcome) => {
            state.checked++;
            if (outcome.ok && found.length < settings.target) {
              found.push({candidate, ...outcome});
              state.usable = found.length;
              state[kindOf(outcome.node)]++;
            }
            this.changed();
          }
        });
      }
    } catch (failure) {
      if (!signal.aborted) error = require('./workspace.cjs').redact(failure?.safeDiagnostic || failure?.message || '获取免费节点失败').slice(0, 200);
    }
    const cancelled = signal.aborted;
    let saved = null;
    // Nodes verified before a stop or an error are kept; on exit nothing more is written.
    if (found.length && !this.closing && !controller.disposing) {
      state.stage = 'save';
      this.changed();
      try { saved = await this.save(found, settings); }
      catch (failure) { error = require('./workspace.cjs').redact(failure?.message || '保存免费节点失败').slice(0, 200); }
    }
    state.result = {imported: saved?.names.length || 0, sourceId: saved?.id || null, cancelled, error};
    const summary = `验证 ${state.checked} / ${state.total} 个候选，导入 ${state.result.imported} 个`;
    controller.workspace.log('subscription', error ? `获取免费节点未完成：${error}（${summary}）` : `${cancelled ? '获取免费节点已停止' : '获取免费节点完成'}：${summary}`, error ? 'WARN' : 'INFO', null, {taskId: state.id, sourceId: saved?.id});
  }
  async save(found, settings) {
    const controller = this.controller;
    for (let waited = 0; controller.proxyModeSwitching && !controller.disposing && waited < 600; waited++) await delay(100);
    return controller.queue('global-library', async () => {
      if (controller.disposing) throw Error('应用正在退出');
      const saved = controller.library.saveFree(found.map(item => ({...item.node, name: nodeName(item)})), {replace: settings.replace});
      const {history, results} = controller.diagnostics;
      // Names that left the source may be reused later; their old records must not vouch for a different node.
      if (saved.replaced) history.clear(saved.id);
      else history.forget(saved.id, saved.removed);
      const gone = new Set(saved.removed);
      for (const [key, result] of results) if (result.sourceId === saved.id && (saved.replaced || gone.has(result.name))) results.delete(key);
      // The verification is itself a connectivity and exit-IP check, so it is recorded as one.
      const at = new Date().toISOString();
      saved.names.forEach((name, index) => {
        const item = found[index], base = {taskId: this.state.id, sourceId: saved.id, instanceId: null, name, at, ok: true};
        // With a located exit the record equals an exit-IP check, time zone included; otherwise it holds the country only.
        const geo = item.geo, code = geo?.countryCode || item.countryCode;
        const rows = [
          {...base, kind: 'latency', latencyMs: item.latencyMs, provider: PROBE_PROVIDER},
          {...base, kind: 'ip', ip: geo?.ip || item.ip, countryCode: code, country: (code && regionName(code)) || geo?.country || '', region: geo?.region || '', city: geo?.city || '', timezone: geo?.timezone || '', isp: geo?.isp || '', queriedAt: geo?.queriedAt || at, provider: geo?.provider || 'Cloudflare trace'}
        ];
        for (const row of rows) {
          const key = JSON.stringify([row.sourceId, row.name, row.kind]);
          results.delete(key);
          results.set(key, row);
          history.record(row);
        }
      });
      while (results.size > 500) results.delete(results.keys().next().value);
      controller.emit();
      return saved;
    });
  }
}
module.exports = {FreeNodes, options, nodeName, DEFAULT_TARGET, MAX_TARGET, DEFAULT_LIMIT, MAX_LIMIT};
