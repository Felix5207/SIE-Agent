import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {directory,getProject,python} from './core.mjs';
import {evidenceKind,validBox} from '../shared/evidence.mjs';
import {isContentList} from './mineru-client.mjs';

function filesUnder(dir){if(!fs.existsSync(dir))return [];return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?filesUnder(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const cache=new Map();
function artifacts(pid,fid){
  const dir=path.join(directory(pid),'parsed',fid),list=filesUnder(dir).find(isContentList);
  if(!list)return {raw:[],base:dir};
  const stamp=fs.statSync(list).mtimeMs,old=cache.get(list);if(old?.stamp===stamp)return old;
  const value={stamp,raw:JSON.parse(fs.readFileSync(list,'utf8')),base:path.dirname(list)};
  cache.set(list,value);if(cache.size>100)cache.delete(cache.keys().next().value);return value;
}
function metadata(b,raw){return raw.find(r=>r.type===b.type&&r.page_idx===b.page_idx&&JSON.stringify(r.bbox)===JSON.stringify(b.bbox))||{};}
export function readerDocument(p,fid){
  const f=p.files.find(f=>f.id===fid);if(!f)throw Object.assign(new Error('文献不存在'),{status:404});
  const {raw}=artifacts(p.id,fid),blocks=p.blocks.filter(b=>b.file_id===fid).map(b=>{
    const source=b.source_evidence_id?p.blocks.find(x=>x.id===b.source_evidence_id):null;const meta=metadata(source||b,raw),kind=evidenceKind(b);
    return {id:b.id,type:b.type,kind,text:(b.type==='visual'?source?.text||'原始图像证据':b.text)||'',level:b.text_level||meta.text_level||null,section:b.section||'',page_idx:b.page_idx,bbox:validBox(b.bbox)?b.bbox:null,page_size:b.page_size,location:b.cell_range||b.anchor||b.sheet||'',asset_url:kind==='image'||kind==='table'?`/api/projects/${p.id}/evidence/${encodeURIComponent(b.id)}/image`:null};
  });
  return {file:{id:f.id,name:f.name,ext:f.ext,status:f.status,pages:f.pages||Math.max(0,...blocks.map(b=>(b.page_idx??-1)+1))},blocks};
}
export async function evidenceImage(p,eid){
  const b=p.blocks.find(b=>b.id===eid);if(!b||!['image','table'].includes(evidenceKind(b)))throw Object.assign(new Error('没有该图表证据'),{status:404});
  const f=p.files.find(f=>f.id===b.file_id),{raw,base}=artifacts(p.id,b.file_id),meta=metadata(b,raw),relative=b.img_path||meta.img_path;
  if(relative){
    const asset=path.resolve(base,relative),root=path.resolve(directory(p.id),'parsed',b.file_id);
    if(asset.startsWith(root+path.sep)&&/\.(png|jpe?g|webp)$/i.test(asset)&&fs.existsSync(asset)){
      const real=fs.realpathSync(asset);if(real.startsWith(fs.realpathSync(root)+path.sep))return real;
    }
  }
  if(!f||!['.pdf','.png','.jpg','.jpeg','.webp','.bmp','.tiff'].includes(f.ext)||!validBox(b.bbox))throw Object.assign(new Error('该证据没有可用图片区域，请查看原文'),{status:404});
  const key=crypto.createHash('sha256').update(JSON.stringify([f.hash,b.page_idx,b.bbox])).digest('hex').slice(0,24);
  const folder=path.join(directory(p.id),'reader-images');fs.mkdirSync(folder,{recursive:true});const dest=path.join(folder,key+'.png');
  if(!fs.existsSync(dest))await python({op:'visual',path:f.path,page:b.page_idx??0,bbox:b.bbox,output:dest});return dest;
}
export function registerReaderRoutes(app){
  app.get('/api/projects/:pid/files/:fid/reader',(req,res)=>res.json(readerDocument(getProject(req.params.pid),req.params.fid)));
  app.get('/api/projects/:pid/evidence/:eid/image',async(req,res)=>{const file=await evidenceImage(getProject(req.params.pid),req.params.eid);res.setHeader('Cache-Control','private, max-age=86400');res.sendFile(file);});
}
