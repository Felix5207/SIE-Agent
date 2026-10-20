import {registerRecoveryRoutes} from './recovery.mjs';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT,DATA,MINERU,MINERU_MODEL,db,getProject,saveProject,listProjects,publicProject,createProject,change,emit,python,id,now,directory,memories,saveMemory,fieldsFromHeaders,validateCell } from './core.mjs';
import {workflowAction,approveProtocol,protocolMarkdown,linkExamples,invalidateProtocol,protocolCurrent} from './workflow.mjs';
import { addFile } from './documents.mjs';
import { enqueue,resumeFeedback,isBusy,jobs } from './agent.mjs';
import {registerConnectionRoutes,connectionHealth} from './connection-routes.mjs';
import {selectedExport} from './export-selection.mjs';
import { coordinateAxis, coordinatePolicy } from './estimates.mjs';
import { registerColumnRoutes } from './columns.mjs';
import { registerReaderRoutes } from './reader.mjs';
import { registerWorkspaceRoutes } from './workspace.mjs';
import { registerExtractionRoutes } from './extraction.mjs';

const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'3mb'}));
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');next();});
const temp=path.join(DATA,'uploads');fs.mkdirSync(temp,{recursive:true});
const upload=multer({dest:temp,limits:{fileSize:100*1024*1024,files:100}});
for(const p of listProjects())if(isBusy(p)){p.status='interrupted';p.stage='运行已中断，可继续';p.error='服务重启，已保存的解析结果和提取记录仍然保留。';saveProject(p);}

function editable(pid){const p=getProject(pid);if(p.trashed_at)throw Object.assign(new Error('任务已移入回收站，请先恢复'),{status:410});if(isBusy(p))throw Object.assign(new Error('任务运行中，请等待或先停止'),{status:409});return p;}
function fileOf(pid,fid){const p=getProject(pid);const f=p.files.find(f=>f.id===fid);if(!f)throw Object.assign(new Error('文件不存在'),{status:404});return f;}
registerWorkspaceRoutes(app, { editable });
registerRecoveryRoutes(app, { editable, enqueue });
registerExtractionRoutes(app, { editable, enqueue });
registerReaderRoutes(app);
registerColumnRoutes(app, { editable });
registerConnectionRoutes(app);

