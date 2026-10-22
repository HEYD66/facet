'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),net=require('node:net'),{spawn}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'facet-subscription-import-'));
const artifacts=process.env.FACET_SUBSCRIPTION_ARTIFACTS||path.join(root,'artifacts');
const sockets=new Set(),counts={subscriptions:0,pages:0,blockedTunnels:0};
let server,origin;
(async()=>{try{
 fs.mkdirSync(artifacts,{recursive:true});
 origin=http.createServer((_req,res)=>{counts.pages++;res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Imported subscription page</title><h1>Imported node works</h1>');});
 origin.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 await new Promise(resolve=>origin.listen(0,'127.0.0.1',resolve));
 server=http.createServer((req,res)=>{
  if(req.url.startsWith('/sub-')){
   counts.subscriptions++;
   // Deliberately mislabeled: production must validate actual YAML content.
   res.setHeader('Content-Type','text/html');
   setTimeout(()=>res.end(JSON.stringify({proxies:[{name:'导入验证节点',type:'http',server:'127.0.0.1',port:server.address().port}]})),100);
  }else if(req.url==='/html'){res.setHeader('Content-Type','text/html');res.end('<html>fixture-login-body</html>');}
  else if(req.url.startsWith('http://import-page.facet.invalid/')){counts.pages++;res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Imported subscription page</title><h1>Imported node works</h1>');}
  else{res.writeHead(404);res.end();}
 });
 server.on('connect',(req,socket,head)=>{
  socket.on('error',()=>{});
  if(req.url!=='import-page.facet.invalid:80'){counts.blockedTunnels++;socket.end('HTTP/1.1 502 Test fixture has no external route\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;}
  const upstream=net.connect(origin.address().port,'127.0.0.1',()=>{socket.write('HTTP/1.1 200 Connection established\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);});
  sockets.add(upstream);upstream.on('close',()=>{sockets.delete(upstream);socket.destroy();});upstream.on('error',()=>socket.destroy());socket.on('close',()=>upstream.destroy());
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const run=phase=>new Promise((resolve,reject)=>{
  const env={...process.env,FACET_SUBSCRIPTION_ROOT:root,FACET_SUBSCRIPTION_PHASE:phase,FACET_SUBSCRIPTION_PORT:String(server.address().port),FACET_SUBSCRIPTION_ARTIFACTS:artifacts};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(process.execPath,[path.resolve('scripts/launch-electron.cjs'),path.resolve('tests/subscription-import-electron.cjs')],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>{process.stdout.write(chunk);fs.appendFileSync(path.join(artifacts,'application.log'),chunk);});
  child.stderr.on('data',chunk=>fs.appendFileSync(path.join(artifacts,'application.log'),chunk));
  child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Subscription Electron '+phase+' failed: '+code)));
 });
 await run('write');await run('reload');
 fs.writeFileSync(path.join(artifacts,'network-counts.json'),JSON.stringify(counts,null,2));
 console.log('PASS both Electron processes completed; '+counts.subscriptions+' real subscription downloads and '+counts.pages+' proxied page requests');
}finally{
 for(const socket of sockets)socket.destroy();if(server)await new Promise(resolve=>server.close(resolve));if(origin)await new Promise(resolve=>origin.close(resolve));
 const resolved=path.resolve(root);if(path.dirname(resolved)!==os.tmpdir()||!path.basename(resolved).startsWith('facet-subscription-import-')||fs.lstatSync(resolved).isSymbolicLink())throw Error('Unsafe cleanup path');
 fs.rmSync(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}})().catch(error=>{console.error(error);process.exitCode=1;});
