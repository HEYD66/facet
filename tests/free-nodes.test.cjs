'use strict';
// Free-node fetching without any network or core: lists and verification are injected.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {Store} = require('../src/main/store.cjs'), {Library} = require('../src/main/library.cjs');
const {DiagnosticHistory} = require('../src/main/diagnostic-history.cjs');
const {parseFreeNodes} = require('../src/main/free-node-parser.cjs');
const catalog = require('../src/main/free-node-catalog.cjs');
const {scanConfiguration, validated, locate} = require('../src/main/free-node-scan.cjs');
const {describe} = require('../src/main/node-evidence.cjs');
const {FreeNodes, options, nodeName} = require('../src/main/free-nodes.cjs');

const base64 = text => Buffer.from(text).toString('base64');
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-free-nodes-test-'));
  const store = new Store(dir), library = new Library(dir, store);
  const controller = {
    dir, binary: process.execPath, disposing: false, proxyModeSwitching: false, library, emits: 0, queues: new Map(),
    nodeNetwork: {warning: '', prepare: async () => ({overrides: {}})},
    diagnostics: {results: new Map(), history: new DiagnosticHistory(dir)},
    workspace: {rows: [], log(...row) { this.rows.push(row); }},
    emit() { this.emits++; },
    queue(id, job) {
      const next = (this.queues.get(id) || Promise.resolve()).catch(() => {}).then(job);
      this.queues.set(id, next);
      next.finally(() => { if (this.queues.get(id) === next) this.queues.delete(id); }).catch(() => {});
      return next;
    }
  };
  return {dir, controller, library, done: () => { controller.diagnostics.history.flush(); fs.rmSync(dir, {recursive: true, force: true}); }};
}
// Every list URL answers with a few endpoints of its own, in the format that list is read as.
function listServer() {
  let serial = 0;
  const address = () => { serial++; return `8.${serial >> 16 & 255}.${serial >> 8 & 255}.${serial & 255}`; };
  return async url => {
    if (/\.ya?ml$/.test(url)) return 'proxies:\n' + Array.from({length: 6}, (_, index) => `  - {name: "节点 ${index}", type: ss, server: ${address()}, port: 8388, cipher: aes-128-gcm, password: "p${index}"}`).join('\n');
    if (/\.json$|geonode/.test(url)) return JSON.stringify({data: Array.from({length: 6}, () => ({ip: address(), port: 8080, protocols: ['http']}))});
    if (/\.txt$/.test(url)) return Array.from({length: 6}, (_, index) => (index % 2 ? 'http://' : '') + address() + ':8080').join('\n');
    return base64(Array.from({length: 6}, (_, index) => `ss://${base64('aes-128-gcm:p' + index)}@${address()}:8388#link-${index}`).join('\n'));
  };
}
const accept = async (batch, {onResult, done, signal}) => {
  for (const candidate of batch) {
    if (done() || signal.aborted) return;
    onResult(candidate, {ok: true, node: {...candidate.node, name: 'candidate'}, ip: '9.9.9.9', countryCode: 'US', latencyMs: 120});
  }
};

