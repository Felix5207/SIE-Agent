import {alignSourceQuote} from './quote-alignment.mjs';
export function evidenceKind(block){
  const type=block?.source_type||block?.type;
  if(type==='table')return 'table';
  if(['image','figure','chart','visual'].includes(type))return 'image';
  return 'text';
}
export function validBox(box){return Array.isArray(box)&&box.length===4&&box.every(n=>Number.isFinite(n)&&n>=0&&n<=1000)&&box[0]<box[2]&&box[1]<box[3];}
export function validateClaims(value,claims,evidenceIds,blocks=[]){
  if(claims===undefined)return undefined;
  if(!Array.isArray(claims))throw new Error('答案分句必须是数组');
  const answer=String(value??'');let offset=0;
  return claims.map(c=>{
    if(typeof c.text!=='string'||!c.text.trim()||!Array.isArray(c.evidence_ids)||!c.evidence_ids.length)throw new Error('每个答案分句需要原答案中的文字及证据 ID');
    const at=answer.indexOf(c.text,offset);if(at<0)throw new Error('答案分句必须按原答案顺序排列，且不能改写或重叠');offset=at+c.text.length;
    if(c.evidence_ids.some(id=>!evidenceIds.includes(id)))throw new Error('分句引用必须属于该答案的证据');
    return {text:c.text,evidence_ids:[...new Set(c.evidence_ids)],...(c.source_quotes?{source_quotes:validateQuotes(c.source_quotes,c.evidence_ids,blocks)}:{})};
  });
}

export function validateQuotes(quotes,evidenceIds,blocks){
  if(quotes===undefined)return undefined;
  if(!Array.isArray(quotes))throw new Error('原文引句必须为数组');
  return quotes.map(q=>{
    const b=blocks.find(b=>b.id===q.evidence_id);
    const text=b?.source_evidence_id?blocks.find(source=>source.id===b.source_evidence_id)?.text||b.text:b?.text;
    if(!b||typeof q.text!=='string'||!q.text.trim())throw new Error(`原文引句必须引用有效的证据 ID 和非空原文：${q.evidence_id}`);
    if(!evidenceIds.includes(q.evidence_id))throw new Error(`引句引用 ${q.evidence_id}，但当前分项 evidence_ids 为 ${JSON.stringify(evidenceIds)}。请核对本项出处，使分项与引句引用同一原文证据；不要重写正确的引句。`);
    const aligned=alignSourceQuote(text,q.text);
    if(!aligned)throw new Error(`证据 ${q.evidence_id} 的引句与原文不匹配，不能改写或编造。请从该证据逐字选取；无需重写其他已正确的内容。原文：${text.slice(0,1600)}`);
    return {evidence_id:q.evidence_id,text:aligned};
  });
}
export function focusedEvidence(blocks,quote,cell,claimIndex){
  if(!quote)return {blocks:[],highlights:[]};
  const block=blocks.find(b=>b.id===quote.id)||blocks.find(b=>b.id===quote.source_evidence_id);
  if(!block)return {blocks:[],highlights:[]};
  const claim=cell.claims?.[claimIndex],quotes=(claim?.source_quotes||cell.source_quotes||[]).filter(q=>[quote.id,quote.source_evidence_id].includes(q.evidence_id));
  let highlights=quotes.map(q=>q.text).filter(t=>block.text.includes(t));
  if(!highlights.length&&block.kind==='text'){
    const value=String(claim?.text||cell.value||'');
    // Legacy answers have no stored sentence. Match exact, distinctive values only;
    // never highlight the entire paragraph merely because its block was cited.
    const numbers=[...new Set(value.match(/\d+(?:\.\d+)?/g)||[])].filter(n=>Number(n)>=10||n.includes('.'));
    const sentences=[...new Intl.Segmenter('en',{granularity:'sentence'}).segment(block.text)].map(s=>s.segment.trim());
    if(value.length>=12&&block.text.includes(value))highlights=[value];
    else if(numbers.length){const scored=sentences.map(text=>({text,score:numbers.filter(n=>new RegExp(`(?<![\\d.])${n.replaceAll('.','\\.')}(?![\\d.]|\\d)`).test(text)).length}));const best=Math.max(...scored.map(x=>x.score));if(best>0)highlights=scored.filter(x=>x.score===best).map(x=>x.text);}
  }
  const paragraphs=block.text.split(/\n\s*\n/);
  const matching=highlights.length&&block.kind==='text'?paragraphs.filter(p=>highlights.some(h=>p.includes(h))):[];
  return {blocks:[{...block,text:matching.length?matching.join('\n\n'):block.text}],highlights};
}

export function ungroundedClaimNumbers(claims,blocks){
  const normalize=s=>String(s).replace(/(?<=\d),(?=\d{3}(?:\D|$))/g,'');
  // A full stop terminates a sentence; only a dot followed by a digit
  // continues a decimal. Do not drop values such as "2024." or "2.24.".
  const numbers=s=>[...normalize(s).matchAll(/(?<![\d.])\d+(?:\.\d+)?(?!\d|\.\d)/g)].map(m=>Number(m[0]));
  const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
  const ordinals=['first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth'];
  return (claims||[]).flatMap(c=>{
    const sources=c.evidence_ids.map(id=>blocks.find(b=>b.id===id)).filter(Boolean);
    if(sources.some(b=>evidenceKind(b)==='image'))return [];
    const source=sources.map(b=>b.text).join(' '),available=new Set(numbers(source));
    months.forEach((month,i)=>{if(new RegExp(`\\b${month}\\b`,'i').test(source))available.add(i+1);});
    // Display-only section labels are not measured values.
    // A numbered site may be spelled out in prose ("the first site").
    // Exempt only that supported label, never the same number used as a measurement.
    const claimText=c.text.replace(/\b(site|station|sampling point)\s+(\d+)[a-z]?\b/gi,(label,kind,n)=>{
      const ordinal=ordinals[Number(n)-1];
      return ordinal&&new RegExp(`\\b${ordinal}\\s+${kind.replace(/\s+/g,'\\s+')}\\b`,'i').test(source)?kind:label;
    });
    const absent=[...new Set(numbers(claimText.replace(/【[^】]*】/g,'').replace(/\bb\d{4}\b|\b(?:Fig(?:ure)?|Table)\.?\s*\d+[a-z]?|[图表]\s*\d+|\(\d+\)(?=\s*[\p{L}])/giu,'')))].filter(n=>!available.has(n));
    return absent.length?[{text:c.text,numbers:absent}]:[];
  });
}
