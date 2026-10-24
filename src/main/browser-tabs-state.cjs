'use strict';
const crypto=require('node:crypto');
const MAX_TABS=32;
// 新建网页标签默认打开的页面：网页标签栏的“+”、Ctrl+T、未给 url 的 tab-new（界面/API/AI），
// 以及关闭最后一页后补上的那一页。页面经各实例自己的代理和会话加载；需要空白页时显式传 about:blank。
// browser-tabs.cjs 在创建时读取 module.exports，测试可替换为本机夹具页而不访问外网。
const NEW_TAB_URL='https://www.bing.com/';
function tabURL(value){return value==='about:blank'?value:require('./store.cjs').safeURL(value);}
function normalize(value){
 if(!value||typeof value!=='object'||!Array.isArray(value.items)||!value.items.length||value.items.length>MAX_TABS)throw Error('每个实例需保留 1–32 个网页标签');
 const ids=new Set();const items=value.items.map(row=>{
  if(!row||typeof row.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(row.id)||ids.has(row.id))throw Error('网页标签 ID 无效或重复');
  ids.add(row.id);return {id:row.id,url:tabURL(row.url)};
 });
 if(!ids.has(value.activeId))throw Error('当前网页标签不存在');
 return {activeId:value.activeId,items};
}
function forInstance(instance){return instance.browserTabs?normalize(instance.browserTabs):(()=>{const id=crypto.randomUUID();return {activeId:id,items:[{id,url:instance.url}]};})();}
module.exports={MAX_TABS,NEW_TAB_URL,tabURL,normalize,forInstance};
