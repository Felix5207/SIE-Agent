import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {getProject,saveProject,memories,saveMemory,directory,id,now,listProjects} from './core.mjs';
import {protocolMarkdown,latestProtocol,activeProtocol,invalidateProtocol,protocolCurrent} from './workflow.mjs';
import {composeSystem,projectPrompt,baseline} from './prompts.mjs';

export function skillDirectory(pid,mid,version){
  if(!/^m_[a-zA-Z0-9-]+$/.test(mid)||!Number.isInteger(version)||version<1)throw new Error('无效技能版本');
  return path.join(directory(pid),'skills',mid,`v${version}`);
}
export function skillMarkdown(m){return `---\nname: learned-${m.id.replaceAll('_','-')}\ndescription: ${JSON.stringify(m.title)}\nmetadata:\n  project: ${m.project_id}\n  scope: project\n  version: "${m.version}"\n---\n\n# ${m.title}\n\n${m.content}\n\n仅适用于当前项目。技能是提取方法，不是新论文事实；当前用户明确修订优先。\n`;}
function writeSkill(m){const folder=skillDirectory(m.project_id,m.id,m.version);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'SKILL.md'),skillMarkdown(m));fs.writeFileSync(path.join(folder,'metadata.json'),JSON.stringify(m,null,2));}
export function writeProtocolArtifact(p,v){const folder=path.join(directory(p.id),'protocols',`v${v.version}`);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'SKILL.md'),protocolMarkdown(v));fs.writeFileSync(path.join(folder,'protocol.json'),JSON.stringify(v,null,2));}
function previousVersion(m){const {revisions,...previous}=m;return previous;}
export function saveProjectSkill(pid,input,source={}){
  getProject(pid);
  const title=String(input.title||'').trim(),content=String(input.content||'').trim();
  if(!title||title.length>200||!content||content.length>16000)throw new Error('技能标题须为1–200字符，内容须为1–16000字符');
  const own=memories(pid),previous=input.skill_id?own.find(m=>m.id===input.skill_id):own.find(m=>m.title===title);
  if(input.skill_id&&!previous)throw new Error('技能不存在或不属于当前项目');
  const m={...(previous||{}),id:previous?.id||id('m_'),project_id:pid,kind:'skill',scope:'project',status:'active',title,content,version:(previous?.version||0)+1,created_at:previous?.created_at||now(),updated_at:now(),source,revisions:previous?[...(previous.revisions||[]),previousVersion(previous)]:[]};
  writeSkill(m);saveMemory(m);return m;
}
export function editProjectSkill(pid,mid,input){
  const m=memories(pid).find(m=>m.id===mid);if(!m)throw Object.assign(new Error('技能不存在或不属于当前项目'),{status:404});
  if(input.scope&&input.scope!=='project')throw new Error('项目记忆已隔离，不支持跨项目共享');
  if(input.version!==undefined&&input.version!==m.version)throw new Error('技能已更新，请刷新后再修改');
  const status=input.status||m.status;if(!['active','candidate','disabled'].includes(status))throw new Error('无效技能状态');
  const title=input.title===undefined?m.title:String(input.title).trim(),content=input.content===undefined?m.content:String(input.content).trim();
  if(!title||title.length>200||!content||content.length>16000)throw new Error('请输入有效标题和技能内容');
  const next={...m,title,content,status,scope:'project',kind:'skill',version:m.version+1,updated_at:now(),revisions:[...(m.revisions||[]),previousVersion(m)]};
  writeSkill(next);saveMemory(next);return next;
}
export function saveSystemPrompt(pid,text,version){
  const p=getProject(pid);if(typeof text!=='string'||!text.trim()||text.length>24000)throw new Error('项目系统提示词须为1–24000字符');
  if(version!==(p.system_prompt?.version||0))throw new Error('系统提示词已更新，请刷新后再保存');
  const previous={version:p.system_prompt?.version||0,text:projectPrompt(p),at:p.system_prompt?.updated_at||p.created_at};
  p.system_prompt={version:previous.version+1,text:text.trim(),updated_at:now(),history:[...(p.system_prompt?.history||[]),previous]};
  invalidateProtocol(p,'项目系统提示词已修改，请对话校准规范');saveProject(p);
  const folder=path.join(directory(pid),'prompts');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,`v${p.system_prompt.version}.md`),p.system_prompt.text);return p;
}
export function harnessView(pid){
  const p=getProject(pid),own=memories(pid),v=latestProtocol(p);
  const skillItems=own.map(m=>({...m,scope:'project',kind:'skill',markdown:skillMarkdown(m),file:`skills/${m.id}/v${m.version}/SKILL.md`,origin:'conversation'}));
  if(v)skillItems.unshift({id:'project-protocol',title:'项目提取规范',version:v.version,status:!protocolCurrent(p)?'outdated':p.workflow.active_version===v.version?'active':'draft',origin:'protocol',scope:'project',content:v.summary,markdown:protocolMarkdown(v),file:`protocols/v${v.version}/SKILL.md`,source:{run_id:v.run_id},revisions:p.workflow.protocols.map(x=>({version:x.version,content:x.summary,markdown:protocolMarkdown(x),created_at:x.created_at})),questions:v.questions});
  const used=own.filter(m=>m.status==='active'),mode='correction',scopeFiles=new Set(p.files.filter(f=>['document','reference'].includes(f.role)).map(f=>f.id));
  const feedbackContext={persistent_session:!!p.pi_session_file,conversation_messages:p.messages.length,skill_states:own.map(m=>({id:m.id,title:m.title,status:m.status,version:m.version})),protocol:v,workflow:p.workflow?{mode:p.workflow.mode,stage:p.workflow.stage}:null};
  const preview=composeSystem({start:p,mode,scopeFiles,protocol:v,feedbackContext,used});
  const last=p.runs.findLast(r=>r.system_prompt_hash),file=last&&path.join(directory(pid),'runs',last.id,'system-prompt.txt');
  return {project_id:pid,isolation:'project',prompt:{text:projectPrompt(p),version:p.system_prompt?.version||0,history:p.system_prompt?.history||[],preview,preview_mode:'项目复核',last_run:last?{id:last.id,hash:last.system_prompt_hash,version:last.system_prompt_version,text:fs.existsSync(file)?fs.readFileSync(file,'utf8'):null}:null},skills:skillItems,baseline:{title:'有证据的科研信息提取',markdown:baseline},learning:p.runs.filter(r=>r.learning_note||r.learned_skills?.length).map(r=>({run_id:r.id,at:r.started_at,note:r.learning_note,skills:r.learned_skills||[]}))};
}
export function recordPrompt(pid,runId,text){
  const p=getProject(pid),run=p.runs.find(r=>r.id===runId),folder=path.join(directory(pid),'runs',runId);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'system-prompt.txt'),text);run.system_prompt_hash=crypto.createHash('sha256').update(text).digest('hex');run.system_prompt_version=p.system_prompt?.version||0;saveProject(p);
}
// Legacy files remain archived. Only project-owned skills are returned or loaded.
export function migrateProjectHarness(){
  const all=memories();const owners=new Map(all.map(m=>[m.id,m.project_id]));
  for(const p of listProjects()){
    if(p.harness_isolation_version===1)continue;
    const contaminated=p.runs.some(r=>(r.applied_memories||[]).some(m=>owners.get(m.id)!==p.id));
    if(contaminated){p.archived_pi_sessions=[...(p.archived_pi_sessions||[]),p.pi_session_file].filter(Boolean);delete p.pi_session_file;p.context_isolation_reset=true;}
    p.harness_isolation_version=1;saveProject(p);
    for(const v of p.workflow?.protocols||[])writeProtocolArtifact(p,v);
    for(const m of all.filter(m=>m.project_id===p.id)){m.legacy_scope=m.scope;m.scope='project';m.kind='skill';writeSkill(m);saveMemory(m);}
  }
}
