'use strict';
// Applies only to connections to a selected proxy server. Never changes host
// routes, system DNS, another client, or an already running instance.
const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns').promises;
const net = require('node:net');
const {execFile} = require('node:child_process');
const {domainToASCII} = require('node:url');
const {atomic} = require('./json-storage.cjs');
const {isPublicHostname, queryDohAddresses} = require('./subscription-doh.cjs');
const {isPublicAddress, isFakeIPAddress} = require('./subscription-policy.cjs');
// Keep the pre-DNS-fix startup behavior as the default. Auto/secure are opt-in
// compatibility modes for nodes affected by Fake-IP or system DNS failures.
// Strict mode never falls back, for users who prioritize leak prevention over reliability.
const DEFAULTS = Object.freeze({dnsMode: 'system', routeMode: 'system', interfaceName: ''});

function safeError(message) {
  const error = new Error(message);
  error.safeDiagnostic = message;
  return error;
}
function interfaceName(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\x00-\x1f\x7f#&]/.test(value)) throw safeError('网卡名称无效');
  return value;
}
function normalize(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !['auto', 'system', 'secure', 'strict'].includes(value.dnsMode) || !['system', 'physical', 'interface'].includes(value.routeMode)) throw safeError('节点 DNS 或出站设置无效');
  return {dnsMode: value.dnsMode, routeMode: value.routeMode, interfaceName: value.routeMode === 'interface' ? interfaceName(value.interfaceName) : ''};
}
function fakeAddress(address) {
  return isFakeIPAddress(String(address).replace(/^\[|\]$/g, ''));
}
async function systemAnswers(host, signal) {
  signal?.throwIfAborted();
  let timer, onAbort;
  try {
    return await Promise.race([
      dns.lookup(host, {all: true}),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(safeError('系统 DNS 查询超时')), 1800);
        onAbort = () => reject(safeError('节点准备已取消'));
        signal?.addEventListener('abort', onAbort, {once: true});
      })
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
function readInterfaces() {
  if (process.platform !== 'win32') return Promise.reject(safeError('自动网卡选择当前仅支持 Windows，请使用系统路由'));
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  // Read through Electron's asar-aware fs; PowerShell cannot open an asar path.
  const script = Buffer.from(fs.readFileSync(path.join(__dirname, 'network-interfaces.ps1'), 'utf8'), 'utf16le').toString('base64');
  return new Promise((resolve, reject) => execFile(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', script], {windowsHide: true, timeout: 8000, maxBuffer: 128 * 1024, encoding: 'utf8'}, (error, stdout) => {
    if (error) return reject(safeError('读取网卡失败，请刷新重试或使用系统路由'));
    try {
      const raw = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
      if (!Array.isArray(raw) || raw.length > 256) throw Error();
      resolve(raw.map(row => ({name: interfaceName(row.name), index: Number(row.index), physical: row.physical === true, defaultRoute: row.defaultRoute === true, metric: Number(row.metric)})).filter(row => Number.isSafeInteger(row.index) && row.index > 0 && Number.isFinite(row.metric)));
    } catch { reject(safeError('网卡信息无法读取，请刷新重试')); }
  }));
}
function pickInterface(rows, settings) {
  if (settings.routeMode === 'system') return '';
  if (settings.routeMode === 'interface') {
    if (!rows.some(row => row.name === settings.interfaceName)) throw safeError('所选网卡已断开或不存在，请重新选择；未回退系统路由');
    return settings.interfaceName;
  }
  const candidates = rows.filter(row => row.physical && row.defaultRoute).sort((a, b) => a.metric - b.metric || a.index - b.index);
  if (!candidates.length) throw safeError('找不到已连接且有默认路由的物理网卡；请手动选择，未回退系统路由');
  return candidates[0].name;
}
class NodeNetwork {
  constructor(dir) {
    this.file = path.join(dir, 'node-network.json');
    this.settings = {...DEFAULTS};
    this.warning = '';
    this.cache = null;
    this.flight = null;
    try { this.settings = normalize(JSON.parse(fs.readFileSync(this.file, 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') this.warning = '节点网络设置无法读取，原文件已保留；请重新保存设置后使用代理'; }
  }
  snapshot() { return {settings: {...this.settings}, warning: this.warning}; }
  async interfaces(force = false) {
    if (this.flight) return this.flight;
    if (!force && this.cache && Date.now() - this.cache.at < 15000) return this.cache.rows;
    this.flight = readInterfaces().then(rows => { this.cache = {at: Date.now(), rows}; return rows; }).finally(() => { this.flight = null; });
    return this.flight;
  }
  async save(value) {
    const settings = normalize(value);
    if (settings.routeMode !== 'system') pickInterface(await this.interfaces(true), settings);
    try { atomic(this.file, settings); }
    catch (error) { if (error.atomicWriteCommitted) { this.settings = settings; this.warning = ''; } throw error; }
    this.settings = settings;
    this.warning = '';
    return this.snapshot();
  }
  async prepare(node, signal) {
    signal?.throwIfAborted();
    if (this.warning) throw safeError(this.warning);
    const settings = {...this.settings};
    const original = String(node.server || '').replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    const host = net.isIP(original) ? original : domainToASCII(original);
    if (fakeAddress(host)) throw safeError('节点地址是 Fake-IP，请重新导入真实节点地址');
    let selected = '';
    if (settings.routeMode !== 'system') {
      if (node['dialer-proxy'] || node['interface-name']) throw safeError('节点已有上游代理或网卡设置，请使用跟随系统模式保留原配置');
      selected = pickInterface(await this.interfaces(), settings);
    }
    signal?.throwIfAborted();
    const bound = selected || node['interface-name'] || '';
    let secure = (settings.dnsMode === 'secure' || settings.dnsMode === 'strict') && isPublicHostname(host);
    let reason = secure ? '安全 DNS' : '系统 DNS';
    const strictMode = settings.dnsMode === 'strict';
    if (settings.dnsMode === 'auto' && isPublicHostname(host)) {
      if (bound) { secure = true; reason = '安全 DNS'; }
      else {
        try {
          const answers = await systemAnswers(host, signal);
          if (answers.some(row => fakeAddress(row.address)) || !answers.length) { secure = true; reason = 'Fake-IP 兼容 DNS'; }
        } catch {
          signal?.throwIfAborted();
          secure = true; reason = '系统解析失败，使用安全 DNS';
        }
      }
    }
    signal?.throwIfAborted();
    const overrides = {};
    if (selected) overrides['interface-name'] = selected;
    if (secure) {
      // Reuse the verified application DoH path (TLS checked, fixed bootstrap
      // IP, no redirects). DNS queries follow system routing, independently of
      // the selected node's physical interface. Keep hostname and TLS/SNI intact;
      // pin only this node hostname in this core's temporary hosts configuration.
      // A new start/probe resolves again; no resolved IP is written to the library.
      let answers;
      let dohFailed = false;
      try { answers = await queryDohAddresses(host, {signal, nodeFallback: true, acceptAddress: isPublicAddress}); }
      catch (error) {
        signal?.throwIfAborted();
        // Strict mode: never fall back, throw error to prevent DNS leaks
        if (strictMode) {
          if (error.code === 'DOH_NONPUBLIC_ADDRESS') throw safeError('节点域名解析为回环、内网或保留地址；多个安全 DNS 均未获得公网地址，请检查节点或订阅配置');
          throw safeError('节点安全 DNS 查询失败；未启动代理、未回退目标网站直连，请检查网络或切换到自动模式');
        }
        // Auto/secure mode: auto-fallback to system DNS with warning
        // This prevents "can't connect" errors while still attempting to reduce leaks.
        dohFailed = true;
        reason = error.code === 'DOH_NONPUBLIC_ADDRESS'
          ? '安全 DNS 返回非公网地址，已回退系统 DNS'
          : '安全 DNS 查询失败，已回退系统 DNS';
        console.warn(`[NodeNetwork] DoH failed for ${host}: ${error.code || error.message}, falling back to system DNS`);
        answers = null;
      }
      signal?.throwIfAborted();
      if (answers) {
        if (!answers.length || answers.some(row => !isPublicAddress(row.address))) {
          // Strict mode: throw error
          if (strictMode) throw safeError('节点安全 DNS 未返回合法公网地址；请核对节点域名或切换到自动模式连接内网节点');
          // Same auto-fallback for invalid responses
          reason = '安全 DNS 返回无效地址，已回退系统 DNS';
          console.warn(`[NodeNetwork] DoH returned invalid addresses for ${host}, falling back to system DNS`);
          dohFailed = true;
        } else {
          overrides.hosts = {[host]: [...new Set(answers.map(row => row.address))]};
        }
      }
    }
    return {overrides, summary: {dns: reason, route: selected ? '指定网卡：' + selected : '保留系统路由及节点设置'}};
  }
}
module.exports = {NodeNetwork, DEFAULTS, normalize, fakeAddress, pickInterface, readInterfaces};
