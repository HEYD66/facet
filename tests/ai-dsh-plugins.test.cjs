'use strict';
// Pure helpers around the DSH backend plugins (ask-user card, compaction transcript).
const {test}=require('node:test'),assert=require('node:assert/strict');
const {questionCard,transcript}=require('../src/main/ai-dsh.cjs');

test('ask_user_question card is bounded and keeps the model ids',()=>{
 const card=questionCard([{id:'net',question:'用哪种网络？',header:'网络',options:[{label:'代理（推荐）',description:'按出口 IP 匹配时区'},{label:''},{label:'直连'}],multiSelect:false},{question:'x'.repeat(3000),options:Array.from({length:20},(_,i)=>({label:'选项'+i})),multiSelect:true}]);
 assert.deepEqual(card[0],{id:'net',question:'用哪种网络？',header:'网络',options:[{label:'代理（推荐）',description:'按出口 IP 匹配时区'},{label:'直连'}],multiSelect:false});
 assert.equal(card[1].id,'q2');assert.equal(card[1].question.length,2000);assert.equal(card[1].options.length,10);assert.equal(card[1].multiSelect,true);
 assert.equal(questionCard(Array.from({length:12},(_,i)=>({id:'q'+i,question:'?'}))).length,8);
 assert.throws(()=>questionCard([]),/为空/);
});

test('compaction transcript drops system rows, keeps tool calls and respects the budget',()=>{
 const rows=[
  {role:'system',content:[{type:'text',text:'SYSTEM'}]},
  {role:'user',content:[{type:'text',text:'打开登录页'}]},
  {role:'assistant',content:[{type:'text',text:'好的'},{type:'tool-call',id:'c1',name:'navigate',arguments:'{"instanceId":"i1","url":"https://example.com/login"}'}]},
  {role:'tool',source:{callId:'c1'},content:[{type:'text',text:'{"requested":true}'}]},
 ];
 const parsed=JSON.parse(transcript(rows,10000));
 assert.equal(parsed.length,3);assert(!JSON.stringify(parsed).includes('SYSTEM'));assert.deepEqual(parsed[1].calls,['navigate {"instanceId":"i1","url":"https://example.com/login"}']);
 const long=JSON.parse(transcript(Array.from({length:50},()=>({role:'tool',content:[{type:'text',text:'y'.repeat(9000)}]})),20000));
 assert(long.length<5);assert.equal(long.at(-1).role,'note');assert(long.every(row=>row.role==='note'||row.text.length<=6000));
});
