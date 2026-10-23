'use strict';
// Map Chat Completions usage to DSH TokenUsage. DSH buckets are disjoint: inputTokens
// excludes cache reads (OpenAI cached_tokens / DeepSeek prompt_cache_hit_tokens).
function usageOf(u){
 if(!u||typeof u!=='object')return null;
 const n=v=>Number.isSafeInteger(v)&&v>=0?v:undefined;
 const prompt=n(u.prompt_tokens)??n(u.input_tokens),output=n(u.completion_tokens)??n(u.output_tokens);
 if(prompt===undefined||output===undefined)return null;
 const cached=Math.min(prompt,n(u.prompt_tokens_details?.cached_tokens)??n(u.prompt_cache_hit_tokens)??n(u.input_tokens_details?.cached_tokens)??0);
 const reasoning=n(u.completion_tokens_details?.reasoning_tokens)??n(u.output_tokens_details?.reasoning_tokens),total=n(u.total_tokens);
 return {inputTokens:prompt-cached,outputTokens:output,...(total!==undefined&&total>=prompt+output?{totalTokens:total}:{}),...(cached?{cacheReadTokens:cached}:{}),...(reasoning!==undefined?{reasoningTokens:reasoning}:{})};
}
// Usage rides on the returned message as a non-enumerable field so it never enters history.
function withUsage(message,usage){if(usage)Object.defineProperty(message,'usage',{value:usage,enumerable:false});return message;}
// Decode SSE across arbitrary UTF-8/network boundaries; execute no partial tools.
async function readCompletion(response,onText=()=>{}){
 const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,buffer='',data=[],finished=false,ended=false,content='',usage=null;const calls=new Map();
 const streaming=(response.headers.get('content-type')||'').includes('text/event-stream');
 function event(){if(!data.length)return;const raw=data.join('\n');data=[];if(raw==='[DONE]'){ended=true;return;}let chunk;try{chunk=JSON.parse(raw);}catch{throw Error('模型流式响应格式无效');}if(chunk.error)throw Error('模型流式服务返回错误');if(chunk.usage)usage=usageOf(chunk.usage)||usage;const choice=chunk.choices?.find(x=>x.index===0)||chunk.choices?.[0];if(!choice)return;if(choice.finish_reason){if(!['stop','tool_calls','function_call'].includes(choice.finish_reason))throw Error('模型回复未完整结束：'+String(choice.finish_reason).slice(0,40));finished=true;}const d=choice.delta||{};if(typeof d.content==='string'){content+=d.content;onText(d.content);}for(const t of d.tool_calls||[]){if(!Number.isInteger(t.index)||t.index<0||t.index>7)throw Error('模型工具调用索引无效');let c=calls.get(t.index);if(!c){c={id:'',type:'function',function:{name:'',arguments:''}};calls.set(t.index,c);}if(t.id)c.id+=t.id;if(t.function?.name)c.function.name+=t.function.name;if(t.function?.arguments)c.function.arguments+=t.function.arguments;}}
 function lines(flush=false){let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i).replace(/\r$/,'');buffer=buffer.slice(i+1);if(!line)event();else if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));if(ended)return;}if(flush&&buffer){if(buffer.startsWith('data:'))data.push(buffer.slice(5).replace(/^ /,''));buffer='';}if(flush)event();}
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2*1024*1024)throw Error('模型响应超过 2MB');buffer+=decoder.decode(value,{stream:true});if(streaming){lines();if(ended)break;}}buffer+=decoder.decode();if(!streaming){let result;try{result=JSON.parse(buffer);}catch{throw Error('模型未返回有效 JSON');}const m=result.choices?.[0]?.message;if(!m||typeof m!=='object')throw Error('接口未返回 Chat Completions 消息');if(typeof m.content==='string')onText(m.content);return withUsage(m,usageOf(result.usage));}lines(true);if(!finished)throw Error('模型流式回复中断，未收到完成标记；未执行未完成的工具调用');const tool_calls=[...calls.entries()].sort((a,b)=>a[0]-b[0]).map(([,c])=>c);for(const c of tool_calls){if(!c.id||!c.function.name)throw Error('模型工具调用不完整');try{JSON.parse(c.function.arguments);}catch{throw Error('模型工具参数不完整');}}return withUsage({role:'assistant',content:content||null,...(tool_calls.length?{tool_calls}:{})},usage);}finally{await reader.cancel().catch(()=>{});}
}
module.exports={readCompletion,usageOf};
