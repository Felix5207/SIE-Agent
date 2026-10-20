import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { coordinatePolicy } from './estimates.mjs';
import {createWorkflow,reviewQueue} from './workflow.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = path.resolve(process.env.SIE_DATA_DIR || path.join(ROOT, 'data'));
export const PYTHON = process.env.SIE_PYTHON || 'python3';
export const MINERU = process.env.MINERU_URL || 'http://127.0.0.1:8001';
export const MINERU_MODEL = process.env.MINERU_MODEL_URL || 'http://127.0.0.1:30000';
export const id = (prefix = '') => prefix + crypto.randomUUID().slice(0, 12);
export const now = () => new Date().toISOString();
fs.mkdirSync(DATA, { recursive: true });
export const db = new DatabaseSync(path.join(DATA, 'sie.sqlite'));
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY, body TEXT NOT NULL);');
export function getProject(pid) {
  const row = db.prepare('SELECT body FROM projects WHERE id=?').get(pid);
  if (!row) throw Object.assign(new Error('项目不存在'), { status: 404 });
  return JSON.parse(row.body);
}
export function saveProject(p) {
  p.updated_at = now();
  db.prepare('INSERT INTO projects VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(p.id, JSON.stringify(p));
  return p;
}
export function listProjects() { return db.prepare('SELECT body FROM projects').all().map(x => JSON.parse(x.body)).sort((a,b) => b.updated_at.localeCompare(a.updated_at)); }
export function change(pid, fn) { const p=getProject(pid); fn(p); return saveProject(p); }
export function emit(pid, type, message, detail = {}) {
  return change(pid, p => { p.events.push({ id:id('e_'), at:now(), type, message, ...detail }); if(p.events.length>600)p.events=p.events.slice(-600); });
}
export function directory(pid) {
  if(!/^p_[a-z0-9-]+$/i.test(pid))throw new Error('Invalid project id');
  const p = path.join(DATA,'projects',pid); fs.mkdirSync(p,{recursive:true}); return p;
}
export function python(args, timeout=60000) {
  return new Promise((resolve,reject) => {
    const child=spawn(PYTHON,[path.join(ROOT,'scripts/documents.py')],{stdio:['pipe','pipe','pipe']});
    let out='',err=''; const timer=setTimeout(()=>{child.kill();reject(new Error('文档处理超时'));},timeout);
    child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{clearTimeout(timer);try {const value=JSON.parse(out);if(code||value.error)reject(new Error(value.error||err));else resolve(value);}catch{reject(new Error(err||out||'文档处理失败'));}});
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(args));
  });
}

