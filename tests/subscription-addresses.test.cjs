'use strict';
// The production resolver validates public addresses; only this test process
// maps those addresses to loopback sockets. No subscription or Internet access.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns').promises;
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { downloadSubscription } = require('../src/main/subscription.cjs');
const { Library } = require('../src/main/library.cjs');
const { Store } = require('../src/main/store.cjs');
const { NetworkTrace } = require('../src/main/network-trace.cjs');
const { pinnedLookup } = require('../src/main/subscription-policy.cjs');

const yaml = 'proxies:\n  - name: Address fixture\n    type: http\n    server: 127.0.0.1\n    port: 9001\n';
const v6 = '2606:4700:4700::1111', v4 = '93.184.216.34', anotherV4 = '1.1.1.1';

async function fixture(t, addresses, handler, run, { secure = false, host = 'subscription.example.test' } = {}) {
  const sockets = new Set(), lookups = [], hosts = [], tlsNames = [];
  const cert = fs.readFileSync(path.join(__dirname, 'fixtures/dns/cert.pem'));
  const transport = secure ? https : http;
  const respond = (req, res) => { hosts.push(req.headers.host); tlsNames.push(req.socket.servername); handler(req, res); };
  const server = secure ? https.createServer({ cert, key: fs.readFileSync(path.join(__dirname, 'fixtures/dns/key.pem')) }, respond) : http.createServer(respond);
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const originalLookup = dns.lookup, originalRequest = transport.request;
  t.mock.method(dns, 'lookup', (name, options) => name === host
    ? Promise.resolve(addresses.map(address => ({ address, family: address.includes(':') ? 6 : 4 })))
    : originalLookup(name, options));
  t.mock.method(transport, 'request', (url, options, callback) => {
    if (url.hostname !== host) throw Error('Unexpected external request');
    const lookup = (host, settings, done) => options.lookup(host, settings, (error, rows, family) => {
      if (error) return done(error);
      const mapped = address => address === v6 ? '::1' : address === v4 ? '127.0.0.1' : address === anotherV4 ? '127.0.0.2' : assert.fail('Unvalidated destination');
      lookups.push(Array.isArray(rows) ? rows.map(row => row.address) : [rows]);
      if (Array.isArray(rows)) done(null, rows.map(row => ({ ...row, address: mapped(row.address) })));
      else done(null, mapped(rows), family);
    });
    return originalRequest(url, { ...options, lookup, ...(secure ? { ca: cert } : {}) }, callback);
  });
  try { await run({ url: `${secure ? 'https' : 'http'}://${host}:${server.address().port}/sub`, lookups, hosts, tlsNames }); }
  finally { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
}

test('real TCP: unavailable IPv6 falls back to the validated IPv4 address', t => fixture(t, [v6, v4],
  (_req, res) => res.end(yaml), async ({ url, lookups, hosts }) => {
    const result = await downloadSubscription(url, { timeoutMs: 3000 });
    assert.equal(result.text, yaml);
    assert.deepEqual(lookups, [[v6, v4]]);
    assert.equal(hosts.length, 1);
    assert.match(hosts[0], /^subscription\.example\.test:/);
  }));

test('real TCP: a refused first IPv4 address does not discard the remaining IPv4 address', t => fixture(t, [anotherV4, v4],
  (_req, res) => res.end(yaml), async ({ url, lookups }) => {
    assert.equal((await downloadSubscription(url, { timeoutMs: 3000 })).text, yaml);
    assert.deepEqual(lookups, [[anotherV4, v4]]);
  }));

test('real TCP library: address fallback imports, refreshes and persists; a failed refresh preserves the old source', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-subscription-addresses-'));
  const trace = new NetworkTrace(dir);
  let status = 200;
  try {
    await fixture(t, [v6, v4], (_req, res) => { res.writeHead(status); res.end(status === 200 ? yaml : 'private-fixture-body'); },
      async ({ url }) => {
        const store = new Store(dir), lib = new Library(dir, store, { trace });
        const id = await lib.save({ name: 'Address fixture', url });
        const reloaded = new Library(dir, new Store(dir), { trace });
        assert.equal(reloaded.get(id).nodes.length, 1);
        assert.equal(reloaded.get(id).url, url);
        await reloaded.save({ id });
        const before = fs.readFileSync(reloaded.file);
        status = 403;
        await assert.rejects(reloaded.save({ id }), /HTTP 403/);
        assert.deepEqual(fs.readFileSync(reloaded.file), before);
        assert.equal(new Library(dir, new Store(dir)).get(id).nodes.length, 1);
        trace.flush();
        const recorded = new NetworkTrace(dir).snapshot();
        assert.deepEqual(recorded.rows.map(row => row.result), ['success', 'success', 'failed']);
        assert(!JSON.stringify(recorded).includes('private-fixture-body'));
      });
  } finally { trace.flush(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('real TLS: address fallback preserves the original Host, SNI and certificate verification', t => fixture(t, [v6, v4],
  (_req, res) => res.end(yaml), async ({ url, hosts, tlsNames }) => {
    assert.equal((await downloadSubscription(url)).text, yaml);
    assert.match(hosts[0], /^tls\.facet-dns\.invalid:/);
    assert.deepEqual(tlsNames, ['tls.facet-dns.invalid']);
  }, { secure: true, host: 'tls.facet-dns.invalid' }));

test('real TLS: address fallback still rejects a certificate for a different hostname', t => fixture(t, [v6, v4],
  (_req, res) => res.end(yaml), async ({ url, hosts }) => {
    await assert.rejects(downloadSubscription(url), error => error.code === 'ERR_TLS_CERT_ALTNAME_INVALID' && /证书与域名不匹配/.test(error.message));
    assert.equal(hosts.length, 0);
  }, { secure: true, host: 'wrong.facet-dns.invalid' }));

test('all failed addresses expose their safe codes and are recorded individually', t => fixture(t, [v6, anotherV4],
  (_req, res) => res.end(yaml), async ({ url, hosts }) => {
    const steps = [];
    await assert.rejects(downloadSubscription(url + '?token=fixture-do-not-echo', { timeoutMs: 3000, onStage: row => steps.push(row) }), error =>
      error.code === 'ECONNREFUSED' && /服务器拒绝连接/.test(error.message) && !error.message.includes('fixture-do-not-echo'));
    assert.equal(hosts.length, 0);
    assert.equal(steps.filter(row => row.stage === 'tcp-address-error' && row.code === 'ECONNREFUSED').length, 2);
    assert(!JSON.stringify(steps).includes('fixture-do-not-echo'));
  }));

test('mixed private/public DNS is blocked before attempting any fallback address', t => fixture(t, [v4, '10.0.0.1'],
  (_req, res) => res.end(yaml), async ({ url, lookups, hosts }) => {
    await assert.rejects(downloadSubscription(url), /本机或内网/);
    assert.deepEqual(lookups, []); assert.deepEqual(hosts, []);
  }));

test('pinned multi-address lookups validate the whole list and honor explicit address families', async () => {
  assert.throws(() => pinnedLookup([v4, '127.0.0.1']), /公网/);
  assert.throws(() => pinnedLookup([]), /公网/);
  const addresses = [v6, v4, v4], lookup = pinnedLookup(addresses);
  addresses.push('127.0.0.1');
  const all = options => new Promise((resolve, reject) => lookup('unused.test', options, (error, rows) => error ? reject(error) : resolve(rows)));
  assert.deepEqual(await all({ all: true }), [{ address: v6, family: 6 }, { address: v4, family: 4 }]);
  assert.deepEqual(await all({ all: true, family: 4 }), [{ address: v4, family: 4 }]);
  assert.deepEqual(await all({ all: true, family: 6 }), [{ address: v6, family: 6 }]);
  await assert.rejects(new Promise((resolve, reject) => pinnedLookup([v4])('unused.test', { all: true, family: 6 }, (error, rows) => error ? reject(error) : resolve(rows))), { code: 'ENOTFOUND' });
});
