import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize,{defaultSchema} from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

const schema={...defaultSchema,attributes:{...defaultSchema.attributes,td:[...(defaultSchema.attributes.td||[]),'colSpan','rowSpan'],th:[...(defaultSchema.attributes.th||[]),'colSpan','rowSpan'],code:[...(defaultSchema.attributes.code||[]).filter(a=>!(Array.isArray(a)&&a[0]==='className')),['className',/^language-./,'math-inline','math-display']]}};
function tableMath(){
  return tree=>{const visit=node=>{if(!node.children||['code','pre'].includes(node.tagName))return;node.children=node.children.flatMap(child=>{if(child.type!=='text'){visit(child);return [child];}const parts=[];let from=0;for(const match of child.value.matchAll(/\$([^$\n]+)\$/g)){parts.push({type:'text',value:child.value.slice(from,match.index)},{type:'element',tagName:'code',properties:{className:['math-inline']},children:[{type:'text',value:match[1]}]});from=match.index+match[0].length;}return parts.length?[...parts,{type:'text',value:child.value.slice(from)}]:[child];});};visit(tree);};
}
// Match after sanitizing HTML, before typesetting formulae. Quotes are plain data.
function highlightQuotes({quotes=[]}={}){
  const normalize=s=>String(s).replace(/<[^>]*>/g,'').replace(/[$*_~#\s]+/g,'');
  return tree=>{
    const entries=[];let joined='';
    const walk=(node,parent)=>{if(node.type==='text'){const start=joined.length;joined+=normalize(node.value);entries.push({node,parent,start,end:joined.length});}else node.children?.forEach(c=>walk(c,node));};walk(tree,null);
    const ranges=[];for(const q of quotes){const needle=normalize(q);if(!needle)continue;let at=joined.indexOf(needle);while(at>=0){ranges.push([at,at+needle.length]);at=joined.indexOf(needle,at+needle.length);}}
    const math=new Set();
    for(const e of entries){const hit=ranges.filter(([a,b])=>a<e.end&&b>e.start);if(!hit.length)continue;
      if(e.parent.tagName==='code'&&e.parent.properties?.className?.includes('math-inline')){math.add(e.parent);continue;}
      let offset=e.start;const chunks=[];let text='',marked=null;
      for(const c of e.node.value){const n=normalize(c).length,active=hit.some(([a,b])=>offset>=a&&offset<b);if(marked!==null&&active!==marked){chunks.push(marked?{type:'element',tagName:'mark',properties:{className:['evidence-sentence']},children:[{type:'text',value:text}]}:{type:'text',value:text});text='';}marked=active;text+=c;offset+=n;}
      if(text)chunks.push(marked?{type:'element',tagName:'mark',properties:{className:['evidence-sentence']},children:[{type:'text',value:text}]}:{type:'text',value:text});
      const i=e.parent.children.indexOf(e.node);e.parent.children.splice(i,1,...chunks);
    }
    const wrap=node=>{if(!node.children)return;node.children=node.children.map(c=>{if(math.has(c))return {type:'element',tagName:'mark',properties:{className:['evidence-sentence']},children:[c]};wrap(c);return c;});};wrap(tree);
  };
}
const remarkPlugins=[remarkGfm,remarkMath];
const components={img:()=>null,a:({children})=><span>{children}</span>,table:({children})=><div className="readable-table"><table>{children}</table></div>};
export default function ReaderMarkdown({text,highlights=[]}){
  const rehypePlugins=[rehypeRaw,tableMath,[rehypeSanitize,schema],[highlightQuotes,{quotes:highlights}],[rehypeKatex,{strict:false,trust:false,throwOnError:false}]];
  return <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>{String(text||'').replace(/<!--[^]*?-->/g,'')}</Markdown>;
}
