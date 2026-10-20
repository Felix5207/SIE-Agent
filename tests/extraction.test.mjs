import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.SIE_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'sie-extract-'));
const {normalizeColumn,updateColumn,extractionCSV}=await import('../server/extraction.mjs');
const {validateCell,db,python}=await import('../server/core.mjs');
const column=normalizeColumn({name:'Participants',instructions:'Count participants.',type:'number'});
const project=()=>({fields:[column],blocks:[{id:'b1',text:'12 participants, randomized trial'}],records:[{id:'r1',label:'Study A',cells:{Participants:{value:12,status:'reported',evidence_ids:['b1'],review:'accepted'}}}],history:[]});
test('adding a column preserves reviewed values and creates pending cells',()=>{const p=project();updateColumn(p,{name:'Design',instructions:'Extract design.',type:'text'});assert.equal(p.records[0].cells.Participants.value,12);assert.equal(p.records[0].cells.Participants.review,'accepted');assert.equal(p.records[0].cells.Design.needs_extraction,true);});
test('editing a definition invalidates only that column and archives the old answer',()=>{const p=project();updateColumn(p,{...column,name:'Final participants',instructions:'Count participants at study end.'},column.id);assert.equal(p.fields[0].id,column.id);assert.equal(p.fields[0].version,2);assert.equal(p.records[0].cells.Participants,undefined);assert.equal(p.records[0].cells['Final participants'].value,null);assert.equal(p.history[0].before.value,12);assert.equal(p.history[0].before.review,'accepted');});
test('invalid and duplicate columns cannot partially mutate answers',()=>{const p=project();assert.throws(()=>updateColumn(p,{...column}),/已存在/);assert.throws(()=>updateColumn(p,{name:'Bad',instructions:'Choose',type:'select',options:['A']}),/2–30/);assert.equal(p.history.length,0);assert.equal(p.records[0].cells.Participants.value,12);});
test('column preferences no longer block a model answer on save',()=>{const p=project(),answer={value:'12',status:'reported',evidence_ids:['b1']};assert.equal(validateCell(p,'Participants',answer).value,'12');p.fields=[normalizeColumn({name:'Design',instructions:'Classify',type:'select',options:['RCT','Cohort']})];assert.equal(validateCell(p,'Design',{...answer,value:'Other'}).value,'Other');assert.equal(validateCell(p,'Design',{...answer,value:null}).status,'not_found');});

test('a newly extracted answer clears the pending flag',()=>{const p=project();const cell=validateCell(p,'Participants',{value:12,status:'reported',evidence_ids:['b1'],needs_extraction:true});assert.equal(cell.needs_extraction,undefined);});
test('saving preserves notes without automatically assigning review status',()=>{const p=project(),note='原文分组说明不一致，需复核。';const cell=validateCell(p,'Participants',{value:12,status:'reported',evidence_ids:['b1'],note});assert.equal(cell.status,'reported');assert.equal(cell.note,note);});

test('explicit model conflict status remains visible',()=>{const cell=validateCell(project(),'Participants',{value:12,status:'conflict',evidence_ids:['b1'],note:'存在源文内部冲突'});assert.equal(cell.status,'conflict');});

test('CSV preserves multiline quotes and prevents spreadsheet formula injection',()=>{const p=project();p.records[0].label='=HYPERLINK("bad")';p.records[0].cells.Participants.value='line 1\n"line 2"';const csv=extractionCSV(p);assert.ok(csv.startsWith('\ufeff'));assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));assert.ok(csv.includes('"line 1\n""line 2"""'));});
test('Excel export accepts column-add and column-remove history and includes paper labels',async()=>{const p={...project(),id:'p_test',name:'Export test',experience:'extract'};updateColumn(p,{name:'Design',instructions:'Extract design.',type:'text'});p.history.push({field:'Deleted',before:{value:'x'},after:null});const output=path.join(process.env.SIE_DATA_DIR,'export.xlsx');await python({op:'export',project:p,output,base_url:'http://127.0.0.1:3211'});assert.ok(fs.statSync(output).size>1000);});
test.after(()=>{db.close();fs.rmSync(process.env.SIE_DATA_DIR,{recursive:true,force:true});});
