'use strict';
const {app,ipcMain,dialog,clipboard,shell}=require('electron');const {refreshOne,refreshAll,reveal}=require('./extension-refresh.cjs');const fs=require('node:fs'),path=require('node:path');const {sizeText}=require('./extension-catalog.cjs');const batchOperations=require('./batch-operations.cjs');
function installIPC(window,controller){
 const ai=controller.aiAgent=new (require('./ai-agent.cjs').AIAgent)(controller);
 const sendWindowVisibility=()=>{if(!window.isDestroyed()&&!window.webContents.isDestroyed())window.webContents.send('core:window-visibility',window.isVisible()&&!window.isMinimized());};
 const visibilityEvents=['minimize','restore','hide','show'];for(const event of visibilityEvents)window.on(event,sendWindowVisibility);
 window.webContents.on('did-finish-load',sendWindowVisibility);
 // 扩展菜单原生浮层：只接受浮层自身页面发来的消息。
 const overlay=new (require('./menu-overlay.cjs').MenuOverlay)(window,message=>{if(!window.isDestroyed()&&!window.webContents.isDestroyed())window.webContents.send('core:overlay',message);});controller.overlay=overlay;
 const onOverlay=(event,message)=>overlay.receive(event.sender,message);ipcMain.on('overlay:event',onOverlay);
 // 高频位置消息只保留一个最新值；与完整布局使用同一控制窗口身份校验。
 let latestScroll=null,scrollTask=null;
 const onGridScroll=(event,message)=>{if(window.isDestroyed()||controller.disposing||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)return;
  if(!message||!Number.isSafeInteger(message.revision)||!Number.isFinite(message.scrollTop)||message.scrollTop<0||message.scrollTop>100000)return;
  latestScroll={revision:message.revision,scrollTop:message.scrollTop};if(scrollTask)return;
  scrollTask=true;queueMicrotask(()=>{scrollTask=null;const next=latestScroll;latestScroll=null;if(!next||window.isDestroyed()||controller.disposing||!controller.grid)return;if(!controller.scrollGrid(next))window.webContents.send('core:grid-resync',next.revision);});};
 ipcMain.on('core:grid-scroll',onGridScroll);
 const onDevToolsResize=(event,message)=>controller.resizeDevTools(event.sender.id,message||{});ipcMain.on('facet:devtools-resize',onDevToolsResize);
 const assignNode=(id,sourceId,name)=>controller.queue(id,async()=>{controller.store.get(id);const node=controller.library.node(sourceId,name);await controller.stopInner(id);controller.store.saveNodes(id,[node],null,{sourceId,name:node.name});controller.store.update(id,{network:{mode:'mihomo',nodeName:node.name}});controller.log(id,'已从全局库分配节点；当前实例已停止，请手动启动');return {id,sourceId,name:node.name,status:'success'};});
 const requestHandler=async(event,message)=>{
  try{if(window.isDestroyed()||controller.disposing)return {ok:false,error:'应用正在关闭'};const controls=window.webContents;if(!controls||controls.isDestroyed())return {ok:false,error:'控制窗口已关闭'};if(event.sender!==controls||event.senderFrame!==controls.mainFrame)throw Error('拒绝非控制界面调用');
  if(!message||typeof message.action!=='string')throw Error('请求无效');const {action,id}=message;
  const exporting=controller.transfer.progress;if(exporting?.running){const mutations=['start','stop','rename','settings','reset-environment','instance-notes','instance-autostart','delete','remove','import','import-subscription','refresh-subscription','library-assign','instance-node-select','navigate','back','forward','reload','audio-volume','audio-mute','environment-timezone'];if(exporting.ids.includes(id)&&mutations.includes(action)||action.startsWith('extension-')&&action!=='extension-reveal'||['batch-start','batch-stop','batch-delete','batch-reset','library-assign-many'].includes(action))throw Error('所选实例正在导出，请等待完成');}
   switch(action){
    case 'ai-select':return {ok:true,value:ai.select(message.providerId,message.model)};
    case 'ai-provider-remove':return {ok:true,value:ai.removeProvider(message.providerId)};
    case 'ai-models':return {ok:true,value:await ai.models(message.settings||{})};
    case 'ai-state':return {ok:true,value:ai.snapshot()};
    case 'ai-settings':return {ok:true,value:ai.save(message.settings||{})};
    case 'ai-run':return {ok:true,value:ai.begin(message)};
    case 'ai-stop':ai.stop();return {ok:true};
    case 'ai-clear':return {ok:true,value:{sessionId:ai.sessions.create()}};
    case 'ai-session-select':ai.sessions.select(message.sessionId);return {ok:true};
    case 'ai-session-rename':ai.sessions.rename(message.sessionId,message.title);return {ok:true};
    case 'ai-session-delete':ai.sessions.remove(message.sessionId,message.confirmed);return {ok:true};
    case 'ai-approve':ai.approve(message.approvalId,message.allow);return {ok:true};
    case 'node-network-interfaces':return {ok:true,value:await controller.nodeNetwork.interfaces(true)};
    case 'node-network-save':return {ok:true,value:await controller.queue('node-network',async()=>{const value=await controller.nodeNetwork.save(message.settings);controller.workspace.log('application','已保存节点 DNS 和出站设置；下次实例启动或节点检测生效');controller.emit();return value;})};
    case 'library-proxy-save':case 'library-proxy-test':case 'library-proxy-clipboard':case 'library-proxy-parse':return {ok:true,value:await require('./proxy-entry.cjs').proxyEntry(controller,message,clipboard)};
    case 'fingerprint-preset':return {ok:true,value:require('./environment.cjs').environment(require('./fingerprint.cjs').preset(message.preset,require('./environment.cjs').environment(message.environment)))};
    case 'environment-timezone':return {ok:true,value:await controller.diagnostics.timezone(id,message.network)};
    case 'quick-link-save':controller.workspace.saveQuickLink(message.link||{});controller.emit();break;
    case 'open-github':await shell.openExternal('https://github.com/HEYD66/facet');break;
    case 'open-feedback':await shell.openExternal('https://github.com/HEYD66/facet/issues');break;
    case 'quick-link-remove':controller.workspace.removeQuickLink(message.linkId);controller.emit();break;
    case 'quick-link-move':controller.workspace.moveQuickLink(message.linkId,message.direction);controller.emit();break;
    case 'quick-link-open':await controller.navigate(id,controller.workspace.quickLink(message.linkId).url);break;
    case 'extension-import':return {ok:true,value:await controller.queue('extensions',async()=>{const pick=await dialog.showOpenDialog(window,{title:'选择包含manifest.json的解压扩展文件夹',properties:['openDirectory']});if(pick.canceled)return {cancelled:true};if(controller.disposing)throw Error('应用正在退出');const catalog=controller.extensions.catalog,row=catalog.stage(pick.filePaths[0]);try{const answer=await dialog.showMessageBox(window,{type:'warning',title:row.requiresElevatedReview?'确认导入高风险浏览器扩展':'确认导入浏览器扩展',message:row.name+' · '+row.version,detail:'扩展可能读取或修改网页内容。只导入可信来源；导入后默认不启用。'+(row.requiresElevatedReview?'\n此扩展声明了高风险权限或全站网页范围，请确认来源、发布者和权限用途后再导入。':'')+'\n声明权限：'+row.permissions.join(', ')+'\n可选权限：'+row.optionalPermissions.join(', ')+'\n内容脚本范围：'+row.matches.join(', ')+'\n大小：'+sizeText(row.bytes)+' · '+row.files+' 个文件和目录'+(row.skipped?.length?'\n已跳过开发用文件夹/文件（扩展运行用不到）：'+row.skipped.map(x=>x.name+'（'+sizeText(x.size)+'）').join('、'):'')+'\n'+row.warnings.join('\n'),buttons:['取消',row.requiresElevatedReview?'确认高风险导入':'信任并导入'],defaultId:0,cancelId:0,noLink:true});if(answer.response!==1||controller.disposing){catalog.discard(row);return {cancelled:true};}catalog.accept(row);controller.emit();return {id:row.id};}catch(e){catalog.discard(row);throw e;}})};
    case 'extension-refresh':return {ok:true,value:await controller.queue('extensions',()=>refreshOne(controller,window,dialog,message.extensionId))};
    case 'extension-refresh-all':return {ok:true,value:await controller.queue('extensions',()=>refreshAll(controller,window,dialog))};
    case 'extension-reveal':await reveal(controller,shell,message.extensionId);break;
    case 'extension-configure':if(message.confirmed!==true)throw Error('请确认仅停止目标实例后更改扩展');await controller.queue('extensions',()=>controller.extensions.configure(id,message.extensionId,message.enabled));break;
    case 'extension-remove':if(message.confirmed!==true)throw Error('请确认移除扩展');return {ok:true,value:await controller.queue('extensions',()=>require('./extension-remove.cjs').removeExtension(controller,message.extensionId,message.instanceIds))};
    case 'extension-action':{const r=controller.runtimes.get(id),ext=r?.loadedExtensions?.get(message.extensionId),compat=r?.extensionHost?.compat;if(!ext||!compat)throw Error('请先启用扩展并启动实例');const ctx=compat.endpoints.get(ext.id);if(!ctx)throw Error('扩展后台尚未就绪');await compat.actionClick(ctx);break;}
    case 'extension-side-panel-close':controller.runtimes.get(id)?.extensionHost?.compat?.closePanel();break;
    case 'extension-open':await controller.queue(id,()=>controller.extensions.open(id,message.extensionId,message.kind));break;
    case 'snapshot':return {ok:true,value:controller.snapshot()};
    case 'control-status':return {ok:true,value:controller.controlApi?.uiSnapshot()||{enabled:false,running:false,apiPort:null,cdpPort:null,token:null,restartRequired:false}};
    case 'control-save':{
      if(!controller.controlApi)throw Error('本地控制模块未初始化');
      const value=await controller.controlApi.save({enabled:message.enabled,regenerateToken:message.regenerateToken===true});
      controller.workspace.log('application',value.enabled?'已保存本地控制设置；重启应用后启用 API 和 CDP':'已关闭本地控制；重启应用后生效');controller.emit();return {ok:true,value};
    }
    case 'control-copy':{
      const text=String(message.text||'');
      if(!text||text.length>2000)throw Error('连接信息无效');
      const baseText=text.split(/\r?\n/).filter(line=>!line.startsWith('说明书入口：')).join('\n').trim();
      const docsRoot=app.isPackaged?process.resourcesPath:path.resolve(__dirname,'../..');
      const guidePath=path.join(docsRoot,'AGENTS.md');
      const guideLine=fs.existsSync(guidePath)?`说明书入口：${guidePath}`:`说明书入口：${guidePath}（当前安装包未附带）`;
      clipboard.writeText(`${baseText}\n${guideLine}`);return {ok:true,value:{copied:true,guidePath,guideIncluded:fs.existsSync(guidePath)}};
    }
    case 'update-status':return {ok:true,value:controller.updates?.snapshot()||{supported:false,status:'unsupported',error:'当前运行方式未接入在线更新'}};
    case 'update-check':return {ok:true,value:await controller.updates.check()};
    case 'update-reminder-open':{const u=controller.updates?.snapshot();if(!u?.reminderVersion||message.version!==u.reminderVersion)return {ok:true,value:{shown:false,response:1}};return {ok:true,value:await require('./update-reminder.cjs').showUpdateReminder(window,{version:u.version,currentVersion:u.currentVersion,releaseNotes:u.releaseNotes,onShown:()=>controller.updates.acknowledgeReminder(u.version)})};}
    case 'update-reminder-shown':return {ok:true,value:controller.updates.acknowledgeReminder(message.version)};
    case 'update-download':return {ok:true,value:await controller.updates.download()};
    case 'update-install':return {ok:true,value:await controller.updates.install(message.confirmed)};
    case 'runtime-output':return {ok:true,value:require('./runtime-output.cjs').readRuntimeOutput()};
    case 'export-diagnostics':return {ok:true,value:await controller.queue('diagnostic-export',()=>require('./diagnostic-bundle.cjs').exportDiagnosticBundle(controller,window,dialog))};
    case 'favorite-node':if(!controller.workspace.data.nodes.some(n=>n.sourceId===message.sourceId&&n.name===message.name))controller.library.node(message.sourceId,message.name);controller.workspace.favorite(message.sourceId,message.name);controller.emit();break;
    case 'set-ip-favorite':controller.workspace.setIPFavorite(message.ip,message.selected,message.note);controller.emit();break;
    case 'remove-ips':controller.workspace.removeIPs(message.bookmarkIds);controller.emit();break;
    case 'copy-ips':{const rows=controller.workspace.selectedIPs(message.bookmarkIds);if(!rows.length)throw Error('请先选择IP');await clipboard.writeText(rows.map(x=>x.ip).join('\n'));return {ok:true,value:{count:rows.length}};}
    case 'save-ip':controller.workspace.saveIP(String(message.ip||''),message.note);controller.emit();break;
    case 'remove-ip':controller.workspace.removeIP(message.bookmarkId);controller.emit();break;
    case 'copy-summary':{const value={time:new Date().toISOString(),app:controller.snapshot().versions.app,electron:process.versions.electron,instances:controller.snapshot().instances.map(x=>({id:x.id,status:x.status,network:x.network.mode,page:x.pageState,core:x.coreVersion,environment:{language:x.environment.language,timezone:x.environment.timezone,customUA:!!x.environment.userAgent,customPlatform:!!x.environment.platform},error:require('./workspace.cjs').redact(x.error)})),events:controller.workspace.events.slice(0,100)};await clipboard.writeText(JSON.stringify(value,null,2));return {ok:true,value:{copied:true}};}
    case 'export-logs':{const result=await dialog.showSaveDialog(window,{title:'导出脱敏系统日志',defaultPath:'facet-events.json',filters:[{name:'JSON',extensions:['json']}]});if(!result.canceled&&result.filePath)fs.writeFileSync(result.filePath,JSON.stringify(controller.workspace.events,null,2));return {ok:true,value:{cancelled:result.canceled}};}

    case 'library-hint':case 'library-delete-nodes':case 'library-restore-nodes':case 'library-save':case 'library-rename':case 'library-remove':case 'library-file':return {ok:true,value:await controller.queue('global-library',async()=>{
     if(controller.disposing)throw Error('应用正在退出');
     let value;
     if(action==='library-hint')controller.library.toggleHint(message.sourceId,message.name);
     if(action==='library-delete-nodes'){const groups=Array.isArray(message.groups)?message.groups:[{sourceId:message.sourceId,names:message.names}];if(!groups.length||groups.length>30)throw Error('节点源数量无效');for(const g of groups){const src=controller.library.get(g.sourceId);if(!Array.isArray(g.names)||!g.names.length||g.names.some(n=>!src.nodes.some(x=>x.name===n)))throw Error('请选择有效节点');}for(const g of groups)controller.library.removeNodes(g.sourceId,g.names);}
     if(action==='library-restore-nodes')controller.library.restoreNodes(message.sourceId);
     if(action==='library-save')value=await controller.library.save({id:message.sourceId,name:message.name,url:message.url});
     if(action==='library-rename')controller.library.rename(message.sourceId,message.name);
     if(action==='library-remove'){controller.library.remove(message.sourceId);controller.diagnostics.history.clear(message.sourceId);}
     if(action==='library-file'){const picked=await dialog.showOpenDialog(window,{title:'导入到全局代理库',properties:['openFile'],filters:[{name:'Clash YAML / JSON',extensions:['yaml','yml','json']}]});if(picked.canceled)return {cancelled:true};const file=picked.filePaths[0];if(fs.statSync(file).size>2*1024*1024)throw Error('配置文件上限2MB');value=await controller.library.save({name:message.name||'本地节点',text:fs.readFileSync(file,'utf8')});}
     if(!['library-rename','library-hint'].includes(action)){const changed=new Set(Array.isArray(message.groups)?message.groups.map(g=>g.sourceId):[message.sourceId||value]);for(const [key,r]of controller.diagnostics.results)if(changed.has(r.sourceId))controller.diagnostics.results.delete(key);}controller.workspace.log('subscription','节点源操作完成：'+action);controller.emit();return value;
    })};
    case 'library-assign':return {ok:true,value:await assignNode(id,message.sourceId,message.name)};
    case 'instance-node-select':return {ok:true,value:await controller.queue(id,async()=>{const x=controller.store.get(id),name=String(message.name||''),node=x&&controller.store.nodes(id).find(n=>n.name===name);if(!node)throw Error('实例节点不存在，请刷新配置');await controller.stopInner(id);const saved=controller.store.source(id);controller.store.saveNodes(id,[...controller.store.nodes(id)],saved.subscription,null);controller.store.update(id,{network:{mode:'mihomo',nodeName:name}});controller.log(id,'已切换实例节点；当前实例已停止，请手动启动');return {id,name};})};
    // 批量分配：先校验全部实例和节点，再将每个实例状态持久化；部分失败返回逐项结果和可重试的 operationId。
    case 'library-assign-many':{const list=Array.isArray(message.assignments)?message.assignments:[];if(!list.length)throw Error('请选择至少一个实例');const ids=new Set();const plan=list.map(item=>{const target=String(item?.id||'');if(ids.has(target))throw Error('同一实例不能重复分配');ids.add(target);controller.store.get(target);const sourceId=String(item?.sourceId||message.sourceId||'');return {id:target,sourceId,node:controller.library.node(sourceId,String(item?.name||''))};});
     const operation=batchOperations.begin(controller.dir,plan.map(p=>({id:p.id,sourceId:p.sourceId,name:p.node.name}))),results=[];for(const [index,p] of plan.entries()){batchOperations.update(controller.dir,operation.operationId,index,{status:'running'});try{const value=await assignNode(p.id,p.sourceId,p.node.name);results.push(value);batchOperations.update(controller.dir,operation.operationId,index,{status:'success',error:null});}catch(e){const error=require('./workspace.cjs').redact(e.message);results.push({id:p.id,sourceId:p.sourceId,name:p.node.name,status:'failed',error});batchOperations.update(controller.dir,operation.operationId,index,{status:'failed',error});}}
     const failed=results.filter(r=>r.status==='failed').length;controller.workspace.log('subscription',`批量分配节点：${plan.length-failed} 个实例成功${failed?`，${failed} 个失败`:''}；已停止的实例需手动启动`,failed?'WARN':'INFO');controller.emit();return {ok:true,value:{operationId:operation.operationId,count:plan.length,partial:failed>0,results}};}
    case 'library-assign-retry':{const operation=batchOperations.read(controller.dir,String(message.operationId||''));const results=[];for(const [index,item] of operation.items.entries()){if(item.status!=='failed')continue;batchOperations.update(controller.dir,operation.operationId,index,{status:'running'});try{const value=await assignNode(item.id,item.sourceId,item.name);results.push(value);batchOperations.update(controller.dir,operation.operationId,index,{status:'success',error:null});}catch(e){const error=require('./workspace.cjs').redact(e.message);results.push({id:item.id,sourceId:item.sourceId,name:item.name,status:'failed',error});batchOperations.update(controller.dir,operation.operationId,index,{status:'failed',error});}}
     const current=batchOperations.read(controller.dir,operation.operationId),failed=current.items.filter(x=>x.status==='failed').length;controller.workspace.log('subscription',`重试批量分配：${current.items.length-failed} 个实例成功${failed?`，${failed} 个失败`:''}`,'INFO');controller.emit();return {ok:true,value:{operationId:operation.operationId,partial:failed>0,results,items:current.items}};}
    case 'diagnostic-start':return {ok:true,value:controller.diagnostics.run(message.items,message.kind,message.concurrency??3)};
    case 'diagnostic-history':return {ok:true,value:{version:controller.diagnostics.history.version,rows:controller.diagnostics.history.list()}};
    case 'diagnostic-history-clear':{if(typeof message.sourceId!=='string'||!message.sourceId)throw Error('请选择节点源');const cleared=controller.diagnostics.history.clear(message.sourceId);controller.diagnostics.history.flush();controller.emit();return {ok:true,value:{cleared}};}
    case 'diagnostic-cancel':controller.diagnostics.cancel();break;

    case 'instance-notes':return {ok:true,value:await controller.queue(id,()=>{controller.store.update(id,{notes:message.notes});controller.emit();return {saved:true};})};
    case 'instance-export':return {ok:true,value:await controller.queue('instance-transfer',async()=>{
      const ids=message.ids;for(const target of ids||[])controller.store.get(target);const mode=message.mode||'separate';if(!['separate','combined'].includes(mode))throw Error('导出方式无效');
      let destination;
      if(mode==='separate'){const picked=await dialog.showOpenDialog(window,{title:'选择实例备份保存文件夹',properties:['openDirectory','createDirectory']});if(picked.canceled||!picked.filePaths.length)return {cancelled:true};destination=picked.filePaths[0];}
      else{const picked=await dialog.showSaveDialog(window,{title:'合并导出实例备份',defaultPath:require('./instance-backup-names.cjs').backupName('Facet-instances'),filters:[{name:'千面实例备份',extensions:['facetbackup']}]});if(picked.canceled||!picked.filePath)return {cancelled:true};destination=picked.filePath;}
      return controller.transfer.prepareExport(ids,destination,{mode,deleteAfterExport:message.deleteAfterExport===true});
    })};
    case 'instance-export-reveal':if(controller.transferOutcome?.destination) shell.showItemInFolder(controller.transferOutcome.destination);break;
    case 'instance-import-inspect':return {ok:true,value:await controller.queue('instance-transfer',async()=>{const picked=await dialog.showOpenDialog(window,{title:'导入实例备份（支持多选）',properties:['openFile','multiSelections'],filters:[{name:'千面实例备份',extensions:['facetbackup']}]});if(picked.canceled||!picked.filePaths.length)return {cancelled:true};return controller.transfer.inspect(picked.filePaths);})};
    case 'instance-import-cancel':return {ok:true,value:controller.transfer.cancel(message.token)};
    case 'instance-import-commit':return {ok:true,value:await controller.queue('instance-transfer',()=>controller.queue('instance-create',()=>controller.transfer.import(message.token,message.selections)))};
    case 'instance-batch-options':return {ok:true,value:require('./instance-batch.cjs').options(controller)};
    case 'instance-batch-plan':return {ok:true,value:await require('./instance-batch.cjs').prepareLocale(controller,message)};
    case 'instance-batch-create':return {ok:true,value:await controller.queue('instance-create',()=>require('./instance-batch.cjs').execute(controller,message.token))};
    case 'instance-batch-cancel':return {ok:true,value:require('./instance-batch.cjs').cancel(controller)};
    case 'create':{const value=await controller.queue('instance-create',()=>require('./operations.cjs').createInstance(controller,message));return {ok:true,value:message.detailed?value:value.id};}
    case 'instance-autostart':return {ok:true,value:await controller.queue(id,()=>{if(controller.disposing)throw Error('应用正在关闭');if(typeof message.enabled!=='boolean')throw Error('随应用启动设置无效');controller.store.update(id,{autoStart:message.enabled});controller.log(id,message.enabled?'已开启随应用启动；下次启动应用时依次启动此实例':'已关闭随应用启动');return {id,enabled:message.enabled};})};
    case 'rename':await controller.queue(id,()=>{controller.store.update(id,{name:message.name});controller.emit();});break;
    case 'activate':controller.choose(id??null);break;
    case 'grid-layout':controller.setGrid(message.grid&&typeof message.grid==='object'?message.grid:null);break;
    case 'grid-thumbs':return {ok:true,value:await controller.gridThumbs()};
    case 'audio-volume':{if(typeof id!=='string')throw Error('请求无效');return {ok:true,value:controller.setVolume(id,message.volume)};}
    case 'audio-mute':{if(id!=null&&typeof id!=='string')throw Error('请求无效');return {ok:true,value:controller.setMuted(id??null,message.muted===true)};}
    case 'app-metrics':return {ok:true,value:await require('./app-metrics.cjs').appMetrics(controller)};
    case 'window-chrome':{const hex=/^#[0-9a-f]{6}$/i;if(!hex.test(message.color)||!hex.test(message.symbolColor))throw Error('标题栏颜色无效');if(typeof window.setTitleBarOverlay!=='function')return {ok:true,value:false};try{window.setTitleBarOverlay({color:message.color,symbolColor:message.symbolColor,height:32});return {ok:true,value:true};}catch{return {ok:true,value:false};}}
    case 'layout':controller.layout(id,message.bounds);break;
    case 'overlay-show':return {ok:true,value:await overlay.show(message)};
    case 'overlay-hide':overlay.hide('request');return {ok:true};
    case 'browser-snapshot':return {ok:true,value:await controller.capturePageFrame(id)};
    case 'start':await controller.start(id);break;
    case 'stop':await controller.stop(id);break;
    case 'remove':await controller.remove(id);break;
    case 'reset-environment':return {ok:true,value:await controller.resetEnvironment(id)};
    case 'instance-remove-many':return {ok:true,value:await controller.queue('instance-delete',()=>require('./instance-bulk.cjs').removeMany(controller,message.ids))};
    case 'instance-reset-many':return {ok:true,value:await controller.queue('instance-reset',()=>require('./instance-bulk.cjs').resetMany(controller,message.ids))};
    case 'navigate':await controller.navigate(id,message.url);break;
    case 'toggle-devtools':return {ok:true,value:await controller.toggleDevTools(id)};
    case 'back':case 'forward':case 'reload':await controller.action(id,action);break;
    case 'settings':return {ok:true,value:await controller.settings(id,message.patch||{})};
    case 'import-subscription':return {ok:true,value:await controller.importSubscription(id,message.url,false)};
    case 'refresh-subscription':return {ok:true,value:await controller.importSubscription(id,null,true)};
    case 'import':{
     controller.store.get(id);const picked=await dialog.showOpenDialog(window,{title:'导入当前实例的 Clash 节点配置',properties:['openFile'],filters:[{name:'Clash YAML / JSON',extensions:['yaml','yml','json']}]});if(picked.canceled)return {ok:true,value:{cancelled:true}};
     const file=picked.filePaths[0];if(fs.statSync(file).size>2*1024*1024)throw Error('配置文件上限2MB');const text=fs.readFileSync(file,'utf8');const nodes=await controller.queue(id,async()=>{await controller.stopInner(id);const names=controller.store.importNodes(id,text);controller.log(id,`已导入 ${names.length} 个节点；请保存网络模式后启动`);return names;});return {ok:true,value:{nodes}};}
    default:throw Error('不支持的操作');
   }return {ok:true};
  }catch(e){controller.workspace.log('application','操作失败：'+require('./workspace.cjs').redact(e.message),'ERROR');controller.emit();return {ok:false,error:e.message};}finally{controller.flushEmit?.();}
 };
 ipcMain.handle('core:request',requestHandler);
 controller.externalRequest=message=>requestHandler({sender:window.webContents,senderFrame:window.webContents.mainFrame},message);
 return ()=>{for(const event of visibilityEvents)window.removeListener(event,sendWindowVisibility);window.webContents.removeListener('did-finish-load',sendWindowVisibility);ipcMain.removeHandler('core:request');delete controller.externalRequest;ipcMain.removeListener('core:grid-scroll',onGridScroll);ipcMain.removeListener('facet:devtools-resize',onDevToolsResize);latestScroll=null;ipcMain.removeListener('overlay:event',onOverlay);overlay.destroy();};
}
module.exports={installIPC};
