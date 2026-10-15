'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),{execFileSync}=require('node:child_process');
const root=__dirname,meta=require('./core-artifact.json');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function obtain(url,digest,file){if(!fs.existsSync(file)||hash(fs.readFileSync(file))!==digest){fs.mkdirSync(path.dirname(file),{recursive:true});execFileSync('curl.exe',['--fail','--location','--silent','--show-error','--max-time','180','--output',file,url],{stdio:'inherit',windowsHide:true});}const bytes=fs.readFileSync(file);if(hash(bytes)!==digest)throw Error('Official artifact SHA256 mismatch: '+path.basename(file));return bytes;}
const archive=obtain(meta.assetURL,meta.assetSHA256,path.join(root,'build/downloads/mihomo-android-arm64-v8-v1.19.31.gz')),binary=zlib.gunzipSync(archive);
if(hash(binary)!==meta.binarySHA256||binary.toString('ascii',1,4)!=='ELF'||binary.readUInt16LE(18)!==183)throw Error('Android ARM64 executable mismatch');
const native=path.join(root,'app/src/main/jniLibs/arm64-v8a');fs.mkdirSync(native,{recursive:true});fs.writeFileSync(path.join(native,'libfacet_mihomo.so'),binary);
const shared=path.join(root,'../resources/mihomo'),source=obtain(meta.sourceURL,meta.sourceSHA256,path.join(shared,'mihomo-source.tar.gz')),assets=path.join(root,'app/src/main/assets/mihomo');fs.mkdirSync(assets,{recursive:true});fs.writeFileSync(path.join(assets,'source.tgz'),source);const old=path.join(assets,'source.tar.gz');if(fs.existsSync(old))fs.unlinkSync(old);fs.copyFileSync(path.join(shared,'LICENSE'),path.join(assets,'LICENSE'));fs.copyFileSync(path.join(root,'core-artifact.json'),path.join(assets,'ARTIFACT.json'));
console.log('Verified Android Mihomo '+meta.version+'; executable, GPL license and corresponding source prepared.');
