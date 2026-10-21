'use strict';
// 资源占用：Electron 全部进程（界面、GPU、各实例网页、扩展/工具进程）的 CPU 与内存，加上本应用启动的各 Mihomo 内核内存；
// Windows 上另读千面自己进程的显卡利用率。同时按实例拆分（网页、弹窗、扩展页面所在进程 + 该实例的 Mihomo 内核）。
// CPU 为 Electron 进程按总核数折算；Windows 内存统一用私有提交量，代理/保护/采样进程每 5 秒采样。
const {app,webContents}=require('electron'),os=require('node:os'),{execFile,spawn}=require('node:child_process');
const CORE_SAMPLE_MS=5000,GPU_IDLE_MS=8000,GPU_INTERVAL_S='2';
const cores={at:0,kb:new Map(),pending:null};
const csv=line=>[...String(line).matchAll(/"([^"]*)"/g)].map(m=>m[1]);
// tasklist /FO CSV /NH 输出："mihomo.exe","1234","Console","1","35,512 K"（千分位随系统区域变化，只取数字）。
function parseTasklist(text){const out=new Map();for(const line of String(text||'').split(/\r?\n/)){const cols=csv(line);if(cols.length<5)continue;const pid=Number(cols[1]),digits=cols[4].replace(/\D/g,'');if(pid>0&&digits!=='')out.set(pid,Number(digits));}return out;}
// ps -o pid=,rss= 输出：每行 "pid rss(KB)"。
function parsePs(text){const out=new Map();for(const line of String(text||'').split(/\r?\n/)){const m=line.trim().match(/^(\d+)\s+(\d+)$/);if(m)out.set(Number(m[1]),Number(m[2]));}return out;}
function sampleCores(pids){
 if(cores.pending)return cores.pending;
 cores.pending=new Promise(resolve=>{
  const done=(error,stdout)=>{cores.pending=null;cores.at=Date.now();cores.kb=error?new Map():parsePs(stdout);resolve();};
  try{if(process.platform==='win32'){const ids=pids.filter(pid=>Number.isSafeInteger(pid)&&pid>0).join(',');const script=require('node:fs').readFileSync(require('node:path').join(__dirname,'process-memory.ps1'),'utf8');const command=Buffer.from("& {\n"+script+"\n} -ProcessIds '"+ids+"'",'utf16le').toString('base64');execFile('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',command],{windowsHide:true,timeout:4000},done);}else execFile('ps',['-o','pid=,rss=','-p',pids.join(',')],{timeout:4000},done);}catch(e){done(e,'');}
 });
 return cores.pending;
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
const cpuPrev=new Map();
function cpuShares(list,n){const now=process.hrtime.bigint(),next=new Map(),out=new Map();for(const p of list){const cum=Number(p.cpu?.cumulativeCPUUsage);let v=0;if(Number.isFinite(cum)){const prev=cpuPrev.get(p.pid),dt=prev?Number(now-prev.at)/1e9:0;if(prev&&dt>0.2&&cum>=prev.cum)v=(cum-prev.cum)/dt*100/n;next.set(p.pid,{cum,at:now});}else v=(Number(p.cpu?.percentCPUUsage)||0)/(process.platform==='win32'?1:n);out.set(p.pid,Math.max(0,v));}cpuPrev.clear();for(const [k,v] of next)cpuPrev.set(k,v);return out;}
const memKb=p=>Number(p.memory?.privateBytes||p.memory?.workingSetSize)||0;
async function appMetrics(controller){
 const list=app.getAppMetrics(),n=Math.max(1,os.cpus().length),byPid=new Map(list.map(p=>[p.pid,p])),share=cpuShares(list,n);let cpu=0,kb=0;
 for(const p of list){cpu+=share.get(p.pid)||0;kb+=memKb(p);}
 const running=[...(controller?.runtimes?.entries()||[])];
 const proxyCores=[...running.map(([,r])=>r.core),...[...(controller?.proxyPool?.groups||[])].map(group=>group.core)].filter(Boolean);
 const corePids=[...new Set(proxyCores.map(core=>core.pid).filter(pid=>pid>0))];
 const hostPids=[...new Set(proxyCores.map(core=>core.child?.pid).filter(pid=>pid>0&&!corePids.includes(pid)))];
 const gpuValue=gpuSample(list),samplerPid=gpu.proc?.pid;
 const pids=[...new Set([...corePids,...hostPids,...(samplerPid?[samplerPid]:[])])].filter(pid=>!byPid.has(pid));
 if(pids.length&&(Date.now()-cores.at>CORE_SAMPLE_MS||pids.some(pid=>!cores.kb.has(pid))))await sampleCores(pids);
 const external=pids.reduce((sum,pid)=>sum+(cores.kb.get(pid)||0),0);
 const sumPids=ids=>ids.reduce((sum,pid)=>sum+(byPid.has(pid)?memKb(byPid.get(pid)):cores.kb.get(pid)||0),0)/1024;
 const coreMB=sumPids(corePids),hostMB=sumPids(hostPids),samplerMB=samplerPid?sumPids([samplerPid]):0;
 const breakdown={mainMB:0,rendererMB:0,gpuMB:0,utilityMB:0,coreMB,hostMB,samplerMB};
 for(const p of list){const key=p.type==='Browser'?'mainMB':p.type==='Tab'?'rendererMB':p.type==='GPU'?'gpuMB':'utilityMB';breakdown[key]+=memKb(p)/1024;}
 const instances={},owners=new Map();for(const [,r]of running)if(r.status==='running'&&r.core?.pid)owners.set(r.core.pid,(owners.get(r.core.pid)||0)+1);
 for(const [id,r] of running){if(r.status!=='running'||!r.view)continue;let icpu=0,ikb=0,count=0;for(const pid of instancePids(r)){const p=byPid.get(pid);if(!p)continue;icpu+=share.get(pid)||0;ikb+=memKb(p);count++;}const own=[...new Set([r.core?.pid,r.core?.child?.pid].filter(pid=>pid>0))],divisor=owners.get(r.core?.pid)||1,core=r.core?.pid?sumPids([r.core.pid])/divisor:0,host=own.filter(pid=>pid!==r.core?.pid);instances[id]={cpu:Math.max(0,Math.min(100,icpu)),memoryMB:ikb/1024+sumPids(own)/divisor,coreMB:core,hostMB:sumPids(host)/divisor,sharedCoreUsers:divisor,processes:count};}
 return {cpu:Math.max(0,Math.min(100,cpu)),gpu:gpuValue,memoryMB:(kb+external)/1024,coreMB,hostMB,breakdown,memoryKind:process.platform==='win32'?'private-commit':'working-set',memoryComplete:pids.every(pid=>cores.kb.has(pid)),memorySampleAt:cores.at,processes:list.length,cores:corePids.length,totalProcesses:list.length+pids.length,instances};
}
module.exports={appMetrics,parseTasklist,parsePs,parseGpuHeader,gpuUsage};
