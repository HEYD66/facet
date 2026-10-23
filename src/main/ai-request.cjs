'use strict';

const {readCompletion}=require('./ai-stream.cjs');
const {safeFetch}=require('./safe-http.cjs');
const MAX_ATTEMPTS=3,MAX_DELAY=30000;
const RETRY_STATUS=new Set([408,429,500,502,503,504]);
const NETWORK_CODES=new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT']);
function retryAfter(value,now=Date.now()){
 if(value===null||value===undefined||!String(value).trim())return null;
 const text=String(value).trim(),seconds=Number(text);
 if(Number.isFinite(seconds))return seconds>=0?Math.ceil(seconds*1000):null;
 const date=Date.parse(text);return Number.isFinite(date)?Math.max(0,date-now):null;
}
function sleep(ms,signal){return new Promise((resolve,reject)=>{
 signal.throwIfAborted();let timer;
 const stop=()=>{clearTimeout(timer);signal.removeEventListener('abort',stop);reject(Error(signal.reason?.name==='TimeoutError'?'模型接口请求超时，请稍后重试':'任务已停止'));};
 timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},ms);signal.addEventListener('abort',stop,{once:true});
});}
function networkCode(error){const code=error?.cause?.code||error?.code;return NETWORK_CODES.has(code)?code:'';}
// Provider wording for a request rejected because the prompt exceeds the model's context.
const OVERFLOW=/context[ _-]?(length|window)|maximum context|too many tokens|prompt is too long|input is too long|tokens? exceed|exceeds? the (model'?s )?(maximum|max)|上下文.{0,8}(超|过长|上限)|超出.{0,8}(上下文|长度|token)/i;
// Read a bounded prefix of an error body only to classify it; it is never shown or logged
// because services may echo request content back.
async function errorText(response){
 const reader=response.body?.getReader();if(!reader)return '';const parts=[];let bytes=0;
 try{while(bytes<16384){const {done,value}=await reader.read();if(done)break;parts.push(value);bytes+=value.length;}}catch{/* classification is best effort */}finally{await reader.cancel().catch(()=>{});}
 return Buffer.concat(parts).toString('utf8').slice(0,16384);
}
async function completionRequest({url,headers,body,signal,onText=()=>{},onRetry=()=>{},onDowngrade=()=>{}}){
 const deadline=AbortSignal.any([signal,AbortSignal.timeout(90000)]);let delivered=false,retry=null,downgraded=false;
 for(let attempt=1;attempt<=MAX_ATTEMPTS;attempt++){
  signal.throwIfAborted();if(retry)onRetry({...retry,phase:'requesting'});
  let response,reason='',delay=null,error;
  try{
   response=await safeFetch(url,{method:'POST',redirect:'error',headers,body,signal:deadline});
   if(!response.ok){
    const status=response.status;delay=retryAfter(response.headers.get('retry-after'));
    const detail=[400,413,422].includes(status)?await errorText(response):(await response.body?.cancel(),'');
    // A strict service that rejects usage reporting gets the same request without it, once.
    if(detail&&!downgraded&&/stream_options|include_usage/i.test(detail)&&body.includes('"stream_options"')){downgraded=true;body=JSON.stringify({...JSON.parse(body),stream_options:undefined});onDowngrade();attempt--;continue;}
    error=Error('模型接口返回 HTTP '+status+'，请检查密钥、模型和服务状态');
    if(detail&&OVERFLOW.test(detail)){error=Error('模型上下文超出上限（HTTP '+status+'），需要压缩较早内容后重试');error.code='CONTEXT_WINDOW_EXCEEDED';}
    if(RETRY_STATUS.has(status))reason='HTTP '+status;
   }else return await readCompletion(response,text=>{if(text)delivered=true;onText(text);});
  }catch(e){
   if(signal.aborted)throw Error('任务已停止');
   if(deadline.aborted)throw Error('模型接口请求超过 90 秒，请稍后重试');
   if(e.code==='ERR_UNSAFE_CONTENT_ENCODING')throw Error(e.message);
   const code=networkCode(e);
   error=Error(code?'模型连接暂时中断（'+code+'），请检查接口及网络':response?'模型回复未完整接收：'+String(e.message).slice(0,220):'模型接口连接失败，请检查接口地址及网络');
   if(code)reason='网络连接暂时中断';
  }
  if(!reason||delivered||attempt===MAX_ATTEMPTS)throw error;
  if(delay===null)delay=1000*2**(attempt-1);
  if(delay>MAX_DELAY)throw Error(error.message+'；服务要求等待 '+Math.ceil(delay/1000)+' 秒，请稍后再试');
  retry={attempt:attempt+1,maxAttempts:MAX_ATTEMPTS,reason,waitMs:delay,nextAt:Date.now()+delay};
  onRetry({...retry,phase:'waiting'});await sleep(delay,deadline);
 }
}
module.exports={completionRequest,retryAfter,MAX_ATTEMPTS,MAX_DELAY};
