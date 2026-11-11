'use strict';
// The public lists free nodes come from, and how candidates are drawn from them.
// Nothing here touches the network; free-nodes.cjs downloads the lists and
// free-node-scan.cjs verifies the candidates picked here.
const {parseFreeNodes} = require('./free-node-parser.cjs');

// GitHub raw is often unreachable; jsDelivr mirrors serve the same files, cached for up to 12 hours.
const github = (repo, branch, file) => [
  `https://gcore.jsdelivr.net/gh/${repo}@${branch}/${file}`,
  `https://testingcf.jsdelivr.net/gh/${repo}@${branch}/${file}`,
  `https://raw.githubusercontent.com/${repo}/${branch}/${file}`
];
// Bare lists carry "ip:port" at the start of each line, sometimes followed by a country or latency column.
// A list named "https" may hold HTTP proxies behind TLS or plain ones that accept CONNECT; each entry below
// uses the reading that measured better.
const bare = scheme => text => text.split(/\r?\n/).flatMap(line => line.trim().match(/^\d{1,3}(?:\.\d{1,3}){3}:\d{2,5}\b/)?.map(address => `${scheme}://${address}`) ?? []).join('\n');
// Proxy-list APIs disagree on field names, so this collects every object or string that names an endpoint, wherever it sits.
const jsonList = scheme => text => {
  const lines = [];
  const endpoint = /^\d{1,3}(?:\.\d{1,3}){3}:\d{2,5}$/;
  const walk = (value, depth = 0) => {
    if (depth > 12 || lines.length >= 20000) return;
    if (typeof value === 'string') { if (scheme && endpoint.test(value.trim())) lines.push(`${scheme}://${value.trim()}`); return; }
    if (Array.isArray(value)) { for (const item of value) walk(item, depth + 1); return; }
    if (!value || typeof value !== 'object') return;
    const host = value.ip ?? value.host;
    const address = host && value.port ? `${host}:${value.port}` : Object.values(value).find(item => typeof item === 'string' && endpoint.test(item.trim()))?.trim();
    if (!address) { for (const item of Object.values(value)) walk(item, depth + 1); return; }
    const named = [value.protocols, value.protocol, value.type, value.scheme].flat().filter(item => typeof item === 'string')
      .flatMap(item => item.toLowerCase().split(/[^a-z0-9]+/)).filter(item => ['http', 'https', 'socks5'].includes(item));
    for (const protocol of named.length ? new Set(named) : scheme ? [scheme] : []) lines.push(`${protocol}://${address}`);
  };
  walk(JSON.parse(text));
  return lines.join('\n');
};
// Chosen on 2026-11-11 by verifying a sample of each of 328 public list files from a mainland China network; these
// had at least a tenth of their candidates working. "strong" lists had over 40% and are used in every run. "mixed"
// lists carry TLS-wrapped HTTP proxies alongside encrypted protocols, so they are fetched for either kind.
const catalog = [
  {id: 'ssrsub', kind: 'mixed', strong: true, name: 'ssrsub', urls: github('ssrsub/ssr', 'master', 'clash.yaml')},
  {id: 'ruk1ng', kind: 'mixed', strong: true, name: 'Ruk1ng001', urls: github('Ruk1ng001/freeSub', 'main', 'clash.yaml')},
  {id: 'xiaocongyu', kind: 'mixed', strong: true, name: 'xiaocongyu66', urls: github('xiaocongyu66/proxypool', 'main', 'output/clash.yml')},
  {id: 'passionsu', kind: 'mixed', strong: true, name: 'passionsu-su', urls: github('passionsu-su/free-nodes', 'main', 'clash/all.yaml')},
  {id: 'shaoyou', kind: 'mixed', strong: true, name: 'shaoyouvip', urls: github('shaoyouvip/free', 'main', 'all.yaml')},
  {id: 'zhuhaiuk', kind: 'mixed', strong: true, name: 'zhuhaiuk', urls: github('zhuhaiuk/free-nodes', 'main', 'clash_config.yaml')},
  {id: 'mrmarble-tls', kind: 'plain', strong: true, name: 'MrMarble TLS', urls: github('MrMarble/proxy-list', 'main', 'https.txt'), adapt: bare('https')},
  {id: 'proxyslist', kind: 'plain', strong: true, name: '398001', urls: github('398001/ProxysList', 'main', 'http_working.txt')},

  {id: 'proxifly', kind: 'plain', name: 'proxifly', urls: github('proxifly/free-proxy-list', 'main', 'proxies/all/data.txt')},
  {id: 'monosans', kind: 'plain', name: 'monosans', urls: github('monosans/proxy-list', 'main', 'proxies/all.txt')},
  {id: 'geonode', kind: 'plain', name: 'Geonode', urls: ['https://proxylist.geonode.com/api/proxy-list?limit=500&page=1&sort_by=lastChecked&sort_type=desc'], adapt: jsonList()},
  {id: 'mrmarble', kind: 'plain', name: 'MrMarble', urls: github('MrMarble/proxy-list', 'main', 'http.txt'), adapt: bare('http')},
  {id: 'proxio', kind: 'plain', name: 'proxio-io', urls: github('proxio-io/proxy-list', 'main', 'https.txt'), adapt: bare('http')},
  {id: 'xyzs996', kind: 'plain', name: 'xyzs996', urls: github('xyzs996/free-proxy-health-list', 'main', 'http.txt'), adapt: bare('http')},
  {id: 'hproxy', kind: 'plain', name: 'hproxy', urls: github('hproxy-com/free-proxy-list', 'main', 'http.txt'), adapt: bare('http')},
  {id: 'mauricegift', kind: 'plain', name: 'mauricegift', urls: github('mauricegift/free-proxies', 'master', 'files/http.json'), adapt: jsonList('http')},
  {id: 'cbx2jun', kind: 'plain', name: 'CB-X2-Jun', urls: github('CB-X2-Jun/proxy-lists', 'main', 'public/proxies.json'), adapt: jsonList()},
  {id: 'cmahmud', kind: 'plain', name: 'cmahmud', urls: github('cmahmud/proxies', 'main', 'alive/http.txt'), adapt: bare('http')},
  {id: 'cmahmud-tls', kind: 'plain', name: 'cmahmud TLS', urls: github('cmahmud/proxies', 'main', 'alive/https.txt'), adapt: bare('https')},
  {id: 'cmahmud-socks5', kind: 'plain', name: 'cmahmud SOCKS5', urls: github('cmahmud/proxies', 'main', 'alive/socks5.txt'), adapt: bare('socks5')},
  {id: 'shaikh', kind: 'plain', name: 'asifshaikhtsn', urls: github('asifshaikhtsn/shaikh', 'master', 'country/all_https.txt'), adapt: bare('http')},
  {id: 'walla-cn', kind: 'plain', name: 'Walla CN', urls: github('asifshaikhtsn/Walla', 'main', 'country/CN/https.txt'), adapt: bare('http')},
  {id: '6yyn', kind: 'plain', name: '6yyn', urls: github('6yyn/free-proxy-list', 'main', 'https.txt'), adapt: bare('http')},
  {id: 'vmheaven', kind: 'plain', name: 'VMHeaven', urls: github('vmheaven/VMHeaven.io-Free-Proxy-List', 'main', 'verified/http.txt'), adapt: bare('http')},
  {id: 'proxmint', kind: 'plain', name: 'proxmint', urls: github('proxmint/free-proxy-list', 'main', 'proxies/http.txt'), adapt: bare('http')},
  {id: 'maximilianfeix', kind: 'plain', name: 'maximilianfeix', urls: github('maximilianfeix/free-proxy-list', 'main', 'http.txt'), adapt: bare('http')},
  {id: 'hideip-tls', kind: 'plain', name: 'hideip.me TLS', urls: github('zloi-user/hideip.me', 'main', 'https.txt'), adapt: bare('https')},
  {id: 'wuyingzhishang', kind: 'plain', name: 'wuyingzhishang', urls: github('wuyingzhishang/proxy-checker', 'main', 'proxies/https.txt')},
  {id: 'anutmagang', kind: 'plain', name: 'anutmagang', urls: github('anutmagang/Free-HighQuality-Proxy-Socks', 'main', 'results/http.txt'), adapt: bare('http')},
  {id: 'proxypulse', kind: 'plain', name: 'Proxy-Pulse', urls: github('BlacKSnowDot0/Proxy-Pulse', 'main', 'http.txt'), adapt: bare('http')},
  {id: 'proxypulse-socks5', kind: 'plain', name: 'Proxy-Pulse SOCKS5', urls: github('BlacKSnowDot0/Proxy-Pulse', 'main', 'socks5.txt'), adapt: bare('socks5')},
  {id: 'fmw86', kind: 'plain', name: 'fmw86', urls: github('fmw86/free-proxy-pool', 'main', 'http_alive.txt'), adapt: bare('http')},
  {id: 'pwnx0', kind: 'plain', name: 'pwnx0', urls: github('pwnx0/proxy', 'main', 'proxies/https.txt'), adapt: bare('http')},
  {id: 'litport', kind: 'plain', name: 'litportnet', urls: github('litportnet/free-proxy-list', 'main', 'proxies/http.txt'), adapt: bare('http')},
  {id: 'proxygenerator-tls', kind: 'plain', name: 'ProxyGenerator TLS', urls: github('proxygenerator1/ProxyGenerator', 'main', 'Stable/https.txt'), adapt: bare('https')},

  {id: 'ermaozi', kind: 'mixed', name: 'ermaozi', urls: github('ermaozi/get_subscribe', 'main', 'subscribe/clash.yml')},
  {id: 'cbusifabcap', kind: 'mixed', name: 'cbusifabcap', urls: github('cbusifabcap/daily_free_vpn', 'main', 'sub/mihomo.yml')},
  {id: 'xcai413', kind: 'mixed', name: 'xcai413', urls: github('xcai413/fanqiang-navigation', 'master', 'free/proxies.yaml')},
  {id: 'nomorewalls', kind: 'encrypted', name: 'NoMoreWalls', urls: github('peasoft/NoMoreWalls', 'master', 'list.yml')},
  {id: 'pawdroid', kind: 'encrypted', name: 'Pawdroid', urls: github('Pawdroid/Free-servers', 'main', 'sub')},
  {id: 'snakem982', kind: 'encrypted', name: 'snakem982', urls: github('snakem982/proxypool', 'main', 'source/clash-meta-2.yaml')},
  {id: 'nirevil', kind: 'encrypted', name: 'NiREvil WARP', urls: github('NiREvil/vless', 'main', 'sub/clash-meta.yml')},
  {id: 'use4free', kind: 'encrypted', name: 'Use4Free', urls: github('Use4Free/VMesslinks', 'main', 'links/vmess')},
  {id: 'lza6', kind: 'encrypted', name: 'lza6', urls: github('lza6/FastVPN-Astro-ProxyPool', 'master', 'ss_links.txt')},
  {id: 'gxyandy', kind: 'encrypted', name: 'gxyandy', urls: github('gxyandy/FreeProxiesSubscribeForClash', 'main', 'tosslk/tosslk')}
];
const KINDS = ['plain', 'encrypted'];
const sourcesPerRun = 16;

