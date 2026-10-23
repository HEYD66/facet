'use strict';
(()=>{
 const panel=document.getElementById('aiPanel'),toggle=document.getElementById('aiToggle');let timer=null,polling=false,last='',scopeKey='',submitting=false,attachments=[],providers=[],editingProvider='default',modelCatalog=[],sessionId='',sessionKey='',sessionChanging=false,sessionRows=[],editingSession=null;const drafts=new Map();let planKey='',queueKey='',currentState=null;
 // Header actions are icon buttons (DSH style) so the title and engine version keep their room.
 const ownPaths={history:'M3.5 12a8.5 8.5 0 1 0 2.5-6 M3.5 4v4.5H8 M12 7.5V12l3 2'};
 const glyph=n=>ownPaths[n]?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+ownPaths[n]+'"></path></svg>':typeof icon==='function'?icon(n):({edit:'＋',settings:'⚙',close:'×',up:'↓'})[n]||'';
 panel.innerHTML=`<header><div class="ai-title"><strong>千面 AI 助手</strong><span id="aiEngine" class="ai-engine"></span></div><button class="icon-btn ai-head-btn" id="aiClear" title="新任务（旧会话保留在「会话记录」里）" aria-label="新任务">${glyph('edit')}</button><button class="icon-btn ai-head-btn" id="aiSessionsButton" aria-expanded="false" title="会话记录" aria-label="会话记录">${glyph('history')}</button><button class="icon-btn ai-head-btn" id="aiSettingsButton" aria-expanded="false" title="模型与提供商设置" aria-label="设置">${glyph('settings')}</button><button class="icon-btn ai-head-btn" id="aiClose" title="收起 AI 助手" aria-label="收起 AI 助手">${glyph('close')}</button></header><section class="ai-settings" id="aiSettings" hidden><h3>模型与提供商</h3><div id="aiProviders"></div><button class="btn tiny" id="aiAddProvider">＋ 添加提供商</button><div class="ai-provider-editor"><h4 id="aiEditorTitle" class="ai-editor-title"></h4><label>显示名称<input id="aiProviderName" placeholder="提供商名称"></label><div id="aiSettingsError" class="ai-error" role="alert"></div><label>接口基础地址<input id="aiBaseURL" placeholder="https://服务地址/v1" autocomplete="off"></label><label>模型名称<input id="aiModel" list="aiModels" placeholder="获取列表后选择，也可手填模型 ID" autocomplete="off"><datalist id="aiModels"></datalist><select id="aiModelList" hidden aria-label="选择获取到的模型"></select><button class="btn tiny" id="aiFetchModels" type="button">一键获取模型</button><span id="aiModelsStatus"></span></label><label>API 密钥<input id="aiKey" type="password" placeholder="留空保留已保存密钥" autocomplete="off"></label><label><input id="aiClearKey" type="checkbox"> 清除已保存密钥</label><label><input id="aiVision" type="checkbox"> 模型支持图片（允许 AI 观察网页时附带截图）</label><label>上下文窗口（tokens）<input id="aiContextWindow" type="number" min="0" max="10000000" step="1024" placeholder="自动" autocomplete="off"></label><p class="ai-hint">留空表示按模型自动估计，用于显示上下文占用；接近上限时自动整理较早内容。</p><label>最多执行轮数<input id="aiMaxRounds" type="number" min="0" max="1000" step="1" placeholder="不限" autocomplete="off"></label><p class="ai-hint">留空或 0 表示不限（对所有提供商生效）。不会因重复读取或重试自动中止，可随时点「停止」。</p><p class="ai-hint">支持 Chat Completions 工具调用。模型请求使用应用本机网络，不跟随实例代理。密钥在本机加密保存。</p><span id="aiConfigStatus"></span><button class="btn tiny primary" id="aiSave">保存设置</button><button class="btn tiny" id="aiSettingsDone">返回对话</button></div></section><section id="aiSessions" class="ai-sessions" hidden><h3>会话记录</h3><div id="aiSessionError" class="ai-error" role="alert"></div><p class="ai-hint">新任务保留旧会话；切换查看不会中断执行。</p><div id="aiSessionEditor" hidden></div><div id="aiSessionList"></div></section><div id="aiActivity" class="ai-activity" hidden></div><details id="aiPlan" class="ai-plan" hidden open></details><div class="ai-history-wrap"><div id="aiHistory" class="ai-history"></div><button id="aiLatest" class="ai-latest" hidden title="回到最新消息" aria-label="回到最新消息">${glyph('up')}</button></div><div id="aiQueue" class="ai-queue" hidden></div><div id="aiApproval" class="ai-approval" hidden></div><div id="aiQuestion" class="ai-question" role="region" aria-label="AI 提问" hidden></div><div class="ai-compose"><div class="ai-context"><select id="aiScope" aria-label="操作范围"></select><button id="aiModelBadge" class="btn tiny" title="选择模型">未配置模型</button><span id="aiContextMeter" class="ai-meter" role="meter" aria-valuemin="0" aria-valuemax="100" hidden><svg viewBox="0 0 20 20" aria-hidden="true"><circle class="ai-meter-track" cx="10" cy="10" r="8"></circle><circle class="ai-meter-value" cx="10" cy="10" r="8"></circle></svg><span></span></span><span id="aiSendOptions" class="ai-send-options" hidden><select id="aiSendMode" aria-label="执行中发送方式" title="接着做：当前任务成功结束后依次执行；立即补充：在下一步提供给正在执行的任务"><option value="queue">接着做</option><option value="steer">立即补充</option></select></span></div><div id="aiModelPicker" hidden><input id="aiModelSearch" placeholder="搜索模型…"><div id="aiModelChoices"></div></div><div id="aiAttachments"></div><input id="aiImageInput" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden><textarea id="aiPrompt" placeholder="发送消息…" aria-label="AI 任务"></textarea><div id="aiError" class="ai-error" role="alert"></div><div class="ai-actions"><button class="btn tiny" id="aiAttach" title="添加图片">＋</button><select id="aiPermission" aria-label="操作权限"><option value="read">仅可查看</option><option value="confirm" selected>逐项确认</option><option value="full">完全权限</option></select><span id="aiMemory" title="每个会话独立保存记忆，重启后保留；新任务不会删除历史"></span><span id="aiStatus" class="ai-status">待命</span><button class="btn tiny" id="aiContinue" hidden>继续处理</button><button class="btn tiny" id="aiRunning" hidden>返回运行会话</button><button class="btn tiny" id="aiStop" disabled>停止</button><button class="btn primary tiny" id="aiSend" aria-label="发送" title="发送">↑</button></div></div>`;
 // Conversation layout follows DSH's chat: messages, with consecutive tool calls grouped into one
 // collapsible step list. Nodes are reconciled by entry identity instead of rebuilding the history,
 // so expanded steps, text selection and scroll position survive streaming updates. Assistant
 // Markdown is parsed in the main process with DSH's parser (ai-markdown.cjs) and drawn by ai-markdown.js.
 const mdCache=new Map(),historyByKey=new Map(),copyText=new Map();let mdPending=new Set(),mdBusy=false,historyEntries=[],historyOpts={},historySession='',emptyKey='';
 const node=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;};
 function entryKeys(entries){const seen=new Map();return entries.map(e=>{const base=(e.at||'')+'|'+e.kind,n=seen.get(base)||0;seen.set(base,n+1);return base+'|'+n;});}
 function historyItems(entries){const keys=entryKeys(entries),out=[];entries.forEach((e,i)=>{if(e.kind==='tool'){const last=out.at(-1);if(last?.kind==='tools'){last.entries.push(e);last.keys.push(keys[i]);}else out.push({kind:'tools',key:keys[i],entries:[e],keys:[keys[i]]});return;}out.push({kind:e.kind,key:keys[i],entry:e});});return out;}
 function toolParts(e){const m=/^([a-z_]+)：([\s\S]*)$/i.exec(e.text);return {name:m?.[1]||'',raw:m?m[2]:e.text};}
 function prettyResult(raw){try{return JSON.stringify(JSON.parse(raw),null,2).slice(0,12000);}catch{return raw;}}
 function mark(kind){return node('span','ai-mark '+kind,{ok:'✓',fail:'!',run:'◌'}[kind]);}
 function messageNode(item){const e=item.entry,kind=['user','assistant','system'].includes(e.kind)?e.kind:'system',box=node('div','ai-entry '+kind);box.append(node('b','',({user:'你',assistant:'千面 AI',system:'状态'})[kind]),node('div',kind==='assistant'?'ai-md':'ai-entry-text'));if(kind!=='system'){const copy=node('button','ai-copy','复制');copy.type='button';copy.title='复制消息';copy.dataset.aiCopy=item.key;box.append(copy);}return box;}
 function fillMessage(box,item){
  const e=item.entry,body=box.children[1];if(e.at)box.title=new Date(e.at).toLocaleString();copyText.set(item.key,e.text);
  if(e.kind!=='assistant'){if(body.textContent!==e.text)body.textContent=e.text;return;}
  if(box.dataset.mdText===e.text)return;const blocks=mdCache.get(e.text);
  // Until the parse arrives keep the previous rendering (streaming) or show plain text once.
  if(blocks===undefined){mdPending.add(e.text);if(!body.childNodes.length)window.facetMarkdown.renderPlain(body,e.text);return;}
  if(blocks===null)window.facetMarkdown.renderPlain(body,e.text);else window.facetMarkdown.renderBlocks(body,blocks);box.dataset.mdText=e.text;
 }
 function toolsNode(){const d=node('details','ai-entry tool ai-tools');d.append(node('summary'),node('ol','ai-steps'));return d;}
 function fillTools(d,item,running){
  const steps=item.entries.map(e=>{const {name,raw}=toolParts(e);return {e,raw,ok:typeof e.ok==='boolean'?e.ok:!/^\s*\{\s*"error"\s*:/.test(raw),label:toolLabel(name),target:e.instanceId?state.instances.find(x=>x.id===e.instanceId)?.name||'':''};});
  const failed=steps.filter(s=>!s.ok).length,first=steps[0],labels=[...new Set(steps.map(s=>s.label))];
  const title=steps.length===1?[first.label,first.target,first.e.result].filter(Boolean).join(' · '):'执行了 '+steps.length+' 步 · '+labels.slice(0,3).join('、')+(labels.length>3?' 等':'');
  const summary=d.firstElementChild,sig=JSON.stringify([title,failed,running]);
  if(summary.dataset.sig!==sig){summary.dataset.sig=sig;summary.replaceChildren(mark(running?'run':failed?'fail':'ok'),node('span','ai-tools-title',title));if(failed)summary.append(node('span','ai-tools-fail',failed+' 步失败'));if(running)summary.append(node('span','ai-tools-run','进行中'));}
  const list=d.lastElementChild;
  steps.forEach((s,i)=>{const key=item.keys[i],current=list.children[i];if(current?.dataset.key===key)return;
   const li=node('li','ai-step '+(s.ok?'ok':'fail')),detail=node('details'),head=node('summary');li.dataset.key=key;
   head.append(mark(s.ok?'ok':'fail'),node('span','ai-step-name',s.label));for(const [cls,text] of [['ai-step-target',s.target],['ai-step-args',s.e.args],['ai-step-result',s.e.result]])if(text)head.append(node('span',cls,text));
   detail.append(head,node('pre','',prettyResult(s.raw)));li.append(detail);if(current)current.replaceWith(li);else list.append(li);});
  while(list.children.length>steps.length)list.lastElementChild.remove();
 }
 function emptyNode(configured){const box=node('div','ai-empty');box.append(node('strong','','准备好，开始任务'),node('p','',configured?'选择实例，告诉我需要做什么。':'先配置模型服务；未配置时不会发送任何请求。'));
  if(!configured){const setup=node('button','btn primary tiny','配置模型');setup.type='button';setup.dataset.aiSetup='';box.append(setup);return box;}
  const examples=node('div','ai-examples');for(const text of ['检查当前网页是否正常加载，列出可操作的元素','列出所有实例的运行状态和网络方式','总结当前网页的主要内容']){const b=node('button','ai-example',text);b.type='button';b.dataset.aiExample='';examples.append(b);}box.append(examples);return box;}
 function renderHistory(entries,opts){
  const history=el('aiHistory'),atBottom=history.scrollHeight-history.scrollTop-history.clientHeight<48;historyEntries=entries;historyOpts=opts;mdPending=new Set();
  if(!entries.length){const key='empty|'+opts.configured;if(emptyKey!==key){emptyKey=key;historyByKey.clear();copyText.clear();history.replaceChildren(emptyNode(opts.configured));}el('aiLatest').hidden=true;return;}
  if(emptyKey){emptyKey='';history.replaceChildren();}
  const list=historyItems(entries),seen=new Set();copyText.clear();
  list.forEach((item,i)=>{seen.add(item.key);let box=historyByKey.get(item.key);if(!box){box=item.kind==='tools'?toolsNode():messageNode(item);historyByKey.set(item.key,box);}
   if(item.kind==='tools')fillTools(box,item,opts.activity&&i===list.length-1);else fillMessage(box,item);if(history.children[i]!==box)history.insertBefore(box,history.children[i]||null);});
  for(const [key,box] of historyByKey)if(!seen.has(key)){box.remove();historyByKey.delete(key);}
  while(history.children.length>list.length)history.lastElementChild.remove();
  if(atBottom)history.scrollTop=history.scrollHeight;el('aiLatest').hidden=atBottom||history.scrollHeight<=history.clientHeight+1;
  if(mdPending.size)void loadMarkdown();
 }
 async function loadMarkdown(){
  if(mdBusy||!mdPending.size)return;mdBusy=true;const texts=[...mdPending].slice(0,32);
  try{const parsed=await request('ai-markdown',{texts});texts.forEach((text,i)=>mdCache.set(text,parsed?.[i]??null));}catch{texts.forEach(text=>mdCache.set(text,null));}
  finally{mdBusy=false;while(mdCache.size>120)mdCache.delete(mdCache.keys().next().value);}
  renderHistory(historyEntries,historyOpts);
 }
 async function openLink(url){
  const href=window.facetMarkdown.safeLink(url);if(!href)return;const scope=el('aiScope').value;
  // Links open as a tab in a running instance so they use its proxy, environment and logins.
  const target=state.instances.find(x=>x.id===activeId&&x.status==='running')||state.instances.find(x=>x.id===scope&&x.status==='running');
  if(!target){error(Error('先启动一个实例再打开链接；链接会在该实例的网络和登录环境中打开'));return;}
  try{el('aiError').textContent='';await request('tab-new',{id:target.id,url:href});await route('browser',target.id);}catch(e){error(e);}
 }
 const el=id=>document.getElementById(id),error=e=>{el('aiSessionError').textContent=e?.message||String(e);el('aiError').textContent=e?.message||String(e);el('aiSettingsError').textContent=e?.message||String(e);};
 function scopes(){const key=JSON.stringify(state.instances.map(x=>[x.id,x.name]));if(key===scopeKey)return;scopeKey=key;const selected=el('aiScope').value;el('aiScope').innerHTML='<option value="all">全部实例</option>'+state.instances.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');el('aiScope').value=selected==='all'?'all':state.instances.some(x=>x.id===selected)?selected:'all';}
 function renderPlan(plan,current=false){
  const box=el('aiPlan'),key=sessionId+JSON.stringify([plan||null,current]);if(key===planKey)return;planKey=key;box.hidden=!plan?.steps?.length;if(box.hidden){box.replaceChildren();return;}
  if(box.dataset.current!==String(current)){box.open=current;box.dataset.current=String(current);}
  // A finished current plan folds to its one-line progress so the conversation keeps the space.
  const finished=plan.steps.every(step=>step.status==='completed');if(current&&finished&&box.dataset.finished!=='true')box.open=false;box.dataset.finished=String(finished);
  const labels={pending:'待进行',in_progress:'进行中',completed:'已完成',blocked:'受阻'},marks={pending:'○',in_progress:'◉',completed:'✓',blocked:'!'};
  const done=plan.steps.filter(step=>step.status==='completed').length;
  box.innerHTML='<summary>'+(current?'任务计划':'历史计划 · 未核对')+' <span>'+done+' / '+plan.steps.length+'</span></summary><ol>'+plan.steps.map(step=>'<li class="'+step.status+'"><span class="ai-plan-mark" aria-hidden="true">'+marks[step.status]+'</span><span class="ai-plan-title">'+esc(step.title)+'</span><small>'+(current?'':'上次：')+labels[step.status]+'</small></li>').join('')+'</ol>'+(current?'':'<p>这是历史记录，不代表当前状态；不会随问候自动恢复。可点击「继续旧任务」核对后继续。</p>')+(plan.explanation?'<p>'+esc(plan.explanation)+'</p>':'');
 }
 async function poll(){if(polling)return;polling=true;try{scopes();const s=await request('ai-state'),r=s.task;currentState=s;syncSessions(s);renderRuntime(s);renderPlan(r?.plan,r?.planCurrent);el('aiStatus').textContent=submitting?'正在提交…':s.busy&&!r?.busy?'其他会话正在运行':r?.retry?.phase==='waiting'?'重试 '+r.retry.attempt+'/'+r.retry.maxAttempts+' · '+Math.max(0,Math.ceil((r.retry.nextAt-Date.now())/1000))+' 秒':r?.status||'待命';providers=s.settings.providers||[];el('aiMemory').title=s.memory?.error||'每个会话独立保存记忆，重启后保留；新任务不会删除历史';el('aiMemory').classList.toggle('ai-error',!!s.memory?.error);el('aiMemory').textContent=s.memory?.error?'记忆存储异常':s.memory?.turns?'记忆 '+s.memory.turns+' 轮'+(s.memory.compressions?' · 已压缩':''):'';el('aiModelBadge').textContent=s.settings.model||'未配置模型';el('aiModelBadge').title=s.settings.model||'请在设置中配置模型';for(const id of ['aiPermission','aiScope','aiSave','aiModelBadge','aiAddProvider'])el(id).disabled=submitting||!!s.busy;el('aiSend').disabled=submitting||sessionChanging||!!s.busy&&!r?.busy;el('aiClear').disabled=submitting||sessionChanging;el('aiStop').disabled=!r?.busy;el('aiPermission').dataset.level=el('aiPermission').value;const opts={configured:!!s.settings.model,activity:!!r?.activity};const key=sessionId+JSON.stringify([r?.entries||[],opts]);if(key!==last){last=key;if(sessionId!==historySession){historySession=sessionId;historyByKey.clear();el('aiHistory').replaceChildren();emptyKey='';}renderHistory(r?.entries||[],opts);}const p=r?.pending;el('aiApproval').hidden=!p;if(p&&el('aiApproval').dataset.id!==p.id){el('aiApproval').dataset.id=p.id;el('aiApproval').innerHTML=`<div class="ai-card-head"><strong>需要你确认这一步</strong><span>${esc(p.instanceName)}</span></div><pre>${esc(p.name==='cdp_command'?('网页 CDP 操作：'+p.args.method+'\n'+JSON.stringify(p.args.params||{},null,2)):p.name==='page_action'?('网页操作：'+p.args.operation+'\n'+JSON.stringify(p.args,null,2)):p.name==='facet_action'?('千面管理：'+p.args.action+'\n'+JSON.stringify(p.args.params,null,2)):({act:'网页操作：'+p.args.action+'\n目标元素：'+(p.args.element||'当前页面')+(p.args.key?'\n按键：'+p.args.key:'')+(p.args.value!==undefined?'\n选项：'+p.args.value:''),dialog:'处理网页对话框：'+(p.args.accept?'确定':'取消')+'\n'+(p.args.message||''),show_instance:'切换显示实例网页',start_instance:'启动实例',stop_instance:'停止实例',navigate:'打开网页',reload:'刷新网页',click:'点击页面元素',fill:'填写输入框'})[p.name]+'\n'+(p.args.url?'网址：'+p.args.url+'\n':'')+(p.args.selector?'页面元素：'+p.args.selector+'\n':'')+(p.args.text!==undefined?'输入内容：'+p.args.text:''))}</pre><div class="ai-actions"><button class="btn tiny" data-ai-approval="no">拒绝</button><button class="btn primary tiny" data-ai-approval="yes">允许这一步</button></div>`;}if(!p)el('aiApproval').dataset.id='';renderQuestion(r?.question);renderMeter(r?.context,r?.usage);}catch(e){error(e);}finally{polling=false;}}
 // DSH ask_user_question: the card is rebuilt only for a new question so typed answers survive polling.
 function renderQuestion(q){
  const box=el('aiQuestion');box.hidden=!q;if(!q){box.dataset.id='';return;}
  if(box.dataset.id===q.id)return;box.dataset.id=q.id;box.replaceChildren();
  const title=node('div','ai-question-title');title.append(node('strong',null,'AI 需要你的回答'),node('span',null,q.questions.length>1?q.questions.length+' 个问题':'回答后任务继续'));box.append(title);
  q.questions.forEach((item,i)=>{
   // Options without descriptions render as compact chips; described ones stay as rows.
   const group=node('fieldset','ai-question-item'+(item.options.length&&item.options.every(o=>!o.description)?' compact':'')),legend=node('legend'),options=node('div','ai-question-options');if(item.header)legend.append(node('span','ai-question-chip',item.header));legend.append(node('span',null,item.question));if(item.multiSelect)legend.append(node('small','ai-question-multi','可多选'));group.append(legend);
   for(const option of item.options){const label=node('label','ai-question-option'),input=document.createElement('input'),textBox=node('span');input.type=item.multiSelect?'checkbox':'radio';input.name='aiq-'+q.id+'-'+i;input.value=option.label;textBox.append(node('b',null,option.label));if(option.description)textBox.append(node('small',null,option.description));label.append(input,textBox);options.append(label);}
   if(item.options.length)group.append(options);
   const custom=document.createElement('textarea');custom.className='ai-question-custom';custom.rows=1;custom.maxLength=2000;custom.placeholder=item.options.length?'其他回答（可选）':'输入你的回答';custom.setAttribute('aria-label','自定义回答：'+item.question);group.append(custom);box.append(group);
  });
  const actions=node('div','ai-actions ai-question-actions'),submit=node('button','btn primary tiny','提交回答'),skip=node('button','btn tiny','暂不回答');submit.dataset.aiAnswer='submit';skip.dataset.aiAnswer='skip';actions.append(skip,submit);box.append(actions);
  // Keep the model's lead-in visible above the card that just took part of the history height.
  requestAnimationFrame(()=>{const h=el('aiHistory');h.scrollTop=h.scrollHeight;});
 }
 el('aiQuestion').onclick=async e=>{
  const b=e.target.closest('[data-ai-answer]');if(!b)return;const box=el('aiQuestion'),buttons=[...box.querySelectorAll('button')];
  const answers=[...box.querySelectorAll('.ai-question-item')].map(group=>({selected:[...group.querySelectorAll('input:checked')].map(x=>x.value),custom:group.querySelector('textarea').value}));
  buttons.forEach(x=>{x.disabled=true;});
  try{el('aiError').textContent='';await request('ai-answer',{questionId:box.dataset.id,answers,skip:b.dataset.aiAnswer==='skip'});await poll();}catch(err){buttons.forEach(x=>{x.disabled=false;});error(err);}
 };
 // DSH token-meter context pressure, drawn as a small ring next to the model.
 const tokenText=n=>n>=1e6?Math.round(n/1e5)/10+'M':n>=1000?Math.round(n/1000)+'K':String(n);
 function renderMeter(context,usage){
  const meter=el('aiContextMeter');meter.hidden=!context;if(!context)return;
  const ratio=Math.min(1,context.used/context.window),pct=Math.round(ratio*100),c=2*Math.PI*8;
  meter.querySelector('.ai-meter-value').setAttribute('stroke-dasharray',(c*ratio).toFixed(2)+' '+c.toFixed(2));
  meter.dataset.level=ratio>=0.8?'high':ratio>=0.6?'mid':'low';meter.lastElementChild.textContent=pct+'%';
  const detail='上下文占用 '+tokenText(context.used)+' / '+tokenText(context.window)+' tokens（'+(context.estimated?'估算':'按模型返回用量')+'），接近上限时自动整理较早内容'+(usage?.requests?'；本次任务 '+usage.requests+' 次请求，输入 '+tokenText(usage.input+usage.cacheRead)+(usage.cacheRead?'（缓存命中 '+tokenText(usage.cacheRead)+'）':'')+'，输出 '+tokenText(usage.output):'');
  meter.title=detail;meter.setAttribute('aria-valuenow',String(pct));meter.setAttribute('aria-valuetext',detail);
 }
 // Poll faster while a task runs so streamed text arrives in small steps; slower when idle.
 function schedule(){clearTimeout(timer);timer=panel.hidden?null:setTimeout(async()=>{await poll();schedule();},currentState?.busy?250:900);}
 async function open(on){panel.hidden=!on;document.documentElement.dataset.aiOpen=String(on);toggle.setAttribute('aria-expanded',String(on));toggle.title=on?'收起 AI 助手':'展开 AI 助手';clearTimeout(timer);timer=null;requestAnimationFrame(()=>{layout();if(view==='grid')gridSendLayout(true);});if(on){try{const s=await request('ai-state');providers=s.settings.providers||[];el('aiMaxRounds').value=s.settings.maxRounds||'';fillEditor(providers.find(p=>p.id===s.settings.providerId)||providers[0]);if(s.settings.error)error(s.settings.error);}catch(e){error(e);}await poll();schedule();}}
 // The editor always shows the provider it will save; opening settings loads the one in use.
 function fillEditor(p){editingProvider=p?.id||crypto.randomUUID();modelCatalog=p?.models||[];el('aiProviderName').value=p?.name||'';el('aiBaseURL').value=p?.baseURL||'';el('aiModel').value=p?.model||'';el('aiKey').value='';el('aiClearKey').checked=false;el('aiModelList').hidden=true;el('aiModelsStatus').textContent='';el('aiConfigStatus').textContent=p?(p.hasKey?'密钥已加密保存':''):'新提供商';el('aiVision').checked=p?.vision===true;el('aiContextWindow').value=p?.contextWindow||'';el('aiContextWindow').placeholder=p?'自动（约 '+tokenText(p.contextAuto||128000)+'）':'自动';el('aiEditorTitle').textContent=p?'编辑「'+p.name+'」':'新提供商';renderProviders();}
 function showSettings(on){if(on){showSessions(false);const s=currentState?.settings;if(s){providers=s.providers||providers;el('aiMaxRounds').value=s.maxRounds||'';}fillEditor(providers.find(p=>p.id===s?.providerId)||providers.find(p=>p.id===editingProvider)||providers[0]);}el('aiSettings').hidden=!on;panel.classList.toggle('ai-edit-settings',on);el('aiSettingsButton').setAttribute('aria-expanded',String(on));}
 el('aiSettingsButton').onclick=async()=>{await poll();showSettings(el('aiSettings').hidden);};el('aiSettingsDone').onclick=()=>showSettings(false);
 el('aiModelList').onchange=()=>{if(el('aiModelList').value)el('aiModel').value=el('aiModelList').value;};
 el('aiFetchModels').onclick=async()=>{const b=el('aiFetchModels');b.disabled=true;el('aiModelsStatus').textContent=' 正在获取…';el('aiSettingsError').textContent='';try{const models=await request('ai-models',{settings:{baseURL:el('aiBaseURL').value.trim(),key:el('aiKey').value,providerId:editingProvider}});modelCatalog=models;el('aiModels').innerHTML=models.map(m=>'<option value="'+esc(m)+'"></option>').join('');el('aiModelList').innerHTML='<option value="">选择一个模型</option>'+models.map(m=>'<option value="'+esc(m)+'">'+esc(m)+'</option>').join('');el('aiModelList').hidden=!models.length;el('aiModelList').value=models.includes(el('aiModel').value)?el('aiModel').value:'';if(!el('aiModel').value&&models.length)el('aiModel').value=models[0];el('aiModelList').value=models.includes(el('aiModel').value)?el('aiModel').value:'';el('aiModelsStatus').textContent=' 已获取 '+models.length+' 个模型，可从列表选择或手填';}catch(e){el('aiModelsStatus').textContent=e.message;}finally{b.disabled=false;}};
 toggle.addEventListener('click',()=>open(panel.hidden));el('aiClose').onclick=()=>open(false);
 el('aiSave').onclick=async()=>{try{el('aiError').textContent='';el('aiSettingsError').textContent='';const s=await request('ai-settings',{settings:{providerId:editingProvider,name:el('aiProviderName').value,models:modelCatalog,baseURL:el('aiBaseURL').value.trim(),model:el('aiModel').value.trim(),key:el('aiKey').value,clearKey:el('aiClearKey').checked,vision:el('aiVision').checked,maxRounds:el('aiMaxRounds').value.trim(),contextWindow:el('aiContextWindow').value.trim()}});el('aiKey').value='';el('aiClearKey').checked=false;el('aiConfigStatus').textContent=s.hasKey?' 已保存（密钥已加密）':' 已保存';showSettings(false);}catch(e){error(e);}};
 el('aiSend').onclick=async()=>{if(submitting||el('aiSend').disabled)return;const prompt=el('aiPrompt').value;if(!prompt.trim()&&!attachments.length){el('aiPrompt').focus();return;}submitting=true;el('aiSend').disabled=true;el('aiStatus').textContent='正在提交…';try{el('aiError').textContent='';const selection=el('aiScope').value,ids=selection==='all'?state.instances.map(x=>x.id):[selection];const sentImages=attachments.slice();const active=currentState?.task;await request('ai-submit',{prompt,images:sentImages.map(x=>x.data),ids,sharePage:true,allowGlobal:true,permission:el('aiPermission').value,taskId:active?.id,mode:el('aiSendMode').value});attachments=attachments.filter(x=>!sentImages.includes(x));renderAttachments();if(el('aiPrompt').value===prompt)el('aiPrompt').value='';el('aiHistory').scrollTop=el('aiHistory').scrollHeight;}catch(e){error(e);}finally{submitting=false;await poll();}};
 el('aiPrompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();if(!e.repeat&&!el('aiSend').disabled)el('aiSend').click();}});
 el('aiStop').onclick=async()=>{try{await request('ai-stop');await poll();}catch(e){error(e);}};
 el('aiClear').onclick=()=>changeSession('ai-clear');
 el('aiApproval').onclick=async e=>{const b=e.target.closest('[data-ai-approval]');if(!b)return;b.disabled=true;try{await request('ai-approve',{approvalId:el('aiApproval').dataset.id,allow:b.dataset.aiApproval==='yes'});await poll();}catch(e){error(e);}};
 function showSessions(on){el('aiSessions').hidden=!on;panel.classList.toggle('ai-show-sessions',on);el('aiSessionsButton').setAttribute('aria-expanded',String(on));if(on)showSettings(false);}
 function syncSessions(s){
  const info=s.sessions;if(!info)return;
  if(sessionId!==info.selectedId){
   if(sessionId)drafts.set(sessionId,{text:el('aiPrompt').value,attachments,scope:el('aiScope').value,permission:el('aiPermission').value});
   sessionId=info.selectedId;const d=drafts.get(sessionId);el('aiPrompt').value=d?.text||'';attachments=d?.attachments||[];renderAttachments();
   const scope=d?.scope||(s.task?.scope?.length===1?s.task.scope[0]:'all');el('aiScope').value=[...el('aiScope').options].some(x=>x.value===scope)?scope:'all';el('aiPermission').value=d?.permission||'confirm';last='';el('aiError').textContent='';
  }
  sessionRows=info.items;const key=JSON.stringify(info);if(key===sessionKey)return;sessionKey=key;
  el('aiSessionList').innerHTML=info.items.map(row=>'<div class="ai-session-row '+(row.id===sessionId?'selected':'')+'"><button class="ai-session-open" data-session-open="'+esc(row.id)+'"><strong>'+esc(row.title)+'</strong><small>'+esc(row.busy?'正在执行 · '+row.status:row.status)+' · '+esc(new Date(row.updatedAt).toLocaleString())+'</small></button><div class="ai-session-actions"><button class="btn tiny" data-session-rename="'+esc(row.id)+'">改名</button><button class="btn tiny" data-session-delete="'+esc(row.id)+'" '+(row.busy?'disabled':'')+'>删除</button></div></div>').join('');
 }
 async function changeSession(action,data={}){
  if(sessionChanging||submitting)return;el('aiSessionError').textContent='';sessionChanging=true;el('aiClear').disabled=true;
  try{await request(action,data);if(action==='ai-session-delete')drafts.delete(data.sessionId);showSessions(false);showSettings(false);el('aiSessionEditor').hidden=true;editingSession=null;await poll();}
  catch(e){error(e);}finally{sessionChanging=false;el('aiClear').disabled=false;}
 }
 el('aiSessionsButton').onclick=async()=>{await poll();showSessions(el('aiSessions').hidden);};
 el('aiSessionList').onclick=e=>{
  const open=e.target.closest('[data-session-open]');if(open){void changeSession('ai-session-select',{sessionId:open.dataset.sessionOpen});return;}
  const rename=e.target.closest('[data-session-rename]'),remove=e.target.closest('[data-session-delete]');const id=rename?.dataset.sessionRename||remove?.dataset.sessionDelete;if(!id)return;
  const row=sessionRows.find(x=>x.id===id);if(!row)return;editingSession={id,remove:!!remove};el('aiSessionEditor').hidden=false;
  el('aiSessionEditor').innerHTML=remove?'<p>删除「'+esc(row.title)+'」及其聊天、图片和记忆？此操作不可撤销，不会删除浏览器实例。</p>':'<label>会话名称<input id="aiSessionName" maxlength="80" value="'+esc(row.title)+'"></label>';
  el('aiSessionEditor').innerHTML+='<div class="ai-session-actions"><button class="btn tiny" id="aiSessionCancel">取消</button><button class="btn tiny primary" id="aiSessionConfirm">'+(remove?'确认删除':'保存')+'</button></div>';
  el('aiSessionCancel').onclick=()=>{editingSession=null;el('aiSessionEditor').hidden=true;};
  el('aiSessionConfirm').onclick=()=>{const edit=editingSession;if(!edit)return;void changeSession(edit.remove?'ai-session-delete':'ai-session-rename',{sessionId:edit.id,...(edit.remove?{confirmed:true}:{title:el('aiSessionName').value})});};
  el('aiSessionName')?.focus();
 };

 function renderProviders(){const active=currentState?.settings?.providerId;el('aiProviders').innerHTML=providers.map(p=>{const editing=p.id===editingProvider;return `<div class="ai-provider-row${editing?' editing':''}"><span><strong>${esc(p.name)}${p.id===active?'<em class="ai-provider-active">使用中</em>':''}</strong><small>${esc(p.model||'未选择模型')}</small></span><button class="btn tiny" data-provider="${esc(p.id)}" ${editing?'disabled aria-current="true"':''}>${editing?'编辑中':'编辑'}</button><button class="btn tiny" data-remove-provider="${esc(p.id)}" ${providers.length<2?'disabled':''}>删除</button></div>`;}).join('');}
 el('aiProviders').onclick=async e=>{const edit=e.target.closest('[data-provider]'),remove=e.target.closest('[data-remove-provider]');try{if(remove){const s=await request('ai-provider-remove',{providerId:remove.dataset.removeProvider});providers=s.providers;await poll();if(providers.some(p=>p.id===editingProvider))renderProviders();else fillEditor(providers.find(p=>p.id===s.providerId)||providers[0]);return;}if(!edit)return;const p=providers.find(p=>p.id===edit.dataset.provider);if(p){fillEditor(p);el('aiProviderName').focus();}}catch(e){error(e);}};
 el('aiAddProvider').onclick=()=>{fillEditor(null);el('aiProviderName').focus();};
 function renderModels(){const q=el('aiModelSearch').value.toLowerCase();el('aiModelChoices').innerHTML=providers.map(p=>{const models=(p.models||[p.model]).filter(m=>m&&m.toLowerCase().includes(q));return models.length?`<section><small>${esc(p.name)}</small>${models.map(m=>`<button data-model="${esc(m)}" data-provider-id="${esc(p.id)}">${esc(m)}</button>`).join('')}</section>`:'';}).join('')||'<p>没有匹配模型，请在设置中获取或填写。</p>';}
 el('aiModelBadge').onclick=async()=>{await poll();el('aiModelPicker').hidden=!el('aiModelPicker').hidden;renderModels();if(!el('aiModelPicker').hidden)el('aiModelSearch').focus();};el('aiModelSearch').oninput=renderModels;
 el('aiModelChoices').onclick=async e=>{const b=e.target.closest('[data-model]');if(!b)return;try{await request('ai-select',{providerId:b.dataset.providerId,model:b.dataset.model});el('aiModelPicker').hidden=true;await poll();}catch(e){error(e);}};
 function toolLabel(name){return ({observe:'观察网页',act:'操作网页',dialog:'处理网页对话框',list_instances:'查看实例',show_instance:'切换实例',get_context:'读取千面状态',facet_action:'管理实例',read_manual:'读取使用说明',cdp_command:'浏览器控制',network_log:'查看网络请求',upload_file:'上传网页文件',page_action:'网页操作',update_plan:'更新计划',read_plan:'读取计划',ask_user_question:'询问你',read_page:'读取网页',fill:'填写网页',click:'点击网页',start_instance:'启动实例',stop_instance:'停止实例',navigate:'打开网页',reload:'刷新网页'})[name]||name||'执行结果';}
 function renderRuntime(s){
  const r=s.task,other=s.busy&&!r?.busy;
  el('aiEngine').textContent='DSH · DeepSeek Harness '+(s.engine?.version||'');
  el('aiEngine').title='官方执行引擎；使用你选择的模型和千面的实例工具';
  el('aiActivity').hidden=!r?.busy;
  el('aiActivity').textContent=r?.activity?toolLabel(r.activity.name)+(r.activity.args?.instanceId?' · '+(state.instances.find(x=>x.id===r.activity.args.instanceId)?.name||'实例'):'')+' · 第 '+(r.round||1)+' 轮':(r?.status||'')+(r?.round?' · 第 '+r.round+' 轮':'');
  el('aiSendOptions').hidden=!r?.busy;el('aiSend').title=r?.busy?(el('aiSendMode').value==='steer'?'补充当前任务':'加入待办'):'发送';
  el('aiContinue').hidden=other||!r||r.busy||!['失败','已停止','已停止：无进展','已暂停：计划未完成','已回复（计划未完成）'].includes(r.status)&&!r.status?.startsWith('已达到')&&!r.plan?.steps.some(step=>step.status!=='completed');el('aiContinue').textContent=r?.plan&&!r.planCurrent?'继续旧任务':'继续处理';
  el('aiRunning').hidden=!other;
  const queue=r?.queue||[],key=sessionId+JSON.stringify([queue,!!r?.busy,other]);el('aiQueue').hidden=!queue.length;
  if(key!==queueKey){queueKey=key;el('aiQueue').innerHTML=queue.length?'<div class="ai-queue-title"><strong>待办 '+queue.length+'</strong><span>'+(r?.busy?'当前任务成功后依次执行':'已暂停，等待继续')+'</span>'+(!r?.busy&&!other?'<button id="aiQueueNext" class="btn tiny">继续待办</button>':'')+'</div>'+queue.map((q,i)=>'<div class="ai-queue-item"><span><b>'+String(i+1)+'.</b> '+esc(q.prompt||'图片任务')+(q.images?' · '+q.images+' 张图':'')+'</span><button class="btn tiny" data-ai-remove="'+esc(q.id)+'" title="移除待办" aria-label="移除待办">×</button></div>').join(''):'';}
 }
 el('aiQueue').onclick=async e=>{try{const b=e.target.closest('[data-ai-remove]');if(b)await request('ai-queue-remove',{messageId:b.dataset.aiRemove});else if(e.target.closest('#aiQueueNext')){const selection=el('aiScope').value;await request('ai-queue-next',{ids:selection==='all'?state.instances.map(x=>x.id):[selection],permission:el('aiPermission').value});}await poll();}catch(e){error(e);}};
 el('aiContinue').onclick=()=>{if(el('aiPrompt').value.trim()){el('aiPrompt').focus();return;}el('aiPrompt').value='请继续上次未完成的任务。先核对当前状态和已执行结果，不要重复已完成的操作；遇到阻碍请明确说明。';el('aiSend').click();};
 el('aiRunning').onclick=()=>changeSession('ai-session-select',{sessionId:currentState?.sessions.runningId});
 el('aiLatest').onclick=()=>{el('aiHistory').scrollTop=el('aiHistory').scrollHeight;el('aiLatest').hidden=true;};
 el('aiHistory').addEventListener('scroll',()=>{const h=el('aiHistory');if(h.scrollHeight-h.scrollTop-h.clientHeight<48)el('aiLatest').hidden=true;});
 el('aiHistory').onclick=async e=>{
  const link=e.target.closest('[data-ai-href]');if(link){e.preventDefault();await openLink(link.dataset.aiHref);return;}
  if(e.target.closest('[data-ai-setup]')){await poll();showSettings(true);return;}
  const example=e.target.closest('[data-ai-example]');if(example){el('aiPrompt').value=example.textContent;el('aiPrompt').focus();return;}
  const copy=e.target.closest('[data-ai-copy]'),code=e.target.closest('[data-ai-code-copy]'),b=copy||code;if(!b)return;
  const text=copy?copyText.get(copy.dataset.aiCopy):code.closest('.ai-md-pre')?.querySelector('pre')?.textContent;if(text===undefined)return;
  try{await navigator.clipboard.writeText(text);b.textContent='已复制';setTimeout(()=>{b.textContent='复制';},1500);}catch{error(Error('复制失败，请选中文字复制'));}
 };
 el('aiPermission').addEventListener('change',()=>{el('aiPermission').dataset.level=el('aiPermission').value;});
 function renderAttachments(){el('aiAttachments').innerHTML=attachments.map((a,i)=>`<div><img src="${a.data}" alt="待发送图片"><button data-image-remove="${i}" aria-label="移除图片">×</button></div>`).join('');}
 async function addImages(files){try{for(const file of files){if(attachments.length>=4)throw Error('最多附加 4 张图片');if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('仅支持 5MB 以内 PNG/JPEG/WebP');const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('图片读取失败'));r.readAsDataURL(file);});attachments.push({data});}renderAttachments();}catch(e){renderAttachments();error(e);}}
 el('aiAttach').onclick=()=>el('aiImageInput').click();el('aiImageInput').onchange=async()=>{await addImages([...el('aiImageInput').files]);el('aiImageInput').value='';};
 el('aiPrompt').addEventListener('paste',e=>{const files=[...e.clipboardData.files];if(files.length){e.preventDefault();addImages(files);}});
 el('aiAttachments').onclick=e=>{const b=e.target.closest('[data-image-remove]');if(b){attachments.splice(Number(b.dataset.imageRemove),1);renderAttachments();}};

})();
