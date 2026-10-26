'use strict';
const crypto=require('node:crypto');
function stable(v){if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));return v;}
class ProgressGuard{
 constructor(){this.seen=new Map();this.empty=0;}
 observe(name,args,result){
  const key=crypto.createHash('sha256').update(JSON.stringify(stable({name,args,result}))).digest('hex');
  const count=(this.seen.get(key)||0)+1;this.seen.set(key,count);
  const read=name==='read_page'||name==='observe'||name==='page_action'&&args.operation==='read_frame';
  const blank=name==='observe'?!result?.dialog&&!String(result?.text||'').trim()&&/没有可操作元素/.test(String(result?.elements||'')):!String(result?.text||'').trim()&&!result?.elements?.length;
  if(result?.error||read&&blank)this.empty++;
  // Navigation/click acknowledgement is not proof that a page loaded. Actual
  // content or a confirmed state change breaks the consecutive failure streak.
  else if(read||name==='act'&&(result?.added||result?.removed||result?.url||result?.title||result?.page||result?.dialog||result?.done?.value!==undefined||result?.done?.selected)||result?.handled===true||result?.filled===true||result?.shown===true||['start_instance','stop_instance'].includes(name)&&['running','stopped'].includes(result?.status))this.empty=0;
  if(count>=3&&(read||result?.error||['list_instances','get_context'].includes(name)||name==='page_action'&&['frames','wait'].includes(args.operation)))return '同一工具和参数已累计得到相同结果 3 次，已停止重复执行。';
  if(this.empty>=4)return '多次读取为空或操作失败，未获得进展，已停止继续尝试。';
  // 轮数不限时的兜底：同一工具、参数与结果完全相同累计 20 次，视为原地循环。
  if(count>=20)return '同一操作已重复 20 次且结果完全相同，判断为原地循环，已停止。';
  return '';
 }
}
module.exports={ProgressGuard};
