'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {applyDefaultRulesets,defaultRulesets,plan,FILE}=require('../src/main/extension-dnr-rulesets.cjs');

const manifest=(rules)=>({manifest_version:3,declarative_net_request:{rule_resources:rules}});
function profile(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'facet-dnr-'));return {dir,session:{getStoragePath:()=>dir}};}
// Fake extension origin: executeJavaScript evaluates the generated script against a fake DNR API.
function fakeElectron(dnr,{hang=false}={}){
  const log={windows:0,destroyed:0,urls:[],updates:[]};
  const api={getEnabledRulesets:async()=>[...dnr.enabled],updateEnabledRulesets:async options=>{log.updates.push(JSON.parse(JSON.stringify(options)));if(dnr.fail)throw Error(dnr.fail);for(const id of options.enableRulesetIds||[])if(!dnr.enabled.includes(id))dnr.enabled.push(id);}};
  class BrowserWindow{
    constructor(options){log.windows++;assert.equal(options.show,false);assert.equal(options.webPreferences.sandbox,true);this.destroyedFlag=false;this.webContents={setWindowOpenHandler(){},executeJavaScript:code=>hang?new Promise(()=>{}):Promise.resolve(vm.runInNewContext(code,{chrome:{declarativeNetRequest:api}})).then(v=>JSON.parse(JSON.stringify(v)))};}
    async loadURL(url){log.urls.push(url);}
    isDestroyed(){return this.destroyedFlag;}
    destroy(){this.destroyedFlag=true;log.destroyed++;}
  }
  return {BrowserWindow,log};
}
const marker=dir=>JSON.parse(fs.readFileSync(path.join(dir,FILE),'utf8'));

test('defaultRulesets reads only manifest-enabled static rulesets',()=>{
  assert.equal(defaultRulesets({}),null);
  assert.equal(defaultRulesets(manifest([])),null);
  assert.deepEqual(defaultRulesets(manifest([{id:'a',enabled:true,path:'a.json'},{id:'b',enabled:false,path:'b.json'},{id:'a',enabled:true,path:'a.json'},{enabled:true},null])),['a']);
});

test('plan applies defaults on install and only newly default rulesets on update',()=>{
  assert.equal(plan({fingerprint:'x',defaults:['a']},'x',['a']),null);
  assert.deepEqual(plan(undefined,'x',['a','b']),{mode:'install',enable:['a','b']});
  assert.deepEqual(plan({fingerprint:'x',defaults:['a']},'y',['a','b']),{mode:'update',enable:['b']});
});

test('first start enables manifest defaults once and records the package fingerprint',async()=>{
  const {dir,session}=profile(),dnr={enabled:[]},{BrowserWindow,log}=fakeElectron(dnr);
  const items=[{key:'ext-1',extension:{id:'abc',manifest:manifest([{id:'on',enabled:true,path:'on.json'},{id:'off',enabled:false,path:'off.json'}])},fingerprint:'sha-1'}];
  const [result]=await applyDefaultRulesets(session,items,{BrowserWindow});
  assert.equal(result.ok,true);assert.deepEqual(result.value,{enabled:['on']});assert.deepEqual(dnr.enabled,['on']);
  assert.deepEqual(log.urls,['chrome-extension://abc/manifest.json']);assert.equal(log.destroyed,1);
  assert.deepEqual(marker(dir).extensions.abc,{fingerprint:'sha-1',defaults:['on']});
  dnr.enabled=[];// the extension later disables its ruleset itself
  assert.deepEqual(await applyDefaultRulesets(session,items,{BrowserWindow}),[]);
  assert.equal(log.windows,1);assert.deepEqual(dnr.enabled,[]);
});

test('an existing enabled set is kept on first sight and update only adds new defaults',async()=>{
  const {dir,session}=profile(),dnr={enabled:['custom']},{BrowserWindow,log}=fakeElectron(dnr);
  const item=(fingerprint,rules)=>[{key:'ext-1',extension:{id:'abc',manifest:manifest(rules)},fingerprint}];
  const [kept]=await applyDefaultRulesets(session,item('sha-1',[{id:'a',enabled:true,path:'a.json'},{id:'custom',enabled:false,path:'c.json'}]),{BrowserWindow});
  assert.deepEqual(kept.value,{kept:['custom']});assert.equal(log.updates.length,0);
  const [updated]=await applyDefaultRulesets(session,item('sha-2',[{id:'a',enabled:true,path:'a.json'},{id:'b',enabled:true,path:'b.json'},{id:'custom',enabled:false,path:'c.json'}]),{BrowserWindow});
  assert.equal(updated.mode,'update');assert.deepEqual(log.updates,[{enableRulesetIds:['b']}]);assert.deepEqual(dnr.enabled,['custom','b']);
  assert.deepEqual(marker(dir).extensions.abc,{fingerprint:'sha-2',defaults:['a','b']});
});

test('failures and timeouts are reported, close the window and retry on the next start',async()=>{
  const {dir,session}=profile(),dnr={enabled:[],fail:'规则文件无效'},{BrowserWindow,log}=fakeElectron(dnr);
  const items=[{key:'ext-1',extension:{id:'abc',manifest:manifest([{id:'on',enabled:true,path:'on.json'}])},fingerprint:'sha-1'}];
  const [failed]=await applyDefaultRulesets(session,items,{BrowserWindow});
  assert.equal(failed.ok,false);assert.match(failed.error,/规则文件无效/);assert.equal(fs.existsSync(path.join(dir,FILE)),false);assert.equal(log.destroyed,1);
  delete dnr.fail;const [retried]=await applyDefaultRulesets(session,items,{BrowserWindow});assert.equal(retried.ok,true);assert.deepEqual(dnr.enabled,['on']);
  const slow=fakeElectron({enabled:[]},{hang:true}),other=profile();
  const [timedOut]=await applyDefaultRulesets(other.session,items,{BrowserWindow:slow.BrowserWindow,timeout:30});
  assert.equal(timedOut.ok,false);assert.match(timedOut.error,/超时/);assert.equal(slow.log.destroyed,1);
});

test('extensions without static rulesets never open an extension page',async()=>{
  const {dir,session}=profile(),{BrowserWindow,log}=fakeElectron({enabled:[]});
  const items=[{key:'ext-1',extension:{id:'abc',manifest:{manifest_version:3}},fingerprint:'sha-1'},{key:'ext-2',extension:{id:'def',manifest:manifest([{id:'off',enabled:false,path:'off.json'}])},fingerprint:'sha-2'}];
  const results=await applyDefaultRulesets(session,items,{BrowserWindow});
  assert.equal(log.windows,0);assert.deepEqual(results.map(x=>[x.key,x.ok,x.value]),[['ext-2',true,null]]);
  assert.deepEqual(marker(dir).extensions,{def:{fingerprint:'sha-2',defaults:[]}});
});
