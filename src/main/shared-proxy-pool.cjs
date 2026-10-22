'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const {Mihomo,configuration,reserveNodePort,retirePort,listenerReady}=require('./mihomo.cjs');
const {NodePortRegistry,nodeKey,canonical}=require('./node-port-registry.cjs');
const {atomic}=require('./json-storage.cjs');
function control(core,method,endpoint,body){return new Promise((resolve,reject)=>{
 const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
 const request=http.request({hostname:'127.0.0.1',port:core.controllerPort,path:endpoint,method,agent:false,headers:{Authorization:'Bearer '+core.secret,Connection:'close',...(bytes?{'Content-Type':'application/json','Content-Length':bytes.length}:{})}},response=>{
  let size=0;const chunks=[];response.on('data',chunk=>{size+=chunk.length;if(size>8*1024*1024)request.destroy(Error('共享内核响应超过上限'));else chunks.push(chunk);});response.on('error',reject);response.on('end',()=>{if(response.statusCode<200||response.statusCode>=300)return reject(Error('共享内核配置请求失败（HTTP '+response.statusCode+'）'));try{const text=Buffer.concat(chunks).toString('utf8');resolve(text?JSON.parse(text):null);}catch{reject(Error('共享内核响应无效'));}});
 });request.on('error',()=>reject(Error('共享代理内核控制连接失败')));request.setTimeout(10000,()=>request.destroy());if(bytes)request.write(bytes);request.end();
});}
function proxyName(key){return 'node-'+key.slice(0,24);}
function sharedConfiguration(core,entries,overrides){const rows=[...entries.values()];const config=configuration({},0,core.controllerPort,core.secret,overrides);config.proxies=rows.map(e=>({...e.node,name:proxyName(e.key)}));config.listeners=rows.map(e=>({name:'port-'+e.port,type:'mixed',listen:'127.0.0.1',port:e.port,udp:true,proxy:proxyName(e.key)}));config.rules=['MATCH,REJECT'];return config;}
class SharedProxyPool{
 constructor({binary,dir,network,trace,onChange=()=>{},onWarning=()=>{}}){this.binary=binary;this.dir=dir;this.network=network;this.trace=trace;this.onChange=onChange;this.onWarning=onWarning;this.registry=new NodePortRegistry(dir);this.entries=new Map();this.groups=new Set();this.tail=Promise.resolve();this.closing=false;}
 queue(work){const next=this.tail.catch(()=>{}).then(work);this.tail=next;return next;}
 lease(onUnexpected,context={}){return new NodeLease(this,onUnexpected,context);}
 lookup(node){const key=nodeKey(node,this.network?.settings);const entry=this.entries.get(key);return {port:entry?.port||this.registry.get(key),running:!!entry?.group.core.child&&!entry?.group.failed,external:!!entry?.external};}
 snapshot(){return {enabled:this.registry.data.enabled,processes:[...this.groups].filter(g=>g.core.child).length,listeners:[...this.entries.values()].filter(e=>e.group.core.child&&!e.group.failed).length,externalListeners:[...this.entries.values()].filter(e=>e.external&&e.group.core.child&&!e.group.failed).length};}
 async acquire(lease,node,signal){return this.queue(async()=>{
  if(this.closing)throw Error('共享代理正在关闭');signal?.throwIfAborted();if(lease.entry)throw Error('节点连接已启动');
  const settings=structuredClone(this.network?.settings||{}),key=nodeKey(node,settings);let entry=this.entries.get(key);
  if(entry&&(!entry.group.core.child||entry.group.failed)){await this.discard(entry.group);entry=null;}
  if(!entry){
   const preparation=this.trace?.journal?.begin({operation:'node-preparation',host:node.server,...lease.context});let prepared;
   try{prepared=this.network?await this.network.prepare(node,signal,step=>this.trace?.journal?.record(preparation,step)):{overrides:{},summary:{dns:'系统 DNS',route:'保留系统路由及节点设置'}};this.trace?.journal?.finish(preparation,{result:'success'});}
   catch(error){this.trace?.journal?.record(preparation,{stage:'node-preparation-error',...require('./network-trace.cjs').errorFields(error)});this.trace?.journal?.finish(preparation,{result:signal?.aborted?'cancelled':'failed'});throw error;}
   signal?.throwIfAborted();const {hosts={},...base}=prepared.overrides;const signature=JSON.stringify(canonical({settings,base}));
   let group=[...this.groups].find(g=>!g.failed&&g.signature===signature&&g.core.child&&Object.entries(hosts).every(([host,addresses])=>!g.hosts[host]||JSON.stringify(g.hosts[host])===JSON.stringify(addresses)));
   let allocation;try{allocation=await this.registry.allocate(key,reserveNodePort);}catch(error){if(error.reservedPort)retirePort(error.reservedPort);throw error;}
   if(allocation.changed)this.onWarning('节点原端口 '+allocation.previous+' 被占用，已改为 '+allocation.port+'；请更新外部软件连接');
   const fresh=!group;if(fresh){
    const runtimeDir=path.join(this.dir,'core-runtime','shared-'+crypto.randomUUID());
    group={signature,hosts:{},base,entries:new Map(),core:null,config:null};
    group.core=new Mihomo(this.binary,runtimeDir,()=>this.failed(group),null,{...this.trace,context:{kind:'shared-proxy'}});
    group.core.configurationFactory=()=>sharedConfiguration(group.core,group.entries,{...group.base,hosts:group.hosts});
   }
   entry={key,node:structuredClone(node),port:allocation.port,hosts,summary:prepared.summary,group,users:new Set(),external:false};
   const oldHosts=group.hosts;group.hosts={...oldHosts,...hosts};group.entries.set(key,entry);
   try{
    if(fresh){group.core.listenerPort=entry.port;const ready=await group.core.start(node,signal);group.version=ready.version;await new Promise(resolve=>setTimeout(resolve,20));if(group.core.bindingFailures)throw Error('节点端口绑定失败；未接入其他服务');group.config=sharedConfiguration(group.core,group.entries,{...group.base,hosts:group.hosts});this.groups.add(group);}
    else await this.reload(group);
    signal?.throwIfAborted();this.entries.set(key,entry);
   }catch(error){
    if(fresh){try{await group.core.stop();}catch(stopError){this.groups.add(group);this.entries.set(key,entry);this.failed(group);throw stopError;}group.entries.delete(key);this.groups.delete(group);retirePort(entry.port);fs.rmSync(group.core.dir,{recursive:true,force:true});}
    else{group.entries.delete(key);group.hosts=oldHosts;if(!group.failed)await this.reload(group).catch(async()=>{this.failed(group);await group.core.stop();});retirePort(entry.port);}
    throw error;
   }
  }
  signal?.throwIfAborted();entry.users.add(lease);lease.entry=entry;this.record(lease,'shared-proxy-acquire',entry);this.onChange();return {port:entry.port,pid:entry.group.core.pid,version:entry.group.version};
 });}
 async reload(group){const config=sharedConfiguration(group.core,group.entries,{...group.base,hosts:group.hosts}),old=group.config,bindings=group.core.bindingFailures||0;
  try{await control(group.core,'PUT','/configs?force=false',{payload:JSON.stringify(config)});await new Promise(resolve=>setTimeout(resolve,20));if((group.core.bindingFailures||0)>bindings)throw Error('节点端口绑定失败；未接入其他服务');const previousPorts=new Set((old?.listeners||[]).map(item=>item.port));for(const entry of group.entries.values())if(!previousPorts.has(entry.port))await listenerReady(entry.port);const proxies=await control(group.core,'GET','/proxies');for(const entry of group.entries.values())if(!proxies.proxies?.[proxyName(entry.key)])throw Error('共享节点未实际载入');atomic(group.core.config,config,{backup:false});group.config=config;}
  catch(error){if(old)try{await control(group.core,'PUT','/configs?force=false',{payload:JSON.stringify(old)});atomic(group.core.config,old,{backup:false});}catch{this.failed(group);await group.core.stop();}throw error;}
 }
 failed(group){if(group.failed)return;group.failed=true;for(const entry of group.entries.values())for(const user of entry.users)try{user.onUnexpected?.('共享代理内核意外退出，相关实例已断开；未切回直连');}catch{}this.onWarning('共享代理内核已退出，相关节点端口不可用；请重新启动端口服务或受影响实例');this.onChange();}
 async release(lease){return this.queue(async()=>{
  const entry=lease.entry;if(!entry)return;
  if(entry.users.size===1&&!entry.external)await this.remove(entry);
  entry.users.delete(lease);lease.entry=null;this.record(lease,'shared-proxy-release',entry);this.onChange();
 });}
 async remove(entry){const group=entry.group,oldHosts=group.hosts;group.entries.delete(entry.key);group.hosts=Object.assign({},...[...group.entries.values()].map(e=>e.hosts));
  try{if(!group.entries.size){await group.core.stop();fs.rmSync(group.core.dir,{recursive:true,force:true});this.groups.delete(group);}else if(group.core.child&&!group.failed)await this.reload(group);}
  catch(error){group.entries.set(entry.key,entry);group.hosts=oldHosts;throw error;}
  this.entries.delete(entry.key);retirePort(entry.port);
 }
 async publish(nodes,signal){const result={started:0,failed:[]};const desired=new Set();
  for(const node of nodes){if(this.closing)break;signal?.throwIfAborted();const key=nodeKey(node,this.network?.settings);desired.add(key);const existing=this.entries.get(key);if(existing?.external&&existing.group.core.child&&!existing.group.failed){result.started++;continue;}
   const lease=this.lease(null,{kind:'external'});try{await lease.start(node,signal);await this.queue(async()=>{lease.entry.external=true;});result.started++;}catch(error){if(signal?.aborted)throw error;result.failed.push({name:node.name,error:'节点端口启动失败；请检查节点配置、网络设置或端口冲突'});}finally{await lease.stop();}
  }
  await this.queue(async()=>{for(const entry of [...this.entries.values()])if(entry.external&&!desired.has(entry.key)){if(!entry.users.size)await this.remove(entry);entry.external=false;}this.onChange();});return result;
 }
 async unpublish(){return this.queue(async()=>{for(const entry of [...this.entries.values()])if(entry.external){if(!entry.users.size)await this.remove(entry);entry.external=false;}this.onChange();});}
 record(lease,operation,entry){const journal=this.trace?.journal;if(!journal)return;const id=journal.begin({operation,nodeName:entry.node.name,...lease.context});journal.record(id,{stage:'shared-node-port',proxyPort:entry.port,pid:entry.group.core.pid});journal.finish(id,{result:'success'});}
 async discard(group){await group.core.stop();fs.rmSync(group.core.dir,{recursive:true,force:true});for(const entry of group.entries.values()){for(const lease of entry.users)lease.entry=null;entry.users.clear();this.entries.delete(entry.key);retirePort(entry.port);}this.groups.delete(group);}
 async close(){this.closing=true;await this.tail.catch(()=>{});const failures=[];for(const group of [...this.groups]){try{await this.discard(group);}catch(error){failures.push(error);}}if(failures.length){this.closing=false;throw Error('共享代理进程尚未退出，请重试关闭');}this.entries.clear();}
}
class NodeLease{
 constructor(pool,onUnexpected,context){this.pool=pool;this.onUnexpected=onUnexpected;this.context=context;this.entry=null;}
 start(node,signal){return this.pool.acquire(this,node,signal);}
 stop(){return this.pool.release(this);}
 get child(){return this.entry?.group.core.child||null;}
 get proxyPort(){return this.entry?.port||null;}
 get pid(){return this.entry?.group.core.pid||null;}
 get config(){return this.entry?.group.core.config;}
 get networkSummary(){return this.entry?.summary;}
 recentIssue(){return '';}
}
module.exports={SharedProxyPool,NodeLease,sharedConfiguration,control};
