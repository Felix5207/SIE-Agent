import {incrementalFileIds} from './extraction-scope.mjs';
import {columnInstructions,answerFormat} from './column-contract.mjs';
import {selectedExport} from './export-selection.mjs';
import path from 'node:path';
import {ROOT,createProject,getProject,saveProject,publicProject,listProjects,id,now,pendingFiles} from './core.mjs';
import {addFile} from './documents.mjs';
import {getFolder} from './workspace.mjs';

const TYPES = new Set(['text','number','boolean','select','multi']);
export const DEFAULT_COLUMNS = [
  {name:'研究设计',instructions:'描述本研究的设计、研究对象、实验或观察方法。只提取当前论文，勿使用引用文献的信息。',type:'text'},
  {name:'样本量',instructions:'提取本研究实际纳入分析的样本总数，仅返回数值。在说明中区分采样数、参与者数和实验重复。未报告时留空。',type:'number'},
  {name:'主要发现',instructions:'简述与研究问题相关的主要结果；保留效应方向、原始数值、单位和不确定性，不混淆 SD 与 SE。',type:'text'},
];

export function normalizeColumn(input, previous) {
  const name=String(input.name||'').trim(),instructions=columnInstructions(input);
  if(!name||name.length>120)throw new Error('列名须为 1–120 个字符');
  if(instructions.length>4000)throw new Error('提取说明最多 4000 字');
  const type=input.type||'text';if(!TYPES.has(type))throw new Error('未知答案格式');
  const options=['select','multi'].includes(type)?[...new Set((Array.isArray(input.options)?input.options:[]).map(s=>String(s).trim()).filter(Boolean))]:[];
  if(['select','multi'].includes(type)&&(options.length<2||options.length>30||options.some(s=>s.length>120||/[;；\n]/.test(s))))throw new Error('请填写 2–30 个不同选项；选项不能包含分号或换行');
  const format=answerFormat(type,options);
  return {id:previous?.id||id('col_'),name,instructions,type,options,description:`${instructions}\n答案格式：${format} 未找到时返回 null 并说明缺失，不得编造。`,hidden:previous?.hidden||false,version:(previous?.version||0)+1};
}

export function updateColumn(p,input,columnId) {
  const index=columnId?p.fields.findIndex(f=>f.id===columnId):-1;
  if(columnId&&index<0)throw new Error('列不存在');
  if(index<0&&p.fields.length>=60)throw new Error('最多支持 60 列');
  const previous=p.fields[index],column=normalizeColumn(input,previous);
  if(p.fields.some(f=>f.id!==column.id&&f.name===column.name))throw new Error('列名已存在');
  // Keep old answers in the audit trail, and visibly invalidate only this column.
  for(const r of p.records){
    const before=previous?r.cells[previous.name]:null;
    const after={value:null,status:'needs_review',evidence_ids:[],note:'列定义已更新，等待提取。',review:'pending',needs_extraction:true};
    if(previous)delete r.cells[previous.name];r.cells[column.name]=after;
    p.history.push({id:id('h_'),at:now(),record_id:r.id,record_label:r.label,field:column.name,previous_field:previous?.name,before,after,reason:'更新提取列定义'});
  }
  if(index<0)p.fields.push(column);else p.fields[index]=column;
  return column;
}