function shuffle(items, random = Math.random) {
  for (let index = items.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}
// Every run uses the strong lists and a different random handful of the rest, which keeps one run to a few seconds of fetching.
function chooseSources(kinds, random = Math.random) {
  const eligible = catalog.filter(source => source.kind === 'mixed' || kinds.includes(source.kind));
  return [...eligible.filter(source => source.strong), ...shuffle(eligible.filter(source => !source.strong), random)].slice(0, sourcesPerRun);
}
// Public HTTP/SOCKS5 proxies carry traffic as-is; every other protocol encrypts the hop to the server.
const kindOf = node => ['http', 'socks5'].includes(node.type) ? 'plain' : 'encrypted';
// Lists republish each other's nodes under new names and with reordered options, so the endpoint identifies a candidate.
const signature = node => `${node.type}${node.type === 'http' && String(node.tls) === 'true' ? '+tls' : ''}|${String(node.server).toLowerCase()}|${Number(node.port)}`;

function candidatesFrom(text, source, random = Math.random) {
  let content = source.adapt ? source.adapt(text) : text;
  // One run draws far fewer candidates than this from any single list; sampling lines first keeps parsing fast.
  if (source.kind === 'plain') content = shuffle(content.split(/\r?\n/), random).slice(0, 1000).join('\n');
  const nodes = parseFreeNodes(content).filter(node => node.name.length <= 200);
  // "https" entries in these lists are HTTP proxies behind TLS, addressed by IP with certificates that never verify.
  if (source.kind === 'plain') for (const node of nodes) if (node.type === 'http' && node.tls === true) node['skip-cert-verify'] = true;
  return nodes;
}

// Draws round-robin across sources so one huge list cannot crowd out the others, three at a time from the strong
// lists, then alternates the two kinds. Endpoints whose signature is in "known" are skipped.
function pickCandidates(lists, sources, kinds, limit, known = [], random = Math.random) {
  const seen = new Set(known);
  const queues = {plain: [], encrypted: []};
  for (const [index, list] of lists.entries()) {
    const fresh = {plain: [], encrypted: []};
    for (const node of shuffle([...list], random)) {
      const key = signature(node), kind = kindOf(node);
      if (seen.has(key) || !kinds.includes(kind)) continue;
      seen.add(key);
      fresh[kind].push(node);
    }
    for (const kind of kinds) if (fresh[kind].length) queues[kind].push({items: fresh[kind], share: sources[index].strong ? 3 : 1});
  }
  const draw = (sourceQueues, count) => {
    const picked = [];
    while (picked.length < count && sourceQueues.some(queue => queue.items.length)) {
      for (const queue of sourceQueues) for (let taken = 0; taken < queue.share && queue.items.length && picked.length < count; taken++) picked.push(queue.items.pop());
    }
    return picked;
  };
  const available = kind => queues[kind].reduce((sum, queue) => sum + queue.items.length, 0);
  const share = Math.ceil(limit / kinds.length);
  const quota = Object.fromEntries(kinds.map(kind => [kind, Math.min(share, available(kind))]));
  for (const kind of kinds) {
    const spare = limit - kinds.reduce((sum, item) => sum + quota[item], 0);
    if (spare > 0) quota[kind] = Math.min(available(kind), quota[kind] + spare);
  }
  const drawn = kinds.map(kind => draw(queues[kind], quota[kind]));
  const picks = [];
  for (let index = 0; picks.length < limit && drawn.some(list => index < list.length); index++) {
    for (const list of drawn) if (index < list.length && picks.length < limit) picks.push(list[index]);
  }
  return picks;
}

module.exports = {catalog, KINDS, chooseSources, candidatesFrom, pickCandidates, kindOf, signature, shuffle};
