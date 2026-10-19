'use strict';
const {environment}=require('./environment.cjs');
function prepareSettings(store,id,patch={}){
 const original=store.get(id),next={};
 if(patch.environment)next.environment=environment(patch.environment);
 if(patch.network){const mode=patch.network.mode,nodeName=String(patch.network.nodeName||'');if(!['direct','mihomo'].includes(mode))throw Error('不支持的网络模式');if(mode==='mihomo'&&!store.nodes(id).some(n=>n.name===nodeName))throw Error('请选择已导入的代理节点');next.network={mode,nodeName};}
 return {next,changed:Object.keys(next).some(key=>JSON.stringify(next[key])!==JSON.stringify(original[key]))};
}
async function createInstance(controller,message){
 if(controller.creationProgress)throw Error('已有实例正在创建，请稍候');
 let plannedEnvironment=message.environment===undefined?null:environment(message.environment);
 const node=message.sourceId?controller.library.node(message.sourceId,message.nodeName):null;
 let x;const value={id:null,created:false,started:false,startError:'',timezoneError:'',configurationError:''};
 const savedRegion=message.regionMode==='saved'&&message.syncTimezone===true;
 if(savedRegion&&node){const evidence=require('./node-evidence.cjs').describe(controller,message.sourceId,node.name);plannedEnvironment=environment(require('./node-evidence.cjs').environmentFor(evidence,plannedEnvironment||environment()));value.regionSource=evidence.locale?.origin||'unknown';value.regionCountry=evidence.locale?.country||'';if(!evidence.locale?.timezone)value.regionNotice=evidence.locale?evidence.locale.origin==='name'?'已按节点名称设置语言；此地区有多个时区，已保留原时区，请在环境配置中确认。':'已按实测国家设置语言，但检测记录没有可确认的时区；已保留原时区，请在环境配置中确认。':'没有已测地区且节点名称无法识别，已保留原语言和时区。';}
 const phase=text=>{controller.creationProgress={phase:text,name:String(message.name||''),id:x?.id||null};controller.emit();};
 try{
  if(message.syncLocale===true){phase('按所选出口同步时区和语言');const locale=await require('./exit-locale.cjs').lookup(controller,node,{force:true});if(message.sourceId&&message.sourceVersion&&controller.library.get(message.sourceId).updatedAt!==message.sourceVersion)throw Error('节点源已更新，请重新生成草稿');plannedEnvironment=environment({...plannedEnvironment,language:locale.language,timezone:locale.timezone});value.exitLocale=locale;}
  phase('创建实例');x=controller.store.create(message.name,node?{mode:'mihomo',nodeName:node.name}:undefined,plannedEnvironment||undefined);value.id=x.id;value.created=true;
  try{if(node)controller.store.saveNodes(x.id,[node],null,{sourceId:message.sourceId,name:node.name});}catch{value.configurationError='实例已创建，但节点副本保存失败。实例保持停止，请重新分配节点。';controller.log(x.id,value.configurationError,'ERROR');}
  if(value.exitLocale&&node&&!value.configurationError){const sourceId=require('./instance-node.cjs').nodeDiagnosticKey(x.id,node),result={...value.exitLocale,kind:'ip',ok:true,sourceId,instanceId:x.id,name:node.name,at:new Date().toISOString()};controller.diagnostics.results.set(JSON.stringify([sourceId,node.name,'ip']),result);controller.diagnostics.history.record(result);}
  if(!value.configurationError&&message.syncTimezone===true&&!savedRegion){phase('按所选出口查询时区');try{const result=await controller.diagnostics.timezone(x.id,controller.store.get(x.id).network);controller.store.update(x.id,{environment:{...controller.store.get(x.id).environment,timezone:result.timezone}});}catch{value.timezoneError='出口时区查询失败，已保留原时区；可稍后手动同步';controller.log(x.id,value.timezoneError,'WARN');}}
  if(!value.configurationError&&message.start){phase('启动已创建的实例');try{await controller.start(x.id);value.started=true;}catch(e){value.startError=require('./workspace.cjs').redact(e.message);}}
  if(message.background!==true)controller.choose(x.id);controller.emit();return value;
 }finally{controller.creationProgress=null;controller.emit();}
}
module.exports={prepareSettings,createInstance};