export function extractionCSV(p) {
  const safe=value=>{let s=String(value??'');if(/^[\s]*[=+@-]/.test(s)&&!/^[-+]?\d+(\.\d+)?$/.test(s.trim()))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  return '\ufeff'+[['Paper',...p.fields.map(f=>f.name)],...p.records.map(r=>[r.label,...p.fields.map(f=>r.cells[f.name]?.value??'')])].map(r=>r.map(safe).join(',')).join('\r\n');
}

export function registerExtractionRoutes(app,{editable,enqueue}) {
  const extraction=pid=>{const p=editable(pid);if(p.experience!=='extract')throw new Error('请在原工作台管理此项目');return p;};
  app.post('/api/extractions',(req,res)=>{
    const name=String(req.body.name||'未命名提取').trim();if(name.length>200)throw new Error('项目名称最多 200 字');
    const folderId=req.body.folder_id??null;
    if(folderId!==null){if(typeof folderId!=='string')throw new Error('请选择有效项目');getFolder(folderId);}
    const p=createProject(name,'','paper');
    p.experience='extract';p.folder_id=folderId;p.fields=DEFAULT_COLUMNS.map(f=>normalizeColumn(f));saveProject(p);res.status(201).json(publicProject(p));
  });
  app.post('/api/extractions/example',async(req,res)=>{
    const p=createProject('虚构土壤颗粒研究（软件演示）','这是虚构演示资料，不是真实研究。每篇论文一行，保留原始单位、证据与不确定性。','paper');
    p.experience='extract';p.fields=[...DEFAULT_COLUMNS,{name:'采样深度',instructions:'提取土壤采样深度和单位；未报告时留空。',type:'text'}].map(f=>normalizeColumn(f));saveProject(p);
    await addFile(p.id,path.join(ROOT,'examples/synthetic-study.pdf'),'Synthetic soil particle study.pdf');
    res.status(201).json(publicProject(getProject(p.id)));
  });
  app.post('/api/extractions/:pid/columns',(req,res)=>{const p=extraction(req.params.pid);updateColumn(p,req.body);saveProject(p);res.json(publicProject(p));});
  app.patch('/api/extractions/:pid/columns/:cid',(req,res)=>{const p=extraction(req.params.pid);updateColumn(p,req.body,req.params.cid);saveProject(p);res.json(publicProject(p));});
  app.delete('/api/extractions/:pid/columns/:cid',(req,res)=>{
    const p=extraction(req.params.pid),f=p.fields.find(f=>f.id===req.params.cid);if(!f)throw new Error('列不存在');
    for(const r of p.records){p.history.push({id:id('h_'),at:now(),record_id:r.id,record_label:r.label,field:f.name,before:r.cells[f.name],after:null,reason:'移除提取列'});delete r.cells[f.name];}
    p.fields=p.fields.filter(x=>x.id!==f.id);saveProject(p);res.json(publicProject(p));
  });
  app.post('/api/extractions/:pid/run',(req,res)=>{
    const p=extraction(req.params.pid);if(!p.fields.length)throw new Error('请先添加至少一列');
    const pending=p.fields.filter(f=>p.records.some(r=>r.cells[f.name]?.needs_extraction)).map(f=>f.name);
    if(p.records.length&&!pending.length&&!pendingFiles(p).length)throw new Error('所有列已提取。修改列定义后可重新提取该列，或在结果详情中复核。');
    const feedback=`每篇论文一行。请处理新资料；已有行仅提取 needs_extraction=true 的待提取列：${JSON.stringify(pending)}。必须逐项保存值或未找到原因以清除待提取状态。保留其他结果及人工确认，禁止跨论文复制。遵循每列答案格式。`;
    res.status(202).json(enqueue(p.id,p.records.length?'continue':'extract',p.records.length?{feedback,file_ids:incrementalFileIds(p,pendingFiles(p))}:null));
  });
  app.get('/api/extractions/:pid/export.csv',(req,res)=>{const p=selectedExport(getProject(req.params.pid),req.query.records);res.type('text/csv').attachment('extraction.csv').send(extractionCSV(p));});
  app.get('/api/library',(req,res)=>res.json(listProjects().filter(p=>!p.trashed_at).flatMap(p=>p.files.filter(f=>f.role==='document').map(f=>({id:f.id,project_id:p.id,project_name:p.name,name:f.name,size:f.size,ext:f.ext,status:f.status})))));
  app.post('/api/extractions/:pid/import',async(req,res)=>{
    const p=extraction(req.params.pid),items=req.body.items;
    if(!Array.isArray(items)||!items.length||items.length>100)throw new Error('请选择 1–100 篇文献');
    const files=items.map(item=>{const source=getProject(item.project_id),f=source.files.find(f=>f.id===item.id&&f.role==='document');if(source.trashed_at||!f)throw new Error('来源文件不存在或任务已移入回收站');return f;});
    for(const f of files)await addFile(p.id,f.path,f.name);
    res.json(publicProject(getProject(p.id)));
  });
}
