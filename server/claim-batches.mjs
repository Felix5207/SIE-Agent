export function assembleClaimBatch(p,args){
  const row=p.records.find(r=>r.id===args.record_id),definition=p.fields.find(f=>f.name===args.field);
  if(!row||!definition)throw new Error('请先创建论文记录和提取列');
  if(definition.type&&definition.type!=='text')throw new Error('分批多项答案仅适用于“不限”格式列');
  if(!['replace','append'].includes(args.mode)||!Array.isArray(args.items)||args.items.length>12||(!args.items.length&&args.mode==='replace'))throw new Error('每批 1–12 项，首批用 replace，后续用 append');
  const before=row.cells[args.field],claims=args.mode==='append'?[...(before?.claims||[])]:[];
  if(args.mode==='append'&&before?.value&&!claims.length)throw new Error('旧答案没有逐项结构，请用 replace 开始');
  for(const c of args.items){if(row.source_file_ids?.length&&c.evidence_ids?.some(id=>{const b=p.blocks.find(b=>b.id===id);return b&&!row.source_file_ids.includes(b.file_id);}))throw new Error('分组证据不属于该论文，不能串用其他研究');if(claims.some(old=>old.text===c.text))throw new Error('该项已保存，请勿重复追加');claims.push(c);}
  if(!claims.length)throw new Error('没有可保存的结果');
  return {field:args.field,value:claims.map(c=>c.text).join('\n'),claims,evidence_ids:[...new Set(claims.flatMap(c=>c.evidence_ids))],status:args.status||before?.status||'reported',note:args.note||before?.note||'逐项提取，保留原始证据。'};
}
