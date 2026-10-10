'use strict';
let networkDraft=null,networkRows=[],networkBusy=false,networkMessage='',networkListError='';
function nodeNetworkCard(){
 const saved=state.nodeNetwork?.settings||{dnsMode:'system',routeMode:'system',interfaceName:''};
 const value=networkDraft||saved;
 const option=(id,label,current)=>`<option value="${id}" ${current===id?'selected':''}>${label}</option>`;
 const isNonDefault = value.dnsMode !== 'system' || value.routeMode !== 'system';
 const warnDns = value.dnsMode !== 'system' ? `<p class="warning-note" style="background:#fef3cd;border-left:3px solid #f4b400;padding:12px;margin:12px 0"><strong>提示：</strong>当前节点 DNS 设置为「${value.dnsMode === 'auto' ? '自动兼容' : value.dnsMode === 'strict' ? '严格模式' : '安全 DNS'}」。${value.dnsMode === 'strict' ? 'DoH 查询失败时会直接报错，彻底防止 DNS 泄露，但可能导致节点连接失败。' : '开启后会优先使用 DoH 查询公网节点域名，避免 DNS 泄露；查询失败时自动回退系统 DNS，不会影响连接。'}</p>` : '';
 return `<section class="settings-card full" id="nodeNetworkCard"><h3>节点 DNS 与出站网络</h3><div class="inner">
 <p class="actions-note">适用于代理实例及节点检测。本机 IP 直连和订阅更新沿用系统网络；设置保存后在下次启动或检测生效。</p>
 ${warnDns}
 <div id="nodeDnsAdvanced">
  <label class="field"><span>节点域名解析</span><select id="nodeDnsMode" ${networkBusy?'disabled':''}>${option('auto','自动兼容（发现 Fake-IP 或解析失败时使用安全 DNS）',value.dnsMode)}${option('system','系统 DNS',value.dnsMode)}${option('secure','安全 DNS（公网节点使用 DoH）',value.dnsMode)}${option('strict','严格模式（强制 DoH，失败不回退，彻底防泄漏）',value.dnsMode)}</select></label>
  <p class="actions-note">默认使用系统 DNS，保持原有启动行为。自动兼容和安全 DNS 会在失败时回退；严格模式不回退，彻底防止 DNS 泄露但可能连接失败。</p>
 </div>
 <label class="field"><span>连接到节点服务器的路由</span><select id="nodeRouteMode" ${networkBusy?'disabled':''}>${option('system','跟随系统路由及节点原配置',value.routeMode)}${option('physical','绕过宿主 TUN（自动选择物理网卡）',value.routeMode)}${option('interface','手动指定网卡',value.routeMode)}</select></label>
 <div id="nodeInterfaceField" ${value.routeMode==='interface'?'':'hidden'}><label class="field"><span>已连接网卡</span><select id="nodeInterfaceName" ${networkBusy?'disabled':''}>${networkRows.map(row=>`<option value="${esc(row.name)}" ${row.name===value.interfaceName?'selected':''}>${esc(row.name)} · ${row.physical?'物理网卡':'虚拟网卡'}${row.defaultRoute?' · 默认路由':''}</option>`).join('')}${value.interfaceName&&!networkRows.some(row=>row.name===value.interfaceName)?`<option value="${esc(value.interfaceName)}" selected>${esc(value.interfaceName)} · 待刷新确认</option>`:''}</select></label></div>
 <p class="actions-note">绕过宿主 TUN 会改变到节点服务器的连接路径；需要公司 VPN 或上游代理时请使用跟随系统。找不到指定网卡时会报错，不自动换路由。正在运行的实例保持原连接，请在方便时手动重启。</p>
 <div class="row"><button class="btn subtle" id="nodeNetworkRefresh" ${networkBusy?'disabled':''}>刷新网卡</button>${isNonDefault?'<button class="btn subtle" id="nodeNetworkReset" '+`${networkBusy?'disabled':''}`+'>重置为默认</button>':''}<button class="btn primary" id="nodeNetworkSave" ${networkBusy?'disabled':''}>保存网络设置</button></div>
 <p id="nodeNetworkStatus" role="status" aria-live="polite">${esc(state.nodeNetwork?.warning||networkListError||networkMessage)}</p>
 <div id="nodeNetworkInterfaces">${networkRows.length?`可用网卡：${networkRows.map(row=>esc(row.name)+(row.physical&&row.defaultRoute?'（物理默认出口）':'')).join('、')}`:''}</div>
 </div></section>`;
}
function nodeNetworkRead(){return {dnsMode:$('#nodeDnsMode').value,routeMode:$('#nodeRouteMode').value,interfaceName:$('#nodeRouteMode').value==='interface'?$('#nodeInterfaceName').value:''};}
function nodeNetworkMount(){
 const card=$('#nodeNetworkCard');if(!card)return;
 card.addEventListener('change',event=>{if(!event.target.matches('select'))return;networkDraft=nodeNetworkRead();$('#nodeInterfaceField').hidden=networkDraft.routeMode!=='interface';if(networkDraft.routeMode==='interface'&&!networkRows.length)nodeNetworkRefresh();});
 $('#nodeNetworkRefresh')?.addEventListener('click',nodeNetworkRefresh);
 $('#nodeNetworkReset')?.addEventListener('click',async()=>{
  if(networkBusy||!confirm('确认重置节点 DNS 与路由为默认设置（系统 DNS + 跟随系统路由）？'))return;
  networkBusy=true;networkMessage='正在重置…';networkListError='';settingsPage();
  try{const result=await request('node-network-save',{settings:{dnsMode:'system',routeMode:'system',interfaceName:''}});state.nodeNetwork=result;networkDraft=null;networkMessage='已重置为默认；下次实例启动或节点检测生效。';}
  catch(error){networkMessage=error.message;}
  finally{networkBusy=false;if(view==='settings')settingsPage();}
 });
 $('#nodeNetworkSave').addEventListener('click',async()=>{
  if(networkBusy)return;networkDraft=nodeNetworkRead();networkBusy=true;networkMessage='正在保存…';networkListError='';settingsPage();
  try{const result=await request('node-network-save',{settings:networkDraft});state.nodeNetwork=result;networkDraft=null;networkMessage='已保存；下次实例启动或节点检测生效，当前实例未重启。';}
  catch(error){networkMessage=error.message;}
  finally{networkBusy=false;if(view==='settings')settingsPage();}
 });
}
async function nodeNetworkRefresh(){
 if(networkBusy)return;if($('#nodeDnsMode'))networkDraft=nodeNetworkRead();networkBusy=true;networkListError='';networkMessage='正在读取网卡…';if(view==='settings')settingsPage();
 try{networkRows=await request('node-network-interfaces');networkMessage='网卡已刷新；路由选择尚未更改。';}
 catch(error){networkRows=[];networkListError=error.message;}
 finally{networkBusy=false;if(view==='settings')settingsPage();}
}
