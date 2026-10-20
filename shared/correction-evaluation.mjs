// Offline comparison only: never promotes one paper's answer into extraction rules.
export function evaluateCorrectionCases(cases,project){
 const rows=cases.map(c=>{
  const actual=project.records.find(r=>r.id===c.record_id)?.cells[c.field];
  const matched=!!actual&&String(actual.value??'')===String(c.expected.value??'')&&actual.status===c.expected.status;
  const evidenceValid=!!actual&&actual.evidence_ids?.length>0&&actual.evidence_ids.every(id=>project.blocks.some(b=>b.id===id&&c.files.some(f=>f.id===b.file_id&&(!f.hash||project.files.find(x=>x.id===f.id)?.hash===f.hash))));
  return {case_id:c.id,record_id:c.record_id,field:c.field,matched,evidence_valid:evidenceValid,expected:c.expected.value,actual:actual?.value??null};
 });
 return {total:rows.length,matched:rows.filter(x=>x.matched).length,with_valid_evidence:rows.filter(x=>x.evidence_valid).length,rows};
}
