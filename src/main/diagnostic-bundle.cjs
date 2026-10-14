'use strict';
const os = require('node:os');
const crypto = require('node:crypto');
const { atomic } = require('./json-storage.cjs');
const { safeLine, readRuntimeOutput } = require('./runtime-output.cjs');
const {fields}=require('./network-trace.cjs');
const net=require('node:net');

// Explicit fields only: never serialize the full snapshot, profiles or nodes.
function buildDiagnosticBundle(snapshot, events, runtime, now = new Date(), details = {}) {
  const text = value => safeLine(String(value ?? ''));
  const network=details.network||{rows:[],warning:'当前启动方式未接入网络阶段采集'};
  const traces=(network.rows||[]).slice(-300).map(row=>({...fields(row),id:text(row.id),startedAt:text(row.startedAt),endedAt:row.endedAt?text(row.endedAt):null,stepsDropped:Math.max(0,Number(row.stepsDropped)||0),steps:(row.steps||[]).slice(-160).map(step=>({...fields(step),time:text(step.time)}))}));
  const measurement=row=>{
    const result={};for(const key of ['taskId','sourceId','instanceId','kind','at','error','provider','country','countryCode','region','city','isp','timezone','queriedAt'])if(row[key]!=null)result[key]=text(row[key]);
    for(const key of ['latencyMs','ms','bytes','elapsedMs','mbps'])if(Number.isFinite(row[key]))result[key]=row[key];
    for(const key of ['ok','fallback'])if(typeof row[key]==='boolean')result[key]=row[key];if(net.isIP(row.ip))result.ip=row.ip;return result;
  };
  const history=[...(details.history||[])].sort((a,b)=>String(a.at||'').localeCompare(String(b.at||''))).slice(-1000).map(row=>{
    const value={sourceId:text(row.sourceId),name:text(row.name),at:text(row.at)};
    for(const kind of ['latency','ip','speed'])if(row[kind]){const stat=row[kind];value[kind]={ok:Number.isSafeInteger(stat.ok)?stat.ok:0,total:Number.isSafeInteger(stat.total)?stat.total:0,last:measurement(stat.last||{}),lastOk:measurement(stat.lastOk||{}),recent:(stat.recent||[]).slice(-10).map(measurement)};}return value;
  });
  const issues=traces.filter(row=>['failed','timeout','interrupted'].includes(row.result)||row.steps.some(step=>step.code||step.errorNumber)).map(row=>{
    const error=[...row.steps].reverse().find(step=>step.code||step.errorNumber)||row.steps.at(-1)||{};
    return {id:row.id,operation:row.operation,instanceId:row.instanceId,sourceId:row.sourceId,taskId:row.taskId,nodeName:row.nodeName,host:row.host,result:row.result,stage:error.stage,code:error.code,errorNumber:error.errorNumber,reason:error.reason,durationMs:row.durationMs};
  });
  return {
    format: 'facet-diagnostics', version: 2, time: now.toISOString(),
    application: { app: text(snapshot.versions?.app), electron: text(snapshot.versions?.electron), platform: os.platform(), architecture: os.arch(), osRelease: os.release() },
    nodeNetwork: { dnsMode: text(snapshot.nodeNetwork?.settings?.dnsMode), routeMode: text(snapshot.nodeNetwork?.settings?.routeMode), warning: text(snapshot.nodeNetwork?.warning) },
    instances: (snapshot.instances || []).map(x => ({
      id: text(x.id), status: text(x.status), network: text(x.network?.mode),
      page: text(x.pageState), core: text(x.coreVersion), error: text(x.error),
      environment: { language: text(x.environment?.language), timezone: text(x.environment?.timezone), customUA: !!x.environment?.userAgent, customPlatform: !!x.environment?.platform }
    })),
    events: (events || []).slice(0, 1000).map(x => ({
      time: text(x.time), scope: text(x.scope), level: text(x.level),
      instanceId: x.instanceId ? text(x.instanceId) : null, sourceId: x.sourceId ? text(x.sourceId) : null,
      taskId: x.taskId ? text(x.taskId) : null, nodeName: x.nodeName ? text(x.nodeName) : null, text: text(x.text)
    })),
    debug: { warning: text(runtime.warning), limit:5000,lineLengthLimit:700,longLinesTruncated:(runtime.rows||[]).slice(-5000).filter(x=>x.truncated||String(x.text||'').length>700).length, retained:Math.min(5000,(runtime.rows||[]).length),dropped:Math.max(0,Number(runtime.dropped)||0)+Math.max(0,(runtime.rows||[]).length-5000),firstRetainedAt:text(runtime.firstRetainedAt),lastRetainedAt:text(runtime.lastRetainedAt),rows:(runtime.rows||[]).slice(-5000).map(x=>({time:text(x.time),channel:x.channel==='stderr'?'stderr':'stdout',text:text(x.text),truncated:!!x.truncated||String(x.text||'').length>700,...fields({instanceId:x.instanceId,taskId:x.taskId,sourceId:x.sourceId,runId:x.runId,pid:x.pid}),...( ['application','core','page','control','operation'].includes(x.source)?{source:x.source}:{})})) },
    network:{warning:text(network.warning),limit:300,stepLimit:160,dropped:Math.max(0,Number(network.dropped)||0)+Math.max(0,(network.rows||[]).length-300),startedAt:text(network.startedAt),rows:traces},
    diagnostics:{history,omittedNodes:Math.max(0,(details.history||[]).length-1000),job:details.job?fields({taskId:details.job.id,kind:details.job.kind,result:details.job.cancelling?'cancelling':'running'}):null},
    summary:{networkIssueCount:issues.length,issues},
    coverage:{operations:'最近最多 1000 条操作记录，包含跨重启历史',debug:'脱敏应用/内核输出最近最多 5000 行，跨重启保留；界面仅显示最近 1000 行；单行最多 700 字符，截断标记及计数随包导出',network:'升级后开始采集；最近 300 个任务、每任务 160 个阶段，含 DNS、连接、TLS、HTTP、解析/保存、内核与网页加载错误；截断数量单独标注',diagnostics:'最近最多 1000 条节点检测历史；Electron 网页请求不提供独立 DNS/TCP/TLS 阶段，仅记录失败事件及检测响应，相关内核输出另存',privacy:'只保留故障元数据，隐藏网址路径与凭据；不收集请求头、响应正文、Cookie、密码、订阅配置、网页内容或实例备注',missingHistory:'未采集的旧记录无法补回；普通网页控制台内容不收集，跨重启下载断点恢复未纳入' }
  };
}

