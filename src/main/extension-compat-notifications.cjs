'use strict';
const {Notification,nativeImage}=require('electron'),fs=require('node:fs'),path=require('node:path');
const {object,text}=require('./extension-compat-state.cjs');
function icon(ctx,url){if(!url)return undefined;const u=new URL(url,'chrome-extension://'+ctx.id+'/');if(u.protocol!=='chrome-extension:'||u.hostname!==ctx.id)throw Error('通知图标必须来自当前扩展');const file=path.resolve(ctx.extension.path,'.'+decodeURIComponent(u.pathname)),root=path.resolve(ctx.extension.path);if(!file.startsWith(root+path.sep)||fs.statSync(file).size>1024*1024)throw Error('通知图标路径或大小无效');const image=nativeImage.createFromPath(file);if(image.isEmpty())throw Error('通知图标无法读取');return image;}
function message(value,max){if(typeof value!=='string'||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))throw Error('通知文字无效');return value;}
class CompatNotifications{
 constructor(c){this.c=c;this.rows=new Map();this.closed=false;}
 dispose(row,error,emitClosed=false){
  if(this.rows.get(row.key)===row)this.rows.delete(row.key);
  row.settle(error||Error('通知已关闭'));row.n.removeAllListeners();row.n.close();
  if(emitClosed&&row.shown)this.c.emit(row.ctx.id,'notifications.onClosed',[row.id,false]);
 }
 async make(ctx,id,options){
  if(this.closed)throw Error('实例已停止');const d=object(options);
  if(!Notification.isSupported())throw Error('当前系统不支持原生通知');
  if(!['basic','image','list','progress',undefined].includes(d.type))throw Error('通知类型无效');
  if(d.type==='image'||d.buttons?.length)throw Error('当前 Windows 通知适配尚不支持图片和按钮');
  let extra='';if(d.type==='list'){if(!Array.isArray(d.items)||d.items.length>100)throw Error('通知列表无效');extra=d.items.map(x=>message(x.title,200)+' '+message(x.message,500)).join('\n');}
  if(d.type==='progress'){if(!Number.isFinite(d.progress)||d.progress<0||d.progress>100)throw Error('通知进度无效');extra='\n'+d.progress+'%';}
  const n=new Notification({title:message(d.title,500),body:message(d.message||'',2000)+extra,silent:d.silent===true,...(d.iconUrl?{icon:icon(ctx,d.iconUrl)}:{})});
  const key=ctx.id+':'+id,old=this.rows.get(key);if(old)this.dispose(old,Error('通知已被替换'));
  const row={n,ctx,id,key,options:{...d},shown:false,settled:false};
  const ready=new Promise((resolve,reject)=>{row.settle=error=>{if(row.settled)return;row.settled=true;clearTimeout(row.timer);if(error)reject(error);else resolve(id);};});
  this.rows.set(key,row);
  n.on('click',()=>{if(row.shown&&this.rows.get(key)===row)this.c.emit(ctx.id,'notifications.onClicked',[id]);});
  n.on('close',()=>{if(this.rows.get(key)!==row)return;this.rows.delete(key);row.settle(Error('通知在显示前已关闭'));n.removeAllListeners();if(row.shown)this.c.emit(ctx.id,'notifications.onClosed',[id,true]);});
  n.once('show',()=>{if(this.closed||this.rows.get(key)!==row){this.dispose(row,Error('实例已停止或通知已被替换'));return;}row.shown=true;row.settle();});
  const failed=()=>this.dispose(row,Error('系统未能显示通知，请检查安装版通知注册与 Windows 通知设置'));
  n.once('failed',failed);row.timer=setTimeout(failed,8000);row.timer.unref();
  try{n.show();}catch(error){this.dispose(row,error);}
  return ready;
 }
 call(ctx,method,args){this.c.require(ctx,'notifications');if(this.closed)throw Error('实例已停止');
  if(method==='create'){const id=typeof args[0]==='string'?text(args[0],200):require('node:crypto').randomUUID(),options=typeof args[0]==='string'?args[1]:args[0];if(this.rows.size>=100&&!this.rows.has(ctx.id+':'+id))throw Error('通知数量超限');return this.make(ctx,id,options);}
  if(method==='getAll')return Object.fromEntries([...this.rows.values()].filter(x=>x.ctx.id===ctx.id&&x.shown).map(x=>[x.id,true]));
  const key=ctx.id+':'+text(args[0],200),row=this.rows.get(key);if(!row)return false;
  if(method==='clear'){this.dispose(row,Error('通知已被清除'),true);return true;}
  if(method==='update')return this.make(ctx,row.id,{...row.options,...object(args[1])}).then(()=>true);
  throw Error('不支持的通知接口');
 }
 close(){this.closed=true;for(const row of [...this.rows.values()])this.dispose(row,Error('实例已停止'));}
}
module.exports={CompatNotifications,icon};
