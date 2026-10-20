// Incremental uploads search new documents plus papers with edited/pending cells.
export function incrementalFileIds(p,pendingFiles) {
  const files=new Set(pendingFiles.map(f=>f.id)),blockFiles=new Map(p.blocks.map(b=>[b.id,b.file_id]));
  for(const row of p.records.filter(r=>Object.values(r.cells).some(c=>c.needs_extraction))){
    const ids=row.source_file_ids?.length?row.source_file_ids:Object.values(row.cells).flatMap(c=>(c.evidence_ids||[]).map(id=>blockFiles.get(id))).filter(Boolean);
    if(!ids.length)return p.files.filter(f=>f.role==='document').map(f=>f.id);
    for(const id of ids)files.add(id);
  }
  return [...files];
}
