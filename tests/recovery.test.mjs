import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.SIE_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'sie-recovery-'));
const {db}=await import('../server/core.mjs');
const {recoverySpec,unfinishedCells,failureInfo,undoChange,resolveProposal,saveCorrectionCase}=await import('../server/recovery.mjs');
const {setReviewPlan,reviseCells,appendRecords}=await import('../server/review.mjs');
const {commitAgentCells}=await import('../server/cell-protection.mjs');
const cell=(value=5)=>({value,status:'reported',evidence_ids:['b'],note:'原文',review:'pending'});
function fixture(){return {id:'p',status:'completed',fields:[{name:'结果'},{name:'日期'}],files:[{id:'f',name:'paper.pdf',hash:'hash',role:'document',status:'parsed'}],blocks:[{id:'b',file_id:'f',type:'text',text:'Results 5 and 8.'}],records:[{id:'r',label:'Paper',source_file_ids:['f'],cells:{结果:cell(),日期:cell(8)}}],runs:[{id:'run',write_scope:{cells:[{record_id:'r',field:'结果'}],new_file_ids:[]}}],history:[],events:[]};}
function plan(p){setReviewPlan(p,'run',{issue:'纠错',targets:[{record_id:'r',fields:['结果','日期'],reason:'检查'}]});}
test('cell retry selects only one cell and cannot bypass scope with a broader model plan',()=>{
 const p=fixture();const spec=recoverySpec(p,{scope:'cell',record_id:'r',field:'结果'});assert.deepEqual(spec.target.file_ids,['f']);assert.deepEqual(spec.target.write_scope,p.runs[0].write_scope);plan(p);
 assert.throws(()=>reviseCells(p,[{record_id:'r',field:'日期',...cell(5)}],'run','bad'),/范围/);assert.equal(p.history.length,0);
 assert.throws(()=>appendRecords(p,[{id:'new',label:'bad',source_file_ids:['f'],cells:[]}],'run'),/范围/);
});
test('accepted answers become proposals; user can accept/reject; stale decisions cannot overwrite newer edits',()=>{
 const p=fixture();p.records[0].cells.结果.review='accepted';plan(p);const before=structuredClone(p.records[0].cells.结果);
 reviseCells(p,[{record_id:'r',field:'结果',...cell(8)}],'run','发现新证据');assert.deepEqual(p.records[0].cells.结果,before);assert.equal(p.history.length,0);assert.equal(p.proposals.length,1);
 resolveProposal(p,p.proposals[0].id,false);assert.deepEqual(p.records[0].cells.结果,before);
 reviseCells(p,[{record_id:'r',field:'结果',...cell(8)}],'run','再次提交');const proposal=p.proposals[1];p.records[0].cells.结果.note='人工更新';assert.throws(()=>resolveProposal(p,proposal.id,true),/已改变/);p.records[0].cells.结果=before;resolveProposal(p,proposal.id,true);assert.equal(p.records[0].cells.结果.value,8);assert.equal(p.records[0].cells.结果.review,'accepted');
});
test('all agent commits, including estimated values, share accepted protection and scope enforcement',()=>{
 const p=fixture();p.records[0].cells.结果.review='accepted';const estimated={...cell(8),status:'estimated',estimate:{range:[7,9]}};commitAgentCells(p,[{record_id:'r',field:'结果',cell:estimated}],'run','估读');assert.equal(p.records[0].cells.结果.value,5);assert.deepEqual(p.proposals[0].after,estimated);
 assert.throws(()=>commitAgentCells(p,[{record_id:'r',field:'日期',cell:estimated}],'run','bad'),/范围/);
});
test('resume uses unsaved scope only, preserves completed answers and includes new files',()=>{
 const p=fixture();p.runs[0].status='error';p.runs[0].write_scope.cells.push({record_id:'r',field:'日期'});p.history.push({run_id:'run',record_id:'r',field:'结果'});
 assert.deepEqual(unfinishedCells(p),[{record_id:'r',field:'日期'}]);p.files.push({id:'new',role:'document',status:'error'});
 const spec=recoverySpec(p);assert.equal(spec.mode,'continue');assert.deepEqual(spec.target.write_scope.cells,[{record_id:'r',field:'日期'}]);assert.deepEqual(spec.target.write_scope.new_file_ids,['new']);
 p.records[0].cells.日期.review='accepted';assert.deepEqual(unfinishedCells(p),[]);
});
test('undo restores complete cell evidence and adds an audit trail; stale undo is rejected',()=>{
 const p=fixture();plan(p);const original=structuredClone(p.records[0].cells.结果);reviseCells(p,[{record_id:'r',field:'结果',...cell(8)}],'run','纠正');const id=p.history[0].id;undoChange(p,id);assert.deepEqual(p.records[0].cells.结果,original);assert.equal(p.history[1].undo_of,id);assert.throws(()=>undoChange(p,id),/后续修改/);
});
test('correction cases require human approval and snapshot source evidence without becoming instructions',()=>{
 const p=fixture();assert.throws(()=>saveCorrectionCase(p,'r','结果'),/人工确认/);p.records[0].cells.结果.review='accepted';const c=saveCorrectionCase(p,'r','结果');p.records[0].cells.结果.value=8;assert.equal(c.expected.value,5);assert.equal(c.evidence[0].text,'Results 5 and 8.');assert.equal(c.files[0].hash,'hash');assert.equal(p.instructions,undefined);
});
test('failure reports distinguish parsing, model, image and citation validation with affected scope',()=>{
 const p=fixture();for(const [message,phase,kind] of [['MinerU unavailable','parsing','parsing'],['模型请求失败','extracting','model'],['图片刻度不足','extracting','image'],['引句不匹配','extracting','validation']]){const f=failureInfo(p,new Error(message),phase,p.runs[0]);assert.equal(f.kind,kind);assert.equal(f.cells[0].field,'结果');}
});
test.after(()=>{db.close();fs.rmSync(process.env.SIE_DATA_DIR,{recursive:true,force:true});});
test('offline correction evaluation detects regressions and wrong-paper evidence without changing results',async()=>{
 const {evaluateCorrectionCases}=await import('../shared/correction-evaluation.mjs');const p=fixture();p.records[0].cells.结果.review='accepted';const c=saveCorrectionCase(p,'r','结果');const original=JSON.stringify(p);
 assert.equal(evaluateCorrectionCases([c],p).matched,1);assert.equal(JSON.stringify(p),original);p.records[0].cells.结果.value=8;assert.equal(evaluateCorrectionCases([c],p).matched,0);p.files[0].hash='replaced';assert.equal(evaluateCorrectionCases([c],p).with_valid_evidence,0);
});
test('failed explicit retry of an accepted cell can resume as a proposal, never an overwrite',()=>{
 const p=fixture();p.records[0].cells.结果.review='accepted';const spec=recoverySpec(p,{scope:'cell',record_id:'r',field:'结果'});p.runs[0].write_scope=spec.target.write_scope;p.runs[0].status='error';const resumed=recoverySpec(p);assert.equal(resumed.target.write_scope.include_confirmed,true);assert.deepEqual(resumed.target.write_scope.cells,[{record_id:'r',field:'结果'}]);
});
test('correction rejects another paper citation before saving any result',()=>{
 const p=fixture();p.blocks.push({id:'other:b',file_id:'other',text:'8'});plan(p);assert.throws(()=>reviseCells(p,[{record_id:'r',field:'结果',...cell(8),evidence_ids:['other:b']}],'run','bad'),/跨论文/);assert.equal(p.history.length,0);
});
