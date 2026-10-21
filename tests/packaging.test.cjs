'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
 const {userDataPath,resourcePath}=require('../src/main/app-paths.cjs');
const {RuntimeOutput,readRuntimeOutput}=require('../src/main/runtime-output.cjs');
test('Fresh data uses Facet, existing installations retain data, and explicit paths isolate launches',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'facet-paths-'));
 const app={getPath:()=>dir,commandLine:{hasSwitch:()=>false}};
 assert.equal(userDataPath(app),path.join(dir,'Facet'));
 fs.mkdirSync(path.join(dir,'ArenaCore'));assert.equal(userDataPath(app),path.join(dir,'ArenaCore'));
 fs.mkdirSync(path.join(dir,'Facet'));assert.equal(userDataPath(app),path.join(dir,'ArenaCore'),'existing data has priority over an empty new directory');
 app.commandLine={hasSwitch:()=>true,getSwitchValue:()=>path.join(os.tmpdir(),'facet-isolated')};
 assert.equal(userDataPath(app),path.join(os.tmpdir(),'facet-isolated'));
 for(const value of ['', 'relative-data']){app.commandLine.getSwitchValue=()=>value;assert.throws(()=>userDataPath(app),/绝对路径/);}
 assert.equal(resourcePath({isPackaged:false},'mihomo','mihomo.exe'),path.resolve(__dirname,'../resources/mihomo/mihomo.exe'));
 fs.rmSync(dir,{recursive:true,force:true});
});
test('Installed output preserves split UTF-8, redacts credentials, and can be read by existing UI',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'facet-package-log-')),file=path.join(dir,'runtime-output.json');
 const out=new RuntimeOutput(file),bytes=Buffer.from('安装版已启动\n');
 out.write('stdout',bytes.subarray(0,2));out.write('stdout',bytes.subarray(2));out.write('stderr','Authorization: Bearer fixture-private\n');out.close();
 const result=readRuntimeOutput(file);assert.equal(result.warning,'');assert.equal(result.rows[0].text,'安装版已启动');assert(!fs.readFileSync(file,'utf8').includes('fixture-private'));
});
test('Installer preserves data and only ships explicit application and verified core resources',()=>{
 const config=require('../electron-builder.config.cjs');
 assert.equal(config.appId,'Facet.MultiInstanceBrowser');assert.equal(config.nsis.deleteAppDataOnUninstall,false);assert.equal(config.nsis.runAfterFinish,false);
 assert.equal(config.nsis.allowToChangeInstallationDirectory,true);assert(!config.files.includes('**/*'));
 assert(config.extraResources.some(x=>x.from==='resources/environment-pipe'&&x.to==='environment-pipe'&&x.filter.includes('environment-pipe.node')&&x.filter.includes('environment-pipe.cc')&&x.filter.includes('manifest.json')),'installer must ship the verified SharedWorker startup helper');
 assert(config.extraResources.some(x=>x.from==='AGENTS.md'&&x.to==='AGENTS.md'),'installer must include the AI entry guide');
 assert(config.extraResources.some(x=>x.from==='docs'&&x.to==='docs'&&x.filter.includes('AI-CONTROL-HANDOFF.md')&&x.filter.includes('CONTROL-API.md')),'installer must include the linked control guides');
 assert(config.files.includes('!src/main/subscription-proxy.cjs'),'unfinished subscription draft must not ship');
 const docs=config.extraResources.find(x=>x.from==='docs');assert(!docs.filter.some(x=>x.includes('*')),'only reviewed manuals may ship');
 for(const file of ['UX-DELIVERY-STATUS.md','VERIFICATION.md','SUBSCRIPTION-NETWORK-DIAGNOSTICS.md'])assert(!docs.filter.includes(file));
 assert(docs.filter.includes('AI-AGENT.md'),'agent manual must ship');
 require('../scripts/build-installer.cjs').verifyArtifacts();
});
