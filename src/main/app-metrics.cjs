'use strict';
// 资源占用：Electron 全部进程及本应用启动的 Mihomo、进程保护、GPU 采样进程的 CPU 与内存；
// Windows 上另读千面自己进程的显卡利用率。同时按实例拆分（网页、弹窗、扩展页面所在进程 + 该实例的 Mihomo 内核）。
// CPU 按总核数折算；Windows 内存统一用私有提交量，代理/保护/采样进程每 5 秒采样。
const {app,webContents}=require('electron'),os=require('node:os'),{execFile,spawn}=require('node:child_process');
const {parseProcessSamples,CpuTracker}=require('./process-metrics.cjs');
const CORE_SAMPLE_MS=5000,GPU_IDLE_MS=8000,GPU_INTERVAL_S='2';
const cores={sample:{at:0,key:'',kb:new Map(),cpu:new Map(),ready:new Set()},tracker:new CpuTracker(),pending:null};
const csv=line=>[...String(line).matchAll(/"([^"]*)"/g)].map(m=>m[1]);
// tasklist /FO CSV /NH 输出："mihomo.exe","1234","Console","1","35,512 K"（千分位随系统区域变化，只取数字）。
function parseTasklist(text){const out=new Map();for(const line of String(text||'').split(/\r?\n/)){const cols=csv(line);if(cols.length<5)continue;const pid=Number(cols[1]),digits=cols[4].replace(/\D/g,'');if(pid>0&&digits!=='')out.set(pid,Number(digits));}return out;}
// ps -o pid=,rss= 输出：每行 "pid rss(KB)"。
function parsePs(text){const out=new Map();for(const line of String(text||'').split(/\r?\n/)){const m=line.trim().match(/^(\d+)\s+(\d+)$/);if(m)out.set(Number(m[1]),Number(m[2]));}return out;}
async function sampleCores(pids,n){
 const key=[...pids].sort((a,b)=>a-b).join(',');
 if(cores.pending){const sampled=await cores.pending.promise;return sampled.key===key?sampled:sampleCores(pids,n);}
 if(cores.sample.key===key&&Date.now()-cores.sample.at<CORE_SAMPLE_MS)return cores.sample;
 if(!pids.length){cores.tracker.update([],n);return cores.sample={at:Date.now(),key,kb:new Map(),cpu:new Map(),ready:new Set()};}
 const pending={promise:null};cores.pending=pending;
 pending.promise=new Promise(resolve=>{
  const done=(error,stdout)=>{
   const sampled={at:Date.now(),key,kb:new Map(),cpu:new Map(),ready:new Set()};
   if(process.platform==='win32'){
    const samples=error?new Map():parseProcessSamples(stdout);
    sampled.kb=new Map([...samples].map(([pid,s])=>[pid,s.memoryKB]));
    const rates=cores.tracker.update(samples.values(),n);sampled.cpu=rates.cpu;sampled.ready=rates.ready;
   }else sampled.kb=error?new Map():parsePs(stdout);
   cores.sample=sampled;cores.pending=null;resolve(sampled);
  };
  try{if(process.platform==='win32'){const ids=pids.filter(pid=>Number.isSafeInteger(pid)&&pid>0).join(',');const script=require('node:fs').readFileSync(require('node:path').join(__dirname,'process-memory.ps1'),'utf8');const command=Buffer.from("& {\n"+script+"\n} -ProcessIds '"+ids+"'",'utf16le').toString('base64');execFile('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',command],{windowsHide:true,timeout:4000},done);}else execFile('ps',['-o','pid=,rss=','-p',pids.join(',')],{timeout:4000},done);}catch(e){done(e,'');}
 });
 return pending.promise;
}
// 显卡：常驻一个 typeperf 读“GPU Engine 利用率”计数器（每 2 秒一行），只累加千面自己的进程；
// 同一引擎上各进程相加，取最忙的引擎——与任务管理器“GPU”列口径一致。8 秒没人看就关掉采样进程。
const gpu={proc:null,cols:null,buf:'',value:null,at:0,seen:new Set(),pids:new Set(),lastUse:0,startedAt:0,timer:null};
function parseGpuHeader(cols){return cols.slice(1).map(name=>{const m=String(name).match(/pid_(\d+)_.*?phys_(\d+)_eng_(\d+)/i);return m?{pid:Number(m[1]),engine:m[2]+':'+m[3]}:null;});}
function gpuUsage(header,values,pids){const per=new Map();header.forEach((c,i)=>{if(!c||!pids.has(c.pid))return;const v=parseFloat(String(values[i]).replace(',','.'));if(Number.isFinite(v)&&v>0)per.set(c.engine,(per.get(c.engine)||0)+v);});return Math.min(100,Math.max(0,...per.values()));}
function gpuLine(line){if(!line.startsWith('"'))return;const cols=csv(line);if(!gpu.cols){if(/PDH-CSV/i.test(cols[0]||'')){gpu.cols=parseGpuHeader(cols);gpu.seen=new Set(gpu.cols.filter(Boolean).map(c=>c.pid));}return;}gpu.value=gpuUsage(gpu.cols,cols.slice(1),gpu.pids);gpu.at=Date.now();}
function gpuStop(){clearInterval(gpu.timer);gpu.timer=null;const p=gpu.proc;gpu.proc=null;gpu.cols=null;gpu.buf='';gpu.value=null;try{p?.kill();}catch{}}
function gpuStart(){
 if(gpu.proc||process.platform!=='win32')return;
 gpu.startedAt=Date.now();gpu.cols=null;gpu.buf='';gpu.value=null;
 let p;try{p=spawn('typeperf',['\\GPU Engine(*)\\Utilization Percentage','-si',GPU_INTERVAL_S],{windowsHide:true,stdio:['ignore','pipe','ignore']});}catch{return;}
 gpu.proc=p;p.stdout.setEncoding('utf8');
 p.stdout.on('data',d=>{if(gpu.proc!==p)return;gpu.buf+=d;let i;while((i=gpu.buf.indexOf('\n'))>=0){const line=gpu.buf.slice(0,i).trim();gpu.buf=gpu.buf.slice(i+1);if(line)gpuLine(line);}if(gpu.buf.length>1e6)gpu.buf='';});
 p.on('error',()=>{if(gpu.proc===p)gpu.proc=null;});p.on('exit',()=>{if(gpu.proc===p){gpu.proc=null;gpu.cols=null;}});
 gpu.timer=setInterval(()=>{if(Date.now()-gpu.lastUse>GPU_IDLE_MS)gpuStop();},2000);gpu.timer.unref?.();
}
function gpuSample(list){
 if(process.platform!=='win32')return undefined;
 gpu.lastUse=Date.now();gpu.pids=new Set(list.map(p=>p.pid));
 // 计数器实例在 typeperf 启动时就固定了；GPU 进程重启（新 pid）后需要重开一次采样。
 const gpuPid=list.find(p=>p.type==='GPU')?.pid;if(gpu.proc&&gpu.cols&&gpuPid&&!gpu.seen.has(gpuPid)&&Date.now()-gpu.startedAt>20000)gpuStop();
 gpuStart();return gpu.value!=null&&Date.now()-gpu.at<10000?gpu.value:null;
}
app.on?.('will-quit',gpuStop);process.on('exit',gpuStop);
// 一个实例的进程：同一会话里所有网页（含弹窗、扩展页面）的主进程和跨站子框架进程。
function instancePids(r){const out=new Set();const ses=r.view?.webContents?.session;if(!ses)return out;for(const w of webContents.getAllWebContents()){try{if(w.isDestroyed()||w.session!==ses)continue;const pid=w.getOSProcessId();if(pid>0)out.add(pid);for(const f of w.mainFrame?.framesInSubtree||[])if(f.osProcessId>0)out.add(f.osProcessId);}catch{}}return out;}
// CPU：用每个进程的累计 CPU 时间（秒）在两次采样间的增量 ÷ 经过的时间 ÷ 核数，与任务管理器口径一致。
// 不用 percentCPUUsage：它在 Windows 上已经按总核数折算过，其他平台却是按单核计，口径不统一（之前再除一次核数导致一直显示 0）。
const electronCpu=new CpuTracker();
function cpuShares(list,n){const sampledAt=Number(process.hrtime.bigint())/1e9;return electronCpu.update(list.map(p=>({pid:p.pid,cpuSeconds:p.cpu?.cumulativeCPUUsage,sampledAt,creationTime:p.creationTime})),n);}
const memoryValue=p=>p?.memory?.[process.platform==='win32'?'privateBytes':'workingSetSize'];
const hasMemory=p=>Number.isFinite(memoryValue(p))&&memoryValue(p)>=0;
const memKb=p=>hasMemory(p)?memoryValue(p):0;
async function appMetrics(controller){
 const list=app.getAppMetrics(),n=Math.max(1,os.cpus().length),byPid=new Map(list.map(p=>[p.pid,p])),rates=cpuShares(list,n),share=rates.cpu;let cpu=0,kb=0;
 for(const p of list){cpu+=share.get(p.pid)||0;kb+=memKb(p);}
 const running=[...(controller?.runtimes?.entries()||[])];
 const proxyCores=[...running.map(([,r])=>r.core),...[...(controller?.proxyPool?.groups||[])].map(group=>group.core)].filter(Boolean);
 const corePids=[...new Set(proxyCores.map(core=>core.pid).filter(pid=>pid>0))];
 const hostPids=[...new Set(proxyCores.map(core=>core.child?.pid).filter(pid=>pid>0&&!corePids.includes(pid)))];
 const gpuValue=gpuSample(list),samplerPid=gpu.proc?.pid;
 const pids=[...new Set([...corePids,...hostPids,...(samplerPid?[samplerPid]:[])])].filter(pid=>!byPid.has(pid));
 const sampled=await sampleCores(pids,n),externalKB=sampled.kb,externalCPU=sampled.cpu,externalReady=sampled.ready;
 const external=pids.reduce((sum,pid)=>sum+(externalKB.get(pid)||0),0);
 const sumPids=ids=>ids.reduce((sum,pid)=>sum+(byPid.has(pid)?memKb(byPid.get(pid)):externalKB.get(pid)||0),0)/1024;
 const pidCpu=pid=>byPid.has(pid)?share.get(pid)||0:externalCPU.get(pid)||0;
 const sumCpu=ids=>ids.reduce((sum,pid)=>sum+pidCpu(pid),0);
 const cpuReady=pid=>byPid.has(pid)?rates.ready.has(pid):externalReady.has(pid);
 const memoryReady=pid=>byPid.has(pid)?hasMemory(byPid.get(pid)):externalKB.has(pid);
 const cpuBreakdown={electron:cpu,core:sumCpu(corePids.filter(pid=>!byPid.has(pid))),host:sumCpu(hostPids.filter(pid=>!byPid.has(pid))),sampler:samplerPid&&!byPid.has(samplerPid)?pidCpu(samplerPid):0};
 cpu+=sumCpu(pids);
 const coreMB=sumPids(corePids),hostMB=sumPids(hostPids),samplerMB=samplerPid?sumPids([samplerPid]):0;
 const breakdown={mainMB:0,rendererMB:0,gpuMB:0,utilityMB:0,coreMB,hostMB,samplerMB};
 for(const p of list){const key=p.type==='Browser'?'mainMB':p.type==='Tab'?'rendererMB':p.type==='GPU'?'gpuMB':'utilityMB';breakdown[key]+=memKb(p)/1024;}
 const instances={},owners=new Map(),memoryKind=process.platform==='win32'?'private-commit':'working-set';
 const ownPids=r=>[...new Set([r.core?.pid,r.core?.child?.pid].filter(pid=>pid>0))];
 for(const [,r]of running)if(r.status==='running')for(const pid of ownPids(r))owners.set(pid,(owners.get(pid)||0)+1);
 for(const [id,r] of running){
  if(r.status!=='running'||!r.view)continue;
  let icpu=0,ikb=0,count=0,complete=true;const pages=instancePids(r),own=ownPids(r).filter(pid=>!pages.has(pid));
  for(const pid of pages){const p=byPid.get(pid);if(!p){complete=false;continue;}icpu+=share.get(pid)||0;ikb+=memKb(p);count++;}
  const allocated=(ids,read)=>ids.reduce((sum,pid)=>sum+read(pid)/(owners.get(pid)||1),0);
  instances[id]={cpu:Math.max(0,Math.min(100,icpu+allocated(own,pidCpu))),memoryMB:ikb/1024+allocated(own,pid=>sumPids([pid])),coreMB:allocated(own.filter(pid=>pid===r.core?.pid),pid=>sumPids([pid])),hostMB:allocated(own.filter(pid=>pid!==r.core?.pid),pid=>sumPids([pid])),sharedCoreUsers:owners.get(r.core?.pid)||1,processes:count,memoryKind,memoryComplete:complete&&[...pages,...own].every(memoryReady),cpuComplete:complete&&[...pages,...own].every(cpuReady)};
 }
 return {cpu:Math.max(0,Math.min(100,cpu)),cpuBreakdown,cpuComplete:list.every(p=>rates.ready.has(p.pid))&&pids.every(cpuReady),cpuExternalSampleAt:sampled.at,gpu:gpuValue,memoryMB:(kb+external)/1024,coreMB,hostMB,breakdown,memoryKind,memoryComplete:list.every(hasMemory)&&pids.every(memoryReady),memorySampleAt:sampled.at,processes:list.length,cores:corePids.length,totalProcesses:list.length+pids.length,instances};
}
module.exports={appMetrics,parseTasklist,parsePs,parseGpuHeader,gpuUsage};
