export function selectedExport(p,raw){
  if(raw===undefined&&p.experience!=='extract')return p;
  let ids;try{ids=JSON.parse(raw);}catch{throw new Error('请先勾选要导出的论文');}
  if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'||!p.records.some(r=>r.id===id)))throw new Error('请选择有效的论文后导出');
  const selected=new Set(ids),records=p.records.filter(r=>selected.has(r.id));
  const files=new Set(records.flatMap(r=>r.source_file_ids||[]));
  const evidence=new Set(records.flatMap(r=>Object.values(r.cells).flatMap(c=>c.evidence_ids||[])));
  for(const b of p.blocks)if(evidence.has(b.id))files.add(b.file_id);
  return {...p,records,history:p.history.filter(h=>selected.has(h.record_id)),blocks:p.blocks.filter(b=>files.has(b.file_id)),files:p.files.filter(f=>files.has(f.id)),summary:`已选择 ${records.length} 篇论文`,messages:[],runs:[]};
}