export function fieldsFromHeaders(headers) { return headers.map((name,i)=>({id:`f${i+1}`,name,instructions:'',description:`从当前研究提取「${name}」，根据论文上下文理解字段含义，保留原始单位和证据；未报告时留空。`})); }
export function createProject(name, instructions='', granularity='group',workflow=null) {
  const p={id:id('p_'),name:name||'未命名提取项目',instructions,granularity,status:'draft',stage:'准备资料',created_at:now(),updated_at:now(),fields:[],files:[],blocks:[],records:[],events:[],messages:[],history:[],runs:[],warnings:[],applied_memories:[]};
  if(workflow){p.workflow=createWorkflow(workflow.mode,workflow.pilot_size??3);p.examples=[];}
  p.coordinate_policy=coordinatePolicy(null,instructions);directory(p.id);saveProject(p);return p;
}
export function summaries(p) {
  const cells=p.records.flatMap(r=>Object.values(r.cells));
  return {records:p.records.length,fields:p.fields.length,documents:p.files.filter(f=>f.role!=='template').length,found:cells.filter(c=>c.value!==null&&c.value!==undefined&&c.value!=='').length,missing:cells.filter(c=>c.value===null).length,flagged:cells.filter(c=>['conflict','needs_review','estimated'].includes(c.status)&&c.review!=='accepted').length,reviewed:cells.filter(c=>c.review==='accepted').length,total:cells.length};
}
export function publicProject(p, full=true) {
  const safe={...p,files:p.files.map(({path:_,...f})=>f),stats:summaries(p),pending_file_ids:pendingFiles(p).map(f=>f.id),review_queue:reviewQueue(p)};
  delete safe.pi_session_file;delete safe.archived_pi_sessions;
  if(!full) {delete safe.blocks;delete safe.records;delete safe.events;delete safe.messages;delete safe.history;}
  return safe;
}
export function pendingFiles(p) {
  const blockFiles=new Map(p.blocks.map(b=>[b.id,b.file_id]));
  // Older projects have no explicit coverage ledger. Recover it from saved evidence,
  // never from "parsed" or a successful run which may have ignored the new file.
  const legacy=new Set(p.records.filter(r=>!r.created_run_id).flatMap(r=>Object.values(r.cells).flatMap(c=>(c.evidence_ids||[]).map(eid=>blockFiles.get(eid)))));
  return p.files.filter(f=>f.role==='document'&&f.status!=='unsupported'&&!f.coverage&&!legacy.has(f.id));
}
export function memories(pid) { return db.prepare('SELECT body FROM memories').all().map(x=>JSON.parse(x.body)).filter(m=>!pid||m.project_id===pid); }
export function saveMemory(m) { db.prepare('INSERT INTO memories VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(m.id,JSON.stringify(m)); return m; }
export function normalize(s) { return String(s??'').normalize('NFKC').toLowerCase().replace(/<[^>]*>/g,' ').replace(/\$|\\[a-zA-Z]+|[{}]/g,'').replace(/\s+/g,' ').trim(); }
// Keep the public name for existing callers. Saving normalizes the result shape;
// it no longer judges the answer, numbers, quotes, or completeness of evidence.
export function validateCell(p, field, input) {
  if(!input || !(input.value===null || typeof input.value==='string' || typeof input.value==='number'&&Number.isFinite(input.value)))throw new Error(`${field}: value 必须是文本、有限数值或 null`);
  const validStatus=['reported','derived','generated','not_found','conflict','needs_review','estimated'];
  const index=new Map(p.blocks.map(b=>[b.id,b]));
  const ids=value=>[...new Set((Array.isArray(value)?value:[]).filter(eid=>typeof eid==='string'&&index.has(eid)))];
  const quotes=value=>(Array.isArray(value)?value:[]).filter(q=>q&&typeof q.text==='string'&&index.has(q.evidence_id)).map(q=>({evidence_id:q.evidence_id,text:q.text}));
  const c={value:input.value===''?null:input.value,status:validStatus.includes(input.status)?input.status:'reported',evidence_ids:ids(input.evidence_ids),note:String(input.note||''),review:'pending'};
  if(c.value===null){if(!['needs_review','conflict'].includes(c.status))c.status='not_found';if(!c.note)c.note='在已解析资料中未找到；不等同于原论文一定未报告。';}
  if(Array.isArray(input.claims))c.claims=input.claims.filter(x=>x&&typeof x.text==='string').map(x=>({text:x.text,evidence_ids:ids(x.evidence_ids),...(Array.isArray(x.source_quotes)?{source_quotes:quotes(x.source_quotes)}:{})}));
  if(Array.isArray(input.source_quotes))c.source_quotes=quotes(input.source_quotes);
  // Preserve valid links provided at any level without enforcing a redundant
  // parent/child subset relationship or inventing missing evidence.
  c.evidence_ids=[...new Set([...c.evidence_ids,...(c.source_quotes||[]).map(q=>q.evidence_id),...(c.claims||[]).flatMap(x=>[...x.evidence_ids,...(x.source_quotes||[]).map(q=>q.evidence_id)])])];
  if(c.evidence_ids.some(eid=>p.files?.find(f=>f.id===index.get(eid).file_id)?.role==='example'))throw new Error('示范结果表不在提取来源文件范围，不能作为新论文的来源');
  if(input.estimate&&typeof input.estimate==='object')c.estimate=structuredClone(input.estimate);
  return c;
}

export function applyRecords(p, input, reason='首次提取') {
  const allowed=new Set(p.fields.map(f=>f.name));
  const prepared=input.map(raw=>{
    if(!raw.id||!raw.label||!raw.cells||!Array.isArray(raw.cells))throw new Error('每条记录需提供 id、label 和 cells 数组');
    const old=p.records.find(r=>r.id===String(raw.id).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80));const cells={...(old?.cells||{})};
    for(const cell of raw.cells){if(old?.cells[cell.field]?.review==='accepted')throw new Error('已审核答案不能覆盖，请提交修改建议');if(!allowed.has(cell.field))throw new Error(`未知字段 ${cell.field}`);cells[cell.field]=validateCell(p,cell.field,cell);}
    for(const f of p.fields)if(!cells[f.name])cells[f.name]={value:null,status:'not_found',evidence_ids:[],note:'尚未找到支持证据。',review:'pending'};
    if(allowed.has('LabelID')&&cells.LabelID?.value===null)cells.LabelID={value:String(raw.id),status:'generated',evidence_ids:[],note:`系统生成的分组标识：${raw.label}；不代表原文采样点编号。`,review:'pending'};
    return {id:String(raw.id).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80),label:String(raw.label),cells};
  });
  if(new Set(prepared.map(x=>x.id)).size!==prepared.length)throw new Error('记录 ID 重复');
  for(const r of prepared){
    const old=p.records.find(x=>x.id===r.id);
    if(old)for(const [f,cell] of Object.entries(r.cells))if(JSON.stringify(old.cells[f])!==JSON.stringify(cell))p.history.push({id:id('h_'),at:now(),record_id:r.id,record_label:r.label,field:f,before:old.cells[f],after:cell,reason});
    const i=p.records.findIndex(x=>x.id===r.id);if(i>=0)p.records[i]=r;else p.records.push(r);
  }
  return prepared.length;
}
