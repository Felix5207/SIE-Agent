export function flagStatisticalConflict(p,cell){
  if(!/\bSD\b/.test(String(cell.value))||!/\bSE\b/.test(String(cell.value)))return;
  for(const b of p.blocks.filter(b=>b.type==='table'&&cell.evidence_ids.includes(b.id))){
    const rows=[...b.text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>[...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c=>c[1].replace(/<[^>]*>/g,'').trim()));
    const sd=rows.find(r=>/^SD$/i.test(r[0])),se=rows.find(r=>/^SE$/i.test(r[0]));
    if(sd&&se&&sd.slice(1).some((v,i)=>Number(v)>0&&Number(v)<Number(se[i+1]))){
      const warning='原表 SD 小于对应 SE，统计标签或数值可能不一致；已保留原文，需人工核查，未擅自交换或重算。';
      if(!cell.note.includes(warning))cell.note+=' '+warning;
      if(cell.status!=='conflict')cell.status='needs_review';
    }
  }
}
