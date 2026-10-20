import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DATA, MINERU, MINERU_MODEL} from './core.mjs';

const file = path.join(DATA, 'connections.json');
const apis = new Set(['openai-completions', 'openai-responses', 'anthropic-messages']);
const kinds = new Set(['models', 'mineru']);
const fail = (message, status=400) => { throw Object.assign(new Error(message), {status}); };
export function httpURL(value, label='API 地址') {
  let url;
  try { url = new URL(String(value).trim()); } catch { fail(`${label}须为完整的 http:// 或 https:// 地址`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail(`${label}不能包含账号、密码、查询参数或片段`);
  return url.href.replace(/\/+$/, '');
}
function legacyKey(value) {
  if (!value || value.startsWith('!')) return '';
  return value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}|\$([A-Z_][A-Z0-9_]*)/g, (_,a,b)=>process.env[a||b]||'');
}
function defaults() {
  const models = [];
  const source = process.env.PI_MODELS_PATH;
  let provider;
  if (source && fs.existsSync(source)) provider = JSON.parse(fs.readFileSync(source, 'utf8')).providers?.['qwen-local'];
  if (provider?.models?.length || process.env.QWEN_BASE_URL) {
    const m = provider?.models?.[0] || {};
    models.push({id:'local-model', name:'现有本地模型', api:provider?.api || 'openai-completions', base_url:process.env.QWEN_BASE_URL || provider.baseUrl,
      api_key:process.env.QWEN_API_KEY || legacyKey(provider?.apiKey || ''), model:process.env.QWEN_MODEL || m.id || '', vision:m.input?.includes('image') ?? true,
      reasoning:!!m.reasoning, context_window:m.contextWindow || 128000, max_tokens:m.maxTokens || 8192, compat:{...provider?.compat,...m.compat}, version:1});
  }
  const mineru = provider || process.env.MINERU_URL || process.env.MINERU_MODEL_URL ? [{id:'local-mineru', name:'现有本地 MinerU', kind:'self-hosted', base_url:MINERU, model_url:MINERU_MODEL, backend:'vlm-http-client', api_key:process.env.MINERU_API_KEY || '', model_version:'vlm', language:'ch', version:1}] : [];
  return {version:1, models, mineru, active_model_id:models[0]?.id || null, active_mineru_id:mineru[0]?.id || null};
}
export function readConnections() { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : defaults(); }
function write(config) {
  fs.mkdirSync(DATA,{recursive:true});
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, JSON.stringify(config,null,2), {mode:0o600}); fs.renameSync(temporary,file); }
  finally { fs.rmSync(temporary,{force:true}); }
  return config;
}
export function publicConnection(c) {
  if (!c) return null;
  const {api_key, compat, ...safe} = c;
  return {...safe, has_api_key:!!api_key};
}
export function connectionView(config=readConnections()) {
  return {...config, models:config.models.map(publicConnection), mineru:config.mineru.map(publicConnection)};
}
export function normalizeConnection(category, input, previous, {allowEmptyModel=false}={}) {
  if (!kinds.has(category)) fail('未知连接类型');
  const raw = {...previous,...input};
  const name = String(raw.name || '').trim();
  if (!name || name.length>100) fail('连接名称须为 1–100 字');
  let base_url = httpURL(raw.base_url);
  if(category==='models' && /\/(?:chat\/completions|responses|messages)$/.test(base_url))fail('请填写 API 基础地址，不要附加 /chat/completions、/responses 或 /messages');
  if(category==='models' && raw.api==='anthropic-messages')base_url=base_url.replace(/\/v1$/,'');
  let api_key = previous?.api_key || '';
  if (input.clear_api_key) api_key='';
  if (input.api_key !== undefined && input.api_key !== '') {
    if (typeof input.api_key !== 'string' || input.api_key.length>8192 || /[\r\n]/.test(input.api_key)) fail('API Key 格式无效');
    api_key=input.api_key.trim();
  }
  if (previous?.api_key && new URL(previous.base_url).origin!==new URL(base_url).origin && !input.api_key && !input.clear_api_key) fail('API 域名已变更，请重新填写密钥或选择清除密钥');
  const common = {id:previous?.id || 'connection_'+crypto.randomUUID(),name,base_url,api_key,version:(previous?.version||0)+1};
  if (category==='models') {
    if (!apis.has(raw.api)) fail('请选择支持的模型 API 协议');
    const model=String(raw.model || '').trim();
    if ((!model && !allowEmptyModel) || model.length>200) fail('请输入服务商提供的模型 ID');
    const context_window=Number(raw.context_window ?? 128000),max_tokens=Number(raw.max_tokens ?? 8192);
    if (!Number.isInteger(context_window)||context_window<16384||context_window>4000000) fail('上下文窗口须为 16384–4000000');
    if (!Number.isInteger(max_tokens)||max_tokens<256||max_tokens>128000||max_tokens>=context_window) fail('最大输出须为 256–128000 且小于上下文窗口');
    const compat = previous?.api===raw.api && previous?.base_url===base_url ? previous.compat : undefined;
    return {...common,api:raw.api,model,vision:raw.vision!==false,reasoning:raw.reasoning===true,context_window,max_tokens,...(compat?{compat}:{})};
  }
  if (!['cloud','self-hosted'].includes(raw.kind)) fail('请选择 MinerU 官方云或自建服务');
  const model_version=raw.model_version || 'vlm';
  if (!['vlm','pipeline'].includes(model_version)) fail('未知 MinerU 解析模型');
  const backend=raw.backend || 'vlm-http-client';
  if (!['vlm-http-client','pipeline','vlm-auto-engine'].includes(backend)) fail('未知 MinerU 服务后端');
  const model_url=raw.kind==='self-hosted' && backend==='vlm-http-client' ? httpURL(raw.model_url,'MinerU 模型服务地址') : '';
  if (raw.kind==='cloud' && !api_key) fail('请填写 MinerU 官方 API Token');
  const language=String(raw.language || 'ch').trim();
  if (!/^[a-zA-Z_+-]{1,30}$/.test(language)) fail('语言代码格式无效');
  return {...common,kind:raw.kind,model_url,backend,model_version,language};
}
export function saveConnection(category,input,id) {
  const config=readConnections();
  if (!kinds.has(category)) fail('未知连接类型');
  const previous=id?config[category].find(c=>c.id===id):undefined;
  if (id&&!previous) fail('连接不存在',404);
  if (previous && input.version!==undefined && input.version!==previous.version) fail('连接已更新，请刷新后再保存',409);
  if (!previous && config[category].length>=30) fail('每类最多保存 30 个连接');
  const saved=normalizeConnection(category,input,previous);
  config[category]=[...config[category].filter(c=>c.id!==saved.id),saved];
  const selected=category==='models'?'active_model_id':'active_mineru_id';
  if (!config[selected]) config[selected]=saved.id;
  write(config);
  return {connection:publicConnection(saved),...connectionView(config)};
}
export function selectConnections(input) {
  const config=readConnections();
  for (const [key,category] of [['active_model_id','models'],['active_mineru_id','mineru']]) {
    if (input[key]===undefined) continue;
    if (!config[category].some(c=>c.id===input[key])) fail('所选连接不存在');
    config[key]=input[key];
  }
  return connectionView(write(config));
}
export function deleteConnection(category,id) {
  const config=readConnections();
  if (!kinds.has(category)||!config[category].some(c=>c.id===id)) fail('连接不存在',404);
  if ([config.active_model_id,config.active_mineru_id].includes(id)) fail('请先切换当前使用的连接，再删除此配置');
  config[category]=config[category].filter(c=>c.id!==id);
  return connectionView(write(config));
}
export function selectedConnections() {
  const config=readConnections();
  return {model:config.models.find(c=>c.id===config.active_model_id),mineru:config.mineru.find(c=>c.id===config.active_mineru_id)};
}
export function connectionSnapshot(connections) {
  // Deliberately omit credentials, private auth configuration and test responses.
  return Object.fromEntries(Object.entries(connections).map(([kind,c])=>[kind,c?{id:c.id,name:c.name,version:c.version,base_url:c.base_url,...(kind==='model'?{model:c.model,api:c.api,vision:c.vision}:{kind:c.kind,model_version:c.model_version,backend:c.backend})}:null]));
}
export function redactError(error, connections=[]) {
  let message=String(error?.message || error || '请求失败');
  for (const c of connections) if(c?.api_key) message=message.split(c.api_key).join('[已隐藏密钥]');
  return message.replace(/Bearer\s+[^\s"'<>]+/gi,'Bearer [已隐藏]').replace(/([?&](?:token|key|signature|api_key)=)[^\s&"']+/gi,'$1[已隐藏]').slice(0,700);
}
export function redactSecrets(value, connections=[]) {
  return JSON.parse(JSON.stringify(value,(_key,item)=>{
    if(typeof item!=='string')return item;
    for(const c of connections)if(c?.api_key)item=item.split(c.api_key).join('[已隐藏密钥]');
    return item;
  }));
}
export function stampTest(category,id,version,result) {
  const config=readConnections(),c=config[category]?.find(c=>c.id===id);
  if (c?.version===version) { c.last_test={...result,at:new Date().toISOString()}; write(config); }
}
