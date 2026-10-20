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
// 长任务的上下文控制：本轮消息过大时，把较早的工具结果替换为摘要占位，保留最近 8 条完整结果。
// 只改 tool 消息的 content，tool_call_id 配对不变，协议仍然有效。
const TURN_LIMIT=200000,KEEP_TOOLS=8;
function compactTurn(messages,start){
 const size=()=>messages.slice(start).reduce((n,m)=>n+(typeof m.content==='string'?m.content.length:JSON.stringify(m.content||'').length)+(m.tool_calls?JSON.stringify(m.tool_calls).length:0),0);
 if(size()<=TURN_LIMIT)return 0;
 const tools=[];for(let i=start;i<messages.length;i++)if(messages[i].role==='tool')tools.push(i);
 let changed=0;
 for(const i of tools.slice(0,Math.max(0,tools.length-KEEP_TOOLS))){
  const c=String(messages[i].content||'');if(c.length<=400||c.startsWith('{"compacted"'))continue;
  messages[i]={...messages[i],content:JSON.stringify({compacted:true,note:'较早的工具结果已省略以控制上下文；需要时请重新查询',head:c.slice(0,300)})};changed++;
  if(size()<=TURN_LIMIT)break;
 }
 return changed;
}
module.exports={ProgressGuard,compactTurn};
