import test from 'node:test';
import assert from 'node:assert/strict';
import {validateClaims,validateQuotes,focusedEvidence} from '../shared/evidence.mjs';
import {selectedExport} from '../server/export-selection.mjs';
const blocks=[{id:'a',file_id:'f1',kind:'text',type:'text',section:'Results',text:'We examined soil. The concentration was 12.5 mg/kg. Another measurement was 30 mg/kg. The remaining observations were recorded separately.'},{id:'b',file_id:'f2',kind:'text',type:'text',text:'Unrelated paper.'}];
test('precise literal source quotes cannot be fabricated or borrowed from another evidence ID',()=>{
 assert.deepEqual(validateQuotes([{evidence_id:'a',text:'The concentration was 12.5 mg/kg.'}],['a'],blocks),[{evidence_id:'a',text:'The concentration was 12.5 mg/kg.'}]);
 assert.throws(()=>validateQuotes([{evidence_id:'a',text:'The concentration was 99 mg/kg.'}],['a'],blocks));
 assert.throws(()=>validateQuotes([{evidence_id:'b',text:'Unrelated paper.'}],['a'],blocks));
 const c=validateClaims('浓度12.5',[{text:'浓度12.5',evidence_ids:['a'],source_quotes:[{evidence_id:'a',text:'The concentration was 12.5 mg/kg.'}]}],['a'],blocks);assert.equal(c[0].source_quotes.length,1);
});
test('reader shows only the cited paragraph and highlights its exact supporting sentence',()=>{
 const f=focusedEvidence(blocks,blocks[0],{value:'浓度12.5',source_quotes:[{evidence_id:'a',text:'The concentration was 12.5 mg/kg.'}]});
 assert.equal(f.blocks.length,1);assert.equal(f.blocks[0].id,'a');assert.deepEqual(f.highlights,['The concentration was 12.5 mg/kg.']);
 const old=focusedEvidence(blocks,blocks[0],{value:12.5});assert.deepEqual(old.highlights,f.highlights);
 assert.equal(focusedEvidence(blocks,blocks[0],{value:'无法定位'}).highlights.length,0);
});
test('per-claim reader selection never highlights the neighboring claim or another paper',()=>{
 const f=focusedEvidence(blocks,blocks[0],{value:'12.5;30',claims:[{text:'12.5',source_quotes:[{evidence_id:'a',text:'The concentration was 12.5 mg/kg.'}]},{text:'30',source_quotes:[{evidence_id:'a',text:'Another measurement was 30 mg/kg.'}]}]},1);
 assert.deepEqual(f.highlights,['Another measurement was 30 mg/kg.']);assert.equal(f.blocks.length,1);
});
function fixture(){return {experience:'extract',records:[{id:'r1',label:'A',source_file_ids:['f1'],cells:{value:{value:'12.5',evidence_ids:['a']}}},{id:'r2',label:'B',source_file_ids:['f2'],cells:{value:{value:'secret',evidence_ids:['b']}}}],fields:[{name:'value'}],blocks,files:[{id:'f1'},{id:'f2'}],history:[{record_id:'r1'},{record_id:'r2'}],runs:[{id:'run'}]};}
test('selected export rejects absent, empty and forged selection and excludes unselected records and history',()=>{
 const p=fixture();assert.throws(()=>selectedExport(p,undefined));assert.throws(()=>selectedExport(p,'[]'));assert.throws(()=>selectedExport(p,'["missing"]'));
 const out=selectedExport(p,'["r1"]');assert.equal(out.records.length,1);assert.equal(out.history.length,1);assert.deepEqual(out.files,[{id:'f1'}]);assert.ok(!JSON.stringify(out).includes('secret'));assert.equal(p.records.length,2);
});
test('more than 80 independently cited results are preserved without truncation',()=>{const claims=Array.from({length:120},(_,i)=>({text:`Site ${i}: ${i+100} mg/kg`,evidence_ids:['a']}));const value=claims.map(c=>c.text).join('\n');assert.equal(validateClaims(value,claims,['a']).length,120);});

