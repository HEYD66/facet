'use strict';
const {httpURL,object,text}=require('./extension-compat-state.cjs');
function nodes(tree){return tree.flatMap(x=>[x,...nodes(x.children||[])]);}
class CompatData{
 constructor(compat){this.c=compat;this.state=compat.state;}
 get data(){return this.state.data;}
 node(id){const x=nodes(this.data.bookmarks).find(x=>x.id===String(id));if(!x)throw Error('书签不存在');return x;}
 depth(node){let depth=0;while(node.parentId){node=this.node(node.parentId);if(++depth>64)throw Error('书签层级超过 64 层');}return depth;}
 async call(ctx,domain,method,args){
  if(domain==='bookmarks'){this.c.require(ctx,'bookmarks');return this.bookmarks(ctx,method,args);}
  if(domain==='history'){this.c.require(ctx,'history');return this.history(ctx,method,args);}
  if(domain==='sessions'){this.c.require(ctx,'sessions');return this.sessions(ctx,method,args);}
  if(domain==='cookies'){this.c.require(ctx,'cookies');return this.cookies(ctx,method,args);}
  if(domain==='browsingData'){this.c.require(ctx,'browsingData');return this.clear(ctx,method,args);}
  if(domain==='privacy'){this.c.require(ctx,'privacy');if(method==='network.webRTCIPHandlingPolicy.get')return {value:'disable_non_proxied_udp',levelOfControl:'not_controllable',incognitoSpecific:false};throw Error('千面的 WebRTC 网络防护不可由扩展修改');}
  throw Error('未知数据接口');
 }
 bookmarks(ctx,method,args){
  const clone=v=>structuredClone(v),emit=(name,...values)=>this.c.broadcast('bookmarks.'+name,values);
  if(method==='getTree')return clone(this.data.bookmarks);
  if(method==='get')return (Array.isArray(args[0])?args[0]:[args[0]]).map(id=>clone(this.node(id)));
  if(method==='getSubTree')return [clone(this.node(args[0]))];
  if(method==='getChildren')return clone(this.node(args[0]).children||[]);
  if(method==='getRecent')return clone(nodes(this.data.bookmarks).filter(x=>x.url).sort((a,b)=>b.dateAdded-a.dateAdded).slice(0,Math.max(0,Math.min(1000,Number(args[0])||0))));
  if(method==='search'){const q=args[0],terms=typeof q==='string'?{query:q}:object(q);return clone(nodes(this.data.bookmarks).filter(x=>x.id!=='0'&&(!terms.url||x.url===terms.url)&&(!terms.title||x.title===terms.title)&&(!terms.query||((x.title||'')+' '+(x.url||'')).toLowerCase().includes(String(terms.query).toLowerCase()))));}
  if(method==='create'){
   if(nodes(this.data.bookmarks).length>=10000)throw Error('书签数量超限');const d=object(args[0]),parent=this.node(d.parentId||'2');if(!parent.children)throw Error('父书签不是文件夹');if(this.depth(parent)>=63)throw Error('书签层级超过 64 层');
   const x={id:String(++this.data.bookmarkSerial),parentId:parent.id,title:text(d.title||'',500),dateAdded:Date.now(),...(d.url?{url:httpURL(d.url)}:{children:[]})};const index=d.index===undefined?parent.children.length:Math.min(parent.children.length,Math.max(0,Number(d.index)||0));parent.children.splice(index,0,x);this.reindex(parent);this.state.save();emit('onCreated',x.id,clone(x));return clone(x);
  }
  const x=this.node(args[0]);if(['0','1','2'].includes(x.id))throw Error('不能修改书签根目录');
  if(method==='update'){const d=object(args[1]);if(d.url!==undefined&&!x.url)throw Error('文件夹不能转成网址');const patch={};if(d.title!==undefined)patch.title=text(d.title,500);if(d.url!==undefined)patch.url=httpURL(d.url);Object.assign(x,patch);this.state.save();emit('onChanged',x.id,clone(patch));return clone(x);}
  const parent=this.node(x.parentId),oldIndex=parent.children.indexOf(x);
  if(method==='move'){const d=object(args[1]),next=this.node(d.parentId||x.parentId);if(!next.children||nodes([x]).includes(next))throw Error('书签移动目标无效');const height=n=>1+Math.max(0,...(n.children||[]).map(height));if(this.depth(next)+height(x)>63)throw Error('书签移动后层级超过 64 层');const oldParentId=x.parentId;parent.children.splice(oldIndex,1);const index=Math.min(next.children.length,Math.max(0,Number(d.index??next.children.length)));next.children.splice(index,0,x);x.parentId=next.id;this.reindex(parent);this.reindex(next);this.state.save();emit('onMoved',x.id,{parentId:x.parentId,index:x.index,oldParentId,oldIndex});return clone(x);}
  if(method==='remove'||method==='removeTree'){if(method==='remove'&&x.children?.length)throw Error('文件夹不为空');parent.children.splice(oldIndex,1);this.reindex(parent);this.state.save();emit('onRemoved',x.id,{parentId:x.parentId,index:oldIndex,node:clone(x)});return;}
  throw Error('不支持的书签接口');
 }
 reindex(parent){parent.children.forEach((x,i)=>x.index=i);}
 history(ctx,method,args){
  const rows=this.data.history;
  if(method==='search'){const q=object(args[0]),start=q.startTime??Date.now()-86400000,end=q.endTime??Date.now();return structuredClone(rows.filter(x=>x.lastVisitTime>=start&&x.lastVisitTime<=end&&(!q.text||(x.url+' '+x.title).toLowerCase().includes(String(q.text).toLowerCase()))).slice(0,Math.max(0,Math.min(5000,q.maxResults??100))));}
  if(method==='getVisits'){const url=httpURL(object(args[0]).url);return this.data.visits.filter(x=>x.url===url).map(({url,...record})=>({...record}));}
  if(method==='addUrl'){const url=httpURL(object(args[0]).url);this.state.visit(url);this.c.broadcast('history.onVisited',[structuredClone(this.data.history.find(x=>x.url===url))]);return;}
  let removed=[];
  if(method==='deleteUrl'){const url=httpURL(object(args[0]).url);removed=rows.filter(x=>x.url===url);}
  else if(method==='deleteRange'){const q=object(args[0]);if(!Number.isFinite(q.startTime)||!Number.isFinite(q.endTime)||q.startTime>q.endTime)throw Error('历史时间范围无效');removed=rows.filter(x=>x.lastVisitTime>=q.startTime&&x.lastVisitTime<=q.endTime);}
  else if(method==='deleteAll')removed=[...rows];else throw Error('不支持的历史接口');
  this.data.history=rows.filter(x=>!removed.includes(x));this.data.visits=this.data.visits.filter(x=>!removed.some(row=>row.url===x.url));this.state.save();this.c.broadcast('history.onVisitRemoved',[{allHistory:method==='deleteAll',urls:removed.map(x=>x.url)}]);
 }
 async sessions(ctx,method,args){
  if(method==='getRecentlyClosed')return structuredClone(this.data.closedTabs.slice(0,Math.min(25,args[0]?.maxResults??25)));
  if(method==='getDevices')return []; // Facet has no signed-in cross-device browser sessions.
  if(method!=='restore')throw Error('不支持的会话接口');
  const id=args[0],index=id?this.data.closedTabs.findIndex(x=>x.tab.sessionId===id):0;if(index<0||!this.data.closedTabs[index])throw Error('没有可恢复的标签');const saved=this.data.closedTabs[index],tab=await this.c.tabs.create(ctx,{url:saved.tab.url,active:true});this.data.closedTabs.splice(index,1);this.state.save();this.c.broadcast('sessions.onChanged',[]);return {lastModified:saved.lastModified,tab};
 }
 async cookies(ctx,method,args){
  const ses=this.c.host.runtime.session,q=object(args[0]||{}),storeId=String(this.c.host.instanceId);
  if(q.storeId!==undefined&&q.storeId!==storeId)throw Error('Cookie 存储不属于当前实例');
  const convert=x=>({...x,storeId,hostOnly:!x.domain.startsWith('.'),session:!x.expirationDate});
  if(method==='getAllCookieStores')return [{id:storeId,tabIds:this.c.tabs.list().map(x=>x.wc.id)}];
  if(method==='getAll'){if(q.url)this.c.origin(ctx,q.url);const filters={};for(const k of ['url','name','domain','path','secure','session'])if(q[k]!==undefined)filters[k]=q[k];const all=await ses.cookies.get(filters);return all.filter(x=>this.c.canOrigin(ctx,(x.secure?'https://':'http://')+x.domain.replace(/^\./,'')+x.path)).map(convert);}
  const url=httpURL(q.url);this.c.origin(ctx,url);
  if(method==='get'){const all=await ses.cookies.get({url,name:text(q.name,1000)});return all.sort((a,b)=>b.path.length-a.path.length)[0]?convert(all.sort((a,b)=>b.path.length-a.path.length)[0]):null;}
  if(method==='remove'){const before=await ses.cookies.get({url,name:text(q.name,1000)});if(!before.length)return null;await ses.cookies.remove(url,q.name);return {url,name:q.name,storeId};}
  if(method==='set'){const details={url};for(const k of ['name','value','domain','path','secure','httpOnly','expirationDate','sameSite'])if(q[k]!==undefined)details[k]=q[k];if(q.partitionKey)throw Error('此 Cookie 接口尚不支持分区键');if(details.domain){const domain=String(details.domain).replace(/^\./,'');if(new URL(url).hostname!==domain&&!new URL(url).hostname.endsWith('.'+domain))throw Error('Cookie 域名与 URL 不一致');this.c.origin(ctx,(details.secure?'https://':'http://')+domain+'/');}await ses.cookies.set(details);const all=await ses.cookies.get({url,name:q.name||''});return all[0]?convert(all[0]):null;}
  throw Error('不支持的 Cookie 接口');
 }
 async clear(ctx,method,args){
  if(method!=='remove')throw Error('不支持的数据清理接口');const opts=object(args[0]||{}),types=object(args[1]);
  for(const key of Object.keys(opts))if(!['since','origins','excludeOrigins','originTypes'].includes(key))throw Error('不支持的清理参数：'+key+'，原数据未清除');
  if(opts.originTypes&&Object.entries(opts.originTypes).some(([key,value])=>key!=='unprotectedWeb'||value!==true))throw Error('当前仅支持普通网站存储清理，原数据未清除');
  if(opts.since!==undefined&&(!Number.isFinite(opts.since)||opts.since<0))throw Error('清理时间参数无效，原数据未清除');
  if(opts.origins!==undefined&&(!Array.isArray(opts.origins)||opts.origins.some(x=>typeof x!=='string')))throw Error('清理来源列表无效，原数据未清除');
  if(opts.since&&Object.keys(types).some(k=>types[k]&&!['history','downloads'].includes(k)))throw Error('当前内核不能按时间精确清理网站存储；请使用 since:0，原数据未清除');
  if(opts.origins?.length&&types.history)throw Error('按来源清理历史尚不支持，原数据未清除');
  const map={cache:'cache',cookies:'cookies',fileSystems:'fileSystems',indexedDB:'indexedDB',localStorage:'localStorage',serviceWorkers:'serviceWorkers',webSQL:'webSQL'};
  for(const [k,v]of Object.entries(types))if(v&&!map[k]&&!['history','downloads'].includes(k))throw Error('不支持的数据类型：'+k);
  const origins=opts.origins?.map(x=>{this.c.origin(ctx,x);return new URL(httpURL(x)).origin;});
  if(opts.excludeOrigins?.length)throw Error('排除来源清理尚不支持，原数据未清除');if(opts.originTypes?.extension)throw Error('扩展存储清理不由此网页接口提供');
  const selected=Object.entries(types).filter(([k,v])=>v&&map[k]).map(([k])=>map[k]);if(selected.length)await this.c.host.runtime.session.clearData({dataTypes:selected,...(origins?{origins}:{excludeOrigins:this.c.host.runtime.session.extensions.getAllExtensions().map(e=>'chrome-extension://'+e.id)})});
  if(types.history){this.data.history=this.data.history.filter(x=>x.lastVisitTime<(opts.since||0));this.data.visits=this.data.visits.filter(x=>x.visitTime<(opts.since||0));}
  if(types.downloads)this.data.downloads=this.data.downloads.filter(x=>x.startTime<(opts.since||0));this.state.save();
 }
}
module.exports={CompatData,nodes};
