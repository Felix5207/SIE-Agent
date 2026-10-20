// Bookkeeping from already saved answers; no model call or source rereading.
export function completeSavedFiles(p,runId,fileIds) {
  const run=p.runs.find(r=>r.id===runId);
  if(!run)throw new Error('运行不存在');
  const blockFiles=new Map(p.blocks.map(b=>[b.id,b.file_id]));
  const completed=[];
  for(const fileId of fileIds){
    if(run.file_results?.some(f=>f.file_id===fileId))continue;
    const rows=p.records.filter(r=>r.source_file_ids?.includes(fileId)||Object.values(r.cells).some(c=>c.evidence_ids?.some(eid=>blockFiles.get(eid)===fileId)));
    if(!rows.length)throw new Error(`文件 ${fileId} 尚无保存结果；请保存该论文答案，无相关数据时记录原因。`);
    if(rows.some(r=>p.fields.some(f=>!r.cells[f.name]||r.cells[f.name].needs_extraction)))throw new Error(`文件 ${fileId} 仍有未保存完的提取结果。`);
    completed.push({file_id:fileId,outcome:'study_extracted',reason:'根据已保存的论文答案自动记录完成。',run_id:runId,at:new Date().toISOString()});
  }
  run.file_results=[...(run.file_results||[]),...completed];
}
