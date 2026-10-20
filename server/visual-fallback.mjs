// Relevance is decided by the agent from column meaning and the paper, not a
// discipline-specific keyword allowlist. Decisions are local to one run.
const visualTypes=new Set(['image','figure','chart']);
export function visualCandidates(p,fileIds){
  const ids=new Set(fileIds);
  return p.blocks.filter(b=>ids.has(b.file_id)&&visualTypes.has(b.type)).map(b=>({
    evidence_id:b.id,file_id:b.file_id,page_idx:b.page_idx,bbox:b.bbox||[0,0,1000,1000],
    caption:String(b.text||'').slice(0,1200),
    context:p.blocks.filter(c=>c.file_id===b.file_id&&c.page_idx===b.page_idx&&c.id!==b.id&&c.type!=='visual').map(c=>String(c.text||'').slice(0,600)).join('\n').slice(0,2400),
  }));
}
const key=(file,field)=>JSON.stringify([file,field]);
export function selectVisualSources(p,plans,{file_id,field,decisions}){
  if(!p.fields.some(f=>f.name===field))throw new Error('未知提取列');
  const candidates=visualCandidates(p,[file_id]),ids=new Set(candidates.map(c=>c.evidence_id));
  if(!Array.isArray(decisions)||decisions.length!==ids.size||new Set(decisions.map(d=>d.evidence_id)).size!==ids.size)throw new Error('请对该论文每张候选图说明相关或无关；图注不明的图片必须读取');
  for(const d of decisions){
    if(!ids.has(d.evidence_id)||typeof d.relevant!=='boolean'||!d.reason?.trim())throw new Error('图片判断须包含有效来源、相关性和具体原因');
    if(!d.relevant&&!candidates.find(c=>c.evidence_id===d.evidence_id).caption.trim())throw new Error('无图注图片不能仅凭上下文排除，请实际读图');
  }
  plans.set(key(file_id,field),structuredClone(decisions));
  return {field,file_id,read_evidence_ids:decisions.filter(d=>d.relevant).map(d=>d.evidence_id)};
}
export function assertVisualFallback(p,cells,{fileIds=[],viewed=new Set(),plans=new Map()}={}){
  for(const c of cells){
    if(!(c.value==null||c.value===''))continue;
    const row=p.records?.find(r=>r.id===c.record_id);
    const ids=row?.source_file_ids?.length?row.source_file_ids:fileIds.length?fileIds:[...new Set((c.evidence_ids||[]).map(id=>p.blocks.find(b=>b.id===id)?.file_id).filter(Boolean))];
    const unread=visualCandidates(p,ids).filter(candidate=>{
      const decision=plans.get(key(candidate.file_id,c.field))?.find(d=>d.evidence_id===candidate.evidence_id);
      if(decision?.relevant===false)return false;
      return !p.blocks.some(b=>b.type==='visual'&&viewed.has(b.id)&&b.image_hash&&b.file_id===candidate.file_id&&b.page_idx===candidate.page_idx&&b.bbox&&b.bbox[0]<=candidate.bbox[0]&&b.bbox[1]<=candidate.bbox[1]&&b.bbox[2]>=candidate.bbox[2]&&b.bbox[3]>=candidate.bbox[3]);
    });
    if(unread.length)throw new Error(`${c.field} 的正文/表格答案缺失，请先根据列含义用 select_visual_sources 判断候选图，read_visual 读取相关图的像素；不能只凭图注或历史答案判定未找到。待读图：${JSON.stringify(unread.map(({caption,context,...v})=>v))}。图片有明示值直接提取；估读须标注图片估算及误差；仍无依据才保存 null 和具体原因。`);
  }
}
export function assertSavedVisualFallback(p,runId,viewed,plans){
  for(const r of p.records){
    const fields=p.fields.filter(f=>r.created_run_id===runId||p.history.some(h=>h.run_id===runId&&h.record_id===r.id&&h.field===f.name));
    assertVisualFallback(p,fields.map(f=>({...r.cells[f.name],field:f.name,record_id:r.id})),{fileIds:r.source_file_ids||[],viewed,plans});
  }
}
