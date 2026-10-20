import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { directory, getProject, change, emit, python, id } from './core.mjs';
import {selectedConnections,redactError} from './connections.mjs';
import {extractWithMineru,isContentList,isLayout} from './mineru-client.mjs';

import {invalidateProtocol} from './workflow.mjs';

const supported = new Set(['.pdf','.png','.jpg','.jpeg','.webp','.bmp','.tiff','.docx','.pptx','.xlsx','.csv','.txt','.md']);
export async function addFile(pid, source, name, role='document') {
  const ext=path.extname(name).toLowerCase();
  if(ext==='.zip') {
    const unpackDir=path.join(directory(pid),'unpacked',id());
    const list=await python({op:'unpack',path:source,output:unpackDir});
    const results=[];
    for(const item of list) {
      if(path.extname(item.name).toLowerCase()==='.zip') {results.push({skipped:item.name,reason:'嵌套压缩包请先解压'});change(pid,p=>{const warning=`未解析的嵌套压缩包：${item.name}，请解压后上传`;p.import_warnings=[...(p.import_warnings||[]),warning];p.warnings.push(warning);});continue;}
      results.push(await addFile(pid,item.path,item.name,role));
    }
    return {archive:name,results};
  }
  if(role==='template'&&ext!=='.xlsx')throw new Error('提取模板请上传 .xlsx 文件');
  if(role==='example'&&!['.xlsx','.csv'].includes(ext))throw new Error('已提取结果请上传 XLSX 或 CSV 表格');
  const contents=fs.readFileSync(source);const hash=crypto.createHash('sha256').update(contents).digest('hex');
  const p=getProject(pid);const previous=p.files.find(f=>f.hash===hash&&f.role===role);
  if(previous)return previous;
  const fid=id('d_');const dest=path.join(directory(pid),'originals',fid+ext);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(source,dest);
  const file={id:fid,name,ext,role,size:contents.length,hash,path:dest,status:role==='template'?'ready':supported.has(ext)?'pending':'unsupported',pages:0,block_count:0};
  let fields,examples;
  if(role==='template') {
    const result=await python({op:'template',path:dest});
    if(p.examples?.length&&JSON.stringify(p.fields.map(f=>f.name))!==JSON.stringify(result.headers))throw new Error('已有教学案例，模板表头必须与案例一致');
    const {fieldsFromHeaders}=await import('./core.mjs');fields=fieldsFromHeaders(result.headers);file.sheet=result.sheet;
  }
  if(role==='example'){
    const imported=await python({op:'examples',path:dest});
    if(p.fields.length&&JSON.stringify(p.fields.map(f=>f.name))!==JSON.stringify(imported.headers))throw new Error('示范结果表与当前字段名称/顺序不一致，请先统一表头');
    const {fieldsFromHeaders}=await import('./core.mjs');if(!p.fields.length)fields=fieldsFromHeaders(imported.headers);
    examples=imported.rows.map((r,i)=>({...r,id:`${fid}:row${i+1}`,file_id:fid,source_file_ids:[],status:'user_example'}));
    file.example_count=examples.length;file.parsing_warnings=imported.warnings;
  }
  change(pid,p=>{p.files.push(file);if(['example','reference','template'].includes(role))invalidateProtocol(p,'新增教学资料或表头，请更新规范');if(fields)p.fields=fields;if(examples){p.examples=[...(p.examples||[]),...examples];p.warnings.push(...file.parsing_warnings);if(p.workflow)p.workflow.stage='setup';}if(file.status==='unsupported')p.warnings.push(`未支持的文件：${name}`);});
  return file;
}
function filesUnder(dir) {return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?filesUnder(path.join(dir,e.name)):[path.join(dir,e.name)]);}
function contentText(b) {
  const parts=[];
  for(const key of ['text','table_caption','table_body','table_footnote','image_caption','image_footnote','list_items','code_body','content']) {
    const v=b[key];if(v)parts.push(typeof v==='string'?v:Array.isArray(v)?v.map(x=>typeof x==='string'?x:JSON.stringify(x)).join('\n'):JSON.stringify(v));
  }
  return parts.join('\n');
}
export async function parseProject(pid, signal, fileIds=null, connection=selectedConnections().mineru) {
  for(const file of getProject(pid).files.filter(f=>f.role!=='template'&&(!fileIds||fileIds.includes(f.id)))) {
    signal.throwIfAborted();
    if(['parsed','unsupported'].includes(file.status))continue;
    change(pid,p=>{p.stage=`解析 ${file.name}`;p.files.find(x=>x.id===file.id).status='parsing';});
    emit(pid,'parse',`正在解析 ${file.name}`);
    try {
      let result,parseVersion='local-adapters-v1';
      const folder=path.join(directory(pid),'parsed',file.id);fs.mkdirSync(folder,{recursive:true});
      if(['.xlsx','.csv'].includes(file.ext))result=await python({op:'table',path:file.path});
      else if(['.txt','.md','.docx'].includes(file.ext))result=await python({op:'plain',path:file.path});
      else {
        parseVersion=connection?.kind==='cloud'?'mineru-cloud-v4':'mineru-self-hosted-tasks';
        const output=await extractWithMineru(file,folder,connection,signal,{checkpoint:task=>change(pid,p=>{const f=p.files.find(x=>x.id===file.id);f.parse_connection=task;delete f.parse_task_id;})});
        const paths=filesUnder(output);const listFile=paths.find(isContentList);const middleFile=paths.find(isLayout);const md=paths.find(x=>x.endsWith('.md'));
        if(!listFile)throw new Error('解析结果缺少 content_list，无法生成可定位证据');
        const raw=JSON.parse(fs.readFileSync(listFile,'utf8'));const middle=middleFile?JSON.parse(fs.readFileSync(middleFile,'utf8')):{};
        const pages=middle.pdf_info||[];
        if(!Array.isArray(raw))throw new Error('MinerU content_list 格式无效');
        result={blocks:raw.map(b=>({...b,text:contentText(b)||(['image','table'].includes(b.type)?'图表区域（未提供可读图注，请实际查看原图）':''),page_size:pages.find(p=>p.page_idx===b.page_idx)?.page_size||null})).filter(b=>b.text.trim()),page_count:pages.length||Math.max(0,...raw.map(b=>(b.page_idx??0)+1)),warnings:[],markdown:md};
      }
      signal.throwIfAborted();
      let section='';
      const blocks=result.blocks.map((b,i)=>{if(b.text_level||b.type==='title')section=b.text;return {id:`${file.id}:b${String(i+1).padStart(4,'0')}`,file_id:file.id,type:b.type||'text',text:b.text,text_level:b.text_level||null,img_path:b.img_path||null,section,page_idx:b.page_idx??null,bbox:b.bbox||null,page_size:b.page_size||null,sheet:b.sheet||null,cell_range:b.cell_range||null,anchor:b.anchor||null,parse_version:parseVersion,source_hash:file.hash};});
      if(!blocks.length)throw new Error('未提取到可用内容');
      fs.writeFileSync(path.join(folder,'blocks.json'),JSON.stringify(blocks,null,2));
      fs.writeFileSync(path.join(folder,'document.md'),blocks.map(b=>`<!-- evidence:${b.id}; ${b.page_idx!==null?'PDF page '+(b.page_idx+1):b.sheet||b.anchor||''} -->\n${b.text}`).join('\n\n'));
      change(pid,p=>{p.blocks=p.blocks.filter(b=>b.file_id!==file.id).concat(blocks);Object.assign(p.files.find(x=>x.id===file.id),{status:'parsed',pages:result.page_count,block_count:blocks.length,parse_error:null,parsing_warnings:result.warnings||[]});p.warnings.push(...(result.warnings||[]));});
      emit(pid,'success',`已解析 ${file.name}`,{detail:`${result.page_count||'—'} 页 · ${blocks.length} 个证据块`});
    }catch(e) {
      e=new Error(redactError(e,[connection]));
      change(pid,p=>Object.assign(p.files.find(x=>x.id===file.id),{status:signal.aborted?'pending':'error',parse_error:e.message}));
      throw e;
    }
  }
}
