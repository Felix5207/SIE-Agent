import {assertWriteScope,commitAgentCells} from './cell-protection.mjs';
import {applyRecords,validateCell,id,now} from './core.mjs';

export function setReviewPlan(p,runId,{issue,targets}) {
  if(!issue?.trim())throw new Error('请先说明对用户问题的理解');
  for(const t of targets){
    // Plans may name prospective rows. Mutation tools still require saved rows;
    // allowing a future ID here avoids a plan -> add_records dependency cycle.
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(t.record_id))throw new Error('计划中的记录 ID 格式无效');
    if(!t.fields.length||t.fields.some(f=>!p.fields.some(x=>x.name===f)))throw new Error('计划包含未知字段');
    if(!t.reason?.trim())throw new Error('请说明该记录和问题的关系');
  }
  const run=p.runs.find(r=>r.id===runId);if(!run)throw new Error('运行不存在');
  run.review_plan={issue,targets,at:now()};
  return run.review_plan;
}
export function assertPlanned(p,runId,record_id,field) {
  assertWriteScope(p,runId,record_id,field);
  if(!p.runs.find(r=>r.id===runId)?.review_plan?.targets.some(t=>t.record_id===record_id&&t.fields.includes(field)))throw new Error('请先用 set_review_plan 将要修订的记录和字段加入问题处理计划');
}
export function reviseCells(p,updates,runId,reason) {
  if(!Array.isArray(updates)||!updates.length||updates.length>60)throw new Error('每批须包含1–60个单元格');
  const keys=new Set();
  const prepared=updates.map(u=>{
    const key=JSON.stringify([u.record_id,u.field]);if(keys.has(key))throw new Error('同一批不能重复修改同一单元格');keys.add(key);
    const row=p.records.find(r=>r.id===u.record_id);if(!row?.cells[u.field])throw new Error('修订单元格不存在');
    assertPlanned(p,runId,u.record_id,u.field);
    const cell=validateCell(p,u.field,u);
    if(row.source_file_ids?.length&&cell.evidence_ids.some(e=>{const b=p.blocks.find(b=>b.id===e);return b&&!row.source_file_ids.includes(b.file_id);}))throw new Error('证据不属于该论文，不能跨论文修订');
    if(u.status==='estimated')throw new Error('图片估算请用 save_visual_estimate；坐标请用成对坐标保存工具');
    return {row,field:u.field,cell};
  });
  commitAgentCells(p,prepared.map(({row,field,cell})=>({record_id:row.id,field,cell})),runId,reason);
  return prepared.length;
}
export function appendRecords(p,records,runId) {
  const scope=p.runs.find(r=>r.id===runId)?.write_scope;
  if(scope&&records.some(r=>!r.source_file_ids?.length||r.source_file_ids.some(fid=>!scope.new_file_ids.includes(fid))))throw new Error('本轮不允许新增范围外论文');
  const existing=new Set(p.records.map(r=>r.id));
  const prepared=records.map(r=>{
    const rid=String(r.id).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80);
    if(existing.has(rid))throw new Error('新增记录 ID 已存在，请用 revise_cells 修订现有记录，不能覆盖');existing.add(rid);
    if(!r.source_file_ids?.length||r.source_file_ids.some(fid=>!p.files.some(f=>f.id===fid&&f.role!=='template'&&f.status==='parsed')))throw new Error('新增记录必须指定已解析的来源文件');
    for(const c of r.cells)if(validateCell(p,c.field,c).evidence_ids.some(eid=>{const b=p.blocks.find(b=>b.id===eid);return b&&!r.source_file_ids.includes(b.file_id);}))throw new Error('证据不属于本条记录的来源资料，不能串用其他论文的数据');
    return {...r,id:rid};
  });
  applyRecords(p,prepared,'继续提取新增记录');
  for(const r of prepared)Object.assign(p.records.find(x=>x.id===r.id),{source_file_ids:r.source_file_ids,created_run_id:runId});
  return prepared.length;
}
export function runChanges(p,runId) {
  const changes=new Map();
  for(const h of p.history.filter(h=>h.run_id===runId)){
    const key=JSON.stringify([h.record_id,h.field]),previous=changes.get(key);
    changes.set(key,{record_id:h.record_id,record_label:h.record_label,field:h.field,before:previous?previous.before:h.before?.value,after:h.after?.value,status:h.after?.status,evidence_ids:h.after?.evidence_ids,note:h.after?.note});
  }
  return {changes:[...changes.values()],proposed_changes:(p.proposals||[]).filter(x=>x.run_id===runId),added_records:p.records.filter(r=>r.created_run_id===runId).map(r=>({id:r.id,label:r.label}))};
}
