'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const b=require('../src/main/ai-browser.cjs');

test('tool schemas expose observe/act/dialog only',()=>{
 assert.deepEqual(b.names,['observe','act','dialog']);
 const act=b.tools.find(t=>t.function.name==='act').function.parameters;
 assert.deepEqual(act.required,['instanceId','action']);
 assert(act.properties.action.enum.includes('type'));
});

test('keyDef maps named keys, characters and modifier combos',()=>{
 assert.deepEqual(b.keyDef('Enter'),{key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',modifiers:0});
 const selectAll=b.keyDef('Control+a');assert.equal(selectAll.modifiers,2);assert.equal(selectAll.code,'KeyA');assert.equal(selectAll.text,undefined);
 assert.equal(b.keyDef('Shift+a').text,'A');
 assert.equal(b.keyDef('Space').key,' ');
 assert.equal(b.keyDef('F5').windowsVirtualKeyCode,116);
 assert.throws(()=>b.keyDef('Hyper+x'),/修饰键/);
 assert.throws(()=>b.keyDef('NotAKey'),/不支持/);
 assert.throws(()=>b.keyDef(''),/按键无效/);
});

test('matchFrames pairs child frames with iframe boxes',()=>{
 const boxes=[{name:'',src:'https://a.test/x'},{name:'pay',src:'https://b.test/y'}];
 assert.deepEqual(b.matchFrames([{url:'https://a.test/x',name:''},{url:'https://b.test/y',name:'pay'}],boxes),[0,1]);
 // Count mismatch: fall back to name, then unique origin.
 assert.deepEqual(b.matchFrames([{url:'https://b.test/z',name:'pay'}],boxes),[1]);
 assert.deepEqual(b.matchFrames([{url:'https://a.test/other',name:''}],boxes),[0]);
 // Ambiguous: coordinates unknown (-1) rather than guessing.
 assert.deepEqual(b.matchFrames([{url:'https://c.test/',name:''}],boxes),[-1]);
 // Redirected iframe whose origin no longer matches its src is not paired by index.
 assert.deepEqual(b.matchFrames([{url:'https://z.test/',name:''},{url:'https://b.test/y',name:'pay'}],boxes),[-1,1]);
});

test('diff reports added and removed elements by role and name',()=>{
 const f={depth:0},el=(ref,role,name)=>({f,e:{ref,role,name,f:[],iv:true}});
 const before=[el('e1','button','Save'),el('e2','button','Cancel'),el('e3','link','Help')];
 const after=[el('e1','button','Save'),el('e9','button','Cancel'),el('e7','textbox','Comment')];
 const d=b.diff(before,after);
 assert.deepEqual(d.added,['e7 textbox "Comment"']);
 assert.deepEqual(d.removed,['link "Help"']);
});

test('line renders value, flags and offscreen marker',()=>{
 assert.equal(b.line({ref:'e4',role:'textbox',name:'Email',v:'a@b.c',f:['required'],iv:false}),'e4 textbox "Email" value="a@b.c" [required] [视口外]');
});

test('only the newest screenshot is sent and none are persisted',()=>{
 const msgs=[{role:'user',content:'task'},b.shotMessage(['data:image/jpeg;base64,AAA']),{role:'assistant',content:'x'},b.shotMessage(['data:image/jpeg;base64,BBB'])];
 b.pruneShots(msgs);
 assert.equal(msgs[1].content,b.SHOT_TAG+' 旧截图已移除');
 assert.equal(msgs[3].content[1].image_url.url,'data:image/jpeg;base64,BBB');
 const stored=b.stripShots(msgs);
 assert(!JSON.stringify(stored).includes('base64'));
 assert.equal(stored[0].content,'task');
 // User-attached images are not screenshots and are kept.
 const user={role:'user',content:[{type:'text',text:'看图'},{type:'image_url',image_url:{url:'data:image/png;base64,CCC'}}]};
 assert.equal(b.isShot(user),false);assert.deepEqual(b.stripShots([user]),[user]);
});
