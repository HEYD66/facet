'use strict';
// Only public diagnostic fields leave this module; never expose proxy configuration.
const {fromProbe}=require('./exit-locale.cjs'),net=require('node:net'),crypto=require('node:crypto');
const COUNTRIES=[
 ['HK','香港',/香港|🇭🇰|hong\s?kong/i,'Asia/Hong_Kong'],['TW','台湾',/台湾|台灣|台北|🇹🇼|taiwan/i,'Asia/Taipei'],
 ['JP','日本',/日本|东京|東京|大阪|🇯🇵|japan|tokyo|osaka/i,'Asia/Tokyo'],['SG','新加坡',/新加坡|狮城|🇸🇬|singapore/i,'Asia/Singapore'],
 ['US','美国',/美国|美國|洛杉矶|圣何塞|硅谷|纽约|西雅图|芝加哥|达拉斯|凤凰城|🇺🇸|united\s?states|america|los\s?angeles|san\s?jose/i,''],
 ['KR','韩国',/韩国|韓國|首尔|🇰🇷|korea|seoul/i,'Asia/Seoul'],['GB','英国',/英国|英國|伦敦|🇬🇧|united\s?kingdom|london/i,'Europe/London'],
 ['DE','德国',/德国|德國|法兰克福|🇩🇪|germany|frankfurt/i,'Europe/Berlin'],['FR','法国',/法国|法國|巴黎|🇫🇷|france|paris/i,'Europe/Paris'],
 ['NL','荷兰',/荷兰|荷蘭|阿姆斯特丹|🇳🇱|netherlands|amsterdam/i,'Europe/Amsterdam'],['CA','加拿大',/加拿大|🇨🇦|canada/i,''],
 ['AU','澳大利亚',/澳大利亚|澳洲|悉尼|🇦🇺|australia|sydney/i,''],['RU','俄罗斯',/俄罗斯|莫斯科|🇷🇺|russia|moscow/i,''],
 ['IN','印度',/印度(?!尼)|孟买|🇮🇳|india|mumbai/i,'Asia/Kolkata'],['TR','土耳其',/土耳其|🇹🇷|turkey/i,'Europe/Istanbul'],
 ['MY','马来西亚',/马来西亚|吉隆坡|🇲🇾|malaysia/i,'Asia/Kuala_Lumpur'],['TH','泰国',/泰国|曼谷|🇹🇭|thailand/i,'Asia/Bangkok'],
 ['VN','越南',/越南|🇻🇳|vietnam/i,'Asia/Ho_Chi_Minh'],['PH','菲律宾',/菲律宾|🇵🇭|philippines/i,'Asia/Manila'],
 ['ID','印尼',/印尼|印度尼西亚|🇮🇩|indonesia/i,''],['BR','巴西',/巴西|🇧🇷|brazil/i,''],['AR','阿根廷',/阿根廷|🇦🇷|argentina/i,'America/Argentina/Buenos_Aires']
];
const CITIES=[
 ['US',/洛杉矶|圣何塞|硅谷|西雅图|los\s?angeles|san\s?jose|seattle/i,'America/Los_Angeles'],['US',/纽约|new\s?york/i,'America/New_York'],
 ['US',/芝加哥|达拉斯|chicago|dallas/i,'America/Chicago'],['US',/凤凰城|phoenix/i,'America/Phoenix'],
 ['CA',/多伦多|toronto/i,'America/Toronto'],['CA',/温哥华|vancouver/i,'America/Vancouver'],
 ['AU',/悉尼|sydney/i,'Australia/Sydney'],['AU',/珀斯|perth/i,'Australia/Perth'],['RU',/莫斯科|moscow/i,'Europe/Moscow'],
 ['ID',/雅加达|jakarta/i,'Asia/Jakarta'],['BR',/圣保罗|sao\s?paulo/i,'America/Sao_Paulo']
];
function infer(name){
 const text=String(name||''),matches=COUNTRIES.filter(([code,,words])=>words.test(text)||new RegExp(`(?<![A-Za-z0-9])(?:${code==='GB'?'GB|UK':code==='US'?'US|USA':code})(?![A-Za-z])`,'i').test(text));
 if(matches.length!==1)return null;
 const [countryCode,country,,defaultZone]=matches[0],city=CITIES.find(([code,words])=>code===countryCode&&words.test(text)),timezone=city?.[2]||defaultZone;
 const language=({US:'en-US',GB:'en-GB',CA:'en-CA',AU:'en-AU',SG:'en-SG',TW:'zh-TW',HK:'zh-HK'})[countryCode]||new Intl.Locale('und-'+countryCode).maximize().language+'-'+countryCode;
 return {countryCode,country,timezone,language,origin:'name',ambiguousTimezone:!timezone};
}
function indexes(controller){const key=(sourceId,name)=>JSON.stringify([sourceId,name]);return {key,history:new Map((controller.diagnostics.history?.list()||[]).map(h=>[key(h.sourceId,h.name),h])),live:new Map([...controller.diagnostics.results.values()].map(r=>[JSON.stringify([r.sourceId,r.name,r.kind]),r]))};}
function evidence(source,name,index){
 const sourceId=source.id,history=index.history.get(index.key(sourceId,name));
 const valid=r=>r&&(!source.updatedAt||String(r.at)>=source.updatedAt),latest=kind=>{const r=index.live.get(JSON.stringify([sourceId,name,kind]));return valid(r)&&r.error!=='已取消'?r:valid(history?.[kind]?.last)?history[kind].last:null;};
 const ip=latest('ip'),latency=latest('latency'),old=history?.ip?.lastOk;
 const success=ip?.ok?ip:valid(old)?old:null;let locale=null;
 if(success){try{locale={...fromProbe(success),origin:'measured',historical:ip?.ok!==true};}catch{const code=String(success.countryCode||'').toUpperCase();if(net.isIP(success.ip)&&/^[A-Z]{2}$/.test(code)&&!['ZZ','XX'].includes(code)){const country=new Intl.DisplayNames(['zh-CN'],{type:'region'}).of(code);if(country!==code){const language=({US:'en-US',GB:'en-GB',CA:'en-CA',AU:'en-AU',SG:'en-SG',TW:'zh-TW',HK:'zh-HK'})[code]||new Intl.Locale('und-'+code).maximize().language+'-'+code;locale={countryCode:code,country:success.country||country,language,timezone:'',origin:'measured',historical:ip?.ok!==true};}}}if(locale&&!locale.country)locale.country=new Intl.DisplayNames(['zh-CN'],{type:'region'}).of(locale.countryCode);}
 const inferred=infer(name);if(!locale&&inferred)locale=inferred;
 const redact=require('./workspace.cjs').redact;
 return {locale,ip:success?.ip||'',ipAt:success?.at||'',ipStatus:ip?ip.ok?'success':'failed':'untested',ipError:ip&&!ip.ok?redact(String(ip.error||'查询失败')).slice(0,200):'',latencyMs:latency?.ok&&Number.isFinite(latency.latencyMs)?latency.latencyMs:null,latencyAt:latency?.at||'',latencyStatus:latency?latency.ok?'success':'failed':'untested',latencyError:latency&&!latency.ok?redact(String(latency.error||'检测失败')).slice(0,200):''};
}
function describe(controller,sourceId,name){const source=controller.library.get(sourceId);controller.library.node(sourceId,name);return evidence(source,name,indexes(controller));}
function activeNodePorts(controller){const ports=new Map(),{nodeKey}=require('./node-port-registry.cjs');for(const instance of controller.store.list()){const runtime=controller.runtimes?.get(instance.id),port=runtime?.core?.proxyPort;if(instance.network.mode!=='mihomo'||!['running','starting'].includes(runtime?.status)||!runtime?.core?.child||!Number.isInteger(port))continue;const node=controller.store.nodes(instance.id).find(n=>n.name===instance.network.nodeName);if(!node)continue;const key=nodeKey(node),rows=ports.get(key)||[];rows.push({instanceId:instance.id,instanceName:instance.name,port});ports.set(key,rows);}return ports;}
function summaries(controller){const index=indexes(controller),ports=activeNodePorts(controller),{nodeKey}=require('./node-port-registry.cjs');return controller.library.summaries().map(source=>{const raw=controller.library.get(source.id),rawNodes=new Map(raw.nodes.map(node=>[node.name,node]));return {...source,nodes:source.nodes.map(node=>node.hint?node:{...node,evidence:evidence(raw,node.name,index),localProxy:controller.proxyPool?.lookup(rawNodes.get(node.name))||null,activeProxies:ports.get(nodeKey(rawNodes.get(node.name)))||[]})};});}
function assignmentUsage(controller){
 const {nodeKey}=require('./node-port-registry.cjs'),usage=new Map();
 // A stopped instance still owns its saved proxy assignment. Match full configuration, not just its display name.
 for(const instance of controller.store.list()){
  if(instance.network.mode!=='mihomo')continue;
  const node=controller.store.nodes(instance.id).find(row=>row.name===instance.network.nodeName);
  if(node){const key=nodeKey(node);usage.set(key,(usage.get(key)||0)+1);}
 }
 return usage;
}
function selectionOptions(controller){
 const {nodeKey}=require('./node-port-registry.cjs'),usage=assignmentUsage(controller),index=indexes(controller),rows=[];
 for(const summary of controller.library.summaries()){
  const source=controller.library.get(summary.id),rawNodes=new Map(source.nodes.map(node=>[node.name,node]));
  for(const row of summary.nodes){
   if(row.hint)continue;
   const node=rawNodes.get(row.name),key=nodeKey(node);
   const valid=result=>result&&Number.isFinite(Date.parse(result.at))&&(!source.updatedAt||String(result.at)>=source.updatedAt)&&result.error!=='已取消';
   const latest=[index.live.get(JSON.stringify([source.id,node.name,'latency'])),index.history.get(index.key(source.id,node.name))?.latency?.last].filter(valid).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];
   rows.push({sourceId:source.id,sourceName:source.name,name:node.name,usage:usage.get(key)||0,available:latest?.ok===true,tested:!!latest,checkedAt:latest?.at||null});
  }
 }
 return rows;
}
function selectForNewInstance(controller){
 const {nodeKey}=require('./node-port-registry.cjs'),seen=new Set(),candidates=[];
 for(const row of selectionOptions(controller)){
  if(!row.available||row.usage)continue;
  const key=nodeKey(controller.library.node(row.sourceId,row.name));if(seen.has(key))continue;seen.add(key);
  candidates.push({sourceId:row.sourceId,sourceVersion:controller.library.get(row.sourceId).updatedAt,sourceName:row.sourceName,name:row.name,usage:0,checkedAt:row.checkedAt});
 }
 return candidates.length?candidates[crypto.randomInt(candidates.length)]:null;
}
function environmentFor(evidence,base){const locale=evidence?.locale;return {...base,...(locale?.language?{language:locale.language}:{}),...(locale?.timezone?{timezone:locale.timezone}:{})};}
module.exports={infer,describe,summaries,environmentFor,selectForNewInstance,selectionOptions,assignmentUsage};
