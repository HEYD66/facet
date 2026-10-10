'use strict';
// Controlled local upstreams, real Electron/Controller/Mihomo, isolated profiles.
// The TLS key is public test material; trust exceptions apply ONLY to fixture hosts.
const {app, BrowserWindow, WebContentsView, session, netLog} = require('electron');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const https = require('node:https'), net = require('node:net'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const mode = process.argv[2], output = process.argv[3];
assert(output, 'Run browser-network-runner.cjs');
const root = path.dirname(output);
const profile = path.join(root, ['baseline', 'guarded'].includes(mode) ? mode : 'recovery');
fs.mkdirSync(profile, {recursive: true}); app.setPath('userData', profile);
app.commandLine.appendSwitch('disable-quic');
app.commandLine.appendSwitch('site-per-process');
const policy = require('../src/main/browser-network-policy.cjs');
if (['guarded', 'interrupted', 'recovered', 'persisted'].includes(mode)) policy.installBrowserNetworkPolicy(app);
// Suppress explicitly direct application-window dictionaries in this fixture.
// The baseline keeps dictionaries off to isolate DNS hints without public traffic.
app.on('session-created', ses => {
  if (mode === 'baseline' || mode === 'seed' ||
    (mode === 'guarded' && !/^arena-core-[0-9a-f-]{36}$/i.test(path.basename(ses.getStoragePath() || ''))))
    ses.setSpellCheckerLanguages([]);
});
const report = {mode, electron: process.versions.electron, results: []};
const pass = text => report.results.push(text);
const servers = [], sockets = new Set(), windows = [];
let controller, logging = false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(fn, label) {
  for (let i = 0; i < 300; i++) { if (await fn()) return; await sleep(25); }
  throw Error('Timeout: ' + label);
}
function track(server) {
  servers.push(server);
  server.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); });
  return server;
}
async function listen(server) { track(server); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return server.address().port; }
const suffix = 'facet-dns.invalid';
function hints(label) {
  return `<link rel="dns-prefetch" href="//html-${label}.${suffix}">
    <link rel="preconnect" href="https://preconnect-${label}.${suffix}">
    <script>const link=document.createElement('link');link.rel='dns-prefetch';link.href='//dynamic-${label}.${suffix}';document.head.append(link);</script>`;
}
function page(req, res, tag) {
  const u = new URL(req.url, 'http://page.' + suffix);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Link', `<http://header-${u.pathname.slice(1)||'main'}.${suffix}>; rel="dns-prefetch"`);
  if (u.pathname === '/image') { res.setHeader('Content-Type', 'image/svg+xml'); return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'); }
  if (u.pathname === '/fetch') { res.setHeader('Access-Control-Allow-Origin', '*'); return res.end('FETCH-' + tag); }
  if (u.pathname === '/secure') { res.setHeader('Access-Control-Allow-Origin', '*'); return res.end('TLS-' + tag); }
  if (u.pathname === '/trace') return res.end('ip=203.0.113.77\n');
  res.setHeader('Content-Type', 'text/html');
  const label = u.pathname.slice(1) || 'main';
  const resources = label === 'main' ? `<img id="image" src="http://img.${suffix}/image">
    <iframe src="http://frame.${suffix}/frame"></iframe>
    <script>window.work=Promise.all([fetch('/fetch').then(r=>r.text()),
      fetch('https://tls.${suffix}/secure').then(r=>r.text()),
      new Promise((resolve,reject)=>{const s=new WebSocket('wss://ws.${suffix}/socket');s.onmessage=e=>{s.close();resolve(e.data)};s.onerror=()=>reject(Error('WS failed'));})]);</script>` : '';
  res.end(`<!doctype html><title>DNS fixture ${tag} ${label}</title>${hints(label)}<body>${tag}${resources}</body>`);
}
async function upstream(tag) {
  const requests = [];
  const originPort = await listen(http.createServer((req, res) => page(req, res, tag)));
  const tls = https.createServer({key: fs.readFileSync(path.join(__dirname, 'fixtures/dns/key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'fixtures/dns/cert.pem'))}, (req, res) => page(req, res, tag));
  tls.on('upgrade', (req, socket) => {
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    const body = Buffer.from('WS-' + tag); socket.write(Buffer.concat([Buffer.from([0x81, body.length]), body]));
    socket.on('data', data => { if ((data[0] & 15) === 8) socket.end(Buffer.from([0x88, 0])); });
  });
  const tlsPort = await listen(tls);
  const proxy = http.createServer((req, res) => {
    requests.push(req.url); if (!req.url.includes(suffix)) {res.writeHead(502); return res.end();}
    page(req, res, tag);
  });
  proxy.on('connect', (req, socket, head) => {
    requests.push('CONNECT ' + req.url);
    const isHTTP = req.url.endsWith('.' + suffix + ':80');
    if (!isHTTP && !['tls.' + suffix + ':443', 'ws.' + suffix + ':443'].includes(req.url)) {
      socket.end('HTTP/1.1 502 Not a fixture\r\nConnection: close\r\n\r\n'); return;
    }
    const peer = net.connect(isHTTP ? originPort : tlsPort, '127.0.0.1'); sockets.add(peer);
    peer.on('close', () => sockets.delete(peer)); peer.on('error', () => socket.destroy()); socket.on('close', () => peer.destroy());
    peer.on('connect', () => { socket.write('HTTP/1.1 200 Connection established\r\n\r\n'); if (head.length) peer.write(head); socket.pipe(peer); peer.pipe(socket); });
  });
  const port = await listen(proxy);
  return {proxy, port, requests, node: {name: 'local-' + tag, type: 'http', server: '127.0.0.1', port}};
}
function trustFixture(ses) { ses.setCertificateVerifyProc((req, cb) => cb(['tls.' + suffix, 'ws.' + suffix].includes(req.hostname) ? 0 : -3)); }
function realResolverJobs(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const names = Object.fromEntries(Object.entries(data.constants.logEventTypes).map(([k, v]) => [v, k]));
  // NQE LOCAL_ONLY manager requests do not mean a system/DoH DNS query occurred.
  return data.events.filter(e => /^(HOST_RESOLVER_IMPL_JOB|HOST_RESOLVER_MANAGER_JOB)$/.test(names[e.type]))
    .map(e => String(e.params?.host || e.params?.hostname || '')).filter(Boolean);
}
const watchdog = setTimeout(() => app.exit(2), 75000);
app.whenReady().then(async () => {
  try {
    if (!['baseline', 'guarded'].includes(mode)) {
      const partition = 'persist:arena-core-11111111-1111-4111-8111-111111111111';
      const s = session.fromPartition(partition);
      const journal = path.join(s.getStoragePath(), 'facet-pending-dictionaries.json');
      const languages = ['en-US', 'de'];
      if (mode === 'seed') {
        await s.setProxy({mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:1', proxyBypassRules: '<-loopback>'});
        s.setSpellCheckerLanguages(languages); s.flushStorageData(); await sleep(400);
        pass('seed custom dictionary languages');
      } else if (mode === 'interrupted') {
        assert.deepEqual(s.getSpellCheckerLanguages(), []);
        assert.deepEqual(JSON.parse(fs.readFileSync(journal)).languages, languages);
        const helper = new BrowserWindow({show: false, webPreferences: {session: s}}); windows.push(helper);
        await helper.loadURL('about:blank'); assert.deepEqual(s.getSpellCheckerLanguages(), []);
        s.flushStorageData(); await sleep(400);
        pass('import helper leaves dictionaries deferred; interruption preserves recovery record');
      } else if (mode === 'recovered') {
        assert.deepEqual(s.getSpellCheckerLanguages(), []);
        const up = await upstream('recovery');
        await s.setProxy({mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:' + up.port, proxyBypassRules: '<-loopback>'});
        policy.resumeDictionaries(s); assert.deepEqual(s.getSpellCheckerLanguages(), languages);
        s.flushStorageData(); await sleep(400);
        pass('new process restores custom languages after proxy configuration');
      } else {
        assert.deepEqual(JSON.parse(fs.readFileSync(journal)).languages, languages);
        await s.setProxy({mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:1', proxyBypassRules: '<-loopback>'});
        policy.resumeDictionaries(s); assert.deepEqual(s.getSpellCheckerLanguages(), languages);
        await wait(() => !fs.existsSync(journal), 'recovery record cleanup after verified persistence');
        pass('third process reads restored persisted languages');
      }
    } else {
      const log = path.join(root, mode + '-netlog.json'); await netLog.startLogging(log); logging = true;
      const a = await upstream('A');
      if (mode === 'baseline') {
        const s = session.fromPartition('baseline'); trustFixture(s);
        await s.setProxy({mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:' + a.port, proxyBypassRules: '<-loopback>'});
        const w = new BrowserWindow({show: false, webPreferences: {session: s}}); windows.push(w);
        await w.loadURL('http://page.' + suffix + '/main');
        assert.deepEqual(await w.webContents.executeJavaScript('window.work'), ['FETCH-A', 'TLS-A', 'WS-A']);
        await sleep(1600); await netLog.stopLogging(); logging = false;
        const jobs = realResolverJobs(log).filter(h => h.includes(suffix));
        assert(jobs.some(h => h.includes('html-main.')), 'positive control must expose HTML DNS hint');
        assert(jobs.some(h => h.includes('dynamic-main.')), 'positive control must expose dynamic hint');
        pass('unfixed positive control exposes actual DNS resolver jobs: ' + jobs.join(', '));
      } else {
        const b = await upstream('B');
        const w = new BrowserWindow({show: false, webPreferences: {partition: 'persist:arena-core-controls'}}); windows.push(w);
        const {Controller} = require('../src/main/controller.cjs');
        controller = new Controller(w, profile, path.resolve(__dirname, '../resources/mihomo/mihomo.exe'));
        const make = async (name, up) => {
          const x = controller.store.create(name, {mode: 'mihomo', nodeName: up.node.name});
          controller.store.saveNodes(x.id, [up.node], null); controller.store.update(x.id, {url: 'http://page.' + suffix + '/main'});
          // Pre-create while guarded to validate eager dictionary prevention and language preservation.
          const s = session.fromPartition('persist:arena-core-' + x.id); trustFixture(s);
          const languages = JSON.parse(fs.readFileSync(path.join(s.getStoragePath(), 'facet-pending-dictionaries.json'))).languages;
          assert.deepEqual(s.getSpellCheckerLanguages(), []);
          await sleep(250); assert.equal(up.requests.length, 0, 'no pre-proxy dictionary request');
          await controller.start(x.id); const r = controller.runtimes.get(x.id);
          await wait(() => r.view.webContents.getTitle() === 'DNS fixture ' + name + ' main', name + ' page');
          assert.deepEqual(await r.view.webContents.executeJavaScript('window.work'), ['FETCH-' + name, 'TLS-' + name, 'WS-' + name]);
          assert.deepEqual(s.getSpellCheckerLanguages(), languages);
          const config = JSON.parse(fs.readFileSync(r.core.config));
          assert.equal(config.dns.enable, false); assert.equal(config.tun.enable, false);
          assert.deepEqual(config.rules, ['MATCH,arena-upstream']);
          return {x, r};
        };
        const A = await make('A', a), B = await make('B', b);
        assert.notEqual(A.r.core.proxyPort, B.r.core.proxyPort);
        const wc = A.r.view.webContents;
        await wc.executeJavaScript("document.cookie='isolation=A';localStorage.setItem('isolation','A')");
        assert.equal(await B.r.view.webContents.executeJavaScript("localStorage.getItem('isolation')"), null);
        await wait(() => wc.mainFrame.frames.some(f => f.url === 'http://frame.' + suffix + '/frame'), 'iframe');
        const opened = new Promise(resolve => wc.once('did-create-window', resolve));
        await wc.executeJavaScript("window.open('http://popup." + suffix + "/popup','_blank','width=400,height=320');0", true);
        const popup = await opened; windows.push(popup);
        await wait(() => popup.webContents.getTitle() === 'DNS fixture A popup', 'real popup');
        assert.equal(popup.webContents.session, A.r.session);
        assert.equal(await popup.webContents.executeJavaScript("localStorage.getItem('isolation')"), null); // different origin
        for (const up of [a, b]) {
          assert(up.requests.some(url => url.includes('img.' + suffix)), 'image via upstream');
          assert(up.requests.includes('CONNECT tls.' + suffix + ':443'));
          assert(up.requests.includes('CONNECT ws.' + suffix + ':443'));
          await wait(() => up.requests.some(url => /gvt1\.com|\.bdic/.test(url)), 'dictionary download released via upstream ' + up.node.name);
        }
        pass('real Controller + two Mihomo cores: HTTP/image/fetch/HTTPS/WSS/iframe/popup through independent upstreams');
        pass('cookies/storage isolated; languages preserved; dictionaries wait for proxy');
        const {TARGETS} = require('../src/main/diagnostics.cjs');
        TARGETS.latency = 'https://tls.' + suffix + '/trace';
        const diagnosticSession = session.fromPartition('arena-core-diagnostics-dns-policy', {cache: false});
        trustFixture(diagnosticSession);
        const latency = await controller.diagnostics.probe(a.node, 'latency', new AbortController().signal, 'dns-policy');
        assert(Number.isFinite(latency.latencyMs)); assert.equal(controller.diagnostics.cores.size, 0);
        const failed = controller.store.create('missing-node', {mode: 'mihomo', nodeName: 'missing'});
        await assert.rejects(controller.start(failed.id), /尚未选择/);
        const failedRuntime = controller.runtimes.get(failed.id);
        assert.equal(failedRuntime.status, 'error'); assert(!failedRuntime.view);
        assert.deepEqual(failedRuntime.session.getSpellCheckerLanguages(), []);
        const damaged = controller.store.create('damaged-recovery', {mode: 'mihomo', nodeName: a.node.name});
        controller.store.saveNodes(damaged.id, [a.node], null);
        const damagedFile = path.join(profile, 'Partitions', 'arena-core-' + damaged.id, 'facet-pending-dictionaries.json');
        fs.mkdirSync(path.dirname(damagedFile), {recursive: true}); fs.writeFileSync(damagedFile, '{bad-json');
        await assert.rejects(controller.start(damaged.id), /拼写词典恢复记录/);
        assert.equal(fs.readFileSync(damagedFile, 'utf8'), '{bad-json');
        assert(!controller.runtimes.get(damaged.id).view);
        pass('real HTTPS diagnostic cleans up its core; failed instance startup keeps dictionaries deferred');
        await sleep(1600); await netLog.stopLogging(); logging = false;
        const jobs = realResolverJobs(log);
        assert.deepEqual(jobs.filter(h => h.includes(suffix) || h.includes('gvt1.com')), [], 'proxied website/dictionary domains never reach local DNS');
        pass('netlog: zero local website/dictionary resolver jobs in proxy phase');
        let sentinelHits = 0;
        const direct = http.createServer((_req, res) => {sentinelHits++; res.end('<title>DIRECT SENTINEL</title>');});
        const directPort = await listen(direct);
        // First verify the exact direct endpoint works, then use it to detect fallback.
        const d = controller.store.list()[0]; controller.store.update(d.id, {url: 'http://localhost:' + directPort});
        await controller.start(d.id);
        await wait(() => controller.runtimes.get(d.id).view.webContents.getTitle() === 'DIRECT SENTINEL', 'direct resolver preserved');
        assert(sentinelHits > 0); await controller.stop(d.id); sentinelHits = 0;
        const before = b.requests.length;
        const result = await B.r.session.fetch('http://127.0.0.1:' + directPort + '/through-proxy').then(r => r.status, () => 'rejected');
        assert(['rejected', 502].includes(result));
        assert(b.requests.length > before); assert.equal(sentinelHits, 0, 'loopback stays proxied');
        // Refuse the upstream while retaining a running core.
        b.proxy.removeAllListeners('request'); b.proxy.on('request', (_req, res) => {res.writeHead(502);res.end();});
        b.proxy.removeAllListeners('connect'); b.proxy.on('connect', (_req, socket) => socket.destroy());
        await B.r.session.closeAllConnections();
        await B.r.session.fetch('http://127.0.0.1:' + directPort + '/bad-upstream').catch(() => {});
        assert.equal(sentinelHits, 0);
        // Real unexpected core termination closes the view, and the session stays fixed.
        A.r.core.child.kill(); await wait(() => A.r.status === 'error' && !A.r.view, 'core failure closes view');
        assert.equal(await A.r.session.resolveProxy('http://127.0.0.1:' + directPort), 'PROXY 127.0.0.1:' + A.r.core.proxyPort);
        await assert.rejects(A.r.session.fetch('http://127.0.0.1:' + directPort + '/stopped-core'));
        assert.equal(sentinelHits, 0);
        pass('direct localhost resolves/loads; loopback and broken proxy never fall back; killed core closes its view');
      }
    }
  } catch (error) { report.error = error.stack || String(error); console.error(report.error); }
  finally {
    clearTimeout(watchdog);
    if (logging) await netLog.stopLogging();
    try { await controller?.closeAll(); } catch (error) { report.error ||= error.stack; }
    for (const w of windows) if (!w.isDestroyed()) w.destroy();
    for (const s of sockets) s.destroy();
    for (const server of servers) await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    app.exit(report.error ? 1 : 0);
  }
});
