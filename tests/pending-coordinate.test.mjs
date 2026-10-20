import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pendingAnswerState} from '../shared/extraction-state.mjs';
process.env.SIE_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'sie-coordinate-pending-'));
const {db}=await import('../server/core.mjs');
const {reviseCells,setReviewPlan}=await import('../server/review.mjs');
function fixture(type='text'){
 const p={coordinate_policy:{enabled:false},fields:[{name:'经度',type}],blocks:[{id:'b',file_id:'f',text:'Map axis: 69°1.2 E to 69°9.6 E'},{id:'uk',file_id:'uk',text:'108 sites across the UK.'}],records:['a','b'].map(id=>({id,label:id,cells:{经度:{value:null,status:'needs_review',needs_extraction:true,evidence_ids:[]}}})),history:[],runs:[{id:'run'}]};
 setReviewPlan(p,'run',{issue:'处理待提取经度',targets:p.records.map(r=>({record_id:r.id,fields:['经度'],reason:'原文没有明确坐标'}))});return p;
}
const missing=id=>({record_id:id,field:'经度',value:null,status:'not_found',evidence_ids:[id==='a'?'b':'uk'],note:'未找到原文明示的研究区域经度；未从地图估算。'});
test('missing coordinates save and clear pending in text and number columns with estimation disabled',()=>{
 for(const type of ['text','number']){const p=fixture(type);assert.equal(reviseCells(p,[missing('a'),missing('b')],'run','处理缺失坐标'),2);for(const r of p.records){assert.equal(r.cells.经度.status,'not_found');assert.equal(r.cells.经度.needs_extraction,undefined);}assert.equal(p.history.length,2);assert.equal(p.history[0].before.needs_extraction,true);}
});
test('coordinate ranges and missing values save without content guards',()=>{const p=fixture(),answer={...missing('a'),value:'研究区：69°1.2 E–69°9.6 E',status:'reported'};reviseCells(p,[answer,missing('b')],'run','test');assert.equal(p.history.length,2);assert.equal(p.records[0].cells.经度.value,answer.value);assert.equal(p.records[1].cells.经度.needs_extraction,undefined);});

test('idle, stopped, interrupted and blocked values never appear as an actively waiting job',()=>{
 for(const status of ['draft','completed','cancelled','interrupted','error']){const s=pendingAnswerState({status});assert.equal(s.running,false);assert.notEqual(s.label,'等待提取');}
 assert.match(pendingAnswerState({status:'completed',runs:[{review_outcome:'needs_clarification'}]}).label,/需要处理/);
 assert.equal(pendingAnswerState({status:'extracting'}).label,'正在提取');assert.equal(pendingAnswerState({status:'queued'}).running,true);
});
test.after(()=>{db.close();fs.rmSync(process.env.SIE_DATA_DIR,{recursive:true,force:true});});
