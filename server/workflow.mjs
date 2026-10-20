// Workflow and protocol validation is deterministic; inference stays with Pi.
export const documentFiles=p=>p.files.filter(f=>f.role==='document'&&f.status!=='unsupported');
export function createWorkflow(mode='scratch',pilotSize=3){
  if(!['scratch','examples'].includes(mode))throw new Error('请选择试提取校准或已有案例学习');
  if(!Number.isInteger(pilotSize)||pilotSize<1||pilotSize>10)throw new Error('试提取篇数须为1–10');
  return {mode,stage:'setup',pilot_size:pilotSize,pilot_file_ids:[],pilot_configured:false,protocols:[],active_version:null};
}
export function latestProtocol(p){return p.workflow?.protocols?.at(-1)||null;}
export function activeProtocol(p){return p.workflow?.protocols?.find(v=>v.version===p.workflow.active_version)||null;}
export function invalidateProtocol(p,reason){if(!p.workflow)return;p.workflow.input_revision=(p.workflow.input_revision||0)+1;p.workflow.active_version=null;p.workflow.stage='setup';p.workflow.revision_reason=reason;}
export function protocolCurrent(p){const v=latestProtocol(p);return !!v&&(v.input_revision||0)===(p.workflow.input_revision||0);}
export function defaultPilotFiles(p){
  const files=documentFiles(p),pdfs=files.filter(f=>f.ext==='.pdf');
  const size=p.workflow?.pilot_size||3;
  const main=(pdfs.length?pdfs:files).slice(0,size);
  return files.filter(f=>main.includes(f)||(pdfs.length>0&&pdfs.length<=size&&f.ext!=='.pdf')).map(f=>f.id);
}
export function workflowAction(p,action,fileIds){
  if(!p.workflow)throw new Error('此操作需要双流程项目');
  if(action==='learn'){
    if(!(p.examples||[]).length)throw new Error('请先上传包含数据行的已提取结果表');
    return {mode:'learn',file_ids:p.files.filter(f=>['example','reference'].includes(f.role)).map(f=>f.id),action};
  }
  if(!['pilot','batch'].includes(action))throw new Error('未知流程操作');
  if(p.workflow.mode==='examples'&&!protocolCurrent(p))throw new Error('案例资料已变化或尚未学习，请先从已提取案例学习规范');
  if(action==='batch'&&(!activeProtocol(p)||latestProtocol(p)?.version!==p.workflow.active_version))throw new Error('请先确认当前规范，再用于其余文献');
  const selected=fileIds!==undefined?fileIds:action==='pilot'?(p.workflow.pilot_configured?p.workflow.pilot_file_ids:defaultPilotFiles(p)):documentFiles(p).filter(f=>!f.coverage).map(f=>f.id);
  if(!Array.isArray(selected))throw new Error('请选择文件列表');
  if(!selected.length)throw new Error('请上传或选择待提取文献');
  if(selected.some(fid=>!documentFiles(p).some(f=>f.id===fid)))throw new Error('提取范围只能包含待提取正文及附件，不能包含教学结果表或示范原文');
  return {mode:p.records.length?'continue':'extract',file_ids:[...new Set(selected)],action};
}
export function saveProtocol(p,input,runId){
  if(!p.workflow)throw new Error('此项目未启用规范校准流程');
  if(!input.summary?.trim()||!Array.isArray(input.rules)||!input.rules.length)throw new Error('规范须包含摘要和规则');
  const allowed=new Set(['*',...p.fields.map(f=>f.name)]),examples=new Set((p.examples||[]).map(e=>e.id));
  const rules=input.rules.map(r=>{
    if(!allowed.has(r.field)||!r.instruction?.trim())throw new Error(`规范包含未知字段或空规则。field只能为：${[...allowed].join('、')}；跨字段约定使用 *`);
    if(!['inferred','supported','user_defined'].includes(r.basis))throw new Error('请标明规则是案例推断、原文核对还是用户约定');
    if((r.example_ids||[]).some(e=>!examples.has(e)))throw new Error('案例行引用不存在');
    if((r.evidence_ids||[]).some(eid=>!p.blocks.some(b=>b.id===eid&&p.files.find(f=>f.id===b.file_id)?.role!=='example')))throw new Error('规则原文证据必须来自正文或附件，不能把结果表当原文');
    if(r.basis==='supported'&&!r.evidence_ids?.length)throw new Error('原文核对规则须提供实际原文证据');
    if(r.basis==='supported'&&(r.example_ids||[]).some(eid=>!r.evidence_ids.some(bid=>p.examples.find(e=>e.id===eid)?.source_file_ids.includes(p.blocks.find(b=>b.id===bid)?.file_id))))throw new Error('请先用 link_example_sources 将这些示范行关联到实际 reference 原文，再将规则标为 supported；结果表不能作为原文');
    return {...r,example_ids:r.example_ids||[],evidence_ids:r.evidence_ids||[]};
  });
  const previous=latestProtocol(p);
  // A conversational correction of one rule preserves other established rules.
  const merged=[...(previous?.rules||[]).filter(r=>!rules.some(n=>n.field===r.field)),...rules];
  const protocol={version:(previous?.version||0)+1,status:'draft',input_revision:p.workflow.input_revision||0,summary:input.summary,rules:merged,questions:input.questions||[],run_id:runId,created_at:new Date().toISOString()};
  p.workflow.protocols.push(protocol);p.workflow.stage='calibration';
  return protocol;
}
export function approveProtocol(p,version){
  const v=latestProtocol(p);if(!v||v.version!==version)throw new Error('规范版本已变化，请查看最新版本再确认');
  if(!protocolCurrent(p))throw new Error('教学资料或要求已变化，请重新学习或对话更新规范后确认');
  if(v.questions.length)throw new Error('规范仍有待解决的问题，请先在对话中澄清，再确认');
  v.status='active';v.approved_at=new Date().toISOString();p.workflow.active_version=v.version;p.workflow.stage='ready';return v;
}
export function linkExamples(p,ids,fileIds,reason,manual=false){
  if(!ids.length||ids.some(eid=>!(p.examples||[]).some(e=>e.id===eid)))throw new Error('案例行不存在');
  if(!fileIds.length||fileIds.some(fid=>!p.files.some(f=>f.id===fid&&f.role==='reference')))throw new Error(`案例只能关联上传的示范正文及附件（role=reference）。请从file_ids移除结果表（role=example），不要重新上传已有原文。可用原文：${JSON.stringify(p.files.filter(f=>f.role==='reference').map(f=>({id:f.id,name:f.name})))}`);
  if(!reason?.trim())throw new Error('请说明关联依据，如 DOI、标题或用户明确说明');
  if(!manual&&p.examples.some(e=>ids.includes(e.id)&&e.link_method==='user'&&JSON.stringify([...e.source_file_ids].sort())!==JSON.stringify([...new Set(fileIds)].sort())))throw new Error('用户已经手动指定原文关联，请保留该关联；若发现冲突，说明证据并请用户调整');
  for(const e of p.examples.filter(e=>ids.includes(e.id)))Object.assign(e,{source_file_ids:[...new Set(fileIds)],link_reason:reason});
}
export function reviewQueue(p){
  const groups=new Map();
  for(const r of p.records)for(const [field,c] of Object.entries(r.cells)){
    if(c.review==='accepted')continue;
    const kind=c.status==='conflict'?'conflict':c.status==='estimated'?'estimated':c.status==='needs_review'?'uncertain':c.value===null?'missing':null;
    if(!kind)continue;
    const key=kind+'|'+field;
    if(!groups.has(key))groups.set(key,{kind,field,count:0,record_ids:[],example_note:c.note});
    const g=groups.get(key);g.count++;g.record_ids.push(r.id);
  }
  const rank={conflict:0,uncertain:1,estimated:2,missing:3};
  return [...groups.values()].sort((a,b)=>rank[a.kind]-rank[b.kind]||b.count-a.count);
}
export function protocolMarkdown(v){return `---\nname: project-extraction-protocol\ndescription: Confirmed extraction conventions for this project.\n---\n\n# 项目提取规范 v${v.version}（${v.status==='active'?'已确认':'草案，校准中'}）\n\n${v.summary}\n\n${v.rules.map(r=>`## ${r.field}\n${r.instruction}\n依据类型：${r.basis}。${r.rationale||''}`).join('\n\n')}\n\n案例数值不是新论文事实。遇到当前用户明确修订，以最新要求为准。\n`;}
