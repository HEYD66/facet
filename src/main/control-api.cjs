'use strict';

const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION = 1;
const HOST = '127.0.0.1';
const MIN_PORT = 20000;
const MAX_PORT = 49000;

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function validPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : null;
}

function normalizeSettings(value) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    version: VERSION,
    enabled: input.enabled === true,
    apiPort: validPort(input.apiPort),
    cdpPort: validPort(input.cdpPort),
    token: typeof input.token === 'string' && /^[A-Za-z0-9_-]{32,200}$/.test(input.token) ? input.token : randomToken(),
  };
}

function loadSettings(file) {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('本地控制配置损坏，请删除 control-api.json 后重启应用');
    return normalizeSettings(null);
  }
}

function saveSettings(file, value) {
  const next = normalizeSettings(value);
  const temp = file + '.tmp-' + process.pid;
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', {encoding: 'utf8', mode: 0o600});
  fs.renameSync(temp, file);
  return next;
}

function canListen(port, host = HOST) {
  return new Promise(resolve => {
    const server = net.createServer();
    const done = value => { server.removeAllListeners(); try { server.close(); } catch {} resolve(value); };
    server.once('error', () => done(false));
    server.listen({port, host}, () => done(true));
  });
}

async function choosePort(excluded = new Set()) {
  for (let i = 0; i < 80; i++) {
    const port = MIN_PORT + Math.floor(Math.random() * (MAX_PORT - MIN_PORT + 1));
    if (!excluded.has(port) && await canListen(port)) return port;
  }
  throw Error('无法为本地控制 API 分配端口');
}

async function ensurePorts(settings) {
  const next = {...settings};
  const used = new Set();
  if (!next.apiPort || !await canListen(next.apiPort)) next.apiPort = null;
  if (next.apiPort) used.add(next.apiPort);
  if (!next.cdpPort || !await canListen(next.cdpPort) || used.has(next.cdpPort)) next.cdpPort = null;
  if (!next.apiPort) next.apiPort = await choosePort(used);
  used.add(next.apiPort);
  if (!next.cdpPort) next.cdpPort = await choosePort(used);
  return next;
}

function safeMessage(error) {
  return String(error?.message || error || '请求失败').replace(/[\r\n]/g, ' ').slice(0, 500);
}

class ControlApi {
  constructor({file, settings, controller, cdpStarted = false}) {
    this.file = file;
    this.settings = normalizeSettings(settings);
    this.controller = controller;
    this.cdpStarted = cdpStarted === true;
    this.server = null;
    this.listening = false;
  }

  uiSnapshot() {
    return {
      enabled: this.settings.enabled,
      running: this.listening,
      apiPort: this.settings.apiPort,
      cdpPort: this.settings.cdpPort,
      token: this.settings.token,
      restartRequired: this.settings.enabled && !this.cdpStarted,
    };
  }

  publicSnapshot() {
    return {
      enabled: this.settings.enabled,
      running: this.listening,
      apiPort: this.settings.apiPort,
      cdpPort: this.settings.cdpPort,
      address: this.listening ? `http://${HOST}:${this.settings.apiPort}` : null,
    };
  }

  async save(patch = {}) {
    if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') throw Error('本地控制开关无效');
    const next = normalizeSettings({...this.settings, enabled: patch.enabled === undefined ? this.settings.enabled : patch.enabled});
    if (patch.regenerateToken === true) next.token = randomToken();
    if (next.enabled) {
      const keepApiPort = this.server && this.settings.apiPort === next.apiPort;
      const keepCdpPort = this.settings.cdpPort && this.settings.cdpPort === next.cdpPort;
      if (!keepApiPort || !keepCdpPort) {
        const checked = await ensurePorts({...next, apiPort: keepApiPort ? null : next.apiPort, cdpPort: keepCdpPort ? null : next.cdpPort});
        if (keepApiPort) checked.apiPort = next.apiPort;
        if (keepCdpPort) checked.cdpPort = next.cdpPort;
        Object.assign(next, checked);
      }
    }
    this.settings = saveSettings(this.file, next);
    if (next.enabled) await this.start();
    else await this.stop();
    return this.uiSnapshot();
  }

  async start() {
    if (!this.settings.enabled || this.server) return this.publicSnapshot();
    if (!this.settings.apiPort || !this.settings.cdpPort) {
      Object.assign(this.settings, await ensurePorts(this.settings));
      this.settings = saveSettings(this.file, this.settings);
    }
    this.server = http.createServer((request, response) => this.handle(request, response));
    await new Promise((resolve, reject) => {
      const fail = error => { this.server?.removeListener('error', fail); reject(error); };
      this.server.once('error', fail);
      this.server.listen({host: HOST, port: this.settings.apiPort}, () => {
        this.server.removeListener('error', fail);
        resolve();
      });
    }).catch(error => { this.server = null; throw Error('本地控制 API 启动失败：' + safeMessage(error)); });
    this.listening = true;
    return this.publicSnapshot();
  }

  async stop() {
    const server = this.server;
    this.server = null;
    this.listening = false;
    if (server) await new Promise(resolve => server.close(() => resolve()));
  }

  authorized(request) {
    const value = String(request.headers.authorization || '');
    if (!value.startsWith('Bearer ')) return false;
    const actual = Buffer.from(value.slice(7));
    const expected = Buffer.from(this.settings.token);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }

  async body(request) {
    let text = '';
    for await (const chunk of request) {
      text += chunk;
      if (Buffer.byteLength(text) > 128 * 1024) throw Error('请求体过大');
    }
    if (!text) return {};
    try { return JSON.parse(text); } catch { throw Error('请求体必须是 JSON'); }
  }

