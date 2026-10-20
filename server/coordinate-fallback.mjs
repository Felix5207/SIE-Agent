import {coordinateAxis} from './estimates.mjs';
const visualTypes=new Set(['image','figure','chart']);
const mapText=/\bmap\b|\blocat(?:ion|ions)\b|\bsampling\s+(?:sites?|points?|area)\b|经纬|地图|研究区|采样点|采样区|采样位置|地理位置|站点分布/i;
export function coordinateVisualCandidates(p,fileIds){
  const candidates=[];
  for(const fid of fileIds){
    const blocks=p.blocks.filter(b=>b.file_id===fid&&b.type!=='visual');
    const figures=blocks.filter(b=>visualTypes.has(b.type));
    const maps=figures.filter((b,i)=>mapText.test(b.text)||blocks.some(c=>
      c.page_idx===b.page_idx&&/^(?:FIGURE|Fig\.|图)\s*\d/i.test(c.text)&&mapText.test(c.text)||
      i===0&&c.page_idx<=b.page_idx&&c.page_idx>=b.page_idx-1&&/(?:geographical coverage|study area|sampling sites|site locations|研究区|采样点).{0,160}(?:Figure|Fig\.?|图)\s*1\b/i.test(c.text)));
    for(const b of maps.length?maps:figures)candidates.push({evidence_id:b.id,file_id:fid,page_idx:b.page_idx,bbox:b.bbox||[0,0,1000,1000],reason:maps.length?'研究区/采样位置图':'未识别地图图注，检查原图是否包含位置标注'});
  }
  return candidates;
}
export function assertCoordinateVisualFallback(p,cells,{fileIds=[],viewed=new Set()}={}){
  for(const c of cells){
    if(!coordinateAxis(c.field,p.fields)||!(c.value==null||c.value===''))continue;
    const row=p.records?.find(r=>r.id===c.record_id);
    const ids=row?.source_file_ids?.length?row.source_file_ids:fileIds.length?fileIds:[...new Set((c.evidence_ids||[]).map(id=>p.blocks.find(b=>b.id===id)?.file_id).filter(Boolean))];
    const unread=coordinateVisualCandidates(p,ids).filter(candidate=>!p.blocks.some(b=>b.type==='visual'&&viewed.has(b.id)&&b.file_id===candidate.file_id&&b.page_idx===candidate.page_idx&&b.bbox&&b.bbox[0]<=candidate.bbox[0]&&b.bbox[1]<=candidate.bbox[1]&&b.bbox[2]>=candidate.bbox[2]&&b.bbox[3]>=candidate.bbox[3]));
    if(unread.length)throw new Error(`${c.field} 在正文/表格未找到时，必须先 read_visual 读取相关原图，不能只读图注便保存未找到。待读图：${JSON.stringify(unread)}。读图后：明确标注直接提取；有经纬网用 calibrate_grid + save_coordinate_estimate；仍无依据保存 null 并说明原因。`);
  }
}
export function assertSavedCoordinateVisualFallback(p,runId,viewed){
  for(const r of p.records){
    const fields=p.fields.filter(f=>coordinateAxis(f.name,p.fields)&&(r.created_run_id===runId||p.history.some(h=>h.run_id===runId&&h.record_id===r.id&&h.field===f.name)));
    assertCoordinateVisualFallback(p,fields.map(f=>({...r.cells[f.name],field:f.name,record_id:r.id})),{fileIds:r.source_file_ids||[],viewed});
  }
}
