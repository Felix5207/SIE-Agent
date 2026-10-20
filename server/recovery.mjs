import {id,now,getProject,saveProject,publicProject} from './core.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const key=c=>JSON.stringify([c.record_id,c.field]);
export function unfinishedCells(p,recordId){
 const cells=p.records.flatMap(r=>p.fields.filter(f=>(!recordId||r.id===recordId)&&r.cells[f.name]?.needs_extraction&&r.cells[f.name]?.review!=='accepted').map(f=>({record_id:r.id,field:f.name})));
 const run=p.runs.at(-1);
 if(run&&['error','cancelled','interrupted'].includes(run.status))for(const row of p.records.filter(r=>(!recordId||r.id===recordId)&&r.created_run_id===run.id))for(const f of p.fields){const c=row.cells[f.name];if(!c||c.review!=='accepted'&&c.note==='尚未找到支持证据。')cells.push({record_id:row.id,field:f.name});}
 if(run&&['error','cancelled','interrupted'].includes(run.status))for(const c of run.write_scope?.cells||run.last_operation?.cells||[]){
  if(recordId&&c.record_id!==recordId)continue;
  if(p.history.some(h=>h.run_id===run.id&&key(h)===key(c))||p.proposals?.some(h=>h.run_id===run.id&&key(h)===key(c)))continue;
  const current=p.records.find(r=>r.id===c.record_id)?.cells[c.field];
  if(current&&(current.review!=='accepted'||run.write_scope?.include_confirmed))cells.push(c);
 }
 return [...new Map(cells.map(c=>[key(c),c])).values()];
}
export function recoverySpec(p,{scope='unfinished',record_id,field,feedback='',category='其他问题'}={}){
 if(!['cell','paper_pending','unfinished'].includes(scope))throw new Error('未知重提范围');
 if(typeof feedback!=='string'||feedback.length>4000)throw new Error('问题说明最多4000字');
 let cells;
 if(scope==='cell'){
  if(!p.records.find(r=>r.id===record_id)?.cells[field])throw new Error('请选择有效答案');
  cells=[{record_id,field}];
 }else{
  if(scope==='paper_pending'&&!p.records.some(r=>r.id===record_id))throw new Error('请选择论文');
  cells=unfinishedCells(p,scope==='paper_pending'?record_id:undefined);
 }
 const newFiles=scope==='unfinished'?p.files.filter(f=>f.role==='document'&&f.status!=='unsupported'&&!p.records.some(r=>r.source_file_ids?.includes(f.id))&&!f.coverage).map(f=>f.id):[];
 if(!cells.length&&!newFiles.length)throw new Error('该范围没有未完成项；如需纠错，请选择具体单元格');
 const files=new Set(newFiles);
 for(const c of cells){const row=p.records.find(r=>r.id===c.record_id);const ids=row.source_file_ids?.length?row.source_file_ids:(row.cells[c.field].evidence_ids||[]).map(e=>p.blocks.find(b=>b.id===e)?.file_id).filter(Boolean);if(!ids.length)throw new Error('该答案缺少论文关联，无法安全限定重提范围');ids.forEach(f=>files.add(f));}
 return {mode:newFiles.length?'continue':'correction',target:{user_feedback:`${String(category).slice(0,80)}：${feedback.trim()||'依据原文重新提取，保留原值与证据'}`,file_ids:[...files],write_scope:{cells,new_file_ids:newFiles,...(scope==='cell'&&p.records.find(r=>r.id===record_id).cells[field].review==='accepted'||scope!=='cell'&&p.runs.at(-1)?.write_scope?.include_confirmed?{include_confirmed:true}:{})},feedback:`本轮只处理这些单元格：${JSON.stringify(cells)}；允许新增论文文件：${JSON.stringify(newFiles)}。问题类别：${String(category).slice(0,80)}。提取者反馈：${feedback.trim()||'依据原文重新提取，保留原始数值、单位、范围和精确证据。'}。禁止修改范围外字段。已审核单元格只能形成修改建议，原值保持；所有请求项必须实际保存结果或未找到原因。图片不足时查看原图，估读附误差。完成后结束，不新增补读核查阶段。`}};
}
export function failureInfo(p,error,phase,run){
 const message=String(error?.message||error||'未知错误');
 let kind='extraction',title='提取未完成',action='继续未完成项';
 if(phase==='parsing'){kind='parsing';title='文献解析失败';action='重试解析并继续';}
 else if(/模型请求|连接|fetch failed|ECONN|HTTP 5|超时|context.*(?:length|limit)/i.test(message)){kind='model';title='模型请求失败';}
 else if(/图片|读图|网格|估算|刻度/.test(message)){kind='image';title='图片证据处理失败';}
 else if(/校验|保存失败|证据|引句|数值|范围|字段/.test(message)){kind='validation';title='答案保存校验失败';}
 return {kind,title,message,action,at:now(),cells:run?.write_scope?.cells||run?.last_operation?.cells||[],file_ids:phase==='parsing'?p.files.filter(f=>f.status==='error').map(f=>f.id):run?.input_file_ids||[]};
}
export function undoChange(p,historyId){
 const h=p.history.find(h=>h.id===historyId),row=p.records.find(r=>r.id===h?.record_id);
 if(!h?.before||!row?.cells[h.field]||!p.fields.some(f=>f.name===h.field))throw new Error('该记录没有可恢复的旧答案');
 if(!same(row.cells[h.field],h.after))throw Object.assign(new Error('答案已有后续修改，请刷新并从最新修订撤销'),{status:409});
 const before=structuredClone(row.cells[h.field]);row.cells[h.field]=structuredClone(h.before);
 p.history.push({id:id('h_'),at:now(),record_id:row.id,record_label:row.label,field:h.field,before,after:structuredClone(h.before),reason:'撤销修订，恢复旧答案',undo_of:h.id});
}
export function resolveProposal(p,proposalId,accept){
 const x=p.proposals?.find(x=>x.id===proposalId);if(!x||x.status!=='pending')throw new Error('修改建议已处理或不存在');
 const row=p.records.find(r=>r.id===x.record_id);
 if(accept){
  if(!same(row?.cells[x.field],x.before))throw Object.assign(new Error('原答案已改变，请重新核对建议'),{status:409});
  const after={...structuredClone(x.after),review:'accepted'};
  p.history.push({id:id('h_'),at:now(),record_id:row.id,record_label:row.label,field:x.field,before:structuredClone(row.cells[x.field]),after,reason:'人工采纳 Agent 修改建议',proposal_id:x.id});row.cells[x.field]=after;
 }
 x.status=accept?'accepted':'rejected';x.resolved_at=now();
}
export function saveCorrectionCase(p,recordId,field){
 const row=p.records.find(r=>r.id===recordId),cell=row?.cells[field];if(!cell||cell.review!=='accepted'||cell.needs_extraction)throw new Error('请先人工确认答案，再保存纠错样例');
 const evidence=cell.evidence_ids.map(e=>p.blocks.find(b=>b.id===e)).filter(Boolean).map(b=>structuredClone(b));
 if(!evidence.length)throw new Error('该答案尚无原文证据，不能保存为纠错样例');
 const files=[...new Set(evidence.map(b=>b.file_id))].map(fid=>{const f=p.files.find(f=>f.id===fid);return {id:fid,name:f?.name,hash:f?.hash};});
 p.correction_cases||=[];
 const sample={id:id('case_'),at:now(),record_id:row.id,label:row.label,field,definition:structuredClone(p.fields.find(f=>f.name===field)),expected:structuredClone(cell),evidence,files};p.correction_cases.push(sample);return sample;
}
export function registerRecoveryRoutes(app,{editable,enqueue}){
 app.post('/api/projects/:pid/retry',(req,res)=>{const p=editable(req.params.pid),spec=recoverySpec(p,req.body);const run=enqueue(p.id,spec.mode,spec.target);res.status(202).json(run);});
 app.post('/api/projects/:pid/history/:hid/undo',(req,res)=>{const p=editable(req.params.pid);undoChange(p,req.params.hid);saveProject(p);res.json(publicProject(p));});
 app.post('/api/projects/:pid/proposals/:id',(req,res)=>{const p=editable(req.params.pid);if(typeof req.body.accept!=='boolean')throw new Error('请选择采纳或保留原值');resolveProposal(p,req.params.id,req.body.accept);saveProject(p);res.json(publicProject(p));});
 app.post('/api/projects/:pid/correction-cases',(req,res)=>{const p=editable(req.params.pid);const sample=saveCorrectionCase(p,req.body.record_id,req.body.field);saveProject(p);res.json({sample,project:publicProject(p)});});
 app.get('/api/projects/:pid/correction-cases',(req,res)=>{res.attachment('correction-cases.json').json({version:1,cases:getProject(req.params.pid).correction_cases||[]});});
}
