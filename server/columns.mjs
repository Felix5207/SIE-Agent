import {db,id,now,getProject,saveProject,publicProject} from './core.mjs';
import {normalizeColumn} from './extraction.mjs';

db.exec('CREATE TABLE IF NOT EXISTS column_presets (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
export const listColumnPresets=()=>db.prepare('SELECT body FROM column_presets ORDER BY rowid DESC').all().map(x=>JSON.parse(x.body));
export function saveColumnPreset(column){const preset={...normalizeColumn(column),id:id('preset_'),created_at:now()};db.prepare('INSERT INTO column_presets VALUES(?,?)').run(preset.id,JSON.stringify(preset));return preset;}
export function duplicateColumn(p,cid){
  const index=p.fields.findIndex(f=>f.id===cid),source=p.fields[index];if(!source)throw new Error('列不存在');if(p.fields.length>=60)throw new Error('最多支持 60 列');
  let n=1,name;do{name=`${source.name.slice(0,105)}（副本${n===1?'':n}）`;n++;}while(p.fields.some(f=>f.name===name));
  const duplicate={...normalizeColumn({...source,name}),hidden:false};p.fields.splice(index+1,0,duplicate);
  for(const row of p.records){row.cells[duplicate.name]=structuredClone(row.cells[source.name]||{value:null,status:'needs_review',needs_extraction:true,evidence_ids:[],review:'pending'});p.history.push({id:id('h_'),at:now(),record_id:row.id,record_label:row.label,field:duplicate.name,before:null,after:structuredClone(row.cells[duplicate.name]),reason:`复制提取列：${source.name}`});}
  return duplicate;
}
export function layoutColumns(p,{order,visibility}){
  if(order!==undefined&&(!Array.isArray(order)||order.length!==p.fields.length||new Set(order).size!==order.length||order.some(x=>!p.fields.some(f=>f.id===x))))throw new Error('列排序必须包含全部列且不能重复');
  if(visibility!==undefined&&(!visibility||typeof visibility!=='object'||Array.isArray(visibility)||Object.entries(visibility).some(([key,value])=>!p.fields.some(f=>f.id===key)||typeof value!=='boolean')))throw new Error('列显示设置无效');
  if(order)p.fields=order.map(cid=>p.fields.find(f=>f.id===cid));
  if(visibility)for(const f of p.fields)if(visibility[f.id]!==undefined)f.hidden=!visibility[f.id];return p;
}
export function registerColumnRoutes(app,{editable}){
  const extraction=pid=>{const p=editable(pid);if(p.experience!=='extract')throw new Error('请在高级工作区管理此任务');return p;};
  app.get('/api/column-presets',(req,res)=>res.json(listColumnPresets()));
  app.post('/api/extractions/:pid/columns/:cid/duplicate',(req,res)=>{const p=extraction(req.params.pid);const column=duplicateColumn(p,req.params.cid);saveProject(p);res.status(201).json({project:publicProject(p),column_id:column.id});});
  app.post('/api/extractions/:pid/columns/:cid/preset',(req,res)=>{const p=getProject(req.params.pid),f=p.fields.find(f=>f.id===req.params.cid);if(!f)throw new Error('列不存在');res.status(201).json(saveColumnPreset(f));});
  app.patch('/api/extractions/:pid/column-layout',(req,res)=>{const p=extraction(req.params.pid);layoutColumns(p,req.body);saveProject(p);res.json(publicProject(p));});
}
