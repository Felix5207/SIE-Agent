import test from 'node:test';
import assert from 'node:assert/strict';
import {completeSavedFiles} from '../server/extraction-completion.mjs';
import {composeSystem} from '../server/prompts.mjs';
const fixture=()=>({fields:[{name:'丰度'}],blocks:[{id:'b',file_id:'paper'},{id:'unread',file_id:'paper',type:'table',text:'unrelated table'}],records:[{id:'r',source_file_ids:['paper'],cells:{丰度:{value:'12',evidence_ids:['b']}}}],runs:[{id:'run'}]});
test('saved extraction completes without reading unrelated tables or generating an audit',()=>{
 const p=fixture();completeSavedFiles(p,'run',['paper']);assert.equal(p.runs[0].file_results[0].outcome,'study_extracted');assert.equal(p.runs[0].extraction_audits,undefined);
 completeSavedFiles(p,'run',['paper']);assert.equal(p.runs[0].file_results.length,1);
});
test('file completion accepts legacy evidence links and explicitly sourced not-found answers',()=>{
 const p=fixture();delete p.records[0].source_file_ids;completeSavedFiles(p,'run',['paper']);assert.equal(p.runs[0].file_results.length,1);
 const missing=fixture();missing.records[0].cells.丰度={value:null,status:'not_found',evidence_ids:[]};completeSavedFiles(missing,'run',['paper']);assert.equal(missing.runs[0].file_results.length,1);
});
test('unhandled papers and unfinished batches are not silently marked complete',()=>{
 const p=fixture();assert.throws(()=>completeSavedFiles(p,'run',['paper','another-paper']),/尚无保存结果/);assert.equal(p.runs[0].file_results,undefined);
 p.records[0].cells.丰度.needs_extraction=true;assert.throws(()=>completeSavedFiles(p,'run',['paper']),/未保存完/);
 delete p.records[0].cells.丰度;assert.throws(()=>completeSavedFiles(p,'run',['paper']),/未保存完/);
});
test('explicit no-data and supplement outcomes survive automatic completion',()=>{
 const p=fixture();const exception={file_id:'supplement',outcome:'no_relevant_data',reason:'没有目标指标'};p.runs[0].file_results=[exception];completeSavedFiles(p,'run',['paper','supplement']);assert.deepEqual(p.runs[0].file_results[0],exception);
});
test('extraction and continuation contracts end after saving without post-extraction auditing',()=>{
 for(const mode of ['extract','continue','correction']){
  const prompt=composeSystem({start:{fields:[{name:'丰度',instructions:'',type:'text'}],instructions:''},mode,scopeFiles:new Set(['paper']),protocol:null});
  assert.ok(!/audit_extraction|extraction_checklist/.test(prompt));assert.ok(prompt.includes('保存完成后不要另起补读'));assert.ok(prompt.includes('完成状态由系统按已保存的答案自动登记'));
 }
});
