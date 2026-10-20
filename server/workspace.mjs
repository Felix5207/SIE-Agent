import crypto from 'node:crypto';
import {db, id, now, getProject, saveProject, publicProject} from './core.mjs';

db.exec(`CREATE TABLE IF NOT EXISTS workspace_settings (id TEXT PRIMARY KEY, body TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS workspace_folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS workspace_shares (token TEXT PRIMARY KEY, project_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);`);
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const title=value=>{if(typeof value!=='string'||!value.trim()||value.trim().length>200)fail('请输入 1–200 字的名称');return value.trim();};
export const folders=()=>db.prepare('SELECT * FROM workspace_folders ORDER BY created_at DESC').all();
export function getFolder(folderId){const folder=db.prepare('SELECT * FROM workspace_folders WHERE id=?').get(folderId);if(!folder)fail('项目不存在',404);return folder;}
export function createFolder(name){const folder={id:id('folder_'),name:title(name),created_at:now()};db.prepare('INSERT INTO workspace_folders VALUES(?,?,?)').run(folder.id,folder.name,folder.created_at);return folder;}
export function renameFolder(folderId,name){getFolder(folderId);db.prepare('UPDATE workspace_folders SET name=? WHERE id=?').run(title(name),folderId);return getFolder(folderId);}
export function deleteFolder(folderId){
  db.exec('BEGIN IMMEDIATE');
  try{
    const folder=getFolder(folderId);
    const members=db.prepare("SELECT body FROM projects WHERE json_extract(body,'$.folder_id')=?").all(folderId).map(row=>JSON.parse(row.body));
    if(members.some(p=>['queued','parsing','extracting','correcting'].includes(p.status)))fail('项目中有运行中的提取任务，请完成或停止后再删除项目',409);
    // Remove only the grouping; retain tasks, evidence, shares and trash state.
    db.prepare("UPDATE projects SET body=json_set(body,'$.folder_id',NULL) WHERE json_extract(body,'$.folder_id')=?").run(folderId);
    db.prepare('DELETE FROM workspace_folders WHERE id=?').run(folderId);
    db.exec('COMMIT');return folder;
  }catch(error){db.exec('ROLLBACK');throw error;}
}
export function readSettings(){return JSON.parse(db.prepare('SELECT body FROM workspace_settings WHERE id=?').get('profile')?.body||'{"name":"科研工作区","email":"","fontSize":16}');}
export function writeSettings(input){
  const current=readSettings(),name=input.name===undefined?current.name:title(input.name),email=input.email===undefined?current.email:String(input.email).trim();
  if(email.length>254||(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))fail('请输入有效邮箱，或留空');
  const fontSize=input.fontSize===undefined?current.fontSize:input.fontSize;if(![15,16,18].includes(fontSize))fail('未知字号');
  const profile={name,email,fontSize};db.prepare('INSERT INTO workspace_settings VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run('profile',JSON.stringify(profile));return profile;
}
export function assignFolder(p,folderId){if(folderId!==null&&!folders().some(f=>f.id===folderId))fail('项目不存在',404);p.folder_id=folderId;return saveProject(p);}
export function trashProject(p){p.trashed_at=now();saveProject(p);db.prepare('DELETE FROM workspace_shares WHERE project_id=?').run(p.id);return p;}
export function restoreProject(p){delete p.trashed_at;return saveProject(p);}
export function makeShare(p){
  // Whitelist snapshot contents: no local paths, prompts, conversations, or unrelated papers.
  const snapshot={name:p.name,created_at:now(),fields:p.fields.map(f=>({name:f.name})),records:p.records.map(r=>({label:r.label,cells:Object.fromEntries(p.fields.map(f=>{
    const c=r.cells[f.name];return [f.name,c?{value:c.value,status:c.status,review:c.review,note:c.note,quotes:(c.evidence_ids||[]).map(eid=>p.blocks.find(b=>b.id===eid)).filter(Boolean).map(b=>({text:b.text,page:b.page_idx==null?null:b.page_idx+1,file:p.files.find(f=>f.id===b.file_id)?.name||'',location:b.location||''}))}:{value:null,status:'not_found',quotes:[]}];
  }))}))};
  const token=crypto.randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO workspace_shares VALUES(?,?,?,?)').run(token,p.id,JSON.stringify(snapshot),snapshot.created_at);
  return {token,created_at:snapshot.created_at};
}
export function readShare(token){const row=db.prepare('SELECT body,project_id FROM workspace_shares WHERE token=?').get(token);if(!row||getProject(row.project_id).trashed_at)fail('分享链接不存在或已撤销',404);return JSON.parse(row.body);}
export function registerWorkspaceRoutes(app,{editable}){
  app.get('/api/workspace/settings',(req,res)=>res.json(readSettings()));
  app.patch('/api/workspace/settings',(req,res)=>res.json(writeSettings(req.body)));
  app.get('/api/workspace/folders',(req,res)=>res.json(folders()));
  app.post('/api/workspace/folders',(req,res)=>res.status(201).json(createFolder(req.body.name)));
  app.patch('/api/workspace/folders/:fid',(req,res)=>res.json(renameFolder(req.params.fid,req.body.name)));
  app.delete('/api/workspace/folders/:fid',(req,res)=>res.json(deleteFolder(req.params.fid)));
  app.post('/api/projects/:pid/rename',(req,res)=>{const p=editable(req.params.pid);p.name=title(req.body.name);saveProject(p);res.json(publicProject(p));});
  app.post('/api/projects/:pid/folder',(req,res)=>res.json(publicProject(assignFolder(editable(req.params.pid),req.body.folder_id))));
  app.post('/api/projects/:pid/trash',(req,res)=>res.json(publicProject(trashProject(editable(req.params.pid)))));
  app.post('/api/projects/:pid/restore',(req,res)=>res.json(publicProject(restoreProject(getProject(req.params.pid)))));
  app.get('/api/projects/:pid/shares',(req,res)=>{getProject(req.params.pid);res.json(db.prepare('SELECT token,created_at FROM workspace_shares WHERE project_id=? ORDER BY created_at DESC').all(req.params.pid));});
  app.post('/api/projects/:pid/shares',(req,res)=>res.status(201).json(makeShare(editable(req.params.pid))));
  app.delete('/api/projects/:pid/shares/:token',(req,res)=>{getProject(req.params.pid);db.prepare('DELETE FROM workspace_shares WHERE token=? AND project_id=?').run(req.params.token,req.params.pid);res.json({ok:true});});
  app.get('/api/shares/:token',(req,res)=>{res.setHeader('Cache-Control','no-store');res.json(readShare(req.params.token));});
  // A trashed task can be restored above, but cannot be run or edited through old URLs.
  app.use(['/api/projects/:pid','/api/extractions/:pid'],(req,res,next)=>{if(req.params.pid.startsWith('p_')&&getProject(req.params.pid).trashed_at)fail('任务已移入回收站，请先恢复',410);next();});
}