app.get('/api/health',async(req,res)=>{
  res.json(await connectionHealth());
});
app.get('/api/projects',(req,res)=>res.json(listProjects().filter(p=>req.query.trash==='1'?!!p.trashed_at:!p.trashed_at).map(p=>publicProject(p,false))));
app.post('/api/projects',(req,res)=>{const {name,instructions='',granularity='group',workflow_mode='scratch',pilot_size=3}=req.body;if(typeof name!=='string'||name.length>200)throw new Error('请输入不超过 200 字的项目名称');res.status(201).json(publicProject(createProject(name,String(instructions).slice(0,12000),['group','point','paper'].includes(granularity)?granularity:'group',{mode:workflow_mode,pilot_size})));});
app.get('/api/projects/:pid',(req,res)=>res.json(publicProject(getProject(req.params.pid))));
app.patch('/api/projects/:pid',(req,res)=>{
  const p=editable(req.params.pid);for(const key of ['name','instructions','granularity'])if(req.body[key]!==undefined)p[key]=String(req.body[key]).slice(0,key==='instructions'?12000:200);
  if(!['group','point','paper'].includes(p.granularity))throw new Error('未知行粒度');
  if(req.body.instructions!==undefined)p.coordinate_policy={...coordinatePolicy(p.coordinate_policy,p.instructions),updated_at:now()};
  if(req.body.fields){if(!Array.isArray(req.body.fields)||req.body.fields.length>100)throw new Error('字段必须为数组，最多100列');const names=req.body.fields.map(f=>String(f.name||'').trim());if(names.some(n=>!n)||new Set(names).size!==names.length)throw new Error('字段名称不能为空或重复');
    if(p.records.length&&JSON.stringify(names)!==JSON.stringify(p.fields.map(f=>f.name)))throw new Error('已有结果时可编辑字段说明；更改列名请新建项目，避免破坏证据映射');
    p.fields=req.body.fields.map((f,i)=>({id:`f${i+1}`,name:names[i],description:String(f.description||'').slice(0,2000)}));}
  if(['instructions','granularity','fields'].some(k=>req.body[k]!==undefined))invalidateProtocol(p,'提取要求已修改，请对话更新规范');
  saveProject(p);res.json(publicProject(p));
});
app.post('/api/projects/:pid/files',upload.array('files'),async(req,res)=>{
  try{
    const p=editable(req.params.pid);const role=req.body.role||'document';if(!['document','template','example','reference'].includes(role))throw new Error('未知资料类型');if(['example','reference'].includes(role)&&!p.workflow)throw new Error('请在案例学习项目中上传示范资料');
    if(role==='template'&&p.records.length)throw new Error('已有结果的项目不能替换模板，请新建项目');
    const paths=JSON.parse(req.body.relativePaths||'[]');const result=[];
    for(const [i,f] of (req.files||[]).entries()){
      let name=paths[i]||f.originalname;
      if(!/[\u3400-\u9fff]/.test(name)){const decoded=Buffer.from(name,'latin1').toString('utf8');if(!decoded.includes('\ufffd'))name=decoded;}
      result.push(await addFile(p.id,f.path,String(name).slice(0,500),role));
    }
    emit(p.id,'upload',`已添加 ${req.files?.length||0} 个文件`);res.json({files:result,project:publicProject(getProject(p.id))});
  }finally{for(const f of req.files||[])fs.rmSync(f.path,{force:true});}
});
app.delete('/api/projects/:pid/files/:fid',(req,res)=>{
  const p=editable(req.params.pid);if(p.records.length)throw new Error('已有结果的资料用于证据追溯，不能删除；请新建项目');
  const f=p.files.find(f=>f.id===req.params.fid);p.files=p.files.filter(f=>f.id!==req.params.fid);p.blocks=p.blocks.filter(b=>b.file_id!==req.params.fid);p.examples=(p.examples||[]).filter(e=>e.file_id!==req.params.fid);for(const e of p.examples)e.source_file_ids=e.source_file_ids.filter(fid=>fid!==req.params.fid);if(p.workflow){p.workflow.pilot_file_ids=p.workflow.pilot_file_ids.filter(fid=>fid!==req.params.fid);p.workflow.stage='setup';}if(f?.role==='template')p.fields=[];if(f&&['reference','example','template'].includes(f.role))invalidateProtocol(p,'教学资料或表头已删除，请更新规范');saveProject(p);res.json(publicProject(p));
});
app.post('/api/examples',async(req,res)=>{
  const p=createProject('虚构土壤颗粒研究（软件演示）','这是虚构演示资料，不是真实研究。提取 Control 和 Treated 组的数据。正文与表格不一致时保留证据并标记冲突。SD 与 SE 严格区分；未报告的坐标与 PointID 留空，不从地图估计。','group');
  await addFile(p.id,path.join(ROOT,'examples/synthetic-study.pdf'),'Synthetic soil particle study.pdf');
  await addFile(p.id,path.join(ROOT,'examples/extraction-template.xlsx'),'提取表头.xlsx','template');
  emit(p.id,'info','已载入程序生成的虚构资料和 17 列空白提取模板；数据仅供软件演示');res.status(201).json(publicProject(getProject(p.id)));
});
app.post('/api/projects/:pid/run',(req,res)=>{
  const p=editable(req.params.pid);
  if(p.workflow){const action=req.body.action||(p.workflow.mode==='examples'&&!protocolCurrent(p)?'learn':p.workflow.active_version?'batch':'pilot');const spec=workflowAction(p,action,req.body.file_ids);return res.status(202).json(enqueue(p.id,spec.mode,{...spec,feedback:req.body.feedback}));}
  const mode=req.body.mode|| (p.records.length?'continue':'extract');
  if(!['extract','continue'].includes(mode))throw new Error('未知提取方式');
  res.status(202).json(enqueue(p.id,p.records.length?mode:'extract'));
});
app.patch('/api/projects/:pid/workflow',(req,res)=>{
  const p=editable(req.params.pid);if(!p.workflow)throw new Error('旧项目保留原流程，请新建双流程项目');
  if(req.body.pilot_size!==undefined){const n=req.body.pilot_size;if(!Number.isInteger(n)||n<1||n>10)throw new Error('试提取篇数须为1–10');p.workflow.pilot_size=n;}
  if(req.body.pilot_file_ids){if(!Array.isArray(req.body.pilot_file_ids)||req.body.pilot_file_ids.some(fid=>!p.files.some(f=>f.id===fid&&f.role==='document')))throw new Error('试提取资料无效');p.workflow.pilot_file_ids=[...new Set(req.body.pilot_file_ids)];p.workflow.pilot_configured=true;}
  saveProject(p);res.json(publicProject(p));
});
app.post('/api/projects/:pid/examples/:eid/sources',(req,res)=>{
  const p=editable(req.params.pid);linkExamples(p,[req.params.eid],req.body.file_ids||[],'用户手动指定对应原文',true);invalidateProtocol(p,'用户更新案例原文关联，请核对规范');
  p.examples.find(e=>e.id===req.params.eid).link_method='user';saveProject(p);res.json(publicProject(p));
});
app.post('/api/projects/:pid/protocol/approve',(req,res)=>{
  const p=editable(req.params.pid),v=approveProtocol(p,req.body.version);
  const folder=path.join(directory(p.id),'protocols',`v${v.version}`);fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(path.join(folder,'SKILL.md'),protocolMarkdown(v));fs.writeFileSync(path.join(folder,'protocol.json'),JSON.stringify(v,null,2));
  p.messages.push({id:id('msg_'),role:'user',text:`确认提取规范 v${v.version}，后续文献按此规范提取。`,at:now(),protocol_version:v.version});
  saveProject(p);emit(p.id,'protocol',`规范 v${v.version} 已确认，后续提取将使用此版本`);res.json(publicProject(getProject(p.id)));
});
app.post('/api/projects/:pid/cancel',(req,res)=>{const c=jobs.get(req.params.pid);if(!c)throw new Error('没有运行中的任务');change(req.params.pid,p=>{p.pending_feedback=[];for(const m of p.messages)if(m.queue_status==='queued')m.queue_status='cancelled';});c.abort(new Error('用户停止任务'));emit(req.params.pid,'info','正在停止任务…');res.json({ok:true});});
app.post('/api/projects/:pid/feedback',(req,res)=>{
  const p=getProject(req.params.pid);const {record_id,field,feedback}=req.body;
  if(record_id&&!p.records.some(r=>r.id===record_id))throw new Error('参考记录不存在');
  if(field&&!p.fields.some(f=>f.name===field))throw new Error('参考字段不存在');
  if(typeof feedback!=='string'||!feedback.trim()||feedback.length>5000)throw new Error('请输入具体反馈（不超过 5000 字）');

  const policy=coordinatePolicy(p.pending_feedback?.at(-1)?.policy||p.coordinate_policy,feedback,req.body.estimate_mode||'auto');
  if(isBusy(p)){if((p.pending_feedback||[]).length>=20)throw new Error('待处理补充消息已达20条，请稍候');const mid=id('msg_');change(p.id,p=>{p.messages.push({id:mid,role:'user',text:feedback,at:now(),record_id,field,queue_status:'queued'});p.pending_feedback||=[];p.pending_feedback.push({message_id:mid,record_id,field,feedback,policy:{...policy,updated_at:now()}});});return res.status(202).json({queued:true,message_id:mid});}
  const run=enqueue(p.id,'correction',{record_id,field,feedback});
  change(p.id,p=>{p.messages.push({id:id('msg_'),role:'user',text:feedback,at:now(),record_id,field,run_id:run.run_id});p.coordinate_policy={...policy,updated_at:now()};});
  res.status(202).json(run);
});
app.post('/api/projects/:pid/review',(req,res)=>{
  const p=editable(req.params.pid);const {record_id,field}=req.body;const r=p.records.find(r=>r.id===record_id);const c=r?.cells[field];if(!c)throw new Error('单元格不存在');
  const before=structuredClone(c);c.review=req.body.accepted===false?'pending':'accepted';
  p.history.push({id:id('h_'),at:now(),record_id,record_label:r.label,field,before,after:structuredClone(c),reason:c.review==='accepted'?'用户确认':'用户撤销确认'});saveProject(p);res.json(publicProject(p));
});
app.post('/api/projects/:pid/manual-edit',(req,res)=>{
  const p=editable(req.params.pid);const {record_id,field,value,note,evidence_ids}=req.body;const r=p.records.find(r=>r.id===record_id);if(!r?.cells[field])throw new Error('单元格不存在');
  if(!String(note||'').trim())throw new Error('手动修订必须填写原因');
  const c=validateCell(p,field,{value:value===''?null:value,status:value===''?'not_found':'needs_review',evidence_ids:evidence_ids||r.cells[field].evidence_ids,note:`人工修订：${note}`});c.review='accepted';
  p.history.push({id:id('h_'),at:now(),record_id,record_label:r.label,field,before:r.cells[field],after:c,reason:note});r.cells[field]=c;saveProject(p);res.json(publicProject(p));
});
app.get('/api/projects/:pid/export',async(req,res)=>{
  const p=selectedExport(getProject(req.params.pid),req.query.records);if(!p.records.length)throw new Error('暂无可导出结果');
  const dir=path.join(directory(p.id),'exports');fs.mkdirSync(dir,{recursive:true});const dest=path.join(dir,`extraction-${Date.now()}.xlsx`);
  await python({op:'export',project:p,output:dest,base_url:`${req.protocol}://${req.get('host')}`});res.download(dest,'SIE-Agent-提取结果.xlsx');
});
app.get('/api/projects/:pid/files/:fid/original',(req,res)=>{const f=fileOf(req.params.pid,req.params.fid);if(f.ext==='.pdf')res.type('application/pdf').sendFile(f.path);else res.download(f.path,path.basename(f.name));});
app.get('/api/projects/:pid/files/:fid/page/:page',async(req,res)=>{
  const f=fileOf(req.params.pid,req.params.fid);const page=Number(req.params.page);if(!Number.isInteger(page)||page<0||page>10000)throw new Error('非法页码');
  if(f.ext!=='.pdf'){if(['.png','.jpg','.jpeg','.webp','.bmp','.tiff'].includes(f.ext))return res.sendFile(f.path);throw new Error('此文件使用段落/单元格定位');}
  const dir=path.join(directory(req.params.pid),'previews',f.id);fs.mkdirSync(dir,{recursive:true});const dest=path.join(dir,`${page}.png`);
  if(!fs.existsSync(dest))await python({op:'render',path:f.path,page,output:dest});res.setHeader('Cache-Control','private, max-age=86400');res.sendFile(dest);
});
app.get('/api/projects/:pid/runs/:runid/transcript',(req,res)=>{
  const p=getProject(req.params.pid);if(!p.runs.some(r=>r.id===req.params.runid))throw new Error('运行记录不存在');
  const f=path.join(directory(p.id),'runs',req.params.runid,'pi-messages.json');if(!fs.existsSync(f))throw new Error('任务运行中，记录将在结束后保存');res.download(f,'pi-messages.json');
});
app.use('/api',(req,res)=>res.status(404).json({error:'接口不存在'}));
if(process.env.NODE_ENV==='production') {
  app.use(express.static(path.join(ROOT,'dist')));
  app.get('/{*splat}',(req,res)=>res.sendFile(path.join(ROOT,'dist/index.html')));
}else {
  const {createServer}=await import('vite');const vite=await createServer({server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);
}
app.use((err,req,res,next)=>{console.error('[api]',req.method,req.path,err.message);res.status(err.status||400).json({error:err.message||'请求失败'});});
for(const p of listProjects())if(p.pending_feedback?.length)resumeFeedback(p.id);
const port=Number(process.env.PORT||3210),host=process.env.HOST||'127.0.0.1';
app.listen(port,host,()=>console.log(`SIE-Agent ready at http://${host}:${port} (${process.env.NODE_ENV||'development'})`));
