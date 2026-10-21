'use strict';
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const {networkURL,checkServerIdentity,decodeResponse,acceptEncoding}=require('./safe-http.cjs');
const { safeError, normalizeHostname, resolvePublicHost, pinnedLookup } = require('./subscription-policy.cjs');

function subscriptionURL(value) {
  let url;
  try {
    if (typeof value !== 'string' || !value.trim() || value.length > 8192) throw Error();
    url = networkURL(value.trim());
  } catch { throw safeError('请输入完整的 HTTP/HTTPS 订阅链接'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw safeError('订阅只允许 HTTP/HTTPS，不允许 URL 内嵌用户名密码');
  }
  url.hash = '';
  return url;
}

async function downloadSubscription(value, {
  maxBytes = 2 * 1024 * 1024, timeoutMs = 20000, maxRedirects = 3, allowPrivateHosts = false, onStage
} = {}) {
  const initial = subscriptionURL(value);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2 * 1024 * 1024 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 ||
      !Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 10) {
    throw safeError('订阅下载限制参数无效');
  }
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const started=Date.now(),report=value=>{try{onStage?.({...value,elapsedMs:Date.now()-started});}catch{}};

  async function one(url) {
    // The same overall deadline covers DNS, every redirect, TLS and the body.
    report({stage:'request-start',host:normalizeHostname(url.hostname),port:Number(url.port)||(url.protocol==='https:'?443:80),protocol:url.protocol.slice(0,-1),route:'system'});
    const resolved = await resolvePublicHost(url, { allowPrivateHosts, signal: abort.signal, onStage:report });
    if (abort.signal.aborted) throw safeError('订阅下载超时，原配置未改变');
    return new Promise((resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http;
      const agent = new transport.Agent({ keepAlive: false, rejectUnauthorized: true, checkServerIdentity });
      let req, body, settled = false, wire=0, size=0, phase='tcp';
      const done = (error, result) => {
        if (settled) return;
        settled = true;
        if(error)report({stage:phase+'-error',bytes:size,wireBytes:wire,...require('./network-trace.cjs').errorFields(error)});
        body?.destroy(); req?.destroy(); agent.destroy();
        error ? reject(error) : resolve(result);
      };
      const host = normalizeHostname(url.hostname);
      try {
        req = transport.request(url, {
          method: 'GET', agent, signal: abort.signal, checkServerIdentity,
          lookup: resolved ? pinnedLookup(resolved) : undefined,
          family: resolved ? net.isIP(resolved) : undefined,
          servername: net.isIP(host) ? undefined : host,
          headers: {
            'User-Agent': 'clash.meta/'+require('./core-release.cjs').version.replace(/^v/,'')+' Facet/'+require('../../package.json').version,
            Accept: 'application/yaml, text/yaml, application/json, text/plain, */*',
            'Accept-Encoding': acceptEncoding
          }
        }, res => {
          phase='http';
          const status = res.statusCode || 0;
          report({stage:'response',status,encoding:String(res.headers['content-encoding']||'identity'),contentType:String(res.headers['content-type']||'').split(';')[0]});
          if ([301, 302, 303, 307, 308].includes(status)) {
            const location = res.headers.location;
            res.destroy();
            return location ? done(null, { redirect: location }) : done(safeError('订阅重定向缺少目标地址'));
          }
          if (status !== 200) { res.destroy(); return done(safeError(`订阅服务器返回 HTTP ${status}，原配置未改变`)); }
          const htmlContentType = /(?:text\/html|application\/xhtml\+xml)/i.test(res.headers['content-type'] || '');
          if (Number(res.headers['content-length']) > maxBytes) { res.destroy(); return done(safeError('订阅内容超过 2MB 上限')); }
          phase='body';report({stage:'body-start'});
          const chunks = [];
          res.on('data', chunk => { wire += chunk.length; if (wire > maxBytes) done(safeError('订阅内容超过 2MB 上限')); });
          res.on('error', error => done(error));
          res.on('aborted', () => done(safeError('订阅传输中断，原配置未改变')));
          const encoding = String(res.headers['content-encoding'] || 'identity').trim().toLowerCase();
          try { body = decodeResponse(res); }
          catch (error) { return done(safeError(error.message)); }
          body.on('data', chunk => {
            size += chunk.length;
            if (size > maxBytes) return done(safeError('订阅解压后超过 2MB 上限'));
            chunks.push(chunk);
          });
          body.on('error', error => done(error));
          body.on('end', () => {
            report({stage:'body-complete',bytes:size,wireBytes:wire,encoding});
            phase='content-validation';
            if (!size) return done(safeError('订阅内容为空，原配置未改变'));
            const text = Buffer.concat(chunks).toString('utf8');
            // Some providers label valid Clash YAML as HTML. Accept it only
            // after the same node validation used by the import transaction.
            const webpageError = () => safeError('链接返回了网页或无效订阅内容，请使用 Clash/Mihomo 格式的订阅地址');
            if (/^\s*(?:<!doctype\s+html\b|<html\b|<head\b|<body\b)/i.test(text)) return done(webpageError());
            if (htmlContentType) {
              try { require('./store.cjs').parseNodes(text); }
              catch { return done(webpageError()); }
            }
            done(null, { text });
          });
        });
        req.on('socket',socket=>{
          report({stage:'tcp-start',address:resolved||undefined});
          socket.once('lookup',(error,address,family)=>report({stage:error?'socket-dns-error':'socket-dns',address,family,...(error?require('./network-trace.cjs').errorFields(error):{})}));
          socket.once('connect',()=>{report({stage:'tcp-connected',remoteAddress:socket.remoteAddress,port:socket.remotePort,family:net.isIP(socket.remoteAddress||'')});if(url.protocol==='https:'){phase='tls';report({stage:'tls-start'});}else phase='http';});
          socket.once('secureConnect',()=>{phase='http';report({stage:'tls-connected',authorized:socket.authorized,protocol:socket.getProtocol()});});
          socket.once('error',error=>report({stage:url.protocol==='https:'&&!socket.encrypted?'tcp-error':'socket-error',...require('./network-trace.cjs').errorFields(error)}));
        });
        req.on('error', error => done(error));
        req.end();
      } catch (error) { done(error); }
    });
  }

  try {
    let url = initial;
    for (let i = 0; i <= maxRedirects; i++) {
      const result = await one(url);
      if (!result.redirect) {report({stage:'download-complete',result:'success'});return { url: initial.href, text: result.text };}
      report({stage:'redirect',redirect:i+1});
      if (i === maxRedirects) throw safeError('订阅重定向次数过多');
      let next;
      try { next = subscriptionURL(new URL(result.redirect, url).href); }
      catch { throw safeError('订阅重定向地址无效'); }
      if (url.protocol === 'https:' && next.protocol !== 'https:') throw safeError('拒绝从 HTTPS 降级到 HTTP 的订阅重定向');
      url = next;
    }
    throw safeError('订阅下载失败');
  } catch (error) {
    report({stage:'download-error',result:abort.signal.aborted?'timeout':'failed',...require('./network-trace.cjs').errorFields(error),...(abort.signal.aborted?{code:'ETIMEDOUT'}:{})});
    if (abort.signal.aborted) throw safeError('订阅下载超时，原配置未改变');
    if (error.subscriptionSafe) throw error;
    throw safeError('订阅下载失败，请检查链接、网络或服务器证书；原配置未改变');
  } finally { clearTimeout(timer); }
}
module.exports = { downloadSubscription, subscriptionURL };
