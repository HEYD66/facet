'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ExtensionCatalog,localPage,extensionIcon}=require('../src/main/extension-catalog.cjs');
function fixture(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'arena-extensions-')),source=path.join(root,'input');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify({manifest_version:2,name:'Fixture',version:'1.0',permissions:['storage'],content_scripts:[{matches:['http://example.test/*'],js:['content.js']}],browser_action:{default_popup:'popup.html'}}));fs.writeFileSync(path.join(source,'popup.html'),'<title>Popup</title>');fs.writeFileSync(path.join(source,'content.js'),'console.log("fixture")');try{fn(new ExtensionCatalog(path.join(root,'data')),source,root);}finally{fs.rmSync(root,{recursive:true,force:true});}}
test('import is copied and disabled by default; explicit bindings persist independently',()=>fixture((c,s,root)=>{const row=c.stage(s);assert.equal(c.data.items.length,0);c.accept(row);fs.writeFileSync(path.join(s,'content.js'),'changed');assert.notEqual(fs.readFileSync(path.join(c.folder(row.id),'content.js'),'utf8'),'changed');c.setEnabled('A',row.id,true);assert.deepEqual(c.enabled('B'),[]);assert.deepEqual(new ExtensionCatalog(path.join(root,'data')).enabled('A'),[row.id]);assert.throws(()=>c.remove(row.id));c.setEnabled('A',row.id,false);c.remove(row.id);assert.equal(c.data.items.length,0);}));
test('cancel, duplicate and invalid manifests never enter catalog',()=>fixture((c,s)=>{let row=c.stage(s);c.discard(row);assert.equal(fs.readdirSync(c.base).length,0);row=c.stage(s);c.accept(row);assert.throws(()=>c.stage(s),/已导入/);assert.equal(fs.readdirSync(c.base).length,1);fs.writeFileSync(path.join(s,'manifest.json'),'invalid');assert.throws(()=>c.stage(s),/JSON/);assert.equal(c.data.items.length,1);}));
test('page paths cannot escape extension origin or directory',()=>{for(const bad of ['../a','http://example.test','/a','x\\y','a?x','a#x','%2e%2e/a']){assert.throws(()=>localPage(bad));}assert.equal(localPage('ui/popup/index.html'),'ui/popup/index.html');});
test('symlinks, oversize files, invalid permissions and ancestor imports rejected',()=>fixture((c,s,root)=>{assert.throws(()=>c.stage(root),/父文件夹/);let m=JSON.parse(fs.readFileSync(path.join(s,'manifest.json')));m.permissions='storage';fs.writeFileSync(path.join(s,'manifest.json'),JSON.stringify(m));assert.throws(()=>c.stage(s),/清单/);m.permissions=[];fs.writeFileSync(path.join(s,'manifest.json'),JSON.stringify(m));const big=path.join(s,'big');fs.writeFileSync(big,'');fs.truncateSync(big,512*1024*1024);assert.throws(()=>c.stage(s),/扩展文件夹共 512 MB .*超过上限 500MB.*占用最多：根目录文件（512 MB）$/);fs.truncateSync(big,500*1024*1024+1);assert.throws(()=>c.stage(s),/超过上限 500MB/);assert.equal(fs.readdirSync(c.base).filter(n=>n.startsWith('ext-')).length,0,'oversize folder is rejected before copying');fs.unlinkSync(big);if(process.platform==='win32'){const target=path.join(root,'junction-target');fs.mkdirSync(target);fs.symlinkSync(target,path.join(s,'linked'),'junction');}else fs.symlinkSync(path.join(s,'content.js'),path.join(s,'linked'));assert.throws(()=>c.stage(s),/链接/);assert.equal(c.data.items.length,0);}));
test('forgetting one instance preserves all other bindings',()=>fixture((c,s)=>{const row=c.stage(s);c.accept(row);c.setEnabled('A',row.id,true);c.setEnabled('B',row.id,true);c.forget('A');assert.deepEqual(c.enabled('A'),[]);assert.deepEqual(c.enabled('B'),[row.id]);assert.throws(()=>c.setEnabled('B',row.id,'yes'));}));

test('new-instance defaults persist, leave existing bindings alone and affect only later instances',()=>fixture((c,s,root)=>{
 const row=c.stage(s);c.accept(row);c.setEnabled('existing',row.id,false);
 assert.equal(c.setDefaultEnabled(row.id,true).changed,true);assert.deepEqual(c.enabled('existing'),[]);
 c.applyDefaults('new');assert.deepEqual(c.enabled('new'),[row.id]);
 const reopened=new ExtensionCatalog(path.join(root,'data'));assert.equal(reopened.get(row.id).defaultEnabled,true);reopened.applyDefaults('after-restart');assert.deepEqual(reopened.enabled('after-restart'),[row.id]);
 assert.equal(reopened.setDefaultEnabled(row.id,true).changed,false);reopened.setDefaultEnabled(row.id,false);reopened.applyDefaults('later');assert.deepEqual(reopened.enabled('later'),[]);assert.deepEqual(reopened.enabled('new'),[row.id]);
 assert.throws(()=>reopened.setDefaultEnabled(row.id,'true'),/状态无效/);assert.throws(()=>reopened.setDefaultEnabled('missing',true),/不存在/);
}));

