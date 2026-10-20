import {readConnections,connectionView,saveConnection,selectConnections,deleteConnection,normalizeConnection,selectedConnections,redactError,stampTest} from './connections.mjs';
import {testModel,listRemoteModels} from './model-client.mjs';
import {testMineru} from './mineru-client.mjs';

export function registerConnectionRoutes(app) {
  app.get('/api/connections',(req,res)=>res.json(connectionView()));
  app.patch('/api/connections/active',(req,res)=>res.json(selectConnections(req.body)));
  app.post('/api/connections/models/list',async(req,res)=>{
    const config=readConnections(),previous=req.body.id?config.models.find(c=>c.id===req.body.id):undefined;
    if(req.body.id&&!previous)throw new Error('连接不存在');
    const c=normalizeConnection('models',req.body,previous,{allowEmptyModel:true});
    try{res.json({models:await listRemoteModels(c)});}catch(e){throw new Error(redactError(e,[c]));}
  });
  app.post('/api/connections/:category',(req,res)=>res.status(201).json(saveConnection(req.params.category,req.body)));
  app.patch('/api/connections/:category/:id',(req,res)=>res.json(saveConnection(req.params.category,req.body,req.params.id)));
  app.delete('/api/connections/:category/:id',(req,res)=>res.json(deleteConnection(req.params.category,req.params.id)));
  const testing=new Set();
  app.post('/api/connections/:category/:id/test',async(req,res)=>{
    const {category,id}=req.params,config=readConnections();
    if(!['models','mineru'].includes(category))throw new Error('未知连接类型');
    const c=config[category].find(c=>c.id===id);if(!c)throw new Error('连接不存在');
    if(testing.has(id))throw Object.assign(new Error('此连接正在测试，请稍候'),{status:409});
    testing.add(id);
    try {
      const result=await(category==='models'?testModel(c):testMineru(c));stampTest(category,id,c.version,result);res.json(result);
    }catch(e){const result={ok:false,message:redactError(e,[c])};stampTest(category,id,c.version,result);res.json(result);}
    finally{testing.delete(id);}
  });
}
export async function connectionHealth() {
  const {model,mineru}=selectedConnections();
  const entries=await Promise.all([['llm',model],['mineru',mineru]].map(async([key,c])=>{
    if(!c)return[key,false];
    // Do not generate paid model requests or upload documents for background health checks.
    const local=/^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(c.base_url).hostname);
    const tested=c.last_test&&Date.now()-Date.parse(c.last_test.at)<15*60*1000?c.last_test.ok:null;
    if(!local||tested===false)return[key,tested];
    try{const base=c.base_url.replace(/\/v1$/,'');const r=await fetch(base+'/health',{headers:c.api_key?{Authorization:`Bearer ${c.api_key}`}:{},redirect:'error',signal:AbortSignal.timeout(2500)});return[key,r.status===404?tested:r.ok];}catch{return[key,false];}
  }));
  const services=Object.fromEntries(entries),values=Object.values(services);
  return {status:values.includes(false)?'degraded':values.every(v=>v===true)?'ready':'configured',services,model:model?.model||null,model_name:model?.name||null,mineru_name:mineru?.name||null,version:'0.1.0'};
}
