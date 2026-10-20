import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
process.env.SIE_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'sie-general-'));
const {validateCell,fieldsFromHeaders,db,python,PYTHON}=await import('../server/core.mjs');
const {visualCandidates,selectVisualSources,assertVisualFallback,assertSavedVisualFallback}=await import('../server/visual-fallback.mjs');
const {visualEstimateCell}=await import('../server/visual-estimates.mjs');
const {composeSystem}=await import('../server/prompts.mjs');
const {coordinateAxis}=await import('../server/estimates.mjs');
function fixture(field='抗拉强度') {return {fields:[{name:field,type:'text'}],files:[{id:'f',role:'document'}],records:[{id:'r',created_run_id:'run',source_file_ids:['f'],cells:{[field]:{value:null}}}],history:[],blocks:[
  {id:'fig',file_id:'f',type:'chart',page_idx:1,bbox:[100,100,900,900],text:'Figure 1. Experimental results under different conditions.'},
  {id:'other',file_id:'f',type:'figure',page_idx:2,bbox:[100,100,900,900],text:'Figure 2. Equipment assembly.'},
  {id:'seen',file_id:'f',type:'visual',page_idx:1,bbox:[0,0,1000,1000],image_hash:'hash'},
  {id:'text',file_id:'f',type:'text',page_idx:0,text:'Control: 10 MPa.'},
]};}
const choices=[{evidence_id:'fig',relevant:true,reason:'图中比较各条件的目标指标'},{evidence_id:'other',relevant:false,reason:'仅装配示意，不包含测量结果'}];
test('missing answers trigger semantic image fallback across disciplines, not only coordinates',()=>{
  for(const field of ['抗拉强度','生存率','峰值波长','识别准确率','收入弹性']){
    const p=fixture(field),plans=new Map(),cells=[{record_id:'r',field,value:null}];
    assert.equal(visualCandidates(p,['f']).length,2);
    assert.throws(()=>assertVisualFallback(p,cells),/read_visual/);
    selectVisualSources(p,plans,{file_id:'f',field,decisions:choices});
    assert.throws(()=>assertVisualFallback(p,cells,{plans,viewed:new Set(['fig'])}),/read_visual/);
    assert.doesNotThrow(()=>assertVisualFallback(p,cells,{plans,viewed:new Set(['seen'])}));
    p.blocks.find(b=>b.id==='seen').bbox=[200,200,800,800];
    assert.throws(()=>assertVisualFallback(p,cells,{plans,viewed:new Set(['seen'])}),/read_visual/);
    assert.doesNotThrow(()=>assertVisualFallback(p,[{...cells[0],value:'已有准确结果'}]));
  }
});
test('image decisions cannot silently omit candidates or exclude captionless figures',()=>{
  const p=fixture(),plans=new Map(),args={file_id:'f',field:'抗拉强度',decisions:choices};
  assert.throws(()=>selectVisualSources(p,plans,{...args,decisions:choices.slice(0,1)}),/每张/);
  assert.throws(()=>selectVisualSources(p,plans,{...args,decisions:choices.map(d=>({...d,evidence_id:'foreign'}))}),/每张/);
  p.blocks.find(b=>b.id==='other').text='';assert.throws(()=>selectVisualSources(p,plans,args),/无图注/);
});
test('finish enforces omitted fields for new rows without rereading unrelated existing results',()=>{
  const p=fixture();assert.throws(()=>assertSavedVisualFallback(p,'run',new Set(),new Map()),/read_visual/);
  assert.doesNotThrow(()=>assertSavedVisualFallback(p,'other-run',new Set(),new Map()));
  p.history.push({record_id:'r',field:'抗拉强度',run_id:'other-run'});
  assert.throws(()=>assertSavedVisualFallback(p,'other-run',new Set(),new Map()),/read_visual/);
});
const item=()=>({label:'处理组',value:42,range:[40,44],unit:'MPa',evidence_id:'seen',basis:'线性轴20至60 MPa，柱高略高于40刻度',uncertainty_note:'按图像分辨率估计±2 MPa，仅为读图误差，非统计区间'});
test('generic image estimates validate, preserve group provenance, and append without losing reported text',()=>{
  const p=fixture();const previous=validateCell(p,'抗拉强度',{value:'Control: 10 MPa.',status:'reported',evidence_ids:['text'],source_quotes:[{evidence_id:'text',text:'Control: 10 MPa.'}]});
  const c=validateCell(p,'抗拉强度',visualEstimateCell(p,'抗拉强度',[item()],'run',previous,'append'));
  assert.equal(c.status,'estimated');assert.match(c.value,/Control: 10 MPa/);assert.match(c.value,/图片估算/);
  assert.deepEqual(c.evidence_ids,['text','seen']);assert.equal(c.claims[0].source_quotes[0].text,'Control: 10 MPa.');
  assert.deepEqual(c.estimate.items[0].range,[40,44]);
  const next=validateCell(p,'抗拉强度',visualEstimateCell(p,'抗拉强度',[{...item(),label:'处理组2',value:52,range:[50,54]}],'run',c,'append'));
  assert.equal(next.estimate.items.length,2);assert.equal(next.claims.length,3);
});
test('generic estimates reject unsupported numbers, fake image evidence and bad ranges',()=>{
  const p=fixture();p.fields[0].type='number';
  const c=validateCell(p,'抗拉强度',visualEstimateCell(p,'抗拉强度',[item()],'run'));assert.equal(c.value,42);
  for(const bad of [{range:[43,45]},{range:[42,42]},{range:[NaN,44]},{evidence_id:'text'},{unit:''},{basis:''},{uncertainty_note:''}])assert.throws(()=>visualEstimateCell(p,'抗拉强度',[{...item(),...bad}],'run'));
  assert.throws(()=>visualEstimateCell(p,'抗拉强度',[item(),item()],'run'),/一个读数/);
  assert.throws(()=>visualEstimateCell(p,'抗拉强度',[item()],'run',c,'append'),/不能追加/);
});
test('name-only extraction ignores legacy task rules and headers no longer inject an environmental-science template',()=>{
  const p={fields:[{name:'强度',instructions:''}],granularity:'paper',instructions:'legacy-scope-ONLY-soil',coordinate_policy:{}};
  const prompt=composeSystem({start:p,mode:'extract',scopeFiles:new Set(['f']),protocol:{rules:['legacy-protocol']}});
  assert.ok(!prompt.includes('legacy-scope'));assert.ok(!prompt.includes('legacy-protocol'));assert.ok(!prompt.includes('微塑料'));
  assert.ok(!prompt.includes('calibrate_grid'));assert.match(prompt,/所有学科和所有提取列/);
  assert.match(prompt,/save_visual_estimate/);
  for(const f of fieldsFromHeaders(['unit','Depth','SizeDefinition','MPs(MEAN)'])){assert.equal(f.instructions,'');assert.doesNotMatch(f.description,/微塑料|土层/);}
});
test('arbitrary X/Y variables do not acquire geographical constraints',()=>{
  const p=fixture('X');p.fields[0].type='number';
  assert.equal(coordinateAxis('X',p.fields),null);
  const c=validateCell(p,'X',visualEstimateCell(p,'X',[{...item(),value:420,range:[400,440]}],'run'));
  assert.equal(c.value,420);assert.equal(c.status,'estimated');
  assert.equal(coordinateAxis('X',[{name:'X',description:'经度（十进制度）'}]),'longitude');
  assert.equal(coordinateAxis('Y',[{name:'Y',instructions:'应力'}]),null);
});
test('Excel exports generic estimates with each group range and source, without requiring geographic metadata',async()=>{
  const p=fixture();p.id='p_export';p.name='跨学科图片估算';p.experience='extract';p.fields[0].id='col';p.records[0].label='Paper';
  p.records[0].cells['抗拉强度']=validateCell(p,'抗拉强度',visualEstimateCell(p,'抗拉强度',[item()],'run'));
  const output=path.join(process.env.SIE_DATA_DIR,'generic.xlsx');
  await python({op:'export',project:p,output,base_url:'http://localhost'});
  execFileSync(PYTHON,['-c',"from openpyxl import load_workbook; import sys; w=load_workbook(sys.argv[1]); s=w['图像数值估读']; assert s.cell(2,4).value==42; assert s.cell(2,6).value==40; assert s.cell(2,7).value==44; assert s.cell(2,10).value=='seen'; assert '图片估算' in w.worksheets[0].cell(2,2).comment.text",output]);
});
test.after(()=>{db.close();fs.rmSync(process.env.SIE_DATA_DIR,{recursive:true,force:true});});
