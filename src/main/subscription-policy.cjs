'use strict';
const net = require('node:net');
const dns = require('node:dns').promises;
const doh = require('./subscription-doh.cjs');

function safeError(message) {
  const error = new Error(message);
  error.subscriptionSafe = true;
  return error;
}
function normalizeHostname(host) {
  return host.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}
function ipv4Number(address) {
  return address.split('.').reduce((value, part) => value * 256 + Number(part), 0);
}
const IPV4_DENIED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10],
  ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
].map(([base, bits]) => [ipv4Number(base), 2 ** (32 - bits)]);
function publicIPv4(address) {
  const value = ipv4Number(address);
  return !IPV4_DENIED.some(([base, length]) => value >= base && value < base + length);
}
function ipv6Number(address) {
  if (address.includes('.')) {
    const colon = address.lastIndexOf(':');
    const value = ipv4Number(address.slice(colon + 1));
    address = address.slice(0, colon + 1) + (value >>> 16).toString(16) + ':' + (value & 65535).toString(16);
  }
  const halves = address.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const parts = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return parts.reduce((value, part) => (value << 16n) | BigInt(parseInt(part, 16)), 0n);
}
const IPV6_DENIED = [
  ['2001::', 23],       // IETF special-purpose, including Teredo and benchmarking.
  ['2001:db8::', 32],   // Documentation.
  ['2002::', 16],       // 6to4 embeds an IPv4 destination; not an SSRF escape hatch.
  ['3ffe::', 16],       // Retired 6bone allocation.
  ['3fff::', 20]        // Documentation.
].map(([base, bits]) => [ipv6Number(base), BigInt(128 - bits)]);

function isPublicAddress(address) {
  if (typeof address !== 'string' || address.includes('%')) return false;
  const family = net.isIP(address);
  if (family === 4) return publicIPv4(address);
  if (family !== 6) return false;
  const value = ipv6Number(address);
  if ((value >> 32n) === 0xffffn) {
    const low = Number(value & 0xffffffffn);
    return publicIPv4(`${low >>> 24}.${(low >>> 16) & 255}.${(low >>> 8) & 255}.${low & 255}`);
  }
  // Allow global unicast only. This also excludes unspecified, loopback, ULA,
  // link-local, multicast, IPv4-compatible and NAT64 special-purpose ranges.
  if ((value >> 125n) !== 1n) return false;
  return !IPV6_DENIED.some(([base, shift]) => (value >> shift) === (base >> shift));
}

function isFakeIPAddress(address) {
  if (typeof address !== 'string' || address.includes('%')) return false;
  const family = net.isIP(address);
  let value;
  if (family === 4) value = ipv4Number(address);
  else if (family === 6) {
    const ipv6 = ipv6Number(address);
    if ((ipv6 >> 32n) !== 0xffffn) return false;
    value = Number(ipv6 & 0xffffffffn);
  } else return false;
  return value >= 0xc6120000 && value <= 0xc613ffff;
}

function waitForLookup(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const aborted = () => reject(safeError('订阅下载超时，原配置未改变'));
    const settle = (callback, value) => {
      signal.removeEventListener('abort', aborted);
      callback(value);
    };
    // Attach rejection handling even if the abort wins: a late DNS failure must
    // not create an unhandled rejection. Node's underlying OS lookup cannot be cancelled.
    promise.then(value => settle(resolve, value), error => settle(reject, error));
    if (signal.aborted) aborted();
    else signal.addEventListener('abort', aborted, { once: true });
  });
}

async function resolvePublicHost(url, { allowPrivateHosts = false, signal, lookup = dns.lookup, onStage } = {}) {
  const report=value=>{try{onStage?.(value);}catch{}};
  const host = normalizeHostname(url.hostname);
  report({stage:'dns-start',host});
  if (signal?.aborted) throw safeError('订阅下载超时，原配置未改变');
  // Internal opt-in for isolated loopback fixtures, never derived from a URL.
  if (allowPrivateHosts === true) { report({stage:'dns-fixture',host,reason:'仅内部受控测试允许本机地址'}); return null; }
  if (net.isIP(host)) {
    report({stage:'dns-literal',address:host,family:net.isIP(host),public:isPublicAddress(host)});
    if (!isPublicAddress(host)) throw safeError('订阅地址指向本机或内网（含保留地址），已阻止下载');
    return host;
  }
  let rows;
  try {
    rows = await waitForLookup(Promise.resolve().then(() => lookup(host, { all: true, verbatim: true })), signal);
  } catch (error) {
    report({stage:'dns-error',...require('./network-trace.cjs').errorFields(error)});
    if (error.subscriptionSafe) throw error;
    throw safeError('订阅域名无法解析，原配置未改变');
  }
  if (!Array.isArray(rows) || rows.length === 0) throw safeError('订阅域名无法解析，原配置未改变');
  report({stage:'dns-answer',host,addresses:rows});
  // A Fake-IP answer is a hint to resolve again, NEVER permission to connect to
  // the reserved range. Other private/malformed answers still fail immediately.
  if (rows.some(row => !row || (!isPublicAddress(row.address) && !isFakeIPAddress(row.address)))) {
    throw safeError('订阅地址解析到本机或内网（含保留地址），已阻止下载');
  }
  if (rows.some(row => isFakeIPAddress(row.address))) {
    report({stage:'dns-public-recheck',host,reason:'系统返回 Fake-IP，沿用现有公网复核流程'});
    if (!doh.isPublicHostname(host)) {
      throw safeError('检测到 Fake-IP，但该域名不适合公共 DNS 查询，已阻止下载');
    }
    try {
      rows = await waitForLookup(doh.queryDohAddresses(host, { signal }), signal);
    } catch (error) {
      report({stage:'dns-public-recheck-error',...require('./network-trace.cjs').errorFields(error)});
      if (signal?.aborted) throw safeError('订阅下载超时，原配置未改变');
      throw safeError('检测到 Fake-IP，但安全公网解析暂不可用；未放宽内网校验，原配置未改变');
    }
    if (!Array.isArray(rows) || !rows.length || rows.some(row => !row || !isPublicAddress(row.address))) {
      throw safeError('Fake-IP 域名的公网复核没有安全公网地址或返回本机或内网，已阻止下载');
    }
  }
  report({stage:'dns-selected',host,address:rows[0].address,family:net.isIP(rows[0].address),public:true});
  return rows[0].address;
}

function pinnedLookup(address) {
  if (!isPublicAddress(address)) throw safeError('订阅解析地址未通过公网校验');
  const family = net.isIP(address);
  return (_host, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    // Node's autoSelectFamily requests all:true and requires an address array.
    queueMicrotask(() => options?.all
      ? callback(null, [{ address, family }])
      : callback(null, address, family));
  };
}
module.exports = { safeError, normalizeHostname, isPublicAddress, isFakeIPAddress, resolvePublicHost, pinnedLookup };
