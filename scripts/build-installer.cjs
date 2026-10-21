'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const {childEnvironment,resolveRuntime}=require('./electron-runtime.cjs');
function verifyArtifacts(){
 const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 const core=path.join(root,'resources/mihomo'),artifact=JSON.parse(fs.readFileSync(path.join(core,'ARTIFACT.json'),'utf8'));
 if(artifact.platform!=='win32'||artifact.architecture!=='x64'||hash(path.join(core,'mihomo.exe'))!==artifact.binarySHA256||hash(path.join(core,'mihomo-source.tar.gz'))!==artifact.sourceSHA256)throw Error('Mihomo 发行文件校验失败');
 const host=path.join(root,'resources/process-host'),manifest=JSON.parse(fs.readFileSync(path.join(host,'manifest.json'),'utf8'));
 if(manifest.architecture!=='x64'||hash(path.join(host,'facet-process-host.exe'))!==manifest.binarySHA256||hash(path.join(host,'ProcessHost.cs'))!==manifest.sourceSHA256)throw Error('进程保护组件校验失败，请运行 npm run build:process-host');
 const environmentPipe=path.join(root,'resources/environment-pipe'),environmentManifest=JSON.parse(fs.readFileSync(path.join(environmentPipe,'manifest.json'),'utf8'));
 if(environmentManifest.architecture!=='x64'||environmentManifest.platform!=='win32'||environmentManifest.nodeApiVersion!==8||hash(path.join(environmentPipe,'environment-pipe.node'))!==environmentManifest.binarySHA256||hash(path.join(environmentPipe,'environment-pipe.cc'))!==environmentManifest.sourceSHA256)throw Error('SharedWorker 环境管道组件校验失败，请运行 npm run build:environment-pipe');
}
async function main(){
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('当前安装包构建支持 Windows x64');
 verifyArtifacts();
 const env=childEnvironment();
 const executable=resolveRuntime({executable:require('electron'),version:require('electron/package.json').version,env});
 // Reuse the project's verified runtime. No runtime download or credential-based publishing.
 delete process.env.ELECTRON_RUN_AS_NODE;
 process.env.CSC_IDENTITY_AUTO_DISCOVERY='false';
 const {build,Platform}=require('electron-builder');
 const {Arch}=require('builder-util');
 const config=require('../electron-builder.config.cjs'),release=path.join(root,'release');
 // A mapped sandbox folder may hold Windows file handles; use a fresh build directory.
 const output=path.join(release,'build-'+Date.now());
 const outputs=await build({projectDir:root,targets:Platform.WINDOWS.createTarget('nsis',Arch.x64),publish:'never',config:{...config,directories:{...config.directories,output},electronDist:path.dirname(executable),electronVersion:require('electron/package.json').version}});
 let installer;
 for(const file of outputs.filter(f=>f.endsWith('.exe'))){installer=path.join(release,path.basename(file));fs.copyFileSync(file,installer);const sha=crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex');fs.writeFileSync(installer+'.sha256',sha+'  '+path.basename(installer)+'\n');if(fs.existsSync(file+'.blockmap'))fs.copyFileSync(file+'.blockmap',installer+'.blockmap');console.log('Installer: '+installer);console.log('SHA256: '+sha);}
 fs.copyFileSync(path.join(output,'latest.yml'),path.join(release,'latest.yml'));
 fs.writeFileSync(path.join(release,'build-manifest.json'),JSON.stringify({version:require('../package.json').version,installer,unpackedExecutable:path.join(output,'win-unpacked','Facet.exe')},null,2));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={verifyArtifacts};
