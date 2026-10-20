import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {coordinateAxis,coordinatePolicy,reviseCoordinatePair} from '../server/estimates.mjs';
import {findPlaces,fitCoordinates,calibratePlaces} from '../server/georeference.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sie-visual-'));
process.env.SIE_DATA_DIR=dir;
const {validateCell,db,createProject,saveProject,getProject,ROOT}=await import('../server/core.mjs');
const {readVisual}=await import('../server/visuals.mjs');
const estimate=()=>({evidence_id:'visual1',run_id:'run1',method:'visual_landmarks',scope:'study_representative',scope_note:'图示区域的近似代表位置，不是站点均值',basis:'通过图中可辨认地名进行粗略定位，未做坐标配准',image_point:[500,500],latitude_range:[52,54],longitude_range:[-3,-1],uncertainty_note:'无网格，目测误差范围约1度，不是置信区间'});
const project=()=>({coordinate_policy:{enabled:true},fields:[{name:'X',description:'经度'},{name:'Y',description:'纬度'}],records:[{id:'r1',cells:{X:{value:null},Y:{value:null}}}],blocks:[{id:'visual1',type:'visual',image_hash:'hash',bbox:[100,100,900,900]}]});

test('latest explicit permission overrides old default; explicit prohibition revokes it',()=>{
  let p=coordinatePolicy({enabled:false},'正文附件未给经纬度，从图里估算');assert.equal(p.enabled,true);
  assert.equal(coordinatePolicy(p,'继续核对').enabled,true);
  assert.equal(coordinatePolicy(p,'不要从图片估算坐标').enabled,false);
  assert.equal(coordinatePolicy(null,'未报告的坐标留空，不从地图估计。').enabled,false);
  assert.equal(coordinatePolicy(null,'give approximate coordinates from the map').enabled,true);
  assert.equal(coordinatePolicy(p,'检查原文','forbid').enabled,false);
});
test('coordinate pairing handles both fields with the same evidence and does not mutate on failure',()=>{
  const p=project();const pair=reviseCoordinatePair(p,'r1',{latitude:53,longitude:-2},estimate(),'用户允许读图');
  assert.deepEqual(pair.map(x=>x.field),['Y','X']);assert.ok(pair.every(x=>x.cell.status==='estimated'));
  assert.throws(()=>reviseCoordinatePair(p,'r1',{latitude:53,longitude:200},estimate(),'bad'));
  assert.equal(p.records[0].cells.Y.value,null);
});
test('estimates require permission and actual image evidence, not just a caption',()=>{
  const p=project();p.coordinate_policy.enabled=false;
  assert.throws(()=>reviseCoordinatePair(p,'r1',{latitude:53,longitude:-2},estimate(),'test'),/允许/);
  p.coordinate_policy.enabled=true;p.blocks[0].type='text';
  assert.throws(()=>reviseCoordinatePair(p,'r1',{latitude:53,longitude:-2},estimate(),'test'),/原始图像/);
});
test('unbounded or misleadingly located coordinate estimates are rejected',()=>{
  for(const e of [{...estimate(),image_point:[950,500]},{...estimate(),latitude_range:[55,56]},{...estimate(),longitude_range:[-2,-2]},{...estimate(),basis:''}]) {
    assert.throws(()=>reviseCoordinatePair(project(),'r1',{latitude:53,longitude:-2},e,'test'));
  }
});
test('null conflict state survives validation and remains distinct from not found',()=>{
  const p=project();assert.equal(validateCell(p,'Y',{value:null,status:'needs_review',evidence_ids:[],note:'图像模糊'}).status,'needs_review');
  assert.equal(validateCell(p,'Y',{value:null,status:'estimated',evidence_ids:[],note:'bad'}).status,'not_found');
  assert.equal(coordinateAxis('latitude'),'latitude');assert.equal(coordinateAxis('SizeDefinition'),null);
});
test('coordinate numbers explicitly read from image pixels do not require OCR text to contain the number',()=>{
 const p=project();p.blocks[0].text='Original image; observe pixels';
 const c=validateCell(p,'Y',{value:27.5,status:'reported',evidence_ids:['visual1'],note:'图上明确标注的数值'});
 assert.equal(c.status,'reported');
});
test('map coordinates are calculated from controls, not invented by the model',()=>{
  const merc=l=>Math.log(Math.tan(Math.PI/4+l*Math.PI/360))*180/Math.PI;
  const anchors=[{latitude:50,longitude:-5,image_point:[0,1000]},{latitude:50,longitude:0,image_point:[1000,1000]},{latitude:55,longitude:-5,image_point:[0,0]},{latitude:55,longitude:0,image_point:[1000,0]}];
  const r=fitCoordinates(anchors,[500,500]);assert.ok(Math.abs(r.longitude+2.5)<1e-9);assert.ok(Math.abs(merc(r.latitude)-(merc(50)+merc(55))/2)<1e-9);
  assert.ok(r.latitude_range[0]<r.latitude&&r.latitude_range[1]>r.latitude);
  assert.throws(()=>fitCoordinates(anchors.slice(0,3).map((a,i)=>({...a,image_point:[i*100,i*100]})),[500,500]),/共线/);
});
test('local reference lookup distinguishes countries and rejects fabricated place IDs',()=>{
  const london=findPlaces('London','GB')[0];assert.equal(london.name,'London');assert.ok(Math.abs(london.latitude-51.5)<.1);
  assert.throws(()=>calibratePlaces([{place_id:'fake',image_point:[0,0]}],[500,500]),/地名库/);
});
test('read_visual returns real PNG pixels and stores hashed source and per-run audit',async()=>{
  const p=createProject('visual test');p.fields=[{name:'经度'}];p.files=[{id:'d_test',role:'document',path:path.join(ROOT,'examples/synthetic-study.pdf'),name:'case.pdf',ext:'.pdf',pages:11,hash:'fixture'}];p.runs=[{id:'run1'}];saveProject(p);
  const v=await readVisual(p.id,'run1',{file_id:'d_test',page_idx:3,bbox:[137,44,828,792]});
  const img=v.content.find(c=>c.type==='image');assert.equal(img.mimeType,'image/png');
  const metadata=JSON.parse(v.content.find(c=>c.type==='text').text);assert.ok(metadata.image_width>0);assert.ok(metadata.image_height>0);assert.ok(Array.isArray(metadata.grid_line_hints.vertical_lines));
  assert.equal(Buffer.from(img.data,'base64').subarray(1,4).toString(),'PNG');
  const saved=getProject(p.id);assert.equal(saved.runs[0].visual_reads[0].evidence_id,v.block.id);assert.equal(saved.blocks[0].image_hash,v.block.image_hash);
  await assert.rejects(()=>readVisual(p.id,'run1',{file_id:'missing',page_idx:0}));
  await assert.rejects(()=>readVisual(p.id,'run1',{file_id:'d_test',page_idx:90}));
});
test.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
