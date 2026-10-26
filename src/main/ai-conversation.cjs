'use strict';
const fs=require('node:fs'),path=require('node:path');
const {safeStorage}=require('electron');
const {atomic}=require('./json-storage.cjs');

// This file contains only ciphertext. Never fall back to plaintext or include it in diagnostics.
class ConversationStore{
 constructor(dir){this.file=path.join(dir,'ai-conversation.json');this.error='';this.blocked=false;}
 load(){
  try{
   let raw;try{raw=fs.readFileSync(this.file,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}
   const envelope=JSON.parse(raw);
   if(envelope.version!==1||typeof envelope.encrypted!=='string'||!safeStorage.isEncryptionAvailable())throw Error('Invalid conversation');
   const data=JSON.parse(safeStorage.decryptString(Buffer.from(envelope.encrypted,'base64')));
   if(data.version!==1)throw Error('Unsupported conversation');
   return data;
  }catch{this.failLoad();return null;}
 }
 failLoad(){this.blocked=true;this.error='历史记忆无法读取或解密，原文件已保留。请恢复备份；新建会话不会覆盖损坏文件。';}
 save(data,{reset=false}={}){
  if(this.blocked&&!reset)throw Error(this.error);
  if(!safeStorage.isEncryptionAvailable()||safeStorage.getSelectedStorageBackend?.()==='basic_text'){
   this.error='系统加密不可用，无法安全保存记忆。原有文件与当前内存仍保留，请勿关闭应用。';throw Error(this.error);
  }
  try{
   atomic(this.file,{version:1,encrypted:safeStorage.encryptString(JSON.stringify({version:1,...data})).toString('base64')},{backup:false});
   this.error='';this.blocked=false;
  }catch{this.error='记忆保存失败，请检查磁盘空间及数据目录权限。原有文件与当前内存仍保留，请勿关闭应用。';throw Error(this.error);}
 }
}
module.exports={ConversationStore};
