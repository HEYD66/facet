'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {safeStorage}=require('electron');
const {atomic}=require('./json-storage.cjs');
const {completionRequest}=require('./ai-request.cjs');
const {safeFetch}=require('./safe-http.cjs');
const taskPlan=require('./ai-task-plan.cjs');
const {Thread,images:validateImages}=require('./ai-memory.cjs');
const {ConversationStore}=require('./ai-conversation.cjs');
const projectTools=require('./ai-project-tools.cjs');
const {Sessions,normalizePermission,normalizeScope}=require('./ai-sessions.cjs');
const {removeLog}=require('./ai-dsh-store.cjs');
const management=require('./ai-management.cjs'),pageActions=require('./ai-page-actions.cjs'),browser=require('./ai-browser.cjs');
const REASONING_LEVELS=new Set(['','low','medium','high']);
function normalizeReasoning(value){const v=String(value??'').trim().toLowerCase();return REASONING_LEVELS.has(v)?v:'';}
const coreTools=[
 {type:'function',function:{name:'list_instances',description:'列出当前授权范围内的所有浏览器实例及其运行状态（running/stopped/error）与 ID。',parameters:{type:'object',properties:{},additionalProperties:false}}},
 {type:'function',function:{name:'show_instance',description:'将千面主界面切换到指定运行中实例的浏览页面；不刷新、不跳转、不读取正文。',parameters:{type:'object',properties:{instanceId:{type:'string',description:'目标实例 ID'}},required:['instanceId'],additionalProperties:false}}},
 {type:'function',function:{name:'start_instance',description:'启动指定实例（直连或按其已配置的代理节点）。',parameters:{type:'object',properties:{instanceId:{type:'string',description:'目标实例 ID'}},required:['instanceId'],additionalProperties:false}}},
 {type:'function',function:{name:'stop_instance',description:'停止指定运行中的实例（保留登录存储与配置）。',parameters:{type:'object',properties:{instanceId:{type:'string',description:'目标实例 ID'}},required:['instanceId'],additionalProperties:false}}},
 {type:'function',function:{name:'navigate',description:'在指定运行中实例的当前活跃网页标签打开 HTTP/HTTPS 网址。',parameters:{type:'object',properties:{instanceId:{type:'string',description:'目标实例 ID'},url:{type:'string',description:'目标 HTTP/HTTPS 网址'}},required:['instanceId','url'],additionalProperties:false}}},
 {type:'function',function:{name:'reload',description:'刷新指定运行中实例的当前活跃网页标签。',parameters:{type:'object',properties:{instanceId:{type:'string',description:'目标实例 ID'}},required:['instanceId'],additionalProperties:false}}},
 {type:'function',function:{name:'manage_tabs',description:'管理指定运行中实例内的多个网页标签：list 查看全部标签及 UUID；new 打开新标签（默认必应，空白页传 about:blank）；activate 切换活跃标签；close 关闭指定标签。',parameters:{type:'object',properties:{instanceId:{type:'string',description:'目标实例 ID'},action:{type:'string',enum:['list','new','activate','close'],description:'标签操作类型'},url:{type:'string',description:'action=new 时可选的初始网址'},tabId:{type:'string',description:'action=activate/close 时必填的标签 UUID'},active:{type:'boolean',description:'action=new 时是否立即切换到新标签，默认 true'}},required:['instanceId','action'],additionalProperties:false}}},
 // 旧网页工具仅保留执行兼容，不再暴露给模型。
 {type:'function',function:{name:'read_page',description:'读取指定实例可见文字及可操作元素（旧兼容入口）',parameters:{type:'object',properties:{instanceId:{type:'string'},frameId:{type:'string'}},required:['instanceId'],additionalProperties:false}}},
 {type:'function',function:{name:'click',description:'点击 CSS 选择器元素（旧兼容入口）',parameters:{type:'object',properties:{instanceId:{type:'string'},frameId:{type:'string'},selector:{type:'string'}},required:['instanceId','selector'],additionalProperties:false}}},
 {type:'function',function:{name:'fill',description:'填写输入框（旧兼容入口）',parameters:{type:'object',properties:{instanceId:{type:'string'},frameId:{type:'string'},selector:{type:'string'},text:{type:'string'}},required:['instanceId','selector','text'],additionalProperties:false}}}
];
const tools=[...coreTools,...projectTools.tools,...management.extraTools,pageActions.tool,...browser.tools,...taskPlan.tools];
const names=tools.map(t=>t.function.name);
// 旧网页工具与重叠的 page_action 保留为兼容执行入口，但不再提供给模型；模型统一使用 observe/act/dialog/manage_tabs/cdp_command。
const legacy=new Set(['read_page','click','fill','page_action']),modelTools=tools.filter(t=>!legacy.has(t.function.name));
function endpoint(value){if(!String(value||'').trim())throw Error('请先填写模型接口地址');let u;try{u=new URL(String(value));}catch{throw Error('模型接口地址格式无效');}if(u.username||u.password||u.search||u.hash||!(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('接口须为 HTTPS（本机接口允许 HTTP），不能含账号或查询参数');return u.href.replace(/\/$/,'').replace(/\/chat\/completions$/,'')+'/chat/completions';}
// 执行轮数上限：0 表示不限（默认）。不限时不自动按重复结果中止；用户可随时点击「停止」。
function rounds(value){const n=Number(value||0);return Number.isInteger(n)&&n>=0&&n<=1000?n:0;}
// Conservative context sizes (tokens) by model family, used when the provider sets none.
// An explicit "32k"-style suffix in the model ID wins; unknown models get 128K.
function defaultWindow(model){
 const m=String(model||'').toLowerCase(),k=m.match(/(?:^|[^a-z0-9])(\d{1,4})k(?:$|[^a-z0-9])/);
 if(k)return Math.max(4096,Number(k[1])*1024);
 if(/gemini|gpt-4\.1|deepseek-(?:v4|flash|pro)|qwen-long|minimax/.test(m))return 1000000;
 if(/gpt-5/.test(m))return 400000;
 if(/claude|kimi-k2|(?:^|[^a-z])o[34](?:-mini)?(?:$|[^a-z0-9])/.test(m))return 200000;
 return 128000;
}
function windowSetting(value){const n=Number(value||0);return Number.isInteger(n)&&n>=4096&&n<=10000000?n:0;}
function publicURL(value){try{const u=new URL(value);return u.origin+u.pathname;}catch{return '';}}
class AIAgent{
 constructor(controller){
  this.c=controller;this.file=path.join(controller.dir,'ai-settings.json');this.config={baseURL:'',model:'',secret:'',reasoningEffort:''};
  if(fs.existsSync(this.file)){try{this.config=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch{this.configError='AI 配置文件无法读取，请重新保存设置';}}
  this.config.reasoningEffort=normalizeReasoning(this.config.reasoningEffort);
  this.maxRounds=rounds(this.config.maxRounds);
  this.noUsage=new Set();this.noReasoning=new Set();
  this.dshDir=path.join(controller.dir,'ai-dsh');
  this.providers=(this.config.providers||[{id:'default',name:'默认提供商',...this.config}]).map(p=>({...p,reasoningEffort:normalizeReasoning(p.reasoningEffort)}));
  this.runtimes=new Map();
  this.conversation=new ConversationStore(controller.dir);
  this.sessions=new Sessions(this);
  this.restoreConversation();
 }
 currentRuntime(){return this.sessions.ensureRuntime(this.sessions.selectedId);}
 runtime(sessionId){return this.sessions.ensureRuntime(sessionId||this.sessions.selectedId);}
 get run(){return this.currentRuntime().run;}
 set run(value){this.currentRuntime().run=value;}
 get thread(){return this.currentRuntime().thread;}
 set thread(value){this.currentRuntime().thread=value;}
 get pending(){return this.currentRuntime().pending;}
 set pending(value){this.currentRuntime().pending=value;}
 get question(){return this.currentRuntime().question;}
 set question(value){this.currentRuntime().question=value;}
 get dsh(){return this.currentRuntime().dsh;}
 set dsh(value){this.currentRuntime().dsh=value;}
 get aiNetworkPages(){return this.currentRuntime().aiNetworkPages;}
 set aiNetworkPages(value){this.currentRuntime().aiNetworkPages=value;}
 get workPromise(){
  const active=[...this.runtimes.values()].map(rt=>rt.workPromise).filter(Boolean);
  if(!active.length)return null;
  return active.length===1?active[0]:Promise.allSettled(active);
 }
 set workPromise(value){this.currentRuntime().workPromise=value;}
 // 构造绑定到指定会话的轻量执行宿主，使多个会话可以完全并行、互不串台地运行 DSH 与全部工具。
 sessionHost(sessionId){
  const rt=this.runtime(sessionId),agent=this;
  return Object.create(agent,{
   sessionId:{value:rt.id,enumerable:true},
   run:{get(){return rt.run;},set(v){rt.run=v;},enumerable:true},
   thread:{get(){return rt.thread;},set(v){rt.thread=v;},enumerable:true},
   pending:{get(){return rt.pending;},set(v){rt.pending=v;},enumerable:true},
   question:{get(){return rt.question;},set(v){rt.question=v;},enumerable:true},
   dsh:{get(){return rt.dsh;},set(v){rt.dsh=v;},enumerable:true},
   workPromise:{get(){return rt.workPromise;},set(v){rt.workPromise=v;},enumerable:true},
   aiNetworkPages:{get(){return rt.aiNetworkPages;},set(v){rt.aiNetworkPages=v;},enumerable:true},
   config:{get(){return rt.run?.modelConfig||agent.config;},enumerable:true}
  });
 }
 restoreConversation(){
  const saved=this.conversation.load();if(!saved)return;
  try{this.sessions.restore(saved);}catch{this.conversation.failLoad();}
 }
 persist(){
  clearTimeout(this.saveTimer);this.saveTimer=null;
  const rows=this.sessions.capture();this.conversation.save(this.sessions.payload(rows));this.sessions.rows=rows;
 }
 persistQuietly(){try{this.persist();}catch{/* Error remains visible in ai-state; do not log conversation content. */}}
 schedulePersist(){if(!this.saveTimer)this.saveTimer=setTimeout(()=>{this.saveTimer=null;this.persistQuietly();},1500);this.saveTimer.unref();}
 // Context window of the selected model: the provider's explicit value, else the family default.
 contextWindow(cfg=this.config){return windowSetting(cfg.contextWindow)||defaultWindow(cfg.model);}
 settings(){return {baseURL:this.config.baseURL||'',model:this.config.model||'',hasKey:!!this.config.secret,vision:this.config.vision===true,reasoningEffort:normalizeReasoning(this.config.reasoningEffort),maxRounds:this.maxRounds,contextWindow:windowSetting(this.config.contextWindow),contextAuto:defaultWindow(this.config.model),error:this.configError||'',providerId:this.config.id||'default',providers:this.providers.map(p=>({id:p.id,name:p.name,baseURL:p.baseURL,model:p.model,models:p.models||[p.model].filter(Boolean),hasKey:!!p.secret,vision:p.vision===true,reasoningEffort:normalizeReasoning(p.reasoningEffort),contextWindow:windowSetting(p.contextWindow),contextAuto:defaultWindow(p.model)}))};}
 save(s){endpoint(s.baseURL);const model=String(s.model||'').trim();if(!model||model.length>200)throw Error('请填写模型名称');const previous=this.providers.find(p=>p.id===(s.providerId||this.config.id||'default'))||{};let secret=previous.secret||'';if(secret&&!s.key&&!s.clearKey&&endpoint(s.baseURL)!==endpoint(previous.baseURL))throw Error('更换接口地址时请重新填写密钥，或勾选清除密钥');if(s.clearKey)secret='';if(s.key){if(!safeStorage.isEncryptionAvailable())throw Error('系统加密不可用，无法保存密钥');secret=safeStorage.encryptString(String(s.key)).toString('base64');}if(!previous.id&&this.providers.length>=20)throw Error('最多保存 20 个提供商');let contextWindow=windowSetting(previous.contextWindow);if(s.contextWindow!==undefined&&s.contextWindow!==null){const raw=String(s.contextWindow).trim(),n=raw===''?0:Number(raw);if(!Number.isInteger(n)||n!==0&&!windowSetting(n))throw Error('上下文窗口须为 4096～10000000 的整数 tokens（留空或 0 表示自动）');contextWindow=n;}const reasoningEffort=s.reasoningEffort!==undefined?normalizeReasoning(s.reasoningEffort):normalizeReasoning(previous.reasoningEffort);const next={id:s.providerId||this.config.id||'default',name:String(s.name||previous.name||'自定义提供商').slice(0,80),baseURL:String(s.baseURL).trim(),model,secret,vision:s.vision===undefined?previous.vision===true:s.vision===true,...(reasoningEffort?{reasoningEffort}:{}),...(contextWindow?{contextWindow}:{}),models:[...new Set([model,...(Array.isArray(s.models)?s.models:previous.models||[])].filter(x=>typeof x==='string'&&x.length<=200))].slice(0,1000)};let maxRounds=this.maxRounds;if(s.maxRounds!==undefined&&s.maxRounds!==null&&s.maxRounds!==''){const n=Number(s.maxRounds);if(!Number.isInteger(n)||n<0||n>1000)throw Error('最多执行轮数须为 0～1000 的整数（0 或留空表示不限）');maxRounds=n;}else if(s.maxRounds==='')maxRounds=0;const providers=this.providers.filter(p=>p.id!==next.id).concat(next);atomic(this.file,{...next,providers,maxRounds},{backup:false});this.maxRounds=maxRounds;this.providers=providers;this.config=next;this.configError='';return this.settings();}
 select(providerId,model,reasoningEffort){const p=this.providers.find(p=>p.id===providerId);if(!p||!p.models?.includes(model)&&p.model!==model)throw Error('模型不存在');return this.save({...p,providerId,model,...(reasoningEffort!==undefined?{reasoningEffort}:{})});}
 setReasoning(effort){const v=normalizeReasoning(effort);if(String(effort??'').trim().toLowerCase()!==v)throw Error('推理强度无效');const current=this.providers.find(p=>p.id===(this.config.id||'default'));if(current?.baseURL&&current?.model)return this.save({...current,providerId:current.id,reasoningEffort:v});this.config={...this.config,reasoningEffort:v};return this.settings();}
 removeProvider(id){if(this.providers.length<2)throw Error('至少保留一个提供商');if(!this.providers.some(p=>p.id===id))throw Error('提供商不存在');const providers=this.providers.filter(p=>p.id!==id);const next=this.config.id===id?providers[0]:this.config;atomic(this.file,{...next,providers,maxRounds:this.maxRounds},{backup:false});this.providers=providers;this.config=next;return this.settings();}
 snapshot(){const v=this.sessions.view(),rt=v.rt,r=v.run;return {engine:{name:'DeepSeek Harness',version:require('./ai-dsh.cjs').VERSION},sessions:v.info,busy:v.info.runningIds.length>0,sessionBusy:!!r?.busy,settings:this.settings(),memory:{...v.thread.snapshot(),error:this.conversation.error,persistent:!this.conversation.error},task:r?{id:r.id,busy:r.busy,status:r.status,scope:r.scope,permission:normalizePermission(r.permission),entries:r.entries,plan:r.plan||null,planCurrent:!!r.plan&&r.planTaskId===r.id,retry:r.retry||null,queue:(r.queue||[]).map(({id,prompt,images,createdAt})=>({id,prompt,images:images.length,createdAt})),round:r.round||0,activity:r.activity||null,context:Number.isSafeInteger(r.context?.used)?{used:r.context.used,window:r.busy&&Number.isSafeInteger(r.context.window)?r.context.window:this.contextWindow(r.modelConfig||this.config),estimated:r.context.estimated===true}:null,usage:r.usage||null,question:rt.question?{id:rt.question.id,questions:rt.question.questions}:null,pending:rt.pending?{id:rt.pending.id,name:rt.pending.name,args:rt.pending.args,instanceName:rt.pending.instanceName}:null}:null};}
 // Optional tool presentation from ai-tool-display.cjs; only these bounded fields are kept.
 entry(kind,text,extra){const row={kind,text:String(text).slice(0,12000),at:new Date().toISOString()};if(extra&&typeof extra==='object'){if(typeof extra.ok==='boolean')row.ok=extra.ok;for(const key of ['args','result'])if(typeof extra[key]==='string'&&extra[key])row[key]=extra[key].slice(0,200);if(typeof extra.instanceId==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(extra.instanceId))row.instanceId=extra.instanceId;}this.run.entries.push(row);if(this.run.entries.length>100)this.run.entries.shift();}
 stopSession(sessionId){
  const rt=this.runtimes.get(sessionId);
  if(!rt?.run?.busy)return false;
  rt.run.status='正在停止';rt.run.abort.abort();rt.pending?.resolve(false);rt.pending=null;this.persistQuietly();
  return true;
 }
 stopAll(){for(const id of this.runtimes.keys())this.stopSession(id);}
 stop(sessionId){
  if(sessionId){this.stopSession(sessionId);return;}
  if(this.c.disposing){this.stopAll();return;}
  if(this.stopSession(this.sessions.selectedId))return;
  const running=this.sessions.runningIds();
  if(running.length===1)this.stopSession(running[0]);
 }
 // Clearing a conversation starts a new DSH session for it and deletes the old session log.
 clear(sessionId=this.sessions.selectedId){
  const rt=this.runtime(sessionId);
  if(rt.run?.busy)throw Error('请先停止任务');
  const old=rt.thread,fresh=new Thread();
  const rows=this.sessions.capture().map(row=>row.id===rt.id?{...row,dsh:fresh.export(),task:null}:row);
  this.conversation.save(this.sessions.payload(rows),{reset:true});
  rt.thread=fresh;rt.run=null;rt.pending=null;rt.question=null;
  this.sessions.rows=rows;clearTimeout(this.saveTimer);this.saveTimer=null;
  removeLog(this.dshDir,old.sessionId);
 }
 approve(id,allow,sessionId=this.sessions.selectedId){
  const rt=this.runtime(sessionId);
  if(!rt.pending||rt.pending.id!==id)throw Error('确认已失效');
  rt.pending.resolve(allow===true);rt.pending=null;
 }
 // Answer for DSH ask_user_question: one item per asked question, labels limited to the
 // offered options; "skip" tells the model the user declined to answer.
 answer(id,answers,skip,sessionId=this.sessions.selectedId){
  const rt=this.runtime(sessionId),q=rt.question;if(!q||q.id!==id)throw Error('提问已失效');
  const out=q.questions.map((item,i)=>{
   if(skip===true)return {id:item.id,selected:[],custom:'（用户暂不回答。请根据已有信息自行判断；确实无法继续时说明还缺少什么。）'};
   const a=Array.isArray(answers)?answers[i]:null,labels=new Set(item.options.map(o=>o.label));
   const selected=[...new Set((Array.isArray(a?.selected)?a.selected:[]).filter(x=>typeof x==='string'&&labels.has(x)))];
   const custom=typeof a?.custom==='string'?a.custom.trim().slice(0,2000):'';
   if(!item.multiSelect&&selected.length>1)throw Error('「'+item.question.slice(0,40)+'」只能选择一项');
   if(!selected.length&&!custom)throw Error('请回答：'+item.question.slice(0,60));
   return {id:item.id,selected,...(custom?{custom}:{})};
  });
  rt.question=null;q.resolve(out);
 }
 begin({prompt,images=[],ids,sharePage=true,allowGlobal=true,permission,sessionId,keepPlan=false},{fromQueue=false}={}){
  if(this.c.disposing)throw Error('应用正在退出');
  const sid=sessionId||this.sessions.selectedId,rt=this.runtime(sid);
  if(rt.run?.busy)throw Error('当前会话已有任务正在执行，请先停止或等待完成');
  if(this.configError)throw Error(this.configError);
  if(this.conversation.blocked)throw Error(this.conversation.error);
  endpoint(this.config.baseURL);if(!this.config.model)throw Error('请先配置模型');
  prompt=String(prompt||'').trim();images=validateImages(images);
  if((!prompt&&!images.length)||prompt.length>12000)throw Error('请输入任务（最多 12000 字）');
  const perm=permission!==undefined?permission:rt.permission||'full';
  if(!['read','confirm','full'].includes(perm))throw Error('权限模式无效');
  if(!Array.isArray(ids)||(!ids.length&&!allowGlobal&&perm!=='full')||ids.length>100)throw Error('请选择要授权的实例');
  const scope=[...new Set(ids)];scope.forEach(id=>this.c.store.get(id));
  const previous=rt.run;
  const modelConfig={...this.config};
  rt.permission=perm;
  rt.scope=scope.length===this.c.store.list().length?null:scope.slice();
  // 任务隔离：发起新一轮任务时默认清空上一轮旧计划，避免历史计划串台；仅显式 keepPlan 时继承。
  const inheritedPlan=keepPlan&&previous?.plan?structuredClone(previous.plan):null;
  rt.run={id:crypto.randomUUID(),busy:true,status:'正在思考',maxRounds:this.maxRounds,modelConfig,queue:previous?.queue?.slice()||[],plan:inheritedPlan,planTaskId:null,scope,permission:perm,allowGlobal:perm==='full'||allowGlobal===true,sharePage:sharePage===false?false:true,entries:previous?.entries?.slice(-80)||[],context:previous?.context||null,images,input:{prompt,images},partial:'',abort:new AbortController()};
  const host=this.sessionHost(sid);
  host.entry('user',prompt+(images.length?'\n[附图 '+images.length+' 张]':''));
  this.sessions.touch(prompt,sid);
  try{this.persist();}catch(e){rt.run=previous;throw e;}
  rt.workPromise=host.work(prompt).catch(()=>{});
  return {id:rt.run.id,sessionId:sid};
 }
 async confirm(name,args,instanceName){const r=this.run;r.abort.signal.throwIfAborted();if(r.permission==='read')throw Error('仅可查看模式不允许修改操作');if(r.permission==='full'){r.status='正在执行';return;}r.status='等待确认';const allowed=await new Promise(resolve=>{this.pending={id:crypto.randomUUID(),name,args,instanceName,resolve};});r.abort.signal.throwIfAborted();if(!allowed)throw Error('用户拒绝了此操作，不得绕过');r.status='正在执行';}
 async models(s={}){const provider=s.providerId?this.providers.find(p=>p.id===s.providerId):this.config;const base=s.baseURL||provider?.baseURL;const target=endpoint(base).replace(/chat\/completions$/,'models');let key=String(s.key||'');if(!key&&provider?.secret){if(endpoint(base)!==endpoint(provider.baseURL))throw Error('更换接口地址时请重新填写密钥');key=safeStorage.decryptString(Buffer.from(provider.secret,'base64'));}let response;try{response=await safeFetch(target,{headers:key?{Authorization:'Bearer '+key}:{},redirect:'error',signal:AbortSignal.timeout(30000)});}catch(error){throw Error(error.code==='ERR_UNSAFE_CONTENT_ENCODING'?error.message:'获取模型失败，请检查接口地址及网络');}if(!response.ok){await response.body?.cancel();throw Error('获取模型失败：HTTP '+response.status);}const reader=response.body.getReader(),parts=[];let bytes=0;try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2*1024*1024)throw Error('模型列表过大');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}let data;try{data=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw Error('模型列表格式无效');}if(!Array.isArray(data.data))throw Error('接口没有返回模型列表');return [...new Set(data.data.map(x=>x.id).filter(x=>typeof x==='string'&&x.length<=200))].sort();}
 async completion(messages,signal,onText,useTools=true,definitions=modelTools){
  const cfg=this.run?.modelConfig||this.config;
  let key='';if(cfg.secret){try{key=safeStorage.decryptString(Buffer.from(cfg.secret,'base64'));}catch{throw Error('密钥无法解密，请重新填写');}}
  const run=this.run,url=endpoint(cfg.baseURL),effort=normalizeReasoning(cfg.reasoningEffort),reasonKey=url+'|'+cfg.model;
  // Ask for streamed usage (DSH token-meter); a service that rejects usage or reasoning_effort downgrades once.
  const payload={model:cfg.model,messages:browser.pruneShots(messages),...(useTools?{tools:definitions,tool_choice:'auto'}:{}),stream:true,...(this.noUsage.has(url)?{}:{stream_options:{include_usage:true}}),...(effort&&!this.noReasoning.has(reasonKey)?{reasoning_effort:effort}:{})};
  try{return await completionRequest({url,headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{})},body:JSON.stringify(payload),signal,onText,onDowngrade:()=>this.noUsage.add(url),onDowngradeReasoning:()=>this.noReasoning.add(reasonKey),onRetry:info=>{
   if(!run?.busy||this.run!==run)return;run.retry=info;run.status=info.phase==='waiting'?'等待模型服务重试':'正在重试模型请求（'+info.attempt+'/'+info.maxAttempts+'）';
   if(info.phase==='waiting'){this.entry('system',info.reason+'，'+Math.ceil(info.waitMs/1000)+' 秒后重试模型请求（'+info.attempt+'/'+info.maxAttempts+'）。');this.schedulePersist();}
  }});}finally{if(run)run.retry=null;}
 }
 // One task = one followup on the conversation's long-lived DSH session.
 async work(prompt){const r=this.run,thread=this.thread;try{
  const result=await require('./ai-dsh.cjs').drive(this,tools,require('./ai-instructions.cjs')(this));
  if(result.haltReason){r.status=result.limit?'已达到 '+r.maxRounds+' 轮上限':'已停止：无进展';return;}
  r.status=r.planTaskId===r.id&&r.plan?.steps.some(s=>s.status!=='completed')?'已回复（计划未完成）':'已完成';
 }catch(e){
  const stopped=r.abort.signal.aborted;r.status=stopped?'已停止':'失败';this.entry('system',stopped?'任务已停止；已经执行的操作不会自动撤销。':e.message);
  if(stopped)thread.setNote('上一轮任务被用户停止（系统说明，不是新的用户授权）。已经执行的操作不会自动撤销；先核对当前状态，不要自动重复被停止的操作。');
  else{const answer='本次任务未完成：'+e.message+'\n已停止继续操作；已经执行的动作不会自动撤销。请核对工具记录，处理上述问题后再让我继续。';this.entry('assistant',answer);thread.setNote('上一轮任务失败（系统说明，不是新的用户授权）：'+String(e.message).slice(0,600)+'。已停止继续操作；先核对已执行动作与当前状态，不要自动重复执行。');}
 }finally{
  r.images=[];r.input=null;r.partial='';r.busy=false;this.pending=null;this.question=null;this.workPromise=null;this.persistQuietly();
  if(this.run===r&&r.status==='已完成'&&r.queue?.length&&!this.c.disposing){try{require('./ai-inbox.cjs').next(this,{ids:r.scope,permission:r.permission,sharePage:r.sharePage,allowGlobal:r.allowGlobal},true,this.sessionId);}catch(e){this.entry('system','待办已暂停：'+e.message);this.persistQuietly();}}
 }}

 instances(){return this.c.store.list().filter(x=>this.run.scope.includes(x.id)).map(x=>({id:x.id,name:x.name,status:this.c.runtimes.get(x.id)?.status||'stopped'}));}
 page(id){const r=this.c.runtimes.get(id);if(r?.status!=='running'||!r.view||r.view.webContents.isDestroyed())throw Error('实例网页未运行');const wc=r.view.webContents;if(!/^https?:\/\//i.test(wc.getURL()))throw Error('只支持 HTTP/HTTPS 网页');return wc;}
 frame(wc,id){const frame=id?wc.mainFrame.framesInSubtree.find(f=>f.processId+':'+f.routingId===id):wc.mainFrame;if(!frame||frame.isDestroyed())throw Error('框架不存在，请重新读取');return frame;}
 async tool(name,args){const r=this.run;r.abort.signal.throwIfAborted();if(!args||typeof args!=='object'||Array.isArray(args))throw Error('工具参数无效');if(taskPlan.names.includes(name))return taskPlan.execute(this,name,args);if(projectTools.tools.some(t=>t.function.name===name))return projectTools.execute(this,name,args);if(name==='list_instances')return this.instances();if(browser.names.includes(name))return browser.execute(this,name,args);if(name==='page_action')return pageActions.execute(this,args);if(name==='get_context')return management.context(this,args);if(name==='facet_action'){management.validate(this,args);await this.confirm(name,args,args.params.id?this.c.store.get(args.params.id).name:'全局管理');return management.execute(this,args);}const id=args.instanceId;if(!r.scope.includes(id))throw Error('实例不在本次授权范围');this.c.store.get(id);if(this.c.transfer.progress?.running&&this.c.transfer.progress.ids.includes(id))throw Error('实例正在导出');
 if(name==='manage_tabs'){
  if(!['list','new','activate','close'].includes(args.action))throw Error('标签操作无效');
  if(args.action==='list')return management.context(this,{topic:'tabs',instanceId:id});
  const map={new:'tab-new',activate:'tab-activate',close:'tab-close'},action=map[args.action];
  const params={id,...(args.url?{url:args.url}:{}),...(args.tabId?{tabId:args.tabId}:{}),...(args.active!==undefined?{active:args.active===true}:{})};
  await this.confirm('facet_action',{action,params},this.c.store.get(id).name);
  return management.execute(this,{action,params});
 }
 if(name==='show_instance'){
  const runtime=this.c.runtimes.get(id);if(runtime?.status!=='running'||!runtime.view||runtime.view.webContents.isDestroyed())throw Error('实例未运行，请先启动再切换');
  await this.confirm(name,args,this.c.store.get(id).name);
  const w=this.c.window;if(!w||w.isDestroyed())throw Error('控制窗口不可用');w.webContents.send('core:external-focus',{id});
  for(let i=0;i<60;i++){r.abort.signal.throwIfAborted();const ui=await w.webContents.executeJavaScript("({view,activeId})");if(ui.view==='browser'&&ui.activeId===id&&this.c.activeId===id&&runtime.view.getVisible())return {shown:true,instanceId:id,view:'browser',note:'已切换显示原网页，未刷新或跳转'};await new Promise(resolve=>setTimeout(resolve,50));}
  throw Error('切换未完成，可能有未保存配置或界面确认待处理');
 }
 if(name==='read_page'){if(!r.sharePage)throw Error('用户未允许发送网页内容');const wc=this.page(id),target=this.frame(wc,args.frameId);const data=await target.executeJavaScript(`(()=>{const out=[],walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node,total=0;while((node=walker.nextNode())&&total<12000){const p=node.parentElement;if(!p||p.closest('script,style,noscript,textarea,input,[contenteditable]')||!p.getClientRects().length)continue;const t=node.textContent.trim();if(t){out.push(t);total+=t.length;}}const elements=[...document.querySelectorAll('a,button,input:not([type="password"]),textarea,select,[contenteditable="true"]')].filter(e=>e.getClientRects().length&&!e.disabled).slice(0,80).map(e=>{const parts=[];let n=e;while(n&&n!==document.body){const tag=n.tagName.toLowerCase();const siblings=[...n.parentElement.children].filter(x=>x.tagName===n.tagName);parts.unshift(tag+':nth-of-type('+(siblings.indexOf(n)+1)+')');n=n.parentElement;}return {selector:'body>'+parts.join('>'),tag:e.tagName,label:(e.getAttribute('aria-label')||e.innerText||e.getAttribute('placeholder')||'').slice(0,100)};});return {text:out.join('\\n').slice(0,12000),elements};})()`);return {untrusted:true,url:publicURL(target.url),...data};}
 if(!names.includes(name))throw Error('工具不受支持');let wc,oldURL,target,targetURL;if(['click','fill','reload'].includes(name)){wc=this.page(id);oldURL=wc.getURL();target=this.frame(wc,args.frameId);targetURL=target.url;}if(['click','fill'].includes(name)){if(typeof args.selector!=='string'||args.selector.length>1500)throw Error('选择器无效');if(name==='fill'&&(typeof args.text!=='string'||args.text.length>8000))throw Error('输入文字无效');}if(name==='navigate'){const u=new URL(args.url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('只允许不含凭据的 HTTP/HTTPS 地址');}
 await this.confirm(name,args,this.c.store.get(id).name);if(wc&&(wc.isDestroyed()||this.page(id)!==wc||wc.getURL()!==oldURL||target.isDestroyed()||target.url!==targetURL))throw Error('页面已变化，请重新读取并确认');
 if(name==='start_instance'){await this.c.start(id);return this.instances().find(x=>x.id===id);}if(name==='stop_instance'){await this.c.stop(id);return this.instances().find(x=>x.id===id);}if(name==='navigate'){await this.c.navigate(id,args.url);return {requested:true,url:publicURL(this.page(id).getURL()),note:'需读取页面验证加载结果'};}if(name==='reload'){await this.c.action(id,'reload');return {requested:true,note:'需读取页面验证加载结果'};}
 return target.executeJavaScript(`(()=>{const e=document.querySelector(${JSON.stringify(args.selector)});if(!e||!e.getClientRects().length||e.disabled)throw Error('元素不存在或不可操作');if(e.type==='file'&&${JSON.stringify(name)}==='fill')throw Error('文件输入请用 upload_file');if(${JSON.stringify(name)}==='fill'){e.focus();if(e.isContentEditable){const range=document.createRange();range.selectNodeContents(e);const sel=getSelection();sel.removeAllRanges();sel.addRange(range);if(!document.execCommand('insertText',false,${JSON.stringify(args.text||'')})){e.textContent=${JSON.stringify(args.text||'')};e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));}return {filled:true};}if(!['INPUT','TEXTAREA'].includes(e.tagName)||e.readOnly)throw Error('请选择可编辑文本框');const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(args.text||'')});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return {filled:true};}e.click();return {clicked:true,note:'点击已触发，需要读取页面确认业务结果'};})()`);
 }
}
module.exports={AIAgent,endpoint,normalizeReasoning};