  send(response, status, value) {
    const body = JSON.stringify(value);
    response.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
    response.end(body);
  }

  async targets() {
    const rows = [];
    for (const instance of this.controller.store.list()) {
      const runtime = this.controller.runtimes.get(instance.id);
      for (const tab of runtime?.tabs?.values() || [{id:null,view:runtime?.view}]) {
      const wc = tab.view?.webContents;
      if (!wc || wc.isDestroyed()) continue;
      let targetId = null;
      try { targetId = (await wc.debugger.sendCommand('Target.getTargetInfo')).targetInfo?.targetId || null; } catch {}
      rows.push({instanceId: instance.id, instanceName: instance.name, tabId:tab.id, active:!tab.id||tab.id===runtime.activeTabId, webContentsId: wc.id, targetId, type: 'page', url: wc.getURL(), title: wc.getTitle()});
      }
    }
    return rows;
  }

  instances() {
    return this.controller.snapshot().instances.map(row => ({
      id: row.id, name: row.name, status: row.status, url: row.currentURL || row.url,
      network: row.network, proxyPort: row.proxyPort || null,
    }));
  }

  async create(input = {}) {
    const name = String(input.name || '').trim();
    if (!name || name.length > 40) throw Error('实例名称必须为 1–40 个字符');
    const message = {name, start: input.start === true, syncTimezone: false, regionMode: 'saved'};
    if (input.environment !== undefined) {
      if (!input.environment || typeof input.environment !== 'object' || Array.isArray(input.environment)) throw Error('实例环境配置无效');
      message.environment = input.environment;
    }
    if (input.sourceId !== undefined || input.nodeName !== undefined) {
      if (typeof input.sourceId !== 'string' || typeof input.nodeName !== 'string' || !input.sourceId || !input.nodeName) throw Error('代理节点来源和名称必须同时提供');
      message.sourceId = input.sourceId;
      message.nodeName = input.nodeName;
    }
    const value = await this.controller.queue('instance-create', () => require('./operations.cjs').createInstance(this.controller, message));
    if (value?.id && value.started) this.focus(value.id);
    return value;
  }

  async action(input = {}) {
    const action = String(input.action || '').trim();
    if (!action || !/^[a-z][a-z0-9-]{0,80}$/.test(action)) throw Error('操作名称无效');
    if (typeof this.controller.externalRequest !== 'function') throw Error('本地操作通道尚未就绪，请重启应用后重试');
    const message = {...input, action};
    const result = await this.controller.externalRequest(message);
    if (!result?.ok) throw Error(result?.error || '操作失败');
    if (['start', 'reload', 'navigate', 'activate', 'tab-new', 'tab-activate'].includes(action) && input.id) this.focus(input.id);
    if (action === 'create' && input.start === true && typeof result.value === 'string') this.focus(result.value);
    return result.value;
  }

  focus(id) {
    this.controller.store.get(id);
    const window = this.controller.window;
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.send('core:external-focus', {id});
  }

  async handle(request, response) {
    const origin = String(request.headers.origin || '');
    if (/^https?:\/\/127\.0\.0\.1(?::\d+)?$/.test(origin)) response.setHeader('access-control-allow-origin', origin);
    response.setHeader('access-control-allow-headers', 'Authorization, Content-Type');
    response.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (!this.authorized(request)) { this.send(response, 401, {ok: false, error: '未授权'}); return; }
    try {
      const url = new URL(request.url || '/', `http://${HOST}`);
      if (request.method === 'GET' && url.pathname === '/v1/status') return this.send(response, 200, {ok: true, value: this.publicSnapshot()});
      if (request.method === 'GET' && url.pathname === '/v1/instances') return this.send(response, 200, {ok: true, value: this.instances()});
      if (request.method === 'GET' && url.pathname === '/v1/targets') return this.send(response, 200, {ok: true, value: await this.targets()});
      if (request.method === 'POST' && url.pathname === '/v1/actions') return this.send(response, 200, {ok: true, value: await this.action(await this.body(request))});
      if (request.method === 'POST' && url.pathname === '/v1/instances') {
        const value = await this.create(await this.body(request));
        return this.send(response, 201, {ok: true, value});
      }
      const removeMatch = url.pathname.match(/^\/v1\/instances\/([^/]+)$/);
      if (request.method === 'DELETE' && removeMatch) {
        const id = decodeURIComponent(removeMatch[1]);
        await this.controller.remove(id);
        return this.send(response, 200, {ok: true, value: {id, removed: true}});
      }
      const match = url.pathname.match(/^\/v1\/instances\/([^/]+)\/(start|stop|reload|navigate|focus)$/);
      if (request.method === 'POST' && match) {
        const id = decodeURIComponent(match[1]);
        const action = match[2];
        if (action === 'start') { await this.controller.start(id); this.focus(id); }
        else if (action === 'stop') await this.controller.stop(id);
        else if (action === 'reload') { await this.controller.action(id, 'reload'); this.focus(id); }
        else if (action === 'focus') this.focus(id);
        else { const input = await this.body(request); await this.controller.navigate(id, input.url); this.focus(id); }
        return this.send(response, 200, {ok: true, value: this.instances().find(row => row.id === id) || null});
      }
      this.send(response, 404, {ok: false, error: '接口不存在'});
    } catch (error) { this.send(response, 400, {ok: false, error: safeMessage(error)}); }
  }
}

module.exports = {ControlApi, loadSettings, saveSettings, ensurePorts};
