import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {testModel,listRemoteModels,modelClient} from '../server/model-client.mjs';

const requests=[];
const server=http.createServer(async(req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 let raw='';for await(const chunk of req)raw+=chunk;
 const body=raw?JSON.parse(raw):null;requests.push({url:req.url,headers:req.headers,body});
 if(pathname.endsWith('/models')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'model-b'},{id:'model-a'}]}));return;}
 res.setHeader('Content-Type','text/event-stream');
 const send=(event,data)=>res.write(`${event?'event: '+event+'\n':''}data: ${JSON.stringify(data)}\n\n`);
 if(pathname.endsWith('/chat/completions')){
  send(null,{id:'chat-1',object:'chat.completion.chunk',created:1,model:'test-model',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'call-1',type:'function',function:{name:'sie_connection_test',arguments:'{"ok":true}'}}]},finish_reason:null}]});
  send(null,{id:'chat-1',object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}});res.end('data: [DONE]\n\n');
 }else if(pathname.endsWith('/responses')){
  const item={id:'fc_1',type:'function_call',call_id:'call_1',name:'sie_connection_test',arguments:'{"ok":true}',status:'completed'};
  send('response.created',{type:'response.created',response:{id:'resp_1',status:'in_progress',output:[]}});
  send('response.output_item.added',{type:'response.output_item.added',output_index:0,item:{...item,arguments:'',status:'in_progress'}});
  send('response.function_call_arguments.delta',{type:'response.function_call_arguments.delta',item_id:item.id,output_index:0,delta:item.arguments});
  send('response.function_call_arguments.done',{type:'response.function_call_arguments.done',item_id:item.id,output_index:0,arguments:item.arguments});
  send('response.output_item.done',{type:'response.output_item.done',output_index:0,item});
  send('response.completed',{type:'response.completed',response:{id:'resp_1',status:'completed',output:[item],usage:{input_tokens:20,output_tokens:10,total_tokens:30}}});res.end();
 }else if(pathname.endsWith('/messages')){
  send('message_start',{type:'message_start',message:{id:'msg_1',type:'message',role:'assistant',model:'test-model',content:[],stop_reason:null,usage:{input_tokens:20,output_tokens:0}}});
  send('content_block_start',{type:'content_block_start',index:0,content_block:{type:'tool_use',id:'call_1',name:'sie_connection_test',input:{}}});
  send('content_block_delta',{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'{"ok":true}'}});
  send('content_block_stop',{type:'content_block_stop',index:0});
  send('message_delta',{type:'message_delta',delta:{stop_reason:'tool_use',stop_sequence:null},usage:{output_tokens:10}});
  send('message_stop',{type:'message_stop'});res.end();
 }else{res.statusCode=404;res.end();}
});
server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
const config=api=>({id:'test',name:'Test',api,base_url:api==='anthropic-messages'?base+'/anthropic':base+'/v1',api_key:'!literal-key-not-a-command',model:'test-model',vision:true,context_window:128000,max_tokens:8192});
for(const api of ['openai-completions','openai-responses','anthropic-messages'])test(`${api} uses the real Pi client with the selected endpoint, model and literal key`,async()=>{
 const c=config(api),result=await testModel(c);assert.equal(result.ok,true);
 const r=requests.at(-1);assert.equal(r.body.model,c.model);assert.ok(r.body.tools.length);
 assert.equal(api==='anthropic-messages'?r.headers['x-api-key']:r.headers.authorization,api==='anthropic-messages'?c.api_key:'Bearer '+c.api_key);
});
test('model list discovery uses the selected protocol and returns model IDs',async()=>{assert.deepEqual(await listRemoteModels(config('openai-completions')),['model-a','model-b']);assert.deepEqual(await listRemoteModels(config('anthropic-messages')),['model-a','model-b']);});
test('text-only capability and context/output limits reach the runtime',async()=>{const {model}=await modelClient({...config('openai-completions'),vision:false,context_window:64000,max_tokens:4096});assert.deepEqual(model.input,['text']);assert.equal(model.contextWindow,64000);assert.equal(model.maxTokens,4096);});
test.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
