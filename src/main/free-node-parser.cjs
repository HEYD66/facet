'use strict';
// Lenient reader for public free-node lists: Clash YAML/JSON, sing-box style JSON,
// Base64 subscriptions, share links and plain proxy lines. Unlike the strict
// subscription import (store.parseNodes), unreadable entries are skipped instead
// of rejecting the whole list; every survivor is still validated before use.
const net = require('node:net');
const {isPublicAddress, isFakeIPAddress} = require('./subscription-policy.cjs');

const MAX_ENTRIES = 20000;
const NOTICE = /^(剩余流量|套餐到期|到期时间|距离下次重置|建议每天更新|如果很少节点可用|流量剩余|官网|更新订阅)/i;
const ALIASES = {socks: 'socks5', socks5h: 'socks5', hy2: 'hysteria2', shadowsocks: 'ss', shadowsocksr: 'ssr'};
// A public list must not decide which local interface or upstream this machine uses.
const LOCAL_ONLY = ['dialer-proxy', 'interface-name', 'routing-mark'];
const truthy = value => ['1', 'true'].includes(String(value || '').toLowerCase());

function decodeBase64(input) {
  const compact = String(input || '').replace(/\s+/g, '');
  if (compact.length < 12 || !/^[A-Za-z0-9+/=_-]+$/.test(compact)) return '';
  return decodeShort(compact);
}
function decodeShort(value) {
  try { return Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); }
  catch { return ''; }
}
function decodeText(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}
function compact(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== null));
}
function publicServer(server) {
  if (net.isIP(server)) return isPublicAddress(server) && !isFakeIPAddress(server);
  return server.length <= 253 && /^(?=.*[a-z])[a-z0-9_-]+(\.[a-z0-9_-]+)+$/i.test(server) && !/\.(local|localhost|lan|internal|home\.arpa)$/i.test(server);
}
// Normalises one entry and appends it; entries without a usable public endpoint are dropped.
function add(list, fields) {
  if (list.length >= MAX_ENTRIES || !fields) return;
  let type = String(fields.type || '').toLowerCase();
  type = ALIASES[type] || type;
  const server = String(fields.server ?? '').trim().replaceAll('\\.', '.').replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const port = Number(fields.port);
  if (!type || !server || !Number.isInteger(port) || port < 1 || port > 65535 || !publicServer(server)) return;
  const node = compact({...fields, type, server, port});
  if (type === 'https') { node.type = 'http'; node.tls = true; }
  for (const key of LOCAL_ONLY) delete node[key];
  const name = String(node.name ?? '').replace(/^\[|\]$/g, '').replace(/\s+/g, ' ').trim();
  if (NOTICE.test(name)) return;
  node.name = name;
  list.push(node);
}

