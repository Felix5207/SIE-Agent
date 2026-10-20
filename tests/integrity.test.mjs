import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sie-integrity-'));
process.env.SIE_DATA_DIR=temp;
const {validateCell,applyRecords,python,db,fieldsFromHeaders}=await import('../server/core.mjs');
const p=()=>({fields:fieldsFromHeaders(['MPs(MEAN)','MPs(SD)','PointID']),blocks:[{id:'b1',text:'Mean 2610; SD 54.1. Samples collected between September 2020 and May 2022.'}],records:[],history:[]});
const reported=(value,evidence_ids=['b1'])=>({value,evidence_ids,status:'reported',note:''});

test('unknown links are omitted without blocking the answer',()=>{const c=validateCell(p(),'MPs(MEAN)',reported(2610,['invented','b1']));assert.equal(c.value,2610);assert.deepEqual(c.evidence_ids,['b1']);});

test('answers without evidence save as submitted',()=>{const c=validateCell(p(),'MPs(MEAN)',reported(2610,[]));assert.equal(c.value,2610);assert.deepEqual(c.evidence_ids,[]);});

test('missing values stay null, not numeric zero',()=>{const c=validateCell(p(),'MPs(MEAN)',{...reported(null,[]),status:'not_found'});assert.equal(c.value,null);assert.equal(c.status,'not_found');});
test('numeric mismatch no longer changes result status',()=>{const c=validateCell(p(),'MPs(MEAN)',reported(999));assert.equal(c.value,999);assert.equal(c.status,'reported');assert.equal(c.note,'');});

test('sentence punctuation is not mistaken for a decimal suffix',()=>assert.equal(validateCell(p(),'EndYear',reported(2022)).status,'reported'));
test('saving does not convert month values or infer their status',()=>{const c=validateCell(p(),'StartMonth',reported(9));assert.equal(c.value,9);assert.equal(c.status,'reported');assert.deepEqual(c.evidence_ids,['b1']);assert.equal(c.note,'');});

test('saving no longer judges inferred dates',()=>{const project=p();project.blocks[0].text='Sampling was performed in fall 2023.';const c=validateCell(project,'StartMonth',{...reported(9),status:'derived',note:'fall starts in September'});assert.equal(c.value,9);assert.equal(c.note,'fall starts in September');});

test('one missing evidence link no longer blocks other answers in a batch',()=>{const project=p();applyRecords(project,[{id:'a',label:'A',cells:[{field:'MPs(MEAN)',...reported(2610)}]},{id:'b',label:'B',cells:[{field:'MPs(MEAN)',...reported(2610,['missing'])}]}]);assert.equal(project.records.length,2);assert.deepEqual(project.records[0].cells['MPs(MEAN)'].evidence_ids,['b1']);assert.deepEqual(project.records[1].cells['MPs(MEAN)'].evidence_ids,[]);});

test('model supplied provenance status is preserved',()=>{const c=validateCell(p(),'MPs(SD)',{value:12,status:'generated',evidence_ids:[],note:'model supplied'});assert.equal(c.status,'generated');assert.equal(c.value,12);});

test('malformed values remain rejected as a request format error',()=>{for(const value of [{x:1},[1,2],NaN,Infinity,undefined])assert.throws(()=>validateCell(p(),'Width',reported(value)),/value/);});

test('Excel attachment preserves all 17 original headers',async()=>{const r=await python({op:'template',path:path.resolve('examples/extraction-template.xlsx')});assert.equal(r.headers.length,17);assert.deepEqual(r.headers.slice(0,7),['ArticleID','LabelID','PointID','ArticleName','Y','X','MPs(MEAN)']);});
test('long source paragraphs retain their complete text and anchors',async()=>{const source='原始证据'.repeat(7000)+'FINAL_SENTINEL';const file=path.join(temp,'long.txt');fs.writeFileSync(file,source);const r=await python({op:'plain',path:file});assert.equal(r.blocks.map(b=>b.text).join(''),source);assert.ok(r.blocks.length>1);assert.equal(new Set(r.blocks.map(b=>b.anchor)).size,r.blocks.length);});
test.after(()=>{db.close();fs.rmSync(temp,{recursive:true,force:true});});
