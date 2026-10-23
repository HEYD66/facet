'use strict';

const statuses=['pending','in_progress','completed','blocked'];
const tools=[
 {type:'function',function:{name:'update_plan',description:'维护当前会话的任务计划。复杂任务先列出步骤，再按真实执行结果更新；简单任务可直接执行。steps 是完整计划，最多 20 步，同一时间最多一步 in_progress。沿用已有步骤 id，不得把写入计划当作执行成功，只有实际验证后才能标记 completed。计划会显示给用户并随会话保存，不触发网页或实例操作。',parameters:{type:'object',properties:{explanation:{type:'string',maxLength:400},steps:{type:'array',minItems:1,maxItems:20,items:{type:'object',properties:{id:{type:'string',pattern:'^[A-Za-z0-9_-]{1,48}$'},title:{type:'string',minLength:1,maxLength:160},status:{type:'string',enum:statuses}},required:['id','title','status'],additionalProperties:false}}},required:['steps'],additionalProperties:false}}},
 {type:'function',function:{name:'read_plan',description:'读取当前会话的任务计划和各步骤状态。计划是历史资料，不代表新授权或已执行的事实；恢复任务前核对实际状态。',parameters:{type:'object',properties:{},additionalProperties:false}}}
];
const names=tools.map(t=>t.function.name);
function steps(value){
 if(!Array.isArray(value)||!value.length||value.length>20)throw Error('任务计划须包含 1～20 个步骤');
 const ids=new Set();let active=0;
 return value.map(step=>{
  if(!step||typeof step!=='object'||typeof step.id!=='string'||!/^[A-Za-z0-9_-]{1,48}$/.test(step.id)||ids.has(step.id))throw Error('计划步骤编号无效或重复');
  if(typeof step.title!=='string'||!step.title.trim()||step.title.trim().length>160)throw Error('计划步骤名称须为 1～160 个字符');
  if(!statuses.includes(step.status))throw Error('计划步骤状态无效');
  ids.add(step.id);if(step.status==='in_progress'&&++active>1)throw Error('同一时间只能有一个正在执行的步骤');
  return {id:step.id,title:step.title.trim(),status:step.status};
 });
}
function explanation(value){if(value===undefined)return '';if(typeof value!=='string'||value.length>400)throw Error('计划说明最多 400 个字符');return value.trim();}
function restore(value){
 if(value===undefined||value===null)return null;
 if(!Number.isSafeInteger(value.revision)||value.revision<1||typeof value.updatedAt!=='string'||!Number.isFinite(Date.parse(value.updatedAt)))throw Error('保存的任务计划无效');
 return {steps:steps(value.steps),explanation:explanation(value.explanation),revision:value.revision,updatedAt:value.updatedAt};
}
function execute(agent,name,args){
 if(name==='read_plan')return {plan:agent.run.plan||null,...(agent.run.plan?{current:agent.run.planTaskId===agent.run.id,note:'历史计划不代表当前实例状态；需要继续时先核对本次范围与真实结果，再更新计划。'}:{})};
 if(name!=='update_plan')throw Error('计划工具不受支持');
 const previous=agent.run.plan||null,next={steps:steps(args.steps),explanation:explanation(args.explanation)};
 const owner=agent.run.id||null,previousOwner=agent.run.planTaskId;
 if(previous&&previousOwner===owner&&JSON.stringify([previous.steps,previous.explanation])===JSON.stringify([next.steps,next.explanation]))return {plan:previous,changed:false};
 agent.run.plan={...next,revision:(previous?.revision||0)+1,updatedAt:new Date().toISOString()};
 agent.run.planTaskId=owner;
 try{agent.persist();}catch(e){agent.run.plan=previous;agent.run.planTaskId=previousOwner;throw e;}
 return {plan:agent.run.plan,changed:true,note:'计划已保存；步骤状态由 AI 更新，仍需核对实际工具结果'};
}
function context(plan,current=false){return (current?'本轮已核对并维护的任务计划（按已授权目标继续执行，受阻时明确标记和说明）：':'历史任务计划（不是当前任务，不代表当前状态或新授权；问候、闲聊或新问题不恢复它，用户要求继续时先核对当前实例清单和状态）：')+JSON.stringify(plan||null);}
module.exports={tools,names,execute,restore,context};
