'use strict';
const {object,text}=require('./extension-compat-state.cjs');
class CompatAlarms{
 constructor(c){this.c=c;this.timers=new Map();this.closed=false;}
 data(id){return this.c.state.data.alarms[id]||{};}
 register(ctx){for(const alarm of Object.values(this.data(ctx.id)))this.schedule(ctx.id,alarm);}
 schedule(id,alarm){const key=id+':'+alarm.name;if(this.closed||this.timers.has(key))return;const scheduled=alarm.scheduledTime,timer=setTimeout(()=>{this.timers.delete(key);if(this.closed)return;const saved=this.data(id)[alarm.name];if(!saved||saved.scheduledTime!==scheduled)return;if(Date.now()<scheduled){this.schedule(id,saved);return;}const event={...saved};if(saved.periodInMinutes)saved.scheduledTime=Date.now()+saved.periodInMinutes*60000;else delete this.data(id)[alarm.name];try{this.c.state.save();}catch(error){this.c.host.controller.log(this.c.host.instanceId,'扩展定时状态保存失败：'+require('./workspace.cjs').redact(error.message),'ERROR');return;}void this.c.emit(id,'alarms.onAlarm',[event]);if(saved.periodInMinutes)this.schedule(id,saved);},Math.max(1,Math.min(2147483647,scheduled-Date.now())));timer.unref();this.timers.set(key,timer);}
 call(ctx,method,args){this.c.require(ctx,'alarms');let name=typeof args[0]==='string'?text(args[0],200):'',info=typeof args[0]==='string'?args[1]:args[0];if(method==='getAll')return Object.values(this.data(ctx.id)).map(x=>({...x}));if(method==='get')return this.data(ctx.id)[name]?{...this.data(ctx.id)[name]}:undefined;
  const clear=key=>{const timerKey=ctx.id+':'+key;clearTimeout(this.timers.get(timerKey));this.timers.delete(timerKey);const found=Object.hasOwn(this.data(ctx.id),key);delete this.data(ctx.id)[key];return found;};
  if(method==='clear'){const result=clear(name);this.c.state.save();return result;}
  if(method==='clearAll'){for(const key of Object.keys(this.data(ctx.id)))clear(key);this.c.state.save();return true;}
  if(method!=='create')throw Error('未知定时任务接口');object(info);if(name==='__proto__'||name==='constructor'||name==='prototype')throw Error('定时任务名称无效');for(const key of ['when','delayInMinutes','periodInMinutes'])if(info[key]!==undefined&&(!Number.isFinite(info[key])||info[key]<0))throw Error('定时参数无效');if(info.when!==undefined&&info.delayInMinutes!==undefined)throw Error('when 与 delayInMinutes 不能同时设置');if(info.periodInMinutes!==undefined&&info.periodInMinutes<0.5)throw Error('重复任务间隔至少 0.5 分钟');if(Object.keys(this.data(ctx.id)).length>=500&&!Object.hasOwn(this.data(ctx.id),name))throw Error('定时任务数量超限');clear(name);const alarm={name,scheduledTime:info.when??Date.now()+(info.delayInMinutes??info.periodInMinutes??0)*60000,...(info.periodInMinutes?{periodInMinutes:info.periodInMinutes}:{})};this.c.state.data.alarms[ctx.id]??={};this.c.state.data.alarms[ctx.id][name]=alarm;this.c.state.save();this.schedule(ctx.id,alarm);
 }
 close(){this.closed=true;for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();}
}
module.exports={CompatAlarms};
