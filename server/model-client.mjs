import {pathToFileURL} from 'node:url';

let sdkPromise;
export function loadPi() {
  sdkPromise ||= (async()=>{
    if (process.env.PI_SDK_PATH) return import(pathToFileURL(process.env.PI_SDK_PATH).href);
    return import('@earendil-works/pi-coding-agent');
  })();
  return sdkPromise;
}
export async function modelClient(connection,signal) {
  if (!connection?.model) throw new Error('请先在“API 配置”中添加并选择提取模型');
  const {ModelRuntime}=await loadPi();
  // Keep user-supplied keys literal and in memory. Pi config strings may execute
  // shell commands; never write web input into models.json or apiKey config.
  const credentials={read:async()=>undefined,list:async()=>[],modify:async()=>{throw new Error('只使用本轮密钥');},delete:async()=>{}};
  const runtime=await ModelRuntime.create({credentials,modelsPath:null,allowModelNetwork:false,refreshOnCreate:false,signal});
  const provider='sie-api';
  runtime.registerProvider(provider,{name:connection.name,baseUrl:connection.base_url,api:connection.api,
    models:[{id:connection.model,name:connection.model,reasoning:connection.reasoning,input:connection.vision?['text','image']:['text'],
      contextWindow:connection.context_window,maxTokens:connection.max_tokens,cost:{input:0,output:0,cacheRead:0,cacheWrite:0},
      ...(connection.api==='openai-completions'?{compat:{supportsStore:false,supportsDeveloperRole:false,supportsReasoningEffort:false,supportsStrictMode:false,maxTokensField:'max_tokens',...connection.compat}}:{})}]});
  await runtime.setRuntimeApiKey(provider,connection.api_key || 'sie-keyless',{signal});
  const model=runtime.getModel(provider,connection.model);
  if (!model) throw new Error('无法加载所选模型，请检查 API 协议与模型 ID');
  return {runtime,model,provider};
}
export async function testModel(connection) {
  const signal=AbortSignal.timeout(60000),{runtime,model}=await modelClient(connection,signal);
  const result=await runtime.completeSimple(model,{systemPrompt:'This is a connection test. Call sie_connection_test with ok=true. Do not answer in prose.',
    messages:[{role:'user',content:'Test the connection by calling the tool.',timestamp:Date.now()}],
    tools:[{name:'sie_connection_test',description:'Confirm API tool calling works.',parameters:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false}}]},
    {signal,maxTokens:256,reasoning:'off'});
  if (result.stopReason==='error') throw new Error(result.errorMessage || '模型请求失败');
  if (!result.content.some(c=>c.type==='toolCall' && c.name==='sie_connection_test' && c.arguments?.ok===true)) throw new Error('接口已响应，但模型未成功调用测试工具；请选择支持工具调用的模型');
  return {ok:true,message:'模型请求及工具调用通过。图片能力按配置启用，尚未进行读图测试。'};
}
export async function listRemoteModels(connection) {
  const headers=connection.api==='anthropic-messages'?{'x-api-key':connection.api_key,'anthropic-version':'2023-06-01'}:connection.api_key?{Authorization:`Bearer ${connection.api_key}`}:{ };
  const base=connection.api==='anthropic-messages'?connection.base_url.replace(/\/v1$/,'')+'/v1':connection.base_url;
  const response=await fetch(base+'/models',{headers,redirect:'error',signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error(`获取模型列表失败（HTTP ${response.status}）。可手动填写模型 ID。`);
  const body=await response.json();
  if (!Array.isArray(body.data)) throw new Error('此服务未返回标准模型列表，请手动填写模型 ID');
  return body.data.map(m=>m.id).filter(id=>typeof id==='string').slice(0,1000).sort();
}
