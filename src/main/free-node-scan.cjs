'use strict';
// Verifies a batch of free-node candidates through one throwaway Mihomo core:
// every candidate gets its own authenticated loopback listener, and a candidate
// counts as usable only after an HTTPS request through it returns an exit IP.
// The core never routes anything but these probes (rules: MATCH,REJECT).
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const tls = require('node:tls');
const http = require('node:http');
const crypto = require('node:crypto');
const {execFile} = require('node:child_process');
const {Mihomo, configuration, reserveNodePort, retirePort, listenerReady} = require('./mihomo.cjs');
const {parseNodes} = require('./store.cjs');
const {checkServerIdentity} = require('./safe-http.cjs');
const {PROVIDERS, normalize} = require('./ip-services.cjs');

const BATCH_SIZE = 80;
const CONCURRENCY = 40;
const PROBE_TIMEOUT_MS = 8000;
const LOCATE_TIMEOUT_MS = 4000;
const LOCATE_BUDGET_MS = 9000;
const PROBE_HOST = 'www.cloudflare.com';
const AGENT = 'Facet/' + require('../../package.json').version;
const PROBE_PROVIDER = 'Cloudflare · HTTPS 首响应（含连接/TLS）';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function pool(items, size, worker) {
  let next = 0;
  await Promise.all(Array.from({length: Math.min(size, items.length)}, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  }));
}
// The same rules as a subscription import; a candidate the library would refuse is never started.
function validated(node) {
  try { return parseNodes(JSON.stringify({proxies: [{...node, name: 'candidate'}]}))[0]; }
  catch { return null; }
}
function scanConfiguration(entries, controllerPort, secret, overrides, user) {
  return {
    ...configuration({}, 0, controllerPort, secret, overrides),
    'log-level': 'silent',
    proxies: entries.map((entry, index) => ({...entry.node, name: 'scan-' + index})),
    listeners: entries.map((entry, index) => ({name: 'in-' + index, type: 'mixed', listen: '127.0.0.1', port: entry.port, proxy: 'scan-' + index, users: [user]})),
    rules: ['MATCH,REJECT']
  };
}
// Resolves with null when the core accepts the file, otherwise with its output.
function testConfiguration(binary, dir, file, signal) {
  return new Promise((resolve, reject) => {
    execFile(binary, ['-t', '-d', dir, '-f', file], {windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024, signal}, (error, stdout, stderr) => {
      if (!error) return resolve(null);
      if (signal?.aborted) return reject(Error('已取消'));
      if (error.code === 'ENOENT') return reject(Error('内置 Mihomo 缺失，请先运行 npm run setup:core'));
      resolve(String(stdout) + String(stderr));
    });
  });
}
// One HTTPS GET through the local listener; resolves with {status, text, latencyMs} once the body is read.
// Certificates are verified, so a proxy that intercepts TLS does not pass.
function request(port, user, host, pathname, signal, timeoutMs, limit = 8192) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let settled = false, tunnel, secure, request;
    const connect = http.request({
      host: '127.0.0.1', port, method: 'CONNECT', path: host + ':443', agent: false,
      headers: {Host: host + ':443', 'Proxy-Authorization': 'Basic ' + Buffer.from(user.username + ':' + user.password).toString('base64')}
    });
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      for (const item of [request, secure, tunnel, connect]) { try { item?.destroy(); } catch {} }
      error ? reject(error) : resolve(value);
    };
    const onAbort = () => finish(Error('已取消'));
    const timer = setTimeout(() => finish(Error('验证超时')), timeoutMs);
    connect.on('error', finish);
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, {once: true});
    connect.once('connect', (response, socket) => {
      tunnel = socket;
      socket.on('error', finish);
      if (settled) return socket.destroy();
      if (response.statusCode !== 200) return finish(Error('代理未建立隧道'));
      secure = tls.connect({socket, servername: host, checkServerIdentity, ALPNProtocols: ['http/1.1']});
      secure.on('error', finish);
      // No agent: the request is written to the tunnel that was just opened.
      request = http.get({host, path: pathname, createConnection: () => secure, headers: {Host: host, Accept: '*/*', 'User-Agent': AGENT, Connection: 'close'}}, answer => {
        const latencyMs = Math.round(performance.now() - started);
        let text = '';
        answer.setEncoding('utf8');
        answer.on('data', chunk => { text += chunk; if (text.length > limit) finish(Error('检测响应超出上限')); });
        answer.on('error', finish);
        answer.on('end', () => finish(null, {status: answer.statusCode, text, latencyMs}));
      });
      request.on('error', finish);
    });
    connect.end();
  });
}
// Cloudflare's trace endpoint decides whether a candidate works: it must return an exit IP.
async function probe(port, user, signal, timeoutMs = PROBE_TIMEOUT_MS) {
  const answer = await request(port, user, PROBE_HOST, '/cdn-cgi/trace', signal, timeoutMs);
  if (answer.status !== 200) throw Error('检测服务返回 HTTP ' + answer.status);
  const ip = /^ip=(.+)$/m.exec(answer.text)?.[1].trim() || '';
  const code = /^loc=([A-Za-z]{2})$/m.exec(answer.text)?.[1].toUpperCase() || '';
  if (!net.isIP(ip)) throw Error('检测响应无效');
  return {ip, countryCode: ['XX', 'ZZ', 'T1'].includes(code) ? '' : code, latencyMs: answer.latencyMs};
}
// The trace has no time zone, and an instance created on this node needs one. The same services as the
// exit-IP check are asked in turn through the node; null when none answers with a country and an IANA zone.
async function locate(ask, {providers = PROVIDERS, budgetMs = LOCATE_BUDGET_MS, now = Date.now} = {}) {
  const deadline = now() + budgetMs;
  for (const provider of providers) {
    const left = deadline - now();
    if (left < 500) break;
    try {
      const answer = await ask(provider.url, Math.min(LOCATE_TIMEOUT_MS, left));
      if (answer.status !== 200) continue;
      return {...normalize(provider, JSON.parse(answer.text), true), queriedAt: new Date(now()).toISOString()};
    } catch {}
  }
  return null;
}

