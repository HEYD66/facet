'use strict';
const crypto=require('node:crypto');
function stable(v){if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));return v;}
class ProgressGuard{
 constructor(){this.seen=new Map();this.empty=0;}
 observe(name,args,result){
  const key=crypto.createHash('sha256').update(JSON.stringify(stable({name,args,result}))).digest('hex');
  const count=(this.seen.get(key)||0)+1;this.seen.set(key,count);
  const read=name==='read_page'||name==='page_action'&&args.operation==='read_frame';
  if(result?.error||read&&!String(result?.text||'').trim()&&!result?.elements?.length)this.empty++;
  // Navigation/click acknowledgement is not proof that a page loaded. Actual
  // content or a confirmed state change breaks the consecutive failure streak.
  else if(read||result?.filled===true||result?.shown===true||['start_instance','stop_instance'].includes(name)&&['running','stopped'].includes(result?.status))this.empty=0;
  if(count>=3&&(read||result?.error||['list_instances','get_context'].includes(name)||name==='page_action'&&['frames','wait'].includes(args.operation)))return '同一工具和参数已累计得到相同结果 3 次，已停止重复执行。';
  if(this.empty>=4)return '多次读取为空或操作失败，未获得进展，已停止继续尝试。';
  return '';
 }
}
module.exports={ProgressGuard};