const {assembleClaimBatch}=await import('../server/claim-batches.mjs');
test('incremental answers preserve every batch and reject repeats and numeric-only columns',()=>{const p=fixture();p.fields[0].type='text';const a={record_id:'r1',field:'value',mode:'replace',items:[{text:'Site A: 12.5 mg/kg',evidence_ids:['a']}],status:'reported',note:'原文'};p.records[0].cells.value=assembleClaimBatch(p,a);const b=assembleClaimBatch(p,{...a,mode:'append',items:[{text:'Site B: 30 mg/kg',evidence_ids:['a']}]});assert.equal(b.claims.length,2);assert.equal(b.value,'Site A: 12.5 mg/kg\nSite B: 30 mg/kg');assert.throws(()=>assembleClaimBatch(p,{...a,mode:'append'}),/重复/);p.fields[0].type='number';assert.throws(()=>assembleClaimBatch(p,a),/不限/);});

const {flagStatisticalConflict}=await import('../server/completeness.mjs');
test('scientific source inconsistencies are surfaced without silently swapping published values',()=>{const p=fixture();p.blocks.push({id:'t',type:'table',text:'<table><tr><td>SD</td><td>54.1</td></tr><tr><td>SE</td><td>104.1</td></tr></table>'});const c={value:'SD 54.1, SE 104.1',status:'reported',note:'原表',evidence_ids:['t']};flagStatisticalConflict(p,c);assert.equal(c.status,'needs_review');assert.equal(c.value,'SD 54.1, SE 104.1');assert.match(c.note,/未擅自交换/);});

test('incremental extraction rejects evidence from an unselected paper in the same project',()=>{const p=fixture();p.fields[0].type='text';assert.throws(()=>assembleClaimBatch(p,{record_id:'r1',field:'value',mode:'replace',items:[{text:'Other paper',evidence_ids:['b']}]}),/不属于该论文/);});

const {ungroundedClaimNumbers}=await import('../shared/evidence.mjs');
test('sentence-final years and decimals remain grounded without accepting decimal fragments or uncited values',()=>{
 const sources=[{id:'abstract',type:'text',text:'Samples were collected between 2020 and 2024. RPIQ reached 2.24.'},{id:'methods',type:'text',text:'Sampling depth was 0–20 cm.'}];
 const check=(text,ids=['abstract'])=>ungroundedClaimNumbers([{text,evidence_ids:ids}],sources);
 assert.deepEqual(check('2020–2024 年；RPIQ 2.24。'),[]);
 assert.deepEqual(check('2024. RPIQ 2.24.'),[]);
 assert.deepEqual(check('2025. RPIQ 2.25.')[0].numbers,[2025,2.25]);
 assert.deepEqual(check('RPIQ 2 或 24')[0].numbers,[2,24]);
 assert.deepEqual(check('2020–2024 年，0–20 cm')[0].numbers,[0,20]);
 assert.deepEqual(check('2020–2024 年，0–20 cm',['abstract','methods']),[]);
});
test('textual multi-result answers detect digit hallucinations even when the source quote is correct',()=>{const b=[{id:'x',type:'text',text:'Winter ranged from 338 ± 20.29 to 5624 ± 59.16 particles per kg.'}];const gaps=ungroundedClaimNumbers([{text:'冬季338 ± 20.29–5624 ± 56.16 particles/kg',evidence_ids:['x']}],b);assert.deepEqual(gaps[0].numbers,[56.16]);assert.equal(ungroundedClaimNumbers([{text:'冬季338 ± 20.29–5624 ± 59.16 particles/kg',evidence_ids:['x']}],b).length,0);});

test('visual evidence quotes resolve to their original figure caption or table content',()=>{const b=[{id:'orig',type:'image',text:'Fig. 2. MPs across seasons.'},{id:'v',type:'visual',source_evidence_id:'orig',text:'Internal image metadata'}];assert.equal(validateQuotes([{evidence_id:'v',text:'Fig. 2. MPs across seasons.'}],['v'],b).length,1);assert.throws(()=>validateQuotes([{evidence_id:'v',text:'Invented 500 particles'}],['v'],b));});
