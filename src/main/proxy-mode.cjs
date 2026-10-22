'use strict';
const path=require('node:path');
const {Mihomo}=require('./mihomo.cjs');
const modeOf=controller=>controller.proxyPool.registry.data.enabled?'node':'instance';
const busyMessage='正在切换代理模式，请完成后重试';
function createCore(controller,onUnexpected,context,dir){
 if(modeOf(controller)==='node')return controller.proxyPool.lease(onUnexpected,context);
 const core=new Mihomo(controller.binary,dir||path.join(controller.dir,'core-runtime',context.instanceId),onUnexpected,controller.nodeNetwork,{journal:controller.networkTrace,output:controller.diagnosticOutput,context});
 if(context.instanceId&&context.kind==='instance')core.onIssue=message=>{const r=controller.runtimes.get(context.instanceId);if(r?.core===core)controller.noteProxyIssue(context.instanceId,r,message);};
 return core;
}
function affected(controller){return controller.store.list().filter(x=>x.network.mode==='mihomo').map(x=>({id:x.id,name:x.name,r:controller.runtimes.get(x.id)})).filter(x=>['running','starting'].includes(x.r?.status)||x.r?.core?.child);}
function setMode(controller,mode,{confirmed=false}={}){
 if(!['instance','node'].includes(mode))return Promise.reject(Error('代理模式无效'));
 if(controller.proxyModeSwitching)return Promise.reject(Error(busyMessage));
 return controller.queue('node-ports',async()=>{
  if(controller.disposing)throw Error('应用正在退出');
  const previous=modeOf(controller);
  if(previous===mode)return {...controller.proxyPool.snapshot(),mode,changed:false,restarted:[],restartFailed:[]};
  if(controller.transfer.progress?.running)throw Error('实例正在导出，请完成后切换代理模式');
  if(['extensions','global-library','instance-create','instance-delete','node-network'].some(key=>controller.queues.has(key)))throw Error('其他配置任务正在处理，请完成后切换代理模式');
  if(!confirmed&&(affected(controller).length||controller.proxyPool.snapshot().externalListeners||controller.diagnostics.work||controller.diagnostics.timeWork||controller.diagnostics.cores.size||controller.diagnostics.standalone.size))throw Error('切换代理模式会重启代理实例、关闭旧节点端口并取消检测，请确认后重试');
  controller.proxyModeSwitching=true;clearTimeout(controller.nodePortTimer);controller.emit();
  let targets=[],committed=false,started=false;const stopped=[],restarted=[],restartFailed=[];
  const restore=async()=>{for(const target of stopped){if(!target.resume||controller.disposing||!controller.store.list().some(x=>x.id===target.id))continue;try{await controller.start(target.id,{proxyModeTransition:true});restarted.push(target.id);}catch{restartFailed.push({id:target.id,name:target.name,error:'实例未能恢复运行，请检查实例日志后重试；未切回直连'});}}};
  try{
   await controller.startTail.catch(()=>{});
   targets=affected(controller).map(x=>({...x,resume:['running','starting'].includes(x.r.status)}));
   if(targets.length&&!confirmed)throw Error('代理实例已启动，请确认重启后切换模式');
   started=true;await controller.diagnostics.close();
   for(const target of targets){await controller.stop(target.id,{proxyModeTransition:true});stopped.push(target);}
   await controller.proxyPool.unpublish();
   if([...controller.proxyPool.groups].some(group=>group.core.child))throw Error('旧模式代理进程尚未回收，请重试切换');
   if(controller.disposing)throw Error('应用正在退出');
   controller.proxyPool.registry.setEnabled(mode==='node');committed=true;
   const ports=mode==='node'?await controller.publishNodePorts():{started:0,failed:[]};
   if(mode==='instance')controller.nodePortResult=null;
   await restore();
   controller.workspace.log('application',`已切换为${mode==='node'?'节点端口共享代理':'实例独立代理'}；恢复 ${restarted.length} 个实例${restartFailed.length?'，部分实例启动失败，请查看日志':''}`);
   return {...controller.proxyPool.snapshot(),mode,changed:true,...ports,restarted,restartFailed};
  }catch(error){
   let rollbackError;
   try{if(started){await controller.proxyPool.unpublish();if(committed||modeOf(controller)!==previous)controller.proxyPool.registry.setEnabled(previous==='node');if(previous==='node'&&!controller.disposing)await controller.publishNodePorts();}}catch(e){rollbackError=e;}
   await restore();
   controller.workspace.log('application',rollbackError?'代理模式切换失败，恢复未完成，请查看代理管理并重试':'代理模式切换失败，已保留原模式；请核对实例运行状态','WARN');
   throw Error((rollbackError?'代理模式切换失败，旧服务未能完整恢复':error.message)+(restartFailed.length?'；部分实例未能恢复，请查看实例日志':''));
  }finally{controller.proxyModeSwitching=false;controller.emit();}
 });
}
module.exports={modeOf,createCore,setMode,busyMessage};