test('refresh retains new-instance default and removal clears it without stale defaults',()=>fixture((c,s)=>{
 const row=c.stage(s);c.accept(row);c.setDefaultEnabled(row.id,true);
 const manifest=JSON.parse(fs.readFileSync(path.join(s,'manifest.json'),'utf8'));manifest.version='2.0';fs.writeFileSync(path.join(s,'manifest.json'),JSON.stringify(manifest));c.replace(row.id,c.stage(s,row.id));
 assert.equal(c.get(row.id).defaultEnabled,true);c.applyDefaults('new');assert.deepEqual(c.enabled('new'),[row.id]);c.remove(row.id,{disableAll:true});c.applyDefaults('later');assert.deepEqual(c.enabled('later'),[]);
}));

test('failed default writes leave stored flags and instance bindings unchanged',()=>fixture((c,s)=>{
 const row=c.stage(s);c.accept(row);const before=fs.readFileSync(c.file,'utf8'),commit=c.commit.bind(c);c.commit=()=>{throw Error('disk failure');};
 assert.throws(()=>c.setDefaultEnabled(row.id,true),/disk failure/);assert.equal(c.get(row.id).defaultEnabled,undefined);assert.equal(fs.readFileSync(c.file,'utf8'),before);
 c.commit=commit;c.setDefaultEnabled(row.id,true);c.commit=()=>{throw Error('disk failure');};assert.throws(()=>c.applyDefaults('new'),/disk failure/);assert.deepEqual(c.enabled('new'),[]);
}));

