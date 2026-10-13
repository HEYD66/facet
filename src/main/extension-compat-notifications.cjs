'use strict';
const {Notification,nativeImage}=require('electron'),fs=require('node:fs'),path=require('node:path');
const {object,text}=require('./extension-compat-state.cjs');
function icon(ctx,url){if(!url)return undefined;const u=new URL(url,'chrome-extension://'+ctx.id+'/');if(u.protocol!=='chrome-extension:'||u.hostname!==ctx.id)throw Error('通知图标必须来自当前扩展');const file=path.resolve(ctx.extension.path,'.'+decodeURIComponent(u.pathname)),root=path.resolve(ctx.extension.path);if(!file.startsWith(root+path.sep)||fs.statSync(file).size>1024*1024)throw Error('通知图标路径或大小无效');const image=nativeImage.createFromPath(file);if(image.isEmpty())throw Error('通知图标无法读取');return image;}
class CompatNotifications{
 constructor(c){this.c=c;this.rows=new Map();}
 async make(ctx,id,options){const d=object(options);if(!Notification.isSupported())throw Error('当前系统不支持原生通知');if(!['basic','image','list','progress',undefined].includes(d.type))throw Error('通知类型无效');if(d.type==='image'||d.buttons?.length)throw Error('当前 Windows 通知适配尚不支持图片和按钮');const extra=d.type==='list'?(d.items||[]).map(x=>text(x.title,200)+' '+text(x.message,500)).join('\n'):d.type==='progress'?'\n'+Math.max(0,Math.min(100,d.progress||0))+'%':'';
  const n=new Notification({title:text(d.title,500),body:text(d.message||'',2000)+extra,silent:d.silent===true,...(d.iconUrl?{icon:icon(ctx,d.iconUrl)}:{})});const key=ctx.id+':'+id,old=this.rows.get(key);if(old){old.n.removeAllListeners();old.n.close();}const row={n,ctx,id,options:{...d},closing:false};this.rows.set(key,row);
  n.on('click',()=>this.c.emit(ctx.id,'notifications.onClicked',[id]));n.on('close',()=>{if(this.rows.get(key)!==row)return;this.rows.delete(key);this.c.emit(ctx.id,'notifications.onClosed',[id,!row.closing]);});
  await new Promise((resolve,reject)=>{let settled=false;const timer=setTimeout(()=>fail(),8000);timer.unref();const fail=()=>{if(settled)return;settled=true;clearTimeout(timer);if(this.rows.get(key)===row)this.rows.delete(key);n.removeAllListeners();n.close();reject(Error('系统未能显示通知，请检查安装版通知注册与 Windows 通知设置'));};n.once('show',()=>{if(settled)return;settled=true;clearTimeout(timer);resolve();});n.once('failed',fail);n.show();});return id;
 }
 call(ctx,method,args){this.c.require(ctx,'notifications');
  if(method==='create'){const id=typeof args[0]==='string'?text(args[0],200):require('node:crypto').randomUUID(),options=typeof args[0]==='string'?args[1]:args[0];if(this.rows.size>=100&&!this.rows.has(ctx.id+':'+id))throw Error('通知数量超限');return this.make(ctx,id,options);}
  if(method==='getAll')return Object.fromEntries([...this.rows.values()].filter(x=>x.ctx.id===ctx.id).map(x=>[x.id,true]));
  const key=ctx.id+':'+text(args[0],200),row=this.rows.get(key);if(!row)return false;
  if(method==='clear'){row.closing=true;this.rows.delete(key);row.n.removeAllListeners();row.n.close();this.c.emit(ctx.id,'notifications.onClosed',[row.id,false]);return true;}
  if(method==='update')return this.make(ctx,row.id,{...row.options,...object(args[1])}).then(()=>true);
  throw Error('不支持的通知接口');
 }
 close(){for(const row of this.rows.values()){row.n.removeAllListeners();row.n.close();}this.rows.clear();}
}
module.exports={CompatNotifications,icon};
