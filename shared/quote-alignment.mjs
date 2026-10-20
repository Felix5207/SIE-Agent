// Resolve only whitespace and omitted figure/table references. Return source text,
// never a rewritten quote; changed words, measurements or inequalities still fail.
function normalizedWithOffsets(text) {
  const refs=[...text.matchAll(/\s*\((?:see\s+)?(?:fig(?:ure)?s?\.?|tables?\.?|图|表)\s*\d+[a-z]?(?:\s*[,–-]\s*\d*[a-z]?)?\)/gi)];
  const chars=[],spans=[];let r=0;
  for(let i=0;i<text.length;i++){
    if(refs[r]?.index===i){i+=refs[r][0].length-1;r++;continue;}
    const ch=/\s/.test(text[i])?' ':text[i];
    if(ch===' '&&(!chars.length||chars.at(-1)===' ')){if(chars.length)spans.at(-1)[1]=i+1;continue;}
    if(/[.,;:!?]/.test(ch)&&chars.at(-1)===' '){chars.pop();spans.pop();}
    chars.push(ch);spans.push([i,i+1]);
  }
  if(chars.at(-1)===' '){chars.pop();spans.pop();}
  return {text:chars.join(''),spans};
}
export function alignSourceQuote(source,quote) {
  if(typeof source!=='string'||typeof quote!=='string'||!quote.trim())return null;
  if(source.includes(quote))return quote;
  const q=normalizedWithOffsets(quote).text;
  if(q.length<20)return null;
  const s=normalizedWithOffsets(source),at=s.text.indexOf(q);
  if(at<0||s.text.indexOf(q,at+1)>=0)return null;
  return source.slice(s.spans[at][0],s.spans[at+q.length-1][1]);
}