async function exportDiagnosticBundle(controller, window, dialog) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const pick = await dialog.showSaveDialog(window, {
    title: '保存问题诊断包', defaultPath: `Facet-diagnostics-${stamp}-${crypto.randomUUID().slice(0, 6)}.json`,
    filters: [{ name: '问题诊断包（JSON）', extensions: ['json'] }]
  });
  if (pick.canceled || !pick.filePath || controller.disposing) return { cancelled: true };
  controller.workspace.flush?.();controller.networkTrace?.flush();controller.diagnostics?.history?.flush();controller.diagnosticOutput?.flush();
  const bundle = buildDiagnosticBundle(controller.snapshot(), controller.workspace.events,controller.diagnosticOutput?.snapshot()||readRuntimeOutput(undefined,{limit:5000}),new Date(),{network:controller.networkTrace?.snapshot(),history:controller.diagnostics?.history?.list(),job:controller.diagnostics?.job});
  try { atomic(pick.filePath, bundle, { backup: false }); }
  catch { throw Error('诊断包保存失败，请检查保存位置和磁盘空间后重试'); }
  return { cancelled:false,eventCount:bundle.events.length,debugLineCount:bundle.debug.rows.length,debugWarning:bundle.debug.warning,networkWarning:bundle.network.warning,networkTraceCount:bundle.network.rows.length,diagnosticHistoryCount:bundle.diagnostics.history.length };
}
module.exports = { buildDiagnosticBundle, exportDiagnosticBundle };