function parseShadowsocksR(raw, list) {
  const decoded = decodeShort(raw.slice(6));
  const [body, query = ''] = decoded.split('/?');
  const match = body.match(/^(.+):(\d+):([^:]+):([^:]+):([^:]+):([^:]+)$/);
  if (!match) return false;
  const params = new URLSearchParams(query);
  add(list, {
    name: decodeShort(params.get('remarks') || ''), server: match[1], port: Number(match[2]), type: 'ssr',
    cipher: match[4], password: decodeShort(match[6]), obfs: match[5], protocol: match[3], udp: true,
    'obfs-param': params.get('obfsparam') ? decodeShort(params.get('obfsparam')) : undefined,
    'protocol-param': params.get('protoparam') ? decodeShort(params.get('protoparam')) : undefined
  });
  return true;
}
function parseVmess(raw, list) {
  const item = JSON.parse(decodeBase64(raw.slice(8).split('#')[0]));
  const network = item.net || 'tcp';
  add(list, {
    name: item.ps, server: item.add, port: Number(item.port), type: 'vmess', uuid: item.id,
    alterId: Number(item.aid || 0), cipher: item.scy || 'auto', tls: item.tls === 'tls' || item.tls === true,
    network, servername: item.sni || undefined, udp: true,
    'ws-opts': network === 'ws' ? {path: item.path || '/', headers: item.host ? {Host: item.host} : {}} : undefined
  });
  return true;
}
function parseShadowsocks(raw, list) {
  let url = new URL(raw);
  const name = decodeText(url.hash.slice(1) || '');
  if (!raw.slice(5).split('#')[0].includes('@')) {
    const decoded = decodeBase64(raw.slice(5).split('#')[0]);
    if (!decoded) return false;
    url = new URL('ss://' + decoded);
  }
  const user = decodeText(url.username || '');
  let cipher = '', password = '';
  if (url.password) { cipher = user; password = decodeText(url.password); }
  else {
    const decoded = decodeBase64(user) || user, colon = decoded.indexOf(':');
    if (colon < 0) return false;
    cipher = decoded.slice(0, colon); password = decoded.slice(colon + 1);
  }
  add(list, {name, server: url.hostname, port: Number(url.port), type: 'ss', cipher, password, udp: true});
  return true;
}
// Share links. Returns true when the line was a link of a known scheme, even if the entry was unusable.
function parseUri(line, list) {
  const raw = line.trim();
  const scheme = /^([a-z][a-z0-9]*):\/\//i.exec(raw)?.[1].toLowerCase();
  if (!['ss', 'ssr', 'vmess', 'vless', 'trojan', 'anytls', 'hysteria', 'hysteria2', 'hy2', 'tuic', 'ssh', 'http', 'https', 'socks', 'socks5'].includes(scheme)) return false;
  try {
    if (scheme === 'ssr') return parseShadowsocksR(raw, list);
    if (scheme === 'vmess') return parseVmess(raw, list);
    if (scheme === 'ss') return parseShadowsocks(raw, list);
    const url = new URL(raw), query = url.searchParams;
    const name = decodeText(url.hash.slice(1) || '');
    const server = url.hostname, user = decodeText(url.username || ''), password = decodeText(url.password || '');
    const insecure = truthy(query.get('insecure') || query.get('allowInsecure'));
    const port = Number(url.port || ({http: 80, https: 443, ssh: 22}[scheme] ?? (['socks', 'socks5'].includes(scheme) ? 0 : 443)));
    if (scheme === 'anytls') add(list, {name, server, port, type: 'anytls', password: user || password, 'skip-cert-verify': insecure, servername: query.get('sni') || undefined, 'client-fingerprint': query.get('fp') || 'chrome', udp: true});
    else if (scheme === 'hysteria2' || scheme === 'hy2') add(list, {name, server, port, type: 'hysteria2', password: user || password, 'skip-cert-verify': insecure, servername: query.get('sni') || undefined, udp: true, obfs: query.get('obfs') || undefined, 'obfs-password': query.get('obfs') ? query.get('obfs-password') || user || password : undefined});
    else if (scheme === 'hysteria') add(list, {name, server, port, type: 'hysteria', 'auth-str': query.get('auth') || query.get('auth-str') || user || password, protocol: query.get('protocol') || 'udp', sni: query.get('sni') || undefined, 'skip-cert-verify': insecure, up: query.get('upmbps') || query.get('up') || undefined, down: query.get('downmbps') || query.get('down') || undefined, udp: true});
    else if (scheme === 'tuic') add(list, {name, server, port, type: 'tuic', uuid: user, password, 'skip-cert-verify': insecure, sni: query.get('sni') || undefined, 'congestion-controller': query.get('congestion_control') || undefined, 'udp-relay-mode': query.get('udp_relay_mode') || undefined, udp: true});
    else if (scheme === 'ssh') add(list, {name, server, port, type: 'ssh', username: user, password});
    else if (scheme === 'vless' || scheme === 'trojan') {
      const network = query.get('type') || 'tcp', security = query.get('security');
      add(list, {
        name, server, port: Number(url.port), type: scheme, tls: scheme === 'trojan' || ['tls', 'reality'].includes(security),
        servername: query.get('sni') || query.get('serverName') || undefined, network, udp: true,
        uuid: scheme === 'vless' ? user : undefined, password: scheme === 'trojan' ? user || password : undefined,
        flow: scheme === 'vless' ? query.get('flow') || undefined : undefined,
        'skip-cert-verify': insecure || undefined,
        'ws-opts': network === 'ws' ? {path: query.get('path') || '/', headers: query.get('host') ? {Host: query.get('host')} : {}} : undefined,
        'grpc-opts': network === 'grpc' && query.get('serviceName') ? {'grpc-service-name': query.get('serviceName')} : undefined,
        'reality-opts': security === 'reality' ? {'public-key': query.get('pbk') || '', 'short-id': query.get('sid') || ''} : undefined,
        'client-fingerprint': security === 'reality' ? query.get('fp') || 'chrome' : undefined
      });
    } else add(list, {name, server, port, type: scheme, username: user || undefined, password: password || undefined});
    return true;
  } catch { return true; }
}
function parseLoose(line, list) {
  const text = line.trim().replace(/^[-*]\s*/, '').replace(/^['"]|['"]$/g, '');
  if (!text || text.startsWith('#') || text.startsWith('//')) return;
  if (parseUri(text, list)) return;
  let match = text.match(/^([^:@\s]+):(\d{2,5}):([^:@\s]*):(.+)$/);
  if (match) {
    const cipher = /^(aes-|chacha|xchacha|none|2022-)/i.test(match[3]);
    add(list, cipher ? {server: match[1], port: match[2], type: 'ss', cipher: match[3], password: match[4]} : {server: match[1], port: match[2], type: 'http', username: match[3], password: match[4]});
    return;
  }
  match = text.match(/^([^:@\s]+):(\d{2,5})@([^:]+):(.+)$/);
  if (match) add(list, {server: match[1], port: match[2], type: 'http', username: match[3], password: match[4]});
}
// Entries of a Clash "proxies" list or a sing-box "outbounds" list.
function addConfigured(entry, list) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
  const type = entry.type || entry.protocol, server = entry.server || entry.address, port = entry.port || entry.server_port;
  if (typeof type !== 'string' || !server || !port) return;
  const fields = {...entry, name: typeof (entry.name ?? entry.tag) === 'string' || typeof (entry.name ?? entry.tag) === 'number' ? String(entry.name ?? entry.tag) : '', type, server: String(server), port};
  if (!entry.type) delete fields.protocol;
  delete fields.address; delete fields.server_port; delete fields.tag;
  add(list, fields);
}
function parseYaml(text, list) {
  try {
    const yaml = require('js-yaml');
    const document = yaml.load(text, {schema: yaml.JSON_SCHEMA});
    const entries = Array.isArray(document) ? document : document?.proxies;
    if (Array.isArray(entries)) for (const entry of entries) addConfigured(entry, list);
  } catch {}
}
function parseFreeNodes(content, depth = 0) {
  const list = [];
  const text = String(content || '').replace(/^\uFEFF/, '').trim();
  if (!text || text.length > 2 * 1024 * 1024) return list;
  if (/^[[{]/.test(text)) {
    try {
      const data = JSON.parse(text);
      const entries = Array.isArray(data) ? data : data?.proxies || data?.outbounds;
      if (Array.isArray(entries)) for (const entry of entries) addConfigured(entry, list);
      else addConfigured(data, list);
    } catch {}
  }
  if (!list.length && /(^|\n)\s*proxies\s*:/i.test(text)) parseYaml(text, list);
  if (!list.length) {
    const decoded = depth < 2 ? decodeBase64(text) : '';
    if (decoded && decoded !== text && (decoded.includes('://') || decoded.includes('proxies:'))) return parseFreeNodes(decoded, depth + 1);
    for (const line of text.split(/\r?\n|\s*,\s*/)) { if (list.length >= MAX_ENTRIES) break; parseLoose(line, list); }
  }
  return list;
}
module.exports = {parseFreeNodes, decodeBase64};
