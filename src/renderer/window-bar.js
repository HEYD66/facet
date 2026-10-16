'use strict';
// 资源占用轮询 + 自绘标题栏。
// 自绘标题栏仅在 Windows 自定义边框时启用：颜色跟随主题与配色，右侧系统按钮同步换色，显示整个应用的 CPU / GPU / 内存（含 Mihomo 内核）。
// 轮询每 2 秒一次，结果同时以 facet-metrics 事件广播给宫格页（每个格子显示自己实例的占用）；
// 既没有标题栏、也不在宫格页，或窗口最小化 / 不可见时不轮询。
(()=>{
 const root=document.documentElement,api=window.facet,bar=document.getElementById('windowBar');if(!api)return;
 const custom=root.dataset.frame==='custom'&&!!bar;
 const size=mb=>mb>=1024?`${(mb/1024).toFixed(mb>=10240?1:2)} GB`:`${Math.max(0,Math.round(mb))} MB`;
 window.facetSize=size;
 // 小于 10% 显示一位小数，空闲时也能看出变化。
 const pct=v=>{v=Math.max(0,Number(v)||0);return v<10?`${v.toFixed(1)}%`:`${Math.round(v)}%`;};window.facetPct=pct;
 if(custom){
  const parse=value=>{let c=String(value||'').trim(),m=c.match(/^#([0-9a-f]{3})$/i);if(m)c='#'+[...m[1]].map(x=>x+x).join('');m=c.match(/^#([0-9a-f]{6})$/i);if(m)return [0,2,4].map(i=>parseInt(m[1].slice(i,i+2),16));m=c.match(/^rgba?\(([^)]+)\)$/);return m?m[1].split(/[\s,\/]+/).slice(0,3).map(Number):null;};
  const hex=rgb=>'#'+rgb.map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')).join('');
  let sent='';
  const sync=()=>{
   const cs=getComputedStyle(root),bg=parse(cs.getPropertyValue('--bg')),text=parse(cs.getPropertyValue('--text'));if(!bg||!text)return;
   // 比工作区背景略深/略亮一点，和下方标签行区分开，但仍属于同一配色。
   const k=root.dataset.theme==='dark'?.07:.055,color=hex(bg.map((v,i)=>v+(text[i]-v)*k)),symbolColor=hex(text);
   root.style.setProperty('--winbar',color);
   if(color+symbolColor===sent)return;sent=color+symbolColor;
   Promise.resolve(api.request('window-chrome',{color,symbolColor})).catch(()=>{});
  };
  new MutationObserver(sync).observe(root,{attributes:true,attributeFilter:['data-theme','data-light-palette','data-dark-palette']});sync();
 }
 // 全部静音：所有实例（含弹窗）都不出声，记住到下次启动；单个实例在宫格格子上静音。
 if(custom){
  const btn=document.getElementById('muteAll');let muted=null;
  const paint=value=>{value=value===true;if(value===muted)return;muted=value;btn.innerHTML=typeof speakerIcon==='function'?speakerIcon(muted):'';btn.classList.toggle('on',muted);btn.setAttribute('aria-pressed',String(muted));btn.title=muted?'已全部静音：点击恢复声音':'全部静音（所有实例和弹窗都不出声，重启后仍保持）';btn.setAttribute('aria-label',muted?'取消全部静音':'全部静音');};
  paint(false);api.onState(s=>paint(s?.audioMuted));Promise.resolve(api.request('snapshot')).then(r=>r?.ok&&paint(r.value?.audioMuted)).catch(()=>{});
  btn.addEventListener('click',async()=>{btn.disabled=true;try{const r=await api.request('audio-mute',{muted:!muted});if(r?.ok)paint(r.value?.global);}catch{}finally{btn.disabled=false;}});
 }
 const show=v=>{
  if(!custom)return;const meter=document.getElementById('resMeter');
  meter.querySelector('[data-cpu]').textContent=pct(v.cpu);
  const g=meter.querySelector('[data-gpu]');g.textContent=v.gpu==null?'—':pct(v.gpu);meter.querySelectorAll('.res-gpu').forEach(el=>el.hidden=v.gpu===undefined);
  meter.querySelector('[data-mem]').textContent=size(v.memoryMB);
  const d=v.breakdown;meter.title=(d?`内存分项：网页/扩展/界面 ${size(d.rendererMB)}；主进程 ${size(d.mainMB)}；GPU 进程 ${size(d.gpuMB)}；网络等 ${size(d.utilityMB)}；代理 ${size(d.coreMB)}；进程保护 ${size(d.hostMB)}；采样 ${size(d.samplerMB)}。\n`:'')+`共 ${v.totalProcesses??v.processes+v.cores} 个进程。Windows 内存为私有提交量（不是实际驻留物理内存）；代理与辅助进程每 5 秒采样。${v.memoryComplete===false?'部分进程采样失败，当前合计不完整。':''}\nCPU 为 Electron 进程按总核数折算；GPU 为最忙引擎利用率，GPU 进程内存不是专用显存。`;
 };
 const wanted=()=>!document.hidden&&(custom||(typeof view!=='undefined'&&view==='grid'));
 let busy=false;
 const tick=async()=>{
  if(busy||!wanted())return;busy=true;
  try{const r=await api.request('app-metrics');if(r?.ok&&r.value){show(r.value);window.dispatchEvent(new CustomEvent('facet-metrics',{detail:r.value}));}}
  catch{}finally{busy=false;}
 };
 setInterval(tick,2000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
 window.facetMetricsNow=tick;
 tick();
})();
