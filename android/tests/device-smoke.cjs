'use strict';
const {execFileSync}=require('node:child_process');
const {fs,path,os,http,assert,out,checks,servers,reverses,forwards,browsers,cmd,pause,wait,ui,click,open,connect,proxy,listen,pkg,adb,deviceArgs}=require('./device-tools.cjs');
(async()=>{let error;try{
assert.equal(cmd('get-state'),'device','ADB device must be connected and authorized');assert.equal(cmd('shell','pm','list','packages',pkg),'package:'+pkg,'Install the prototype APK before running this test');
cmd('push',path.join(__dirname,'../build/input-helper/facet-input.jar'),'/data/local/tmp/facet-input.jar');
const a=await listen('proxy-A'),b=await listen('proxy-B'),origin=await listen('direct-origin',true),url='http://facet-'+Date.now()+'.invalid:'+origin.address().port,directUrl='http://127.0.0.1:'+origin.address().port;
cmd('shell','am','force-stop',pkg);
await open(1);let one=await connect(1);await proxy('http://127.0.0.1:'+a.address().port);await one.goto(url);assert.equal(await one.title(),'Facet proxy-A');
await one.evaluate(()=>{localStorage.setItem('facet-test-profile','one');document.cookie='facet-test=one; Max-Age=3600; Path=/; SameSite=Lax';});await one.reload();checks.push('Instance 1 uses proxy A and stores its own test session');
await open(2);let two=await connect(2);await proxy('http://127.0.0.1:'+b.address().port);await two.goto(url);assert.equal(await two.title(),'Facet proxy-B');assert.deepEqual(await two.evaluate(()=>({value:localStorage.getItem('facet-test-profile'),cookie:document.cookie})),{value:null,cookie:''});
await two.evaluate(()=>{localStorage.setItem('facet-test-profile','two');document.cookie='facet-test=two; Max-Age=3600; Path=/; SameSite=Lax';});await two.reload();assert.equal(await one.evaluate(()=>localStorage.getItem('facet-test-profile')),'one');checks.push('Two simultaneous processes use different proxies and isolated Cookie/localStorage on the same origin');assert.equal(origin.hits,0);
// WebView commits DOM storage asynchronously. Test restart after the normal
// persistence interval, rather than claiming a kill immediately after JS writes is durable.
await pause(6500);for(const browser of browsers.splice(0))await browser.close();cmd('shell','am','force-stop',pkg);
await open(1);one=await connect(1);await wait(async()=>await one.title()==='Facet proxy-A','restored proxy A');assert.deepEqual(await one.evaluate(()=>({value:localStorage.getItem('facet-test-profile'),cookie:document.cookie})),{value:'one',cookie:'facet-test=one'});
await open(2);two=await connect(2);await wait(async()=>await two.title()==='Facet proxy-B','restored proxy B');assert.deepEqual(await two.evaluate(()=>({value:localStorage.getItem('facet-test-profile'),cookie:document.cookie})),{value:'two',cookie:'facet-test=two'});checks.push('Force-stop/restart retains both independent sessions, URLs and proxy settings');
await proxy('http://127.0.0.1:1');let failed=false;try{await two.goto(directUrl+'/blocked',{timeout:12000});}catch{failed=true;}assert(failed,'Broken proxy must fail');await pause(300);assert.equal(origin.hits,0);assert(ui().includes('加载失败'));checks.push('Unavailable proxy fails visibly without HTTP fallback to direct origin');
await proxy('');await two.goto(directUrl+'/direct');assert.equal(await two.title(),'Facet direct-origin');assert(origin.hits>0);checks.push('Explicit system-network mode loads the actual direct origin');
await two.goto('https://example.com').catch(()=>{});await open(1);await proxy('');await one.goto('https://example.com').catch(()=>{});cmd('shell','am','start','-f','0x00020000','-n',pkg+'/.MainActivity');await pause(400);
fs.writeFileSync(path.join(out,'prototype.png'),execFileSync(adb,[...deviceArgs,'exec-out','screencap','-p'],{windowsHide:true,timeout:10000}));
}catch(e){error=e.stack;}finally{for(const browser of browsers)await browser.close().catch(()=>{});if(error)cmd('shell','am','force-stop',pkg);for(const p of forwards)try{cmd('forward','--remove','tcp:'+p);}catch{}for(const p of reverses)try{cmd('reverse','--remove','tcp:'+p);}catch{}try{cmd('shell','rm','-f','/data/local/tmp/facet-input.jar','/sdcard/facet-prototype-ui.xml');}catch{}for(const s of servers)s.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,error},null,2));console.log(JSON.stringify({out,checks,error},null,2));process.exitCode=error?1:0;}})();