// Reports every candidate it reached a verdict on through onResult(candidate, outcome):
//   {ok: true, node, ip, countryCode, latencyMs, geo} | {ok: false, reason: 'invalid' | 'failed'}
// geo is null or the exit-IP check's fields: {ip, countryCode, country, region, city, timezone, isp, provider, queriedAt}.
// Candidates left unprobed because done() turned true or the signal aborted are not reported.
async function verifyBatch(candidates, {binary, root, prepare, signal, onResult, done = () => false, concurrency = CONCURRENCY, probeTimeoutMs = PROBE_TIMEOUT_MS}) {
  const report = (candidate, outcome) => { try { onResult?.(candidate, outcome); } catch {} };
  signal.throwIfAborted();
  let entries = [];
  for (const candidate of candidates) {
    const node = validated(candidate.node);
    if (node) entries.push({candidate, node});
    else report(candidate, {ok: false, reason: 'invalid'});
  }
  // The node DNS and outbound settings apply here exactly as they do to an instance's own core.
  const overrides = {}, preparing = new Map();
  await pool(entries, 8, async entry => {
    const key = String(entry.node.server).toLowerCase();
    if (!preparing.has(key)) preparing.set(key, Promise.resolve().then(() => prepare ? prepare(entry.node, signal) : {overrides: {}}));
    try { entry.overrides = (await preparing.get(key)).overrides || {}; }
    catch { entry.unprepared = true; }
  });
  signal.throwIfAborted();
  for (const entry of entries) {
    if (entry.unprepared) { report(entry.candidate, {ok: false, reason: 'invalid'}); continue; }
    if (entry.overrides['interface-name']) overrides['interface-name'] = entry.overrides['interface-name'];
    if (entry.overrides.hosts) overrides.hosts = {...overrides.hosts, ...entry.overrides.hosts};
  }
  entries = entries.filter(entry => !entry.unprepared);
  if (!entries.length) return;

  const dir = path.join(root, crypto.randomUUID());
  const user = {username: 'facet', password: crypto.randomBytes(18).toString('base64url')};
  const ports = [];
  let core = null;
  try {
    fs.mkdirSync(dir, {recursive: true});
    for (const entry of entries) {
      signal.throwIfAborted();
      entry.port = await reserveNodePort();
      ports.push(entry.port);
    }
    // The core names the proxy it rejects ("proxy 3: ..."); drop that one and ask again.
    const draft = path.join(dir, 'candidates.json');
    try {
      for (;;) {
        fs.writeFileSync(draft, JSON.stringify(scanConfiguration(entries, 1, 'draft', overrides, user)), {mode: 0o600});
        const output = await testConfiguration(binary, dir, draft, signal);
        if (output === null) break;
        const index = Number(/proxy (\d+):/.exec(output)?.[1] ?? -1);
        if (!Number.isInteger(index) || index < 0 || index >= entries.length) throw Error('内核无法校验候选节点配置');
        report(entries.splice(index, 1)[0].candidate, {ok: false, reason: 'invalid'});
        if (!entries.length) return;
      }
    } finally { fs.rmSync(draft, {force: true}); }

    const exited = new AbortController();
    core = new Mihomo(binary, dir, () => exited.abort(), null, null);
    core.configurationFactory = (_node, _proxyPort, controllerPort, secret) => scanConfiguration(entries, controllerPort, secret, overrides, user);
    core.listenerPort = entries[0].port;
    await core.start({}, signal);

    const ready = new Set(), deadline = Date.now() + 5000;
    for (;;) {
      await pool(entries.filter(entry => !ready.has(entry)), 20, async entry => { try { await listenerReady(entry.port); ready.add(entry); } catch {} });
      if (ready.size === entries.length || Date.now() > deadline || signal.aborted || exited.signal.aborted) break;
      await delay(100);
    }
    signal.throwIfAborted();
    for (const entry of entries) if (!ready.has(entry)) report(entry.candidate, {ok: false, reason: 'failed'});

    const enough = new AbortController();
    const probing = AbortSignal.any([signal, enough.signal, exited.signal]);
    await pool(entries.filter(entry => ready.has(entry)), concurrency, async entry => {
      if (probing.aborted || done()) return;
      try {
        const result = await probe(entry.port, user, probing, probeTimeoutMs);
        if (done()) return;
        // A node that passed stays usable when no service places it; it is then stored with its country only.
        const geo = await locate((url, timeoutMs) => {
          const target = new URL(url);
          return request(entry.port, user, target.hostname, target.pathname + target.search, probing, timeoutMs, 65536);
        });
        if (done()) return;
        report(entry.candidate, {ok: true, node: entry.node, ...result, geo});
        if (done()) enough.abort();
      } catch { if (!probing.aborted) report(entry.candidate, {ok: false, reason: 'failed'}); }
    });
    signal.throwIfAborted();
    if (exited.signal.aborted && !done()) throw Error('验证内核意外退出');
  } finally {
    try { await core?.stop(); } catch {}
    for (const port of ports) retirePort(port);
    try { fs.rmSync(dir, {recursive: true, force: true}); } catch {}
  }
}
module.exports = {verifyBatch, probe, locate, scanConfiguration, validated, BATCH_SIZE, CONCURRENCY, PROBE_TIMEOUT_MS, PROBE_PROVIDER};
