import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sie-harness-'));process.env.SIE_DATA_DIR=temp;
const {createProject,saveProject,saveMemory,memories,getProject,db}=await import('../server/core.mjs');
const {saveProjectSkill,editProjectSkill,harnessView,saveSystemPrompt,migrateProjectHarness,skillDirectory,recordPrompt}=await import('../server/harness.mjs');
const {saveProtocol,approveProtocol}=await import('../server/workflow.mjs');
test('legacy shared memories cannot cross project boundaries through lookup or composed prompts',()=>{
  const a=createProject('A'),b=createProject('B');saveMemory({id:'m_legacy',project_id:a.id,title:'A-only secret convention',content:'SENTINEL_A_ONLY',scope:'shared',kind:'skill',status:'active',version:1});
  assert.equal(memories(a.id).length,1);assert.equal(memories(b.id).length,0);assert.ok(!harnessView(b.id).prompt.preview.includes('SENTINEL_A_ONLY'));
  assert.throws(()=>editProjectSkill(b.id,'m_legacy',{status:'active'}),/不属于/);
  assert.throws(()=>saveProjectSkill(b.id,{skill_id:'m_legacy',title:'x',content:'y'}),/不属于/);
});
test('archived skill revisions are preserved but no longer enter the runtime prompt',()=>{
  const p=createProject('C');const first=saveProjectSkill(p.id,{title:'Units',content:'Preserve dry weight'},{run_id:'r1',feedback:'keep basis'});
  assert.equal(first.status,'active');assert.equal(first.scope,'project');assert.ok(fs.existsSync(path.join(skillDirectory(p.id,first.id,1),'SKILL.md')));
  const next=saveProjectSkill(p.id,{skill_id:first.id,title:'Units',content:'Preserve wet and dry basis'},{run_id:'r2'});
  assert.equal(next.version,2);assert.equal(next.revisions[0].content,first.content);assert.ok(!harnessView(p.id).prompt.preview.includes(next.content));
  assert.throws(()=>editProjectSkill(p.id,first.id,{scope:'shared'}),/隔离/);
  assert.throws(()=>editProjectSkill(p.id,first.id,{version:1,content:'stale'}),/已更新/);
  editProjectSkill(p.id,first.id,{version:2,status:'disabled'});
  assert.ok(!harnessView(p.id).prompt.preview.includes(next.content));assert.equal(harnessView(p.id).skills[0].status,'disabled');
});
test('archived custom prompt versions no longer enter the runtime prompt',()=>{
  const p=createProject('D','','group',{mode:'scratch'}),other=createProject('E');p.fields=[{name:'Mean'}];saveProtocol(p,{summary:'rule',rules:[{field:'Mean',instruction:'report',basis:'user_defined'}],questions:[]},'r');approveProtocol(p,1);saveProject(p);
  saveSystemPrompt(p.id,'PROMPT_D_ONLY: preserve original units',0);
  assert.equal(getProject(p.id).workflow.active_version,null);assert.equal(harnessView(p.id).prompt.version,1);
  assert.ok(!harnessView(p.id).prompt.preview.includes('PROMPT_D_ONLY'));assert.ok(!harnessView(other.id).prompt.preview.includes('PROMPT_D_ONLY'));
  assert.throws(()=>saveSystemPrompt(p.id,'stale overwrite',0),/已更新/);
});
test('actual prompt snapshot remains immutable when project configuration later changes',()=>{
  const p=createProject('F');p.runs.push({id:'run_snapshot',status:'completed',mode:'correction'});saveProject(p);recordPrompt(p.id,'run_snapshot','ACTUAL_PROMPT_V0');saveSystemPrompt(p.id,'CURRENT_PROMPT_V1',0);
  const view=harnessView(p.id);assert.equal(view.prompt.last_run.text,'ACTUAL_PROMPT_V0');assert.equal(view.prompt.last_run.version,0);assert.ok(!view.prompt.preview.includes('CURRENT_PROMPT_V1'));
});
test('migration keeps old statuses but isolates files and resets sessions that loaded foreign memories',()=>{
  const owner=createProject('Owner'),consumer=createProject('Consumer');saveMemory({id:'m_foreign',project_id:owner.id,scope:'shared',status:'disabled',version:1,title:'old',content:'old rule'});
  consumer.pi_session_file='/tmp/legacy-session.jsonl';consumer.runs.push({id:'r',applied_memories:[{id:'m_foreign'}]});saveProject(consumer);
  migrateProjectHarness();assert.equal(memories(owner.id)[0].status,'disabled');assert.equal(memories(owner.id)[0].scope,'project');assert.equal(memories(consumer.id).length,0);
  assert.equal(getProject(consumer.id).pi_session_file,undefined);assert.equal(getProject(consumer.id).context_isolation_reset,true);
});
test.after(()=>{db.close();fs.rmSync(temp,{recursive:true,force:true});});
