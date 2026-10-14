'use strict';
// Allowlisted network metadata only. Never accept raw requests, bodies or engine output.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const {atomic}=require('./json-storage.cjs');
const LIMIT=300,STEP_LIMIT=160;
const STRING_KEYS=['operation','stage','result','route','sourceId','instanceId','taskId','kind','dnsMode','routeMode','category','encoding','protocol','reason','runId','contentType','lastStage','level','method','resourceType','nodeName'];
const NUMBER_KEYS=['elapsedMs','durationMs','status','bytes','wireBytes','redirect','port','proxyPort','pid','nodeCount','exitCode','family','errorNumber','webContentsId'];
function hostname(value){const s=String(value||'').replace(/^\[|\]$/g,'').toLowerCase();return net.isIP(s)?s:/^(?=.{1,253}$)[a-z0-9.-]+$/.test(s)?s:'';}
function fields(input={}){const out={};for(const key of STRING_KEYS)if(typeof input[key]==='string')out[key]=require('./runtime-output.cjs').safeLine(input[key]).slice(0,180);for(const key of NUMBER_KEYS)if(Number.isFinite(input[key]))out[key]=input[key];
 for(const key of ['host','lookupHost'])if(input[key])out[key]=hostname(input[key]);
 for(const key of ['address','remoteAddress'])if(net.isIP(input[key]))out[key]=input[key];
 if(Array.isArray(input.addresses))out.addresses=input.addresses.slice(0,32).filter(x=>x&&net.isIP(x.address)).map(x=>({address:x.address,family:net.isIP(x.address),public:require('./subscription-policy.cjs').isPublicAddress(x.address),fakeIP:require('./subscription-policy.cjs').isFakeIPAddress(x.address)}));
 if(typeof input.code==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(input.code))out.code=input.code;
 for(const key of ['authorized','fallback','proxy','cancelled','mainFrame','public'])if(typeof input[key]==='boolean')out[key]=input[key];return out;}
function errorFields(error){const value={reason:require('./runtime-output.cjs').safeLine(error?.message||String(error||'未知错误'))};if(typeof error?.code==='string')value.code=error.code;else if(Number.isInteger(error?.errno))value.errorNumber=error.errno;if(error?.cause&&typeof error.cause.code==='string'&&!value.code)value.code=error.cause.code;if(!value.code){const code=String(error?.message||'').match(/\b(ERR_[A-Z0-9_]+)\b/);if(code)value.code=code[1];}return fields(value);}
class NetworkTrace{
 constructor(dir){this.file=path.join(dir,'network-trace.json');this.rows=[];this.warning='';this.timer=null;this.dropped=0;this.runId=crypto.randomUUID();this.startedAt=new Date().toISOString();try{if(fs.statSync(this.file).size>12*1024*1024)throw Error('limit');const d=JSON.parse(fs.readFileSync(this.file,'utf8'));if(d.version!==1||!Array.isArray(d.rows))throw Error('format');this.dropped=Math.max(0,Number(d.dropped)||0)+Math.max(0,d.rows.length-LIMIT);this.rows=d.rows.slice(-LIMIT).map(x=>({...fields(x),id:String(x.id||'').slice(0,64),startedAt:String(x.startedAt||'').slice(0,40),endedAt:x.endedAt?String(x.endedAt).slice(0,40):null,stepsDropped:Math.max(0,Number(x.stepsDropped)||0),steps:(x.steps||[]).slice(-STEP_LIMIT).map(s=>({...fields(s),time:String(s.time||'').slice(0,40)}))}));for(const row of this.rows)if(!row.endedAt){row.endedAt=new Date().toISOString();row.result='interrupted';row.reason='应用上次退出前未记录完成结果';}}catch(e){if(e.code!=='ENOENT')this.warning='网络详情历史无法读取，原文件保留';}}
 begin(input){const id=crypto.randomUUID();this.rows.push({id,startedAt:new Date().toISOString(),endedAt:null,runId:this.runId,...fields(input),steps:[],stepsDropped:0});if(this.rows.length>LIMIT){const i=this.rows.findIndex(r=>r.endedAt);if(i>=0)this.rows.splice(i,1);else this.rows.shift();this.dropped++;}this.schedule();return id;}
 record(id,input){const row=this.rows.find(x=>x.id===id);if(!row||row.endedAt)return;const step={time:new Date().toISOString(),elapsedMs:Date.now()-Date.parse(row.startedAt),...fields(input)};row.steps.push(step);if(step.stage)row.lastStage=step.stage;if(row.steps.length>STEP_LIMIT){row.stepsDropped+=row.steps.length-STEP_LIMIT;row.steps.splice(0,row.steps.length-STEP_LIMIT);}this.schedule();}
 finish(id,input){const row=this.rows.find(x=>x.id===id);if(!row||row.endedAt)return;Object.assign(row,fields(input),{endedAt:new Date().toISOString(),durationMs:Date.now()-Date.parse(row.startedAt)});this.schedule();}
 schedule(){if(!this.timer){this.timer=setTimeout(()=>this.flush(),250);this.timer.unref?.();}}
 flush(){clearTimeout(this.timer);this.timer=null;if(this.warning==='网络详情历史无法读取，原文件保留')return;try{atomic(this.file,{version:1,rows:this.rows,dropped:this.dropped},{backup:false});this.warning='';}catch{this.warning='网络详情写盘失败';}}
 snapshot(){return {warning:this.warning,limit:LIMIT,stepLimit:STEP_LIMIT,dropped:this.dropped,startedAt:this.startedAt,rows:structuredClone(this.rows)};}
}
function engineDetails(value){const text=String(value||''),lower=text.toLowerCase();const out={stage:'core-error',category:require('./network-error.cjs').networkError(text)};
 const lookup=text.match(/\blookup\s+([a-z0-9.-]+)(?::|\s)/i);if(lookup)out.lookupHost=lookup[1];
 const endpoint=text.match(/(?:dial\s+(?:tcp|udp)(?:4|6)?\s+|connect\s+)(?:\[([a-f0-9:]+)\]|([0-9.]+)):(\d+)/i);if(endpoint){out.address=endpoint[1]||endpoint[2];out.port=Number(endpoint[3]);}
 out.code=/no such host|not.*resolved/.test(lower)?'DNS_NOT_FOUND':/dns.*fail|lookup .*:/.test(lower)?'DNS_LOOKUP_FAILED':/timeout|timed out|deadline exceeded/.test(lower)?'ETIMEDOUT':/connection.*reset/.test(lower)?'ECONNRESET':/connection refused/.test(lower)?'ECONNREFUSED':/x509|certificate/.test(lower)?'TLS_CERTIFICATE':/unexpected eof/.test(lower)?'UNEXPECTED_EOF':'CORE_NETWORK_ERROR';return out;}
module.exports={NetworkTrace,fields,errorFields,engineDetails};
