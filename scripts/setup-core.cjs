'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {execFileSync}=require('node:child_process');
// Stable v1.19.32 predates Go's October certificate revocation fix. Pin this
// upstream security build by exact name, digest and immutable source commit.
const {version,releaseTag,sourceRef,assets,goVersion,sourceSHA256,licenseSHA256}=require('../src/main/core-release.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function download(url,digest){
 const cache=process.env.FACET_CORE_DOWNLOAD_CACHE&&path.join(process.env.FACET_CORE_DOWNLOAD_CACHE,digest);
 if(cache&&fs.existsSync(cache)){const bytes=fs.readFileSync(cache);if(hash(bytes)!==digest)throw Error('本地发行缓存 SHA256 不一致');return bytes;}
 const r=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!r.ok)throw Error(`下载失败 HTTP ${r.status}`);
 const bytes=Buffer.from(await r.arrayBuffer());if(hash(bytes)!==digest)throw Error('官方发行文件 SHA256 不一致，停止安装');
 if(cache){fs.mkdirSync(path.dirname(cache),{recursive:true});fs.writeFileSync(cache,bytes);}return bytes;
}
(async()=>{if(process.arch!=='x64'||!assets[process.platform])throw Error('当前安装脚本仅支持 Windows/Linux x64');const a=assets[process.platform],url=`https://github.com/MetaCubeX/mihomo/releases/download/${releaseTag}/${a.name}`;const bytes=await download(url,a.digest);const root=path.join(__dirname,'../resources/mihomo');fs.mkdirSync(root,{recursive:true});let binary;
 if(process.platform==='linux')binary=zlib.gunzipSync(bytes);else{const temp=fs.mkdtempSync(path.join(os.tmpdir(),'arena-core-'));try{const zip=path.join(temp,'core.zip'),out=path.join(temp,'unpacked');fs.writeFileSync(zip,bytes);const quote=x=>"'"+x.replace(/'/g,"''")+"'";execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Expand-Archive -LiteralPath ${quote(zip)} -DestinationPath ${quote(out)} -Force`],{stdio:'pipe',windowsHide:true});const files=fs.readdirSync(out).filter(n=>n.endsWith('.exe'));if(files.length!==1)throw Error('内核压缩包内容不符合预期');binary=fs.readFileSync(path.join(out,files[0]));}finally{fs.rmSync(temp,{recursive:true,force:true});}}
 const licenseURL=`https://raw.githubusercontent.com/MetaCubeX/mihomo/${sourceRef}/LICENSE`,sourceURL=`https://codeload.github.com/MetaCubeX/mihomo/tar.gz/${sourceRef}`;
 const [license,source]=await Promise.all([download(licenseURL,licenseSHA256),download(sourceURL,sourceSHA256)]);
 const probeDir=fs.mkdtempSync(path.join(os.tmpdir(),'facet-core-security-'));
 let buildInfo;
 try{const probe=path.join(probeDir,process.platform==='win32'?'mihomo.exe':'mihomo');fs.writeFileSync(probe,binary,{mode:0o755});buildInfo=execFileSync(probe,['-v'],{encoding:'utf8',windowsHide:true});}
 finally{fs.rmSync(probeDir,{recursive:true,force:true});}
 if(!new RegExp('\\b'+goVersion.replace(/\./g,'\\.')+'\\b').test(buildInfo)||!buildInfo.includes(version))throw Error('代理内核版本或 Go 安全补丁不符合预期');
 const target=path.join(root,process.platform==='win32'?'mihomo.exe':'mihomo');fs.writeFileSync(target,binary,{mode:0o755});
 fs.writeFileSync(path.join(root,'LICENSE'),license);fs.writeFileSync(path.join(root,'mihomo-source.tar.gz'),source);
 const record={version,platform:process.platform,architecture:process.arch,goVersion,sourceRef,prerelease:true,assetURL:url,assetSHA256:a.digest,binarySHA256:hash(binary),sourceURL,sourceSHA256:hash(source),licenseURL,releaseURL:`https://github.com/MetaCubeX/mihomo/releases/tag/${releaseTag}`};
 for(const name of ['ARTIFACT.json',`ARTIFACT-${process.platform}.json`])fs.writeFileSync(path.join(root,name),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record,null,2));console.log(buildInfo);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
