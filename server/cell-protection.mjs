import crypto from 'node:crypto';
const uid=prefix=>prefix+crypto.randomUUID().slice(0,12);
export function assertWriteScope(p,runId,recordId,field){
 const scope=p.runs?.find(r=>r.id===runId)?.write_scope;
 if(!scope)return;
 if(scope.cells.some(c=>c.record_id===recordId&&c.field===field))return;
 const row=p.records.find(r=>r.id===recordId);
 if(row?.created_run_id===runId&&row.source_file_ids?.every(fid=>scope.new_file_ids.includes(fid)))return;
 throw new Error(`本轮仅允许修改指定范围：${recordId} / ${field} 不在重提范围内`);
}
export function commitAgentCells(p,updates,runId,reason){
 for(const u of updates){if(!p.records.find(r=>r.id===u.record_id)?.cells[u.field])throw new Error('单元格不存在');assertWriteScope(p,runId,u.record_id,u.field);}
 for(const u of updates){
  const row=p.records.find(r=>r.id===u.record_id),before=structuredClone(row.cells[u.field]);
  if(before.review==='accepted'){
   p.proposals||=[];
   for(const old of p.proposals.filter(x=>x.record_id===u.record_id&&x.field===u.field&&x.status==='pending'))old.status='superseded';
   p.proposals.push({id:uid('proposal_'),at:new Date().toISOString(),run_id:runId,record_id:row.id,field:u.field,before,after:structuredClone(u.cell),reason,status:'pending'});
  }else{
   row.cells[u.field]=structuredClone(u.cell);
   p.history.push({id:uid('h_'),at:new Date().toISOString(),run_id:runId,record_id:row.id,record_label:row.label,field:u.field,before,after:structuredClone(u.cell),reason});
  }
 }
 return updates.length;
}