test('parser reads share links, Base64 subscriptions, Clash YAML and sing-box JSON', () => {
  const vmess = 'vmess://' + base64(JSON.stringify({ps: 'vm', add: 'vm.example.com', port: '443', id: '11111111-2222-3333-4444-555555555555', aid: 0, net: 'ws', tls: 'tls', path: '/ws', host: 'cdn.example.com'}));
  const links = [
    `ss://${base64('aes-256-gcm:secret')}@8.8.8.8:8388#first`,
    'ss://' + base64('chacha20-ietf-poly1305:pw@1.1.1.1:443') + '#second',
    vmess,
    'vless://11111111-2222-3333-4444-555555555555@vl.example.com:443?security=reality&sni=www.example.com&pbk=key&sid=ab&type=tcp&flow=xtls-rprx-vision#vl',
    'trojan://pw@tr.example.com:443?sni=tr.example.com#tr',
    'hy2://pw@hy.example.com:8443?insecure=1&sni=hy.example.com#hy',
    'socks5://9.9.9.9:1080',
    'https://4.4.4.4:8443',
    'http://user:pass@5.5.5.5:3128'
  ];
  const nodes = parseFreeNodes(base64(links.join('\n')));
  assert.deepEqual(nodes.map(node => node.type), ['ss', 'ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'socks5', 'http', 'http']);
  assert.deepEqual([nodes[0].cipher, nodes[0].password, nodes[0].name], ['aes-256-gcm', 'secret', 'first']);
  assert.deepEqual([nodes[1].server, nodes[1].port, nodes[1].cipher], ['1.1.1.1', 443, 'chacha20-ietf-poly1305']);
  assert.deepEqual(nodes[2]['ws-opts'], {path: '/ws', headers: {Host: 'cdn.example.com'}});
  assert.equal(nodes[3]['reality-opts']['public-key'], 'key');
  assert.equal(nodes[3].flow, 'xtls-rprx-vision');
  assert.equal(nodes[5]['skip-cert-verify'], true);
  assert.equal(nodes[6].name, '');
  assert.equal(nodes[7].tls, true);
  assert.deepEqual([nodes[8].username, nodes[8].password], ['user', 'pass']);
  for (const node of nodes) assert(validated(node), node.type + ' passes the import rules');

  const yaml = 'proxies:\n  - {name: a, type: ss, server: 8.8.4.4, port: 1, cipher: aes-128-gcm, password: 123456, dialer-proxy: x, interface-name: eth0}\n  - {name: 剩余流量：1GB, type: ss, server: 8.8.4.4, port: 2, cipher: aes-128-gcm, password: x}\n  - {name: lan, type: http, server: 192.168.1.1, port: 80}\n  - {name: broken}';
  const fromYaml = parseFreeNodes(yaml);
  assert.equal(fromYaml.length, 1);
  assert.equal(fromYaml[0]['dialer-proxy'], undefined);
  assert.equal(fromYaml[0]['interface-name'], undefined);
  const fromJson = parseFreeNodes(JSON.stringify({outbounds: [{tag: 'out', type: 'shadowsocks', server: '8.8.8.8', server_port: 443, method: 'aes-128-gcm', password: 'x'}, {type: 'direct', tag: 'direct'}]}));
  assert.deepEqual(fromJson.map(node => [node.name, node.type, node.port]), [['out', 'ss', 443]]);
  assert.deepEqual(parseFreeNodes('127.0.0.1:8080:user:pass\nlocalhost:80@u:p\n198.18.0.5:80:u:p\n<html>'), []);
});

test('catalog adapts bare and JSON lists and marks TLS proxies from plain lists', () => {
  const tls = catalog.catalog.find(source => source.id === 'mrmarble-tls'), json = catalog.catalog.find(source => source.id === 'geonode');
  const fromBare = catalog.candidatesFrom('8.8.8.8:443 US 120ms\nnot an endpoint\n10.0.0.1:80\n', tls);
  assert.deepEqual(fromBare, [{type: 'http', server: '8.8.8.8', port: 443, tls: true, name: '', 'skip-cert-verify': true}]);
  const fromJson = catalog.candidatesFrom(JSON.stringify({data: [{ip: '8.8.8.8', port: '80', protocols: ['http', 'socks5']}, {ip: '8.8.4.4', port: 1080, protocols: ['socks4']}]}), json);
  assert.deepEqual(fromJson.map(catalog.signature).sort(), ['http|8.8.8.8|80', 'socks5|8.8.8.8|80']);
  assert.throws(() => catalog.candidatesFrom('<html>', json));
  const chosen = catalog.chooseSources(['plain']);
  assert.equal(chosen.length, 16);
  assert(catalog.catalog.filter(source => source.strong).every(source => chosen.includes(source)));
  assert(chosen.every(source => source.kind !== 'encrypted'));
  assert.equal(new Set(catalog.catalog.map(source => source.id)).size, catalog.catalog.length);
});

test('candidates are drawn across lists without repeats, known endpoints or unwanted kinds', () => {
  const plain = index => ({name: '', type: 'http', server: '8.8.0.' + index, port: 80});
  const encrypted = index => ({name: 'n' + index, type: 'ss', server: '8.9.0.' + index, port: 443, cipher: 'aes-128-gcm', password: 'x'});
  const lists = [[plain(1), plain(2), plain(3), encrypted(1)], [plain(1), encrypted(2), encrypted(3)], []];
  const sources = [{strong: true}, {}, {}];
  const all = catalog.pickCandidates(lists, sources, ['plain', 'encrypted'], 100, ['http|8.8.0.3|80']);
  assert.deepEqual(all.map(catalog.signature).sort(), ['http|8.8.0.1|80', 'http|8.8.0.2|80', 'ss|8.9.0.1|443', 'ss|8.9.0.2|443', 'ss|8.9.0.3|443']);
  const four = catalog.pickCandidates(lists, sources, ['plain', 'encrypted'], 4);
  assert.equal(four.length, 4);
  assert.equal(four.filter(node => catalog.kindOf(node) === 'plain').length, 2);
  assert(catalog.pickCandidates(lists, sources, ['encrypted'], 100).every(node => node.type === 'ss'));
});

test('free source merges without touching earlier nodes and can be replaced', () => {
  const t = setup();
  try {
    const node = (name, port) => ({name, type: 'http', server: '8.8.8.8', port});
    const first = t.library.saveFree([node('A', 1), node('A', 2), node('B', 3)]);
    assert.deepEqual([first.names, first.created], [['A', 'A 2', 'B'], true]);
    const version = t.library.get(first.id).updatedAt;
    assert.deepEqual(t.library.summaries().map(source => [source.name, source.free, source.subscription, source.nodes.length]), [['免费节点', true, false, 3]]);
    t.library.removeNodes(first.id, ['A 2']);
    t.library.rename(first.id, '我的免费节点');
    const second = t.library.saveFree([node('A', 4), node('A 2', 5)]);
    assert.deepEqual([second.id, second.names, second.removed, second.created, second.replaced], [first.id, ['A 2', 'A 2 2'], ['A 2'], false, false]);
    const merged = new Library(t.dir, new Store(t.dir)).get(first.id);
    assert.deepEqual(merged.nodes.map(item => [item.name, item.port]), [['A 2', 4], ['A 2 2', 5], ['A', 1], ['B', 3]]);
    assert.deepEqual([merged.updatedAt, merged.excluded, merged.name, merged.free], [version, [], '我的免费节点', true]);
    const replaced = t.library.saveFree([node('C', 6)], {replace: true});
    assert.deepEqual([replaced.replaced, replaced.removed.length, t.library.get(first.id).nodes.map(item => item.name)], [true, 4, ['C']]);
    assert.throws(() => t.library.saveFree([{name: 'bad', type: 'direct', server: '8.8.8.8', port: 1}]), /协议不支持/);
    assert.throws(() => t.library.saveFree([]), /没有可保存/);
    assert.equal(t.library.get(first.id).nodes.length, 1);
    assert.equal(t.library.summaries().length, 1);
  } finally { t.done(); }
});

test('a new free source respects the 30-source limit', async () => {
  const t = setup();
  try {
    for (let index = 0; index < 30; index++) await t.library.save({name: 'S' + index, text: JSON.stringify({proxies: [{name: 'n', type: 'http', server: '8.8.8.8', port: 1 + index}]})});
    assert.throws(() => t.library.saveFree([{name: 'A', type: 'http', server: '8.8.4.4', port: 1}]), /最多保存 30 个/);
    assert.throws(() => new FreeNodes(t.controller, {fetchText: listServer(), verify: accept}).start({}), /最多保存 30 个/);
  } finally { t.done(); }
});

test('options are validated and defaulted', () => {
  assert.deepEqual(options({}), {kinds: ['plain', 'encrypted'], target: 30, limit: 400, replace: false});
  assert.deepEqual(options({kinds: ['encrypted'], target: '500', replace: true}), {kinds: ['encrypted'], target: 500, limit: 500, replace: true});
  for (const bad of [{kinds: []}, {kinds: ['vpn']}, {kinds: 'plain'}, {target: 0}, {target: 501}, {target: 1.5}, {limit: 2001}, {target: 50, limit: 10}]) assert.throws(() => options(bad));
  assert.equal(nodeName({candidate: {node: {name: ''}}, node: {type: 'http', tls: true, server: '8.8.8.8', port: 443}, countryCode: 'JP'}), 'JP HTTPS 8.8.8.8:443');
  assert.equal(nodeName({candidate: {node: {name: '官网地址 example'}}, node: {type: 'socks5', server: '2001:4860:4860::8888', port: 1080}, countryCode: ''}), 'SOCKS5 [2001:4860:4860::8888]:1080');
  assert.equal(nodeName({candidate: {node: {name: ' 香港 01 '}}, node: {type: 'ss', server: 'a.example.com', port: 1}, countryCode: 'HK'}), '香港 01');
});

test('a run downloads lists, verifies in batches, saves the target and records the checks', async () => {
  const t = setup();
  try {
    const known = await t.library.save({name: 'Existing', text: JSON.stringify({proxies: [{name: 'kept', type: 'http', server: '8.0.0.2', port: 8080}]})});
    const batches = [], urls = [];
    const fetch = listServer();
    const service = new FreeNodes(t.controller, {
      batchSize: 4,
      fetchText: async (url, signal) => { urls.push(url); if (url.includes('gcore.jsdelivr.net')) throw Error('mirror down'); return fetch(url, signal); },
      verify: async (batch, context) => {
        batches.push(batch.length);
        assert.equal(context.root, path.join(t.dir, 'diagnostic-runtime'));
        for (const candidate of batch) {
          if (context.done()) return;
          assert.notEqual(catalog.signature(candidate.node), 'http|8.0.0.2|8080');
          // Every other candidate is dead.
          const alive = Number(String(candidate.node.server).split('.')[3]) % 2 === 0;
          context.onResult(candidate, alive ? {ok: true, node: {...candidate.node, name: 'candidate'}, ip: '9.9.9.' + batches.length, countryCode: 'DE', latencyMs: 80, geo: {ip: '9.9.9.' + batches.length, countryCode: 'DE', country: 'Germany', region: 'Hesse', city: 'Frankfurt', timezone: 'Europe/Berlin', isp: 'Example Net', provider: 'IP.SB', queriedAt: '2026-11-11T00:00:00.000Z'}} : {ok: false, reason: 'failed'});
        }
      }
    });
    assert.equal(service.snapshot(), null);
    const started = service.start({target: 5, limit: 40});
    assert.equal(started.started, true);
    assert.throws(() => service.start({}), /已有免费节点获取任务/);
    assert.equal(service.snapshot().running, true);
    await service.work;
    const state = service.snapshot();
    assert.deepEqual([state.running, state.stage, state.usable, state.result.imported, state.result.cancelled, state.result.error], [false, 'done', 5, 5, false, '']);
    assert.equal(state.sources.length, 16);
    assert(state.sources.every(source => source.state === 'ok'));
    assert(urls.some(url => url.includes('testingcf.jsdelivr.net')), 'falls back to the next mirror');
    assert(batches.length >= 2 && batches.every(size => size <= 4));
    assert(state.checked >= 5 && state.checked <= state.total && state.total <= 40);
    assert.equal(state.plain + state.encrypted, 5);
    const source = t.library.get(state.result.sourceId);
    assert.deepEqual([source.free, source.nodes.length, new Set(source.nodes.map(node => node.name)).size], [true, 5, 5]);
    assert.equal(t.library.get(known).nodes.length, 1);
    // Listed first although it was added after the existing source.
    assert.deepEqual(t.library.summaries().map(item => [item.name, item.free === true]), [['免费节点', true], ['Existing', false]]);    // Bare endpoints are named after the measured exit country; listed names are kept.
    assert(source.nodes.every(node => node.name && node.name !== 'candidate'));
    assert(source.nodes.filter(node => node.type === 'http').every(node => /^DE HTTP 8\.\d+\.\d+\.\d+:8080$/.test(node.name)));
    for (const node of source.nodes) {
      const latency = t.controller.diagnostics.results.get(JSON.stringify([source.id, node.name, 'latency']));
      const ip = t.controller.diagnostics.results.get(JSON.stringify([source.id, node.name, 'ip']));
      assert.deepEqual([latency.ok, latency.latencyMs, ip.ok, ip.countryCode, ip.country], [true, 80, true, 'DE', '德国']);
      assert.deepEqual([ip.timezone, ip.city, ip.isp, ip.provider, ip.queriedAt], ['Europe/Berlin', 'Frankfurt', 'Example Net', 'IP.SB', '2026-11-11T00:00:00.000Z']);
      assert(latency.at >= source.updatedAt && ip.at >= source.updatedAt, 'results count for this source version');
      // What a new instance on this node is given: language and time zone, both measured.
      const locale = describe(t.controller, source.id, node.name).locale;
      assert.deepEqual([locale.origin, locale.countryCode, locale.timezone, locale.language], ['measured', 'DE', 'Europe/Berlin', 'de-DE']);
    }
    assert.equal(t.controller.diagnostics.history.list().filter(row => row.sourceId === source.id && row.latency.ok === 1 && row.ip.ok === 1).length, 5);
    assert(t.controller.workspace.rows.some(row => /获取免费节点完成/.test(row[1])));
    assert(!JSON.stringify(t.controller.workspace.rows).includes('jsdelivr'), 'list URLs stay out of the log');

    // A second run appends and never re-verifies what the first run stored.
    const stored = new Set(source.nodes.map(catalog.signature));
    const again = new FreeNodes(t.controller, {fetchText: listServer(), verify: async (batch, context) => {
      for (const candidate of batch) { assert(!stored.has(catalog.signature(candidate.node))); if (!context.done()) context.onResult(candidate, {ok: true, node: {...candidate.node}, ip: '9.9.9.9', countryCode: 'US', latencyMs: 5, geo: null}); }
    }});
    again.start({target: 3, kinds: ['plain']});
    await again.work;
    const after = t.library.get(source.id);
    assert.deepEqual([again.snapshot().result.imported, after.nodes.length, after.updatedAt], [3, 8, source.updatedAt]);
    // A node no service could place is kept with its country; its time zone stays unknown rather than guessed.
    const unplaced = t.controller.diagnostics.results.get(JSON.stringify([source.id, after.nodes[0].name, 'ip']));
    assert.deepEqual([unplaced.ok, unplaced.countryCode, unplaced.timezone, unplaced.provider], [true, 'US', '', 'Cloudflare trace']);
    assert.deepEqual([describe(t.controller, source.id, after.nodes[0].name).locale.language, describe(t.controller, source.id, after.nodes[0].name).locale.timezone], ['en-US', '']);
    assert(after.nodes.slice(0, 3).every(node => node.type === 'http'));
    assert(t.controller.diagnostics.results.get(JSON.stringify([source.id, source.nodes[0].name, 'latency'])).ok, 'earlier results stay');
  } finally { t.done(); }
});

test('stopping keeps what was verified; failures are reported without saving', async () => {
  const t = setup();
  try {
    let release;
    const service = new FreeNodes(t.controller, {fetchText: listServer(), verify: async (batch, context) => {
      context.onResult(batch[0], {ok: true, node: {...batch[0].node}, ip: '9.9.9.9', countryCode: 'US', latencyMs: 30});
      context.onResult(batch[1], {ok: false, reason: 'invalid'});
      await new Promise(resolve => { release = resolve; context.signal.addEventListener('abort', resolve, {once: true}); });
      context.signal.throwIfAborted();
    }});
    assert.deepEqual(service.cancel(), {cancelled: false});
    service.start({target: 10});
    while (!release) await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual(service.cancel(), {cancelled: true});
    assert.equal(service.snapshot().cancelling, true);
    await service.work;
    const stopped = service.snapshot();
    assert.deepEqual([stopped.running, stopped.cancelling, stopped.checked, stopped.result.imported, stopped.result.cancelled, stopped.result.error], [false, false, 2, 1, true, '']);
    assert.equal(t.library.freeSource().nodes.length, 1);

    const offline = new FreeNodes(t.controller, {fetchText: async () => { throw Error('offline'); }, verify: accept});
    offline.start({});
    await offline.work;
    assert.match(offline.snapshot().result.error, /全部下载失败/);
    assert.equal(offline.snapshot().sources.filter(source => source.state === 'failed').length, 16);

    const broken = new FreeNodes(t.controller, {fetchText: listServer(), verify: async () => { throw Error('Mihomo 启动超时 password=hunter2'); }});
    broken.start({});
    await broken.work;
    assert.match(broken.snapshot().result.error, /Mihomo 启动超时/);
    assert(!broken.snapshot().result.error.includes('hunter2'));
    assert.equal(t.library.freeSource().nodes.length, 1);

    // On exit the task stops and writes nothing more.
    const closing = new FreeNodes(t.controller, {fetchText: listServer(), verify: async (batch, context) => {
      context.onResult(batch[0], {ok: true, node: {...batch[0].node}, ip: '9.9.9.9', countryCode: 'US', latencyMs: 30});
      await new Promise(resolve => context.signal.addEventListener('abort', resolve, {once: true}));
    }});
    closing.start({});
    while (!closing.snapshot().usable) await new Promise(resolve => setTimeout(resolve, 5));
    await closing.close();
    assert.equal(t.library.freeSource().nodes.length, 1);
    assert.throws(() => closing.start({}), /正在退出/);

    // A step that ignores the stop signal cannot hold up exit beyond the cap, and still saves nothing.
    let unstick;
    const stuck = new FreeNodes(t.controller, {fetchText: listServer(), verify: async (batch, context) => {
      context.onResult(batch[0], {ok: true, node: {...batch[0].node}, ip: '9.9.9.9', countryCode: 'US', latencyMs: 30});
      await new Promise(resolve => { unstick = resolve; });
    }});
    stuck.start({});
    while (!stuck.snapshot().usable) await new Promise(resolve => setTimeout(resolve, 5));
    const work = stuck.work, began = Date.now();
    await stuck.close(40);
    assert(Date.now() - began < 2000 && stuck.snapshot().running);
    unstick();
    await work;
    assert.deepEqual([stuck.snapshot().running, stuck.snapshot().result.imported, t.library.freeSource().nodes.length], [false, 0, 1]);

    t.controller.proxyModeSwitching = true;
    assert.throws(() => new FreeNodes(t.controller, {fetchText: listServer(), verify: accept}).start({}), /正在切换代理模式/);
    t.controller.proxyModeSwitching = false;
    t.controller.nodeNetwork.warning = '节点网络设置无法读取';
    assert.throws(() => new FreeNodes(t.controller, {fetchText: listServer(), verify: accept}).start({}), /节点网络设置无法读取/);
  } finally { t.done(); }
});

test('scan configuration gives every candidate its own authenticated loopback listener', () => {
  const entries = [{node: {name: 'candidate', type: 'http', server: '8.8.8.8', port: 80}, port: 30001}, {node: {name: 'candidate', type: 'socks5', server: '8.8.4.4', port: 1080}, port: 30002}];
  const user = {username: 'facet', password: 'secret'};
  const config = scanConfiguration(entries, 30100, 'controller-secret', {'interface-name': 'Ethernet', hosts: {'a.example.com': ['8.8.8.8']}}, user);
  assert.deepEqual(config.proxies.map(proxy => proxy.name), ['scan-0', 'scan-1']);
  assert.deepEqual(config.listeners, [
    {name: 'in-0', type: 'mixed', listen: '127.0.0.1', port: 30001, proxy: 'scan-0', users: [user]},
    {name: 'in-1', type: 'mixed', listen: '127.0.0.1', port: 30002, proxy: 'scan-1', users: [user]}
  ]);
  assert.deepEqual([config.rules, config['mixed-port'], config['allow-lan'], config['bind-address'], config['interface-name']], [['MATCH,REJECT'], 0, false, '127.0.0.1', 'Ethernet']);
  assert.equal(validated({name: '', type: 'http', server: '8.8.8.8', port: 80}).name, 'candidate');
  assert.equal(validated({type: 'direct', server: '8.8.8.8', port: 80}), null);
  assert.equal(validated({type: 'ss', server: '8.8.8.8', port: 80, 'dialer-proxy': 'x'}), null);
});

test('a verified node is placed by the first service that returns a country and a time zone', async () => {
  const asked = [];
  const answers = {
    'api.ip.sb': {status: 429, text: ''},
    'get.geojs.io': {status: 200, text: JSON.stringify({ip: '9.9.9.9', country_code: 'JP', country: 'Japan', timezone: 'Not/AZone'})},
    'ipapi.co': {status: 200, text: JSON.stringify({ip: '9.9.9.9', country_code: 'jp', country_name: 'Japan', region: 'Tokyo', city: 'Tokyo', timezone: 'Asia/Tokyo', org: 'Example'})}
  };
  const ask = async (url, timeoutMs) => { asked.push([new URL(url).hostname, timeoutMs]); return answers[new URL(url).hostname]; };
  const placed = await locate(ask, {now: () => Date.parse('2026-11-11T00:00:00Z')});
  assert.deepEqual(placed, {ip: '9.9.9.9', countryCode: 'JP', country: 'Japan', region: 'Tokyo', city: 'Tokyo', timezone: 'Asia/Tokyo', isp: 'Example', provider: 'ipapi.co', queriedAt: '2026-11-11T00:00:00.000Z'});
  assert.deepEqual(asked, [['api.ip.sb', 4000], ['get.geojs.io', 4000], ['ipapi.co', 4000]]);
  assert.equal(await locate(async () => { throw Error('proxy closed'); }), null);
  assert.equal(await locate(async () => ({status: 200, text: '<html>'})), null);
  // The whole lookup has a time budget, so a slow node cannot hold its verification slot for long.
  let clock = 0, calls = 0;
  assert.equal(await locate(async (_url, timeoutMs) => { calls++; clock += timeoutMs; throw Error('timeout'); }, {budgetMs: 6000, now: () => clock}), null);
  assert.equal(calls, 2);
});
