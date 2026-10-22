'use strict';
const net=require('node:net'),crypto=require('node:crypto');
function fromProbe(result){
 const code=String(result.countryCode||'').toUpperCase();
 if(!net.isIP(result.ip)||!result.timezone||!/^[A-Z]{2}$/.test(code)||['ZZ','XX'].includes(code))throw Error('出口服务未返回完整的 IP、国家和时区，未生成地区环境');
 new Intl.DateTimeFormat('en',{timeZone:result.timezone});
 // Regional default only: multilingual countries may use another valid language.
 const preferred={US:'en-US',GB:'en-GB',CA:'en-CA',AU:'en-AU',NZ:'en-NZ',SG:'en-SG',CN:'zh-CN',TW:'zh-TW',HK:'zh-HK',MO:'zh-MO'};
 const locale=new Intl.Locale('und-'+code).maximize();
 const language=preferred[code]||Intl.getCanonicalLocales(locale.language+'-'+code)[0];
 return {ip:result.ip,countryCode:code,country:result.country||'',timezone:result.timezone,language,provider:result.provider||'',queriedAt:result.queriedAt||'',cached:result.cached===true};
}
async function lookup(controller,node,{force=false,signal}={}){
 signal?.throwIfAborted();
 const abort=new AbortController(),task={abort,promise:null};
 task.promise=controller.diagnostics.probe(node,'ip',signal?AbortSignal.any([signal,abort.signal]):abort.signal,'locale-'+crypto.randomUUID(),false,{force,requireLocale:true}).then(fromProbe).catch(error=>{signal?.throwIfAborted();throw Error('出口地区同步失败，未创建实例；请重试或取消地区同步后自行设置。'+(error.safeDiagnostic?' '+error.safeDiagnostic:''));}).finally(()=>controller.diagnostics.standalone.delete(task));
 controller.diagnostics.standalone.add(task);return task.promise;
}
module.exports={fromProbe,lookup};
