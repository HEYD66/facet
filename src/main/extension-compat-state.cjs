'use strict';
const fs=require('node:fs'),path=require('node:path');
const {atomic}=require('./json-storage.cjs');
function fresh(){return {version:1,alarms:{},permissions:{},bookmarks:[{id:'0',title:'',children:[{id:'1',parentId:'0',title:'书签栏',children:[]},{id:'2',parentId:'0',title:'其他书签',children:[]}]}],bookmarkSerial:2,history:[],visits:[],closedTabs:[],downloadSerial:0,downloads:[],action:{},sidePanels:{},groups:{},groupSerial:0};}
class CompatState{
 constructor(session){this.file=path.join(session.getStoragePath(),'facet-extension-state.json');this.data=fresh();if(fs.existsSync(this.file)){const data=JSON.parse(fs.readFileSync(this.file,'utf8'));if(data.version!==1||!Array.isArray(data.bookmarks)||!Array.isArray(data.history)||!Array.isArray(data.downloads))throw Error('扩展兼容数据无效，原文件保留');this.data={...this.data,...data};}}
 save(){atomic(this.file,this.data);}
 visit(url,title=''){if(!/^https?:/i.test(url))return;const now=Date.now();let row=this.data.history.find(x=>x.url===url);if(row){row.lastVisitTime=now;row.visitCount++;if(title)row.title=title;}else{row={id:String(now)+'-'+this.data.history.length,url,title,lastVisitTime:now,visitCount:1,typedCount:0};this.data.history.unshift(row);}this.data.visits.unshift({url,id:row.id,visitId:require('node:crypto').randomUUID(),visitTime:now,isLocal:true});this.data.visits=this.data.visits.slice(0,10000);this.data.history=this.data.history.sort((a,b)=>b.lastVisitTime-a.lastVisitTime).slice(0,5000);this.save();}
 remember(tab){if(!/^https?:/i.test(tab.url||''))return;this.data.closedTabs.unshift({lastModified:Math.floor(Date.now()/1000),tab:{...tab,sessionId:require('node:crypto').randomUUID()}});this.data.closedTabs=this.data.closedTabs.slice(0,25);this.save();}
}
function httpURL(value){const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('仅允许不含登录凭据的 HTTP/HTTPS 地址');return url.href;}
function object(value){if(!value||typeof value!=='object'||Array.isArray(value))throw Error('参数需要对象');return value;}
function number(value,min,max){if(!Number.isInteger(value)||value<min||value>max)throw Error('参数超出范围');return value;}
function text(value,max=1000){if(typeof value!=='string'||value.length>max||/[\x00-\x1f\x7f]/.test(value))throw Error('文本参数无效');return value;}
module.exports={CompatState,fresh,httpURL,object,number,text};
