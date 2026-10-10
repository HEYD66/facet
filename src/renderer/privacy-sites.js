'use strict';
const privacySites=Object.freeze([
 {id:'ipleak',name:'ipleak.net',url:'https://ipleak.net/',note:'IP · DNS · WebRTC',icon:'search',tone:'blue'},
 {id:'browserleaks',name:'browserleaks.com/dns',url:'https://browserleaks.com/dns',note:'DNS 泄露检测',icon:'globe',tone:'purple'},
 {id:'dnsleaktest',name:'dnsleaktest.com',url:'https://dnsleaktest.com/',note:'标准 / 扩展 DNS 检测',icon:'monitor',tone:'green'},
 {id:'ippure',name:'ippure.com',url:'https://ippure.com/',note:'IP 信息与风险检测',icon:'shield',tone:'orange'}
]);
let privacyMenuFor=null,privacyMenuClosedAt=0,privacyMenuKey='';
function privacySitesButtonHTML(){return `<button type="button" class="privacy-sites-trigger" data-privacy-toggle aria-label="隐私检测网站" title="展开隐私检测网站" aria-haspopup="dialog" aria-expanded="${privacyMenuFor===activeId}">${icon('shield')}<span>检测</span>${icon('chevron')}</button>`;}
function privacySitesMenuHTML(x){return `<div class="privacy-sites-menu"><header><strong>隐私检测</strong><small title="${esc(x.name)}">${esc(x.name)}</small></header><div class="privacy-sites-list">${privacySites.map(site=>`<button type="button" class="privacy-site ${site.tone}" data-privacy-site="${site.id}" data-instance-id="${esc(x.id)}" ${x.status!=='running'||quickNavigating.has(x.id)?'disabled':''}><span class="privacy-site-icon">${icon(site.icon)}</span><span class="privacy-site-label"><b>${site.name}</b><small>${site.note}</small></span>${icon('arrow')}</button>`).join('')}</div><p class="privacy-sites-note">${x.status==='running'?`在当前实例打开 · ${x.network.mode==='direct'?'使用实例直连网络':'沿用当前代理'}`:'请先启动当前实例'}</p></div>`;}
function privacyMenuNative(){return !!window.facet?.onOverlay;}
function closePrivacySitesMenu(returnFocus=false){const was=!!privacyMenuFor;privacyMenuFor=null;privacyMenuKey='';$('[data-privacy-toggle]')?.setAttribute('aria-expanded','false');if(!was)return;if(privacyMenuNative())window.facet.request('overlay-hide').catch(()=>{});else{document.getElementById('privacySitesMenu')?.close();layout();}if(returnFocus)$('[data-privacy-toggle]')?.focus();}
function syncPrivacySitesMenu(){
 if(!privacyMenuFor)return;
 const x=current(),button=$('[data-privacy-toggle]');
 if(view!=='browser'||x?.id!==privacyMenuFor||!button||modal||document.querySelector('dialog[data-browser-overlay][open]:not(#privacySitesMenu)')){closePrivacySitesMenu();return;}
 button.setAttribute('aria-expanded','true');const r=button.getBoundingClientRect(),html=privacySitesMenuHTML(x),attrs=extensionMenuAttrs(),key=JSON.stringify([html,attrs,r.right,r.bottom]);
 if(privacyMenuNative()){if(key!==privacyMenuKey){privacyMenuKey=key;window.facet.request('overlay-show',{html,anchor:{right:r.right,bottom:r.bottom},width:310,attrs,label:'隐私检测网站',update:true}).catch(()=>closePrivacySitesMenu());}}
 else{const d=document.getElementById('privacySitesMenu');if(!d?.open)return;d.innerHTML=html;d.style.width='310px';d.style.left=Math.max(8,Math.min(r.right-310,innerWidth-318))+'px';d.style.top=(r.bottom+6)+'px';}
}
async function openPrivacySitesMenu(){
 const x=current(),button=$('[data-privacy-toggle]');if(!x||!button)return;
 closeExtensionMenu();privacyMenuFor=x.id;button.setAttribute('aria-expanded','true');
 if(privacyMenuNative()){const r=button.getBoundingClientRect(),html=privacySitesMenuHTML(x),attrs=extensionMenuAttrs();privacyMenuKey=JSON.stringify([html,attrs,r.right,r.bottom]);try{await request('overlay-show',{html,anchor:{right:r.right,bottom:r.bottom},width:310,attrs,label:'隐私检测网站'});}catch(e){closePrivacySitesMenu();toast(e.message);}return;}
 let d=document.getElementById('privacySitesMenu');if(!d){d=document.createElement('dialog');d.id='privacySitesMenu';d.className='ext-menu';d.setAttribute('data-browser-overlay','');d.setAttribute('aria-label','隐私检测网站');document.body.append(d);}
 d.show();syncPrivacySitesMenu();layout();d.querySelector('button:not(:disabled)')?.focus();
}
async function openPrivacySite(siteId,instanceId){
 const site=privacySites.find(row=>row.id===siteId),x=current();if(!site||!x||view!=='browser'||x.id!==instanceId)return;
 closePrivacySitesMenu();if(x.status!=='running'){toast('请先启动当前实例');return;}if(quickNavigating.has(x.id))return;
 quickNavigating.add(x.id);render();try{await request('navigate',{id:x.id,url:site.url});}catch(e){if(!String(e.message).includes('ERR_ABORTED'))toast(e.message);}finally{quickNavigating.delete(x.id);render();}
}
window.facet?.onOverlay?.(e=>{if(e?.type==='closed'&&privacyMenuFor){privacyMenuFor=null;privacyMenuKey='';privacyMenuClosedAt=Date.now();$('[data-privacy-toggle]')?.setAttribute('aria-expanded','false');if(e.reason==='escape')$('[data-privacy-toggle]')?.focus();}else if(e?.type==='action'&&e.data?.privacySite)openPrivacySite(e.data.privacySite,e.data.instanceId);});
document.addEventListener('click',e=>{if(e.target.closest('[data-privacy-toggle]')){if(privacyMenuFor)closePrivacySitesMenu(true);else if(Date.now()-privacyMenuClosedAt>=350)openPrivacySitesMenu();}const b=e.target.closest('[data-privacy-site]');if(b&&!b.disabled)openPrivacySite(b.dataset.privacySite,b.dataset.instanceId);});
document.addEventListener('mousedown',e=>{if(privacyMenuFor&&!e.target.closest('[data-privacy-toggle],#privacySitesMenu'))closePrivacySitesMenu();},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&privacyMenuFor){e.preventDefault();closePrivacySitesMenu(true);}},true);
window.addEventListener('resize',syncPrivacySitesMenu);
