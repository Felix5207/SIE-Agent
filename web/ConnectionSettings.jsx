import React,{useEffect,useState} from 'react';
import {Plus,Check,LoaderCircle,PlugZap,Trash2} from 'lucide-react';
import './connections.css';

const presets={
  custom:{name:'自定义 API',api:'openai-completions',base_url:''},
  openai:{name:'OpenAI',api:'openai-responses',base_url:'https://api.openai.com/v1'},
  qwen:{name:'阿里云百炼（北京）',api:'openai-completions',base_url:'https://dashscope.aliyuncs.com/compatible-mode/v1'},
  deepseek:{name:'DeepSeek',api:'openai-completions',base_url:'https://api.deepseek.com'},
  openrouter:{name:'OpenRouter',api:'openai-completions',base_url:'https://openrouter.ai/api/v1'},
  anthropic:{name:'Anthropic',api:'anthropic-messages',base_url:'https://api.anthropic.com'},
};
const empty=category=>category==='models'?{...presets.custom,model:'',vision:true,reasoning:false,context_window:128000,max_tokens:8192,api_key:''}:{name:'MinerU 官方云',kind:'cloud',base_url:'https://mineru.net',api_key:'',model_version:'vlm',language:'ch',backend:'vlm-http-client',model_url:''};
async function request(route,body,method=body===undefined?'GET':'POST') {
  const res=await fetch('/api/connections'+route,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await res.json();if(!res.ok)throw new Error(data.error||'请求失败');return data;
}
export function ConnectionSettings({onChanged=()=>{},onBusyChange=()=>{}}) {
  const [config,setConfig]=useState(null),[category,setCategory]=useState('models'),[form,setForm]=useState(null),[preset,setPreset]=useState('custom');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[models,setModels]=useState([]);
  const refresh=async()=>{const c=await request('');setConfig(c);return c;};
  useEffect(()=>{let mounted=true;request('').then(c=>{if(mounted)setConfig(c);}).catch(e=>{if(mounted)setError(e.message);});return()=>{mounted=false;};},[]);
  const act=async action=>{setBusy(true);onBusyChange(true);setError('');setNotice('');try{await action();}catch(e){setNotice('');setError(e.message);}finally{setBusy(false);onBusyChange(false);}};
  const edit=c=>{setForm(c?{...c,api_key:'',clear_api_key:false}:empty(category));setPreset('custom');setModels([]);setError('');setNotice('');};
  const update=(key,value)=>{setForm(f=>({...f,[key]:value}));setNotice('');};
  const choosePreset=value=>{setPreset(value);setModels([]);setForm(f=>({...f,...presets[value],model:'',api_key:'',has_api_key:false,clear_api_key:true}));};
  const save=async test=>{
    const data=await request(`/${category}${form.id?'/'+form.id:''}`,form,form.id?'PATCH':'POST');
    setConfig(data);setForm({...data.connection,api_key:'',clear_api_key:false});onChanged();
    if(test){setNotice(category==='models'?'正在测试模型请求和工具调用…':'正在解析一页测试 PDF，可能需要一两分钟…');const result=await request(`/${category}/${data.connection.id}/test`,{});await refresh();if(!result.ok)throw new Error(result.message);setNotice(result.message);onChanged();}
    else setNotice('配置已保存。选择“使用此连接”后，新启动的任务将使用它。');
  };
  const activeKey=category==='models'?'active_model_id':'active_mineru_id';
  return <div className="connection-settings">
    <p className="connection-intro">配置你申请的模型 API 和 MinerU 服务。选择的连接用于随后启动的任务，正在运行的任务保持原配置。</p>
    <p className="connection-privacy">密钥保存在当前 SIE 服务端，不回显、不写入导出或分享。使用外部 API 时，相关文献内容会发送到所选服务商。</p>
    <div className="connection-tabs" role="tablist" aria-label="API 配置类型">{[['models','提取模型'],['mineru','MinerU 解析']].map(([key,label])=><button key={key} role="tab" aria-selected={category===key} disabled={busy} onClick={()=>{setCategory(key);setForm(null);setError('');setNotice('');}}>{label}</button>)}</div>
    {error&&<p className="connection-error" role="alert">{error}</p>}
    {notice&&<p className="connection-notice" role="status">{busy&&<LoaderCircle size={15} className="spin"/>}{notice}</p>}
    {!config?<button className="button" disabled={busy} onClick={()=>act(refresh)}>重新加载配置</button>:<>
      <div className="connection-list">{config[category].map(c=><article key={c.id} className={config[activeKey]===c.id?'selected':''}>
        <div><strong>{c.name}</strong>{config[activeKey]===c.id&&<span className="connection-current"><Check size={12}/>当前使用</span>}<small>{category==='models'?c.model:c.kind==='cloud'?'MinerU 官方云 API':'MinerU 自建异步服务'}</small><span className="connection-host">{c.base_url}</span>{c.last_test&&<small className={c.last_test.ok?'test-passed':'test-failed'}>{c.last_test.ok?'最近测试通过':'最近测试失败'} · {new Date(c.last_test.at).toLocaleString('zh-CN')}</small>}</div>
        <div className="connection-list-actions"><button className="button small" disabled={busy} onClick={()=>edit(c)} aria-label={`编辑 ${c.name}`}>编辑</button><button className="button small" disabled={busy||config[activeKey]===c.id} onClick={()=>act(async()=>{setConfig(await request('/active',{[activeKey]:c.id},'PATCH'));setNotice(`已切换到 ${c.name}`);onChanged();})}>使用此连接</button></div>
      </article>)}</div>
      {!config[category].length&&<p className="muted">尚未配置连接。添加服务地址、密钥和模型后即可开始提取。</p>}
      {!form&&<button className="button" disabled={busy} onClick={()=>edit(null)}><Plus size={15}/>添加{category==='models'?'模型':'MinerU'}连接</button>}
    </>}
    {form&&<form className="connection-form" onSubmit={e=>{e.preventDefault();act(()=>save(false));}}>
      <h3>{form.id?'编辑连接':'添加连接'}</h3>
      <fieldset disabled={busy}>
        {category==='models'?<label>服务商预设<select value={preset} onChange={e=>choosePreset(e.target.value)}>{Object.entries(presets).map(([id,c])=><option key={id} value={id}>{c.name}</option>)}</select></label>:<label>MinerU 接口类型<select value={form.kind} onChange={e=>setForm(f=>({...f,kind:e.target.value,base_url:e.target.value==='cloud'?'https://mineru.net':'http://127.0.0.1:8001',model_url:'http://127.0.0.1:30000',api_key:'',has_api_key:false,clear_api_key:true}))}><option value="cloud">官方云 API（使用申请的 Token）</option><option value="self-hosted">自建服务（/tasks 异步接口）</option></select></label>}
        <label>连接名称<input required maxLength={100} value={form.name} onChange={e=>update('name',e.target.value)}/></label>
        {category==='models'&&<label>接口协议<select value={form.api} onChange={e=>update('api',e.target.value)}><option value="openai-completions">OpenAI 兼容 · Chat Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option></select></label>}
        <label>{category==='models'?'API Base URL':'MinerU API 地址'}<input required type="url" value={form.base_url} placeholder={category==='models'?'https://服务商地址/v1':'https://mineru.net'} onChange={e=>update('base_url',e.target.value)}/></label>
        <small className="muted">{category==='models'?'填写基础地址，不要附加 /chat/completions、/responses 或 /messages。百炼等服务请使用与密钥地域一致的地址。':form.kind==='cloud'?'官方地址为 https://mineru.net，也可填写兼容官方 v4 协议的网关。':'服务须支持 /tasks、任务状态查询及 ZIP 结果下载。'}</small>
        <label>{category==='mineru'&&form.kind==='cloud'?'MinerU API Token':'API Key'}<input type="password" autoComplete="new-password" value={form.api_key} required={category==='mineru'&&form.kind==='cloud'&&(!form.has_api_key||form.clear_api_key)} placeholder={form.has_api_key?'已配置，留空保持不变':category==='mineru'&&form.kind==='cloud'?'粘贴在 MinerU 申请的 API Token':'粘贴服务商提供的密钥；无鉴权自建服务可留空'} onChange={e=>update('api_key',e.target.value)}/></label>
        {form.has_api_key&&<label className="connection-checkbox"><input type="checkbox" checked={!!form.clear_api_key} onChange={e=>update('clear_api_key',e.target.checked)}/>清除已保存的密钥</label>}
        {category==='models'?<>
          <label>模型 ID<div className="connection-model-input"><input required list="sie-api-models" value={form.model} maxLength={200} placeholder="填写或选择服务商提供的模型 ID" onChange={e=>update('model',e.target.value)}/><button type="button" className="button" onClick={()=>act(async()=>{const data=await request('/models/list',form);setModels(data.models);setNotice(`已获取 ${data.models.length} 个模型，可在模型 ID 输入框中选择。`);})}>获取模型列表</button></div><datalist id="sie-api-models">{models.map(m=><option key={m} value={m}/>)}</datalist></label>
          <label className="connection-checkbox"><input type="checkbox" checked={form.vision} onChange={e=>update('vision',e.target.checked)}/>该模型支持图片输入（用于原图和图表提取）</label>
          <small className="muted">请选择支持工具调用的模型。关闭图片输入后，仅提取解析正文与表格，图片专有信息会注明限制。</small>
          <details><summary>模型参数</summary><div className="connection-grid"><label>上下文窗口（token）<input type="number" min={16384} max={4000000} required value={form.context_window} onChange={e=>update('context_window',Number(e.target.value))}/></label><label>最大输出（token）<input type="number" min={256} max={128000} required value={form.max_tokens} onChange={e=>update('max_tokens',Number(e.target.value))}/></label></div><label className="connection-checkbox"><input type="checkbox" checked={form.reasoning} onChange={e=>update('reasoning',e.target.checked)}/>推理模型</label><small className="muted">按服务商规格填写，超过模型上限会导致请求失败。</small></details>
        </>:<>
          {form.kind==='cloud'?<label>解析模型<select value={form.model_version} onChange={e=>update('model_version',e.target.value)}><option value="vlm">VLM</option><option value="pipeline">Pipeline</option></select></label>:<><label>解析后端<select value={form.backend} onChange={e=>update('backend',e.target.value)}><option value="vlm-http-client">VLM HTTP Client</option><option value="pipeline">Pipeline</option><option value="vlm-auto-engine">VLM Auto Engine</option></select></label>{form.backend==='vlm-http-client'&&<label>MinerU 模型服务地址<input required type="url" value={form.model_url} onChange={e=>update('model_url',e.target.value)}/></label>}</>}
          {form.kind==='cloud'&&<><label>文档语言代码<input value={form.language} maxLength={30} onChange={e=>update('language',e.target.value)} placeholder="ch / en / auto"/></label><a href="https://mineru.net" target="_blank" rel="noreferrer">前往 MinerU 申请 API Token ↗</a></>}
          <small className="muted">已解析的论文继续复用结果；新文件及解析失败后重试的文件使用所选服务。</small>
        </>}
      </fieldset>
      <p className="connection-test-note">{category==='models'?'连接测试会发送一条简短请求验证工具调用，可能产生少量 token 费用。':'连接测试会上传一页系统生成的测试 PDF，消耗一页解析额度，不上传你的论文。'}</p>
      <footer><button type="button" className="button" disabled={busy} onClick={()=>setForm(null)}>关闭编辑</button>{form.id&&config?.[activeKey]!==form.id&&<button type="button" className="button danger" disabled={busy} onClick={()=>act(async()=>{setConfig(await request(`/${category}/${form.id}`,undefined,'DELETE'));setForm(null);setNotice('连接已删除');onChanged();})}><Trash2 size={14}/>删除</button>}<span/><button className="button" disabled={busy} type="submit">保存配置</button><button className="button primary" disabled={busy} type="button" onClick={e=>{if(e.currentTarget.form.reportValidity())act(()=>save(true));}}>{busy?<LoaderCircle className="spin" size={15}/>:<PlugZap size={15}/>}保存并测试</button></footer>
    </form>}
  </div>;
}
