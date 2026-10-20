import test from 'node:test';
import assert from 'node:assert/strict';
import {coordinatePolicy,reviseCoordinatePair} from '../server/estimates.mjs';
import {calibrateGrid,suggestedGridTicks} from '../server/grid-calibration.mjs';
import {limitVisionContext} from '../server/vision-context.mjs';
import {coordinateVisualCandidates,assertCoordinateVisualFallback,assertSavedCoordinateVisualFallback} from '../server/coordinate-fallback.mjs';
const grid=()=>({longitude_ticks:[{position:100,value:69.02},{position:900,value:69.16}],latitude_ticks:[{position:100,value:27.52},{position:900,value:27.44}],image_point:[500,500],point_error:5});
test('batch reading bounds outgoing images without deleting source evidence or tool text',()=>{
 const messages=Array.from({length:8},(_,i)=>({role:'toolResult',toolCallId:String(i),content:[{type:'text',text:'evidence '+i},{type:'image',data:String(i),mimeType:'image/png'}]}));
 const before=structuredClone(messages),out=limitVisionContext(messages);
 assert.deepEqual(out.flatMap(m=>m.content).filter(c=>c.type==='image').map(c=>c.data),['4','5','6','7']);
 assert.deepEqual(messages,before);assert.equal(out.length,messages.length);assert.equal(out[0].content[0].text,'evidence 0');
 assert.match(out[0].content[1].text,/重新 read_visual/);
 const duplicate=limitVisionContext([...messages,messages[7]]);assert.equal(duplicate.flatMap(m=>m.content).filter(c=>c.type==='image').length,4);
});
test('workspace grid fallback applies to new and old defaults, retaining explicit prohibition',()=>{
 assert.deepEqual(coordinatePolicy(null,'').methods,['axis_interpolation']);assert.equal(coordinatePolicy({enabled:false},'').enabled,true);
 assert.equal(coordinatePolicy({enabled:false,reason:'禁止估算'},'').enabled,false);
 assert.deepEqual(coordinatePolicy(null,'允许按经纬网估读').methods,['axis_interpolation']);
 assert.equal(coordinatePolicy(null,'允许按经纬网估读。不要使用城市地名库或模型常识估计。').enabled,true);
 assert.equal(coordinatePolicy(null,'允许按经纬网估读。不要从图片估算坐标。').enabled,false);
});
test('grid calculation supports decreasing axes and western/southern coordinates, with bounded readout tolerance',()=>{
 const c=calibrateGrid(grid());assert.ok(Math.abs(c.longitude-69.09)<1e-8);assert.ok(Math.abs(c.latitude-27.48)<1e-8);
 assert.ok(c.latitude_range[0]<c.latitude&&c.latitude_range[1]>c.latitude);assert.ok(c.longitude_range[1]-c.longitude_range[0]<.01);
 const args=grid();args.longitude_ticks=[{position:100,value:-76},{position:900,value:-75}];args.latitude_ticks=[{position:100,value:-1},{position:900,value:-2}];
 const west=calibrateGrid(args);assert.equal(west.longitude,-75.5);assert.equal(west.latitude,-1.5);
});
test('grid calculation rejects ungrounded extrapolation, bad controls and inconsistent ticks',()=>{
 assert.throws(()=>calibrateGrid({...grid(),image_point:[950,500]}),/外推/);
 assert.throws(()=>calibrateGrid({...grid(),point_error:0}),/误差/);
 assert.throws(()=>calibrateGrid({...grid(),longitude_ticks:[{position:100,value:69},{position:110,value:69.1}]}),/相距/);
 assert.throws(()=>calibrateGrid({...grid(),longitude_ticks:[{position:100,value:69},{position:500,value:69.3},{position:900,value:69.4}]}),/不一致/);
});
test('OCR grid labels align with evenly spaced interior lines, excluding the map frame',()=>{
 const hints={vertical_lines:[50,100,500,900,950],horizontal_lines:[20,100,500,900,980]};
 const ticks=suggestedGridTicks("69°1.200'E 69°2.400'E 69°3.600'E 27°31.200'N 27°30.000'N 27°28.800'N",hints);
 assert.deepEqual(ticks.longitude_ticks.map(t=>t.position),[100,500,900]);assert.ok(Math.abs(ticks.longitude_ticks[0].value-69.02)<1e-8);
 assert.ok(Math.abs(ticks.latitude_ticks[0].value-27.52)<1e-8);
 assert.deepEqual(suggestedGridTicks('No labelled graticule',hints),{});
 assert.deepEqual(suggestedGridTicks("69°1.2'E 69°2.4'E 69°3.6'E",{...hints,vertical_lines:[50,100,150,900,950]}),{});
});
function fixture(){return {fields:[{name:'经度'},{name:'纬度'}],records:[{id:'r',source_file_ids:['f'],created_run_id:'run',cells:{经度:{value:null},纬度:{value:20}}}],history:[],blocks:[{id:'map',file_id:'f',type:'chart',page_idx:2,bbox:[100,100,900,900],text:'red green blue'}, {id:'caption',file_id:'f',type:'text',page_idx:2,text:'FIGURE 1 A map showing sampling sites'}, {id:'micro',file_id:'f',type:'image',page_idx:3,text:'Microscopic particles'}, {id:'other',file_id:'g',type:'image',page_idx:2,text:'Study area map'}, {id:'seen',file_id:'f',type:'visual',page_idx:2,bbox:[0,0,1000,1000],image_hash:'hash'}]};}
test('missing coordinates require real relevant-map pixels from this run, including chart-classified maps',()=>{
 const p=fixture(),cells=[{field:'经度',value:null,record_id:'r',evidence_ids:[]}];
 assert.deepEqual(coordinateVisualCandidates(p,['f']).map(b=>b.evidence_id),['map']);
 assert.throws(()=>assertCoordinateVisualFallback(p,cells),/read_visual/);
 assert.throws(()=>assertCoordinateVisualFallback(p,cells,{viewed:new Set(['map'])}),/read_visual/);
 assert.doesNotThrow(()=>assertCoordinateVisualFallback(p,cells,{viewed:new Set(['seen'])}));
 p.blocks.find(b=>b.id==='seen').bbox=[200,200,800,800];assert.throws(()=>assertCoordinateVisualFallback(p,cells,{viewed:new Set(['seen'])}),/read_visual/);
 assert.doesNotThrow(()=>assertCoordinateVisualFallback(p,[{field:'经度',value:118,record_id:'r'}]));
 assert.doesNotThrow(()=>assertCoordinateVisualFallback(p,[{field:'采样时间',value:null,record_id:'r'}]));
});
test('omitting coordinate cells cannot skip the image fallback, and unrelated old missing cells are not reread',()=>{
 const p=fixture();assert.throws(()=>assertSavedCoordinateVisualFallback(p,'run',new Set()),/read_visual/);
 assert.doesNotThrow(()=>assertSavedCoordinateVisualFallback(p,'run',new Set(['seen'])));
 assert.doesNotThrow(()=>assertSavedCoordinateVisualFallback(p,'another',new Set()));
 p.history.push({run_id:'another',record_id:'r',field:'经度'});assert.throws(()=>assertSavedCoordinateVisualFallback(p,'another',new Set()),/read_visual/);
});
test('grid estimates retain computed controls and errors, cannot silently use place-name inference',()=>{
 const c=calibrateGrid(grid());const p=fixture();p.coordinate_policy=coordinatePolicy(null,'');
 const e={calibration:c,evidence_id:'seen',run_id:'run',method:'axis_interpolation',scope:'study_representative',scope_note:'研究区代表位置，非采样点坐标',basis:'按原图经纬网内插',image_point:[500,500],latitude_range:c.latitude_range,longitude_range:c.longitude_range,uncertainty_note:c.uncertainty_note};
 const pair=reviseCoordinatePair(p,'r',{latitude:c.latitude,longitude:c.longitude},e,'图片估算');assert.equal(pair[0].cell.value,27.48);assert.equal(pair[1].cell.value,69.09);assert.ok(pair.every(x=>x.cell.status==='estimated'));
 assert.throws(()=>reviseCoordinatePair(p,'r',{latitude:27.48,longitude:69.09},{...e,calibration:null},'bad'),/calibrate_grid/);
 assert.throws(()=>reviseCoordinatePair(p,'r',{latitude:27.48,longitude:69.09},{...e,method:'visual_landmarks'},'bad'),/仅允许/);
});
