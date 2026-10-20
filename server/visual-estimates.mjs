// Generic figure readouts: preserve each group, its unit and the readout error.
// These are approximate image measurements, never author-reported statistics.
export function validateVisualEstimate(p,cell){
  const e=cell.estimate;
  if(e?.kind!=='visual_readout'||!e.run_id||!Array.isArray(e.items)||!e.items.length)throw new Error('图片估算须保留逐项读数、图像来源和误差范围');
  for(const item of e.items){
    const b=p.blocks.find(b=>b.id===item.evidence_id);
    if(b?.type!=='visual'||!b.image_hash||!cell.evidence_ids.includes(b.id))throw new Error('图片估算须引用实际读取的原图');
    if(!Number.isFinite(item.value)||!Array.isArray(item.range)||item.range.length!==2||item.range.some(v=>!Number.isFinite(v))||item.range[0]>=item.range[1]||item.value<item.range[0]||item.value>item.range[1])throw new Error('图片估算值必须位于有效的读图误差范围内');
    if(!item.label?.trim()||!item.unit?.trim()||!item.basis?.trim()||!item.uncertainty_note?.trim())throw new Error('请说明分组、单位（无量纲须明示）、读图参照和误差依据');
  }
  return structuredClone(e);
}
export function visualEstimateCell(p,field,items,runId,previous,mode='replace'){
  const f=p.fields.find(f=>f.name===field);
  if(!f||!['text','number',undefined].includes(f.type))throw new Error('数值图片估算支持自由文本或数值列；类别信息请直接引用图片保存');
  if(f.type==='number'&&items.length!==1)throw new Error('数值列仅能保存一个读数；多个分组请用自由文本列，不能自行平均');
  const lines=items.map(i=>`${i.label}：≈ ${i.value} ${i.unit}（图片估算）`);
  const c={value:f.type==='number'?items[0]?.value:lines.join('\n'),status:'estimated',evidence_ids:[...new Set(items.map(i=>i.evidence_id))],
    note:items.map(i=>`${i.label}：${i.basis}；${i.uncertainty_note}`).join('\n'),
    estimate:{kind:'visual_readout',run_id:runId,items},review:'pending'};
  c.estimate=validateVisualEstimate(p,c);
  if(f.type!=='number')c.claims=items.map((i,n)=>({text:lines[n],evidence_ids:[i.evidence_id]}));
  if(mode==='append'&&previous?.value!=null&&previous.value!==''){
    if(f.type==='number')throw new Error('数值列不能追加多个读数');
    if(previous.estimate&&previous.estimate.kind!=='visual_readout')throw new Error('不能混合不同估算结构');
    c.value=String(previous.value)+'\n'+c.value;
    c.evidence_ids=[...new Set([...previous.evidence_ids,...c.evidence_ids])];
    c.claims=[...(previous.claims?.length?previous.claims:[{text:String(previous.value),evidence_ids:previous.evidence_ids,...(previous.source_quotes?{source_quotes:previous.source_quotes}:{})}]),...c.claims];
    c.note=[previous.note,c.note].filter(Boolean).join('\n');
    c.estimate.items=[...(previous.estimate?.items||[]),...items];
  }
  return c;
}