test('confirmed bulk removal rolls back the package on metadata failure and preserves unrelated bindings',()=>fixture((c,s,root)=>{
 const row=c.stage(s);c.accept(row);c.setEnabled('A',row.id,true);c.setEnabled('B',row.id,true);
 const m=JSON.parse(fs.readFileSync(path.join(s,'manifest.json'),'utf8'));m.name='Other';fs.writeFileSync(path.join(s,'manifest.json'),JSON.stringify(m));const other=c.stage(s);c.accept(other);c.setEnabled('A',other.id,true);
 const before=fs.readFileSync(c.file,'utf8'),folder=c.folder(row.id),commit=c.commit.bind(c);c.commit=()=>{throw Error('disk-write failure')};
 assert.throws(()=>c.remove(row.id,{disableAll:true}),/disk-write failure/);assert(fs.existsSync(folder));assert.equal(fs.readFileSync(c.file,'utf8'),before);assert.deepEqual(c.enabled('B'),[row.id]);assert.deepEqual(fs.readdirSync(c.base).sort(),[row.id,other.id].sort());
 c.commit=commit;assert.equal(c.remove(row.id,{disableAll:true}).removed,true);assert(!fs.existsSync(folder));assert(fs.existsSync(s));assert.deepEqual(c.enabled('A'),[other.id]);assert.deepEqual(c.enabled('B'),[]);const reopened=new ExtensionCatalog(path.join(root,'data'));assert.deepEqual(reopened.enabled('A'),[other.id]);assert.deepEqual(reopened.enabled('B'),[]);
}));
test('high-risk permissions and global page scopes are explicitly marked for review',()=>fixture((c,s)=>{const m=JSON.parse(fs.readFileSync(path.join(s,'manifest.json')));m.permissions=['storage','webRequestBlocking','proxy'];m.content_scripts=[{matches:['<all_urls>'],js:['content.js']}];fs.writeFileSync(path.join(s,'manifest.json'),JSON.stringify(m));const row=c.stage(s);assert.equal(row.riskLevel,'high');assert.equal(row.requiresElevatedReview,true);assert.deepEqual(row.riskPermissions.sort(),['proxy','webRequestBlocking']);assert.deepEqual(row.globalMatches,['<all_urls>']);c.discard(row);}));
test('toolbar icon comes only from a small image declared inside the package',()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'arena-ext-icon-'));try{const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGPQqDjxnxLMMGrAqAGjBgwXAwAasGcfZXRQWAAAAABJRU5ErkJggg==','base64'),write=m=>fs.writeFileSync(path.join(d,'manifest.json'),JSON.stringify({manifest_version:3,name:'I',version:'1',...m}));
 fs.mkdirSync(path.join(d,'img'));fs.writeFileSync(path.join(d,'img','16.png'),png);fs.writeFileSync(path.join(d,'img','48.png'),png);fs.writeFileSync(path.join(d,'img','big.png'),Buffer.alloc(64*1024+1));fs.writeFileSync(path.join(d,'img','a.txt'),'x');fs.writeFileSync(path.join(path.dirname(d),'outside.png'),png);
 write({icons:{16:'img/16.png',48:'/img/48.png',128:'img/missing.png'}});assert.equal(extensionIcon(d),'data:image/png;base64,'+png.toString('base64'));
 write({action:{default_icon:'./img/16.png'}});assert.match(extensionIcon(d),/^data:image\/png;base64,/);
 write({icons:{48:'img/big.png'}});assert.equal(extensionIcon(d),null,'oversize');
 write({icons:{48:'../outside.png',32:'img/a.txt',64:'C:/x.png'}});assert.equal(extensionIcon(d),null,'outside, wrong type or absolute');
 write({});assert.equal(extensionIcon(d),null,'no icon falls back to a letter in the UI');
 fs.writeFileSync(path.join(d,'manifest.json'),'{bad');assert.equal(extensionIcon(d),null);
}finally{fs.rmSync(d,{recursive:true,force:true});fs.rmSync(path.join(path.dirname(d),'outside.png'),{force:true});}});
test('development folders are skipped and reported; a parent folder names the extensions inside it',()=>fixture((c,s,root)=>{for(const d of ['.git/objects','node_modules/pkg','.vscode'])fs.mkdirSync(path.join(s,d),{recursive:true});fs.writeFileSync(path.join(s,'.git/objects/pack'),Buffer.alloc(2048));fs.writeFileSync(path.join(s,'node_modules/pkg/index.js'),'x');fs.writeFileSync(path.join(s,'Thumbs.db'),'x');fs.mkdirSync(path.join(s,'model'));fs.writeFileSync(path.join(s,'model/weights.bin'),Buffer.alloc(4096,1));
 const row=c.stage(s);const copied=fs.readdirSync(path.join(c.base,row.id)).sort();assert.deepEqual(copied,['content.js','manifest.json','model','popup.html']);assert.deepEqual(row.skipped.map(x=>x.name).sort(),['.git','.vscode','Thumbs.db','node_modules']);assert.equal(row.skipped.find(x=>x.name==='.git').size,2048);assert.equal(fs.statSync(path.join(c.base,row.id,'model/weights.bin')).size,4096);c.discard(row);
 const m=JSON.parse(fs.readFileSync(path.join(s,'manifest.json')));m.content_scripts[0].js=['node_modules/pkg/index.js'];fs.writeFileSync(path.join(s,'manifest.json'),JSON.stringify(m));const kept=c.stage(s);assert(fs.existsSync(path.join(c.base,kept.id,'node_modules/pkg/index.js')),'node_modules kept when the manifest references it');c.discard(kept);
 const parent=path.join(root,'store');fs.mkdirSync(parent);fs.cpSync(s,path.join(parent,'ext-one'),{recursive:true});fs.mkdirSync(path.join(parent,'notes'));assert.throws(()=>c.stage(parent),/根目录没有 manifest\.json。里面这些子文件夹是扩展，请选其中一个：ext-one$/);}));
test('refresh replaces files in the same package folder, keeps id and enable list, and remembers the source',()=>fixture((c,s)=>{const row=c.stage(s);assert.equal(row.source,path.resolve(s));c.accept(row);c.setEnabled('inst-a',row.id,true);const folder=c.folder(row.id);
 const same=c.stage(s,row.id);assert.equal(same.sha256,row.sha256,'unchanged folder hashes the same');assert.doesNotThrow(()=>c.discard(same));
 const m=JSON.parse(fs.readFileSync(path.join(s,'manifest.json')));m.version='2.0';fs.writeFileSync(path.join(s,'manifest.json'),JSON.stringify(m));fs.writeFileSync(path.join(s,'content.js'),'console.log("v2")');
 const next=c.stage(s,row.id);const updated=c.replace(row.id,next);
 assert.equal(updated.id,row.id);assert.equal(updated.version,'2.0');assert.equal(updated.importedAt,row.importedAt);assert(updated.updatedAt);assert.equal(c.folder(row.id),folder);
 assert.equal(fs.readFileSync(path.join(folder,'content.js'),'utf8'),'console.log("v2")');assert.deepEqual(c.enabled('inst-a'),[row.id]);assert.equal(c.data.items.length,1);
 assert.deepEqual(fs.readdirSync(c.base).sort(),[row.id],'staging and old copies are cleaned up');
 c.setSource(row.id,'D:\\\\moved');assert.equal(c.get(row.id).source,'D:\\\\moved');}));
