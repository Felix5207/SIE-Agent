import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.SIE_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'sie-raw-coordinates-'));
const {db,validateCell}=await import('../server/core.mjs');
const {reviseCells,setReviewPlan}=await import('../server/review.mjs');
const {runtimeColumn}=await import('../server/column-contract.mjs');
const {extractionCSV}=await import('../server/extraction.mjs');
const source='以小流域(E 118°06′31″ \\~ 118°07′05″, N 35°38′09″ \\~ 35°38′31″)为研究区。';
function project(){return {fields:[{name:'经度',type:'text'},{name:'纬度',type:'number'}],blocks:[{id:'b',type:'text',text:source,file_id:'f'}],files:[{id:'f',role:'document'}],records:[{id:'r',label:'Paper',cells:{经度:{value:null,needs_extraction:true},纬度:{value:null,needs_extraction:true}}}],runs:[{id:'run'}],history:[]};}
const cell=(field,value)=>({field,value,status:'reported',evidence_ids:['b'],note:'原文研究区范围。',source_quotes:[{evidence_id:'b',text:source}]});
test('DMS ranges survive correction, legacy numeric columns and CSV without midpoint conversion',()=>{
 const p=project();setReviewPlan(p,'run',{issue:'保留原文',targets:[{record_id:'r',fields:['经度','纬度'],reason:'恢复范围'}]});
 const lon='E 118°06′31″ ~ 118°07′05″',lat='N 35°38′09″ ~ 35°38′31″';
 reviseCells(p,[{record_id:'r',...cell('经度',lon)},{record_id:'r',...cell('纬度',lat)}],'run','保留原文');
 assert.equal(p.records[0].cells.经度.value,lon);assert.equal(p.records[0].cells.纬度.value,lat);
 assert.equal(p.records[0].cells.纬度.needs_extraction,undefined);
 assert.equal(p.history[0].after.status,'reported');assert.match(extractionCSV(p),/118°06′31″ ~ 118°07′05″/);
 assert.equal(runtimeColumn(p.fields[1]).type,'text');assert.match(runtimeColumn(p.fields[1]).answer_format,/不取中点/);
});
test('saving preserves coordinate output instead of running coordinate content validation',()=>{const p=project();const c=validateCell(p,'经度',{...cell('经度',118.1133),status:'derived',note:'范围中点'});assert.equal(c.value,118.1133);assert.equal(c.status,'derived');assert.equal(validateCell(p,'经度',cell('经度','E 119°06′31″ ~ 119°07′05″')).value,'E 119°06′31″ ~ 119°07′05″');});

test('direct decimal coordinates stay decimal and visual labels can retain DMS',()=>{
 const p=project();p.blocks.push({id:'decimal',type:'text',text:'Longitude 69.07° E.'},{id:'v',type:'visual',image_hash:'hash'});
 const c=validateCell(p,'经度',{value:69.07,status:'reported',evidence_ids:['decimal'],note:''});assert.equal(c.value,69.07);assert.equal(c.status,'reported');
 assert.equal(validateCell(p,'纬度',{value:'27°31′12″N',status:'reported',evidence_ids:['v'],note:'原图标签'}).value,'27°31′12″N');
});
test.after(()=>{db.close();fs.rmSync(process.env.SIE_DATA_DIR,{recursive:true,force:true});});
