'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Memory}=require('../src/main/ai-memory.cjs');

const turn=(tag,toolChars)=>[
 {role:'user',content:'任务 '+tag},
 {role:'assistant',content:null,tool_calls:[{id:'c-'+tag,type:'function',function:{name:'observe',arguments:'{}'}}]},
 {role:'tool',tool_call_id:'c-'+tag,content:'开头'+tag+'x'.repeat(toolChars)+'结尾'+tag},
 {role:'assistant',content:'完成 '+tag}
];

test('earlier tasks resend long tool results as head and tail; stored memory is untouched',()=>{
 const m=new Memory();m.add(['a'],turn('1',20000));m.add(['a'],turn('2',20000));m.add(['a'],turn('3',3000));
 const stored=JSON.stringify(m.export()),sent=m.context(['a']),tools=sent.filter(x=>x.role==='tool');
 assert.equal(sent.length,12,'message structure (tool_call ids) is preserved');
 assert(tools[0].content.length<1400&&tools[1].content.length<1400,'older turns are slimmed');
 for(const [i,t] of tools.entries()){assert(t.content.startsWith('开头'+(i+1)));assert(t.content.endsWith('结尾'+(i+1)));}
 assert(tools[0].content.includes('已精简'));assert.equal(tools[2].content,turn('3',3000)[2].content,'the latest task keeps a moderate result in full');
 assert.equal(JSON.stringify(m.export()),stored,'slimming happens only on what is sent');
 // The latest task is trimmed too when its results are very long, but keeps more than older ones.
 m.add(['a'],turn('4',30000));const latest=m.context(['a']).filter(x=>x.role==='tool').at(-1);
 assert(latest.content.length>3000&&latest.content.length<4200&&latest.content.endsWith('结尾4'));
 // User and assistant text is never shortened.
 m.add(['a'],[{role:'user',content:'长要求'.repeat(5000)},{role:'assistant',content:'长答复'.repeat(5000)}]);
 const last=m.context(['a']).slice(-2);assert.equal(last[0].content.length,15000);assert.equal(last[1].content.length,15000);
});

test('memory compresses on what is actually resent, earlier for a small context window',async()=>{
 const fake=windowTokens=>({run:{abort:new AbortController()},contextWindow:()=>windowTokens,completion:async()=>({content:'摘要'})});
 // Large tool results that slimming removes do not force a compression by themselves.
 const a=new Memory();for(let i=0;i<4;i++)a.add(['x'],turn(String(i),40000));
 await a.compress(fake(128000),['x']);assert.equal(a.compressions,0);
 // Text that is really resent: 4 turns of about 6K characters.
 const text=()=>{const m=new Memory();for(let i=0;i<4;i++)m.add(['x'],[{role:'user',content:'资料'.repeat(1500)},{role:'assistant',content:'好'}]);return m;};
 const big=text();await big.compress(fake(128000),['x']);assert.equal(big.compressions,0,'below 48K characters for a 128K window');
 const small=text();await small.compress(fake(16384),['x']);assert.equal(small.compressions,1,'a 16K window compresses at 12K characters');
 assert.equal(small.turns.length,2,'the last two tasks stay verbatim');assert.equal(small.summary,'摘要');
 // Callers without a context window keep the previous 48K rule.
 const plain=text();await plain.compress({run:{abort:new AbortController()},completion:async()=>({content:'摘要'})},['x']);assert.equal(plain.compressions,0);
});
