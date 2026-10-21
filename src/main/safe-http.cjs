'use strict';
// Harden network entry points until Electron embeds the full October 2026
// Node update. Electron links Chromium's separately patched Brotli decoder.
const http=require('node:http'),https=require('node:https'),tls=require('node:tls');
const net=require('node:net'),zlib=require('node:zlib');
const {domainToASCII}=require('node:url');
const {Readable}=require('node:stream');
const {X509Certificate}=require('node:crypto');

function canDecodeBrotli(versions=process.versions){
 // This exact Electron/Chromium build was checked against its upstream GN
 // dependency and Brotli source. New Electron builds require revalidation.
 if(versions.electron)return versions.electron==='44.9.3'&&versions.chrome==='152.0.7977.167';
 const [major,minor,patch]=String(versions.node||'').split('.').map(Number);
 const floor={22:[23,4],24:[22,1],26:[12,1]}[major];
 return !!floor&&(minor>floor[0]||minor===floor[0]&&patch>=floor[1]);
}
const brotliSafe=canDecodeBrotli(),acceptEncoding='gzip, deflate'+(brotliSafe?', br':'');

function invalidHost(){return Object.assign(Error('网络地址中的主机名无效'),{code:'ERR_INVALID_HOSTNAME'});}
function checkedHostname(value){
 if(typeof value!=='string'||!value||/[\0-\x20\x7f]/.test(value))throw invalidHost();
 const host=value.replace(/^\[|\]$/g,'');
 if(net.isIP(host))return host;
 const ascii=domainToASCII(host),unfqdn=ascii.replace(/\.$/,'');
 // Reject ambiguous IP spellings before Node's vulnerable IDNA/TLS path.
 if(!ascii||net.isIP(unfqdn)||/[\/:@%\\]/.test(ascii))throw invalidHost();
 return ascii;
}
function checkServerIdentity(host,cert){
 try{
  const checked=checkedHostname(host);
  if(net.isIP(checked)){
   // Match literal IPs only against IP SANs, without the broken IDNA path in
   // Node 24.22.0. DNS SANs and CNs cannot authenticate an IP endpoint.
   if(new X509Certificate(cert.raw).checkIP(checked))return;
   throw invalidHost();
  }
  return tls.checkServerIdentity(checked,cert);
 }
 catch{return Object.assign(Error('服务器证书主机名校验失败'),{code:'ERR_TLS_CERT_ALTNAME_INVALID'});}
}
function networkURL(value){
 if(typeof value!=='string'&&!(value instanceof URL))throw invalidHost();
 if(/[\0-\x1f\x7f]/.test(String(value)))throw invalidHost();
 const url=new URL(value);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw invalidHost();
 checkedHostname(url.hostname);
 return url;
}
function decodeResponse(response){
 const encoding=String(response.headers['content-encoding']||'identity').trim().toLowerCase();
 if(encoding==='identity'||!encoding)return response;
 let body;
 if(encoding==='gzip')body=zlib.createGunzip();
 else if(encoding==='deflate')body=zlib.createInflate();
 else if(encoding==='br'&&brotliSafe)body=zlib.createBrotliDecompress();
 else throw Object.assign(Error(encoding==='br'?'为规避当前运行时安全漏洞，暂不接收 Brotli 压缩响应，请服务端使用 gzip 或 identity':'服务器使用了不支持的压缩格式'),{code:'ERR_UNSAFE_CONTENT_ENCODING'});
 response.on('error',error=>body.destroy(error));
 response.on('aborted',()=>body.destroy(Object.assign(Error('响应传输中断'),{code:'ECONNRESET'})));
 body.once('close',()=>{if(!response.complete)response.destroy();});
 return response.pipe(body);
}
function safeFetch(value,{method='GET',headers,body,signal,redirect='error'}={}){
 return new Promise((resolve,reject)=>{
  let url;
  try{url=networkURL(value);signal?.throwIfAborted();if(redirect!=='error')throw Error('此传输仅允许显式处理重定向');}
  catch(error){reject(error);return;}
  const transport=url.protocol==='https:'?https:http;
  const agent=new transport.Agent({keepAlive:false,rejectUnauthorized:true,checkServerIdentity});
  let request,response,decoded,settled=false;
  const cleanup=()=>{signal?.removeEventListener('abort',abort);agent.destroy();};
  const fail=error=>{
   request?.destroy();response?.destroy();decoded?.destroy();cleanup();
   if(!settled){settled=true;reject(error);}
  };
  const abort=()=>{
   const error=Object.assign(Error('网络请求已取消'),{code:'ABORT_ERR'});
   decoded?.destroy(error);fail(error);
  };
  try{
   const outgoing=new Headers(headers);
   outgoing.set('Accept-Encoding',acceptEncoding);outgoing.set('Connection','close');
   request=transport.request(url,{method,headers:Object.fromEntries(outgoing),agent,rejectUnauthorized:true,checkServerIdentity},res=>{
    response=res;
    res.on('error',fail);
    try{
     if(res.statusCode>=300&&res.statusCode<400&&res.headers.location)throw Object.assign(Error('不允许自动跟随网络重定向'),{code:'ERR_UNSAFE_REDIRECT'});
     decoded=decodeResponse(res);
     const incoming=new Headers();
     for(const [name,val]of Object.entries(res.headers))if(val!==undefined)for(const entry of Array.isArray(val)?val:[val])incoming.append(name,entry);
     // The response stream has already been decoded, as with native fetch.
     incoming.delete('content-encoding');incoming.delete('content-length');
     const noBody=method==='HEAD'||[204,205,304].includes(res.statusCode);
     const result=new Response(noBody?null:Readable.toWeb(decoded),{status:res.statusCode,headers:incoming});
     decoded.once('close',()=>{if(!res.complete)res.destroy();cleanup();});
     if(noBody){res.resume();res.once('end',cleanup);}
     settled=true;resolve(result);
    }catch(error){fail(error);}
   });
   request.on('error',fail);
   signal?.addEventListener('abort',abort,{once:true});
   if(signal?.aborted){abort();return;}
   request.end(body);
  }catch(error){fail(error);}
 });
}
module.exports={safeFetch,networkURL,checkedHostname,checkServerIdentity,decodeResponse,canDecodeBrotli,acceptEncoding};
