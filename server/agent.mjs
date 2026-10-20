import {prepareArguments,toolOperation} from './tool-arguments.mjs';
import {assertWriteScope,commitAgentCells} from './cell-protection.mjs';
import {failureInfo} from './recovery.mjs';
import {saveRetryGuard} from './save-retries.mjs';
import {limitVisionContext} from './vision-context.mjs';
import {runtimeColumn} from './column-contract.mjs';
import {assembleClaimBatch} from './claim-batches.mjs';
import {completeSavedFiles} from './extraction-completion.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {loadPi,modelClient} from './model-client.mjs';
import {selectedConnections,connectionSnapshot,redactError,redactSecrets} from './connections.mjs';
import { ROOT,DATA,getProject,saveProject,change,emit,id,now,directory,normalize,applyRecords,validateCell,memories,saveMemory,fieldsFromHeaders,pendingFiles } from './core.mjs';
import { parseProject } from './documents.mjs';
import { setReviewPlan, assertPlanned, reviseCells, appendRecords, runChanges } from './review.mjs';
import {latestProtocol,activeProtocol,saveProtocol,linkExamples,protocolMarkdown} from './workflow.mjs';
import {composeSystem} from './prompts.mjs';
import {writeProtocolArtifact,recordPrompt} from './harness.mjs';
import { readVisual,visualGridHints } from './visuals.mjs';
import { coordinateAxis, coordinatePolicy, reviseCoordinatePair } from './estimates.mjs';
import {visualCandidates,selectVisualSources} from './visual-fallback.mjs';
import {visualEstimateCell} from './visual-estimates.mjs';
import {calibrateGrid,gridBasis} from './grid-calibration.mjs';
import { findPlaces, calibratePlaces, calibrationBasis } from './georeference.mjs';

const {createAgentSession,SessionManager,SettingsManager,DefaultResourceLoader}=await loadPi();
const agentDir=path.join(DATA,'pi');fs.mkdirSync(agentDir,{recursive:true});
export const jobs=new Map();
let chain=Promise.resolve();
const activeStatuses=['queued','parsing','extracting','correcting'];
export const isBusy=p=>activeStatuses.includes(p.status);

function object(properties,required=Object.keys(properties)){return {type:'object',properties,required,additionalProperties:false};}
const string={type:'string'}, strings={type:'array',items:string};
const result=value=>({content:[{type:'text',text:JSON.stringify(value)}],details:{}});


async function sessionFor(pid, runId, signal, mode, target, connections) {
  const start=getProject(pid);const used=[];
  change(pid,p=>{p.applied_memories=used.map(m=>({id:m.id,version:m.version,scope:m.scope,title:m.title}));p.runs.find(r=>r.id===runId).applied_memories=structuredClone(p.applied_memories);});
  const {runtime,model,provider}=await modelClient(connections.model,signal);
  const settings=SettingsManager.inMemory({defaultProvider:provider,defaultModel:model.id,defaultThinkingLevel:'off',compaction:{enabled:true,reserveTokens:Math.min(12000,Math.floor(connections.model.context_window/4))},retry:{enabled:true,maxRetries:1}});
  const scopeFiles=new Set(target?.file_ids||start.files.filter(f=>mode==='learn'?['example','reference'].includes(f.role):f.role==='document'||(mode==='correction'&&f.role==='reference')).map(f=>f.id));
  const protocol=mode==='learn'?latestProtocol(start):null;
  const feedbackContext={conversation_messages:start.messages.length,protocol};
  const system=composeSystem({start,mode,scopeFiles,protocol,feedbackContext,used})+(connections.model.vision?'':'\n当前选择的是纯文本模型，不能读取图片像素。可提取解析正文和表格；仅图中存在的信息须说明模型不支持图片，不得声称已看图或猜测图中内容。');recordPrompt(pid,runId,system);
  const loader=new DefaultResourceLoader({cwd:ROOT,agentDir,settingsManager:settings,noExtensions:true,noContextFiles:true,noPromptTemplates:true,noThemes:true,noSkills:true,skillsOverride:()=>({skills:[],diagnostics:[]}),systemPromptOverride:()=>system});await loader.reload();
  let finished=false, revised=false, toolsCalled=0;
  const isReview=mode!=='extract';
  const pendingAtStart=pendingFiles(start).filter(f=>scopeFiles.has(f.id)).map(f=>f.id);
  function checkCells(cells){
    const p=getProject(pid);
    for(const c of cells){
      if(c.record_id)assertWriteScope(p,runId,c.record_id,c.field);
      const evidence=[...(c.evidence_ids||[]),...(c.source_quotes||[]).map(q=>q.evidence_id),...(c.claims||[]).flatMap(x=>[...(x.evidence_ids||[]),...(x.source_quotes||[]).map(q=>q.evidence_id)])];
      for(const eid of evidence){const b=p.blocks.find(b=>b.id===eid);if(b&&(!scopeFiles.has(b.file_id)||p.files.find(f=>f.id===b.file_id)?.role!=='document'))throw new Error('引用来源不在本轮目标文献范围');}
    }
  }

  const viewed=new Set(),calibrations=new Map(),visualPlans=new Map();
  const quoteSchema={type:'array',items:object({evidence_id:string,text:string})};
  const claimsSchema={type:'array',items:object({text:string,evidence_ids:strings,source_quotes:quoteSchema},['text','evidence_ids'])};
  const cellSchema=object({field:{type:'string'},value:{anyOf:[string,{type:'number'},{type:'null'}]},status:{type:'string',enum:['reported','derived','generated','not_found','conflict','needs_review']},evidence_ids:strings,note:string,claims:claimsSchema,source_quotes:quoteSchema},['field','value','status','evidence_ids','note']);
  const tools=[];
  function tool(name,description,parameters,execute,raw=false){tools.push({name,label:name,description,parameters,prepareArguments:args=>prepareArguments(args,parameters),execute:async(_id,args)=>{signal.throwIfAborted();if(++toolsCalled>300)throw new Error('工具调用次数达到上限，请汇总已完成工作');if(mode==='learn'&&['save_visual_estimate','save_coordinate_estimate','revise_cells','add_records','add_paper','record_file_coverage','save_project_skill'].includes(name))throw new Error('当前为案例学习，仅可学习规范，不可写入新文献结果');const value=await execute(args);return raw?value:result(value);}});}
  tool('list_documents','查看所有文件、页数、章节标题和表格位置；首先调用此工具。',object({}),()=>{
    const p=getProject(pid);return {files:p.files.filter(f=>scopeFiles.has(f.id)).map(f=>({id:f.id,name:f.name,role:f.role,status:f.status,pages:f.pages,pending:pendingAtStart.includes(f.id)})),visual_candidates:visualCandidates(p,[...scopeFiles]),outline:p.blocks.filter(b=>scopeFiles.has(b.file_id)).filter(b=>['table','title','image','figure','chart','visual'].includes(b.type)||/^\d[\d.\s|]+[A-Z]/.test(b.text)||b.text.length<150).map(b=>({id:b.id,file_id:b.file_id,page_idx:b.page_idx,type:b.type,text:b.text.slice(0,300)})).slice(0,160),...(p.fields.some(f=>coordinateAxis(f.name,p.fields))?{coordinate_policy:{enabled:p.coordinate_policy?.enabled,methods:p.coordinate_policy?.methods}}:{}),granularity:p.granularity,fields:p.fields.map(runtimeColumn),parsing_warnings:p.warnings};
  });
  tool('select_visual_sources','按列含义和论文语义自主判断图像相关性，无需用户配置。对该论文所有 visual_candidates 填 relevant 和具体原因；图注不清须读图。选择结果仅用于本轮，不生成任务规则。',object({file_id:string,field:string,decisions:{type:'array',items:object({evidence_id:string,relevant:{type:'boolean'},reason:string})}}),args=>{
    if(!scopeFiles.has(args.file_id))throw new Error('图片来源不在本轮文献范围');
    const p=getProject(pid),selected=selectVisualSources(p,visualPlans,args);
    const run=p.runs.find(r=>r.id===runId);run.visual_selections||=[];run.visual_selections.push({...args,at:now()});saveProject(p);return selected;
  });
  tool('read_visual','实际读取原始 PDF 页或图片并返回图像像素。优先指定图表 evidence_id；也可指定 file_id、零基 page_idx 和可选原页 bbox。只有调用后才可声称看过图。',object({evidence_id:string,file_id:string,page_idx:{type:'integer',minimum:0},bbox:{type:'array',items:{type:'number',minimum:0,maximum:1000},minItems:4,maxItems:4}},[]),async args=>{
    if(!connections.model.vision)throw new Error('当前模型未启用图片输入。请说明该限制；用户可在 API 配置中选择支持图片的模型后重提。');
    const fid=args.file_id||getProject(pid).blocks.find(b=>b.id===args.evidence_id)?.file_id;if(!scopeFiles.has(fid))throw new Error('图像不在本轮资料范围');
    const v=await readVisual(pid,runId,args);viewed.add(v.block.id);if(args.evidence_id)viewed.add(args.evidence_id);return {content:v.content,details:{evidence_id:v.block.id}};
  },true);
  const pair={type:'array',items:{type:'number'},minItems:2,maxItems:2};
  const pagePoint=(point,box)=>[box[0]+point[0]*(box[2]-box[0])/1000,box[1]+point[1]*(box[3]-box[1])/1000];
  const tickSchema={type:'array',minItems:2,maxItems:8,items:object({position:{type:'number',minimum:0,maximum:1000},value:{type:'number'}})};
  tool('save_visual_estimate','保存任意学科的图像数值估读及误差，不限经纬度。先建行、read_visual。每项需标签、值、单位、误差范围、刻度/比例尺依据和误差说明；多组文本答案逐项保存，mode=append 保留已有正文/表格结果并追加图片独有数据；replace 替换整列答案，数值列只接受单值。直接写在图上的准确值用普通保存工具。坐标仍用 calibrate_grid + save_coordinate_estimate。',object({record_id:string,field:string,mode:{type:'string',enum:['replace','append']},items:{type:'array',minItems:1,maxItems:60,items:object({label:string,value:{type:'number'},unit:string,range:pair,evidence_id:string,basis:string,uncertainty_note:string})}}),args=>{
    const p=getProject(pid),row=p.records.find(r=>r.id===args.record_id);
    if(!row?.cells[args.field])throw new Error('请先创建目标记录');
    if(coordinateAxis(args.field,p.fields))throw new Error('坐标估读请使用专用网格计算和成对保存工具');
    if(isReview&&row.created_run_id!==runId)assertPlanned(p,runId,args.record_id,args.field);
    for(const item of args.items){const b=p.blocks.find(b=>b.id===item.evidence_id);if(!viewed.has(item.evidence_id)||b?.type!=='visual'||!scopeFiles.has(b.file_id)||!row.source_file_ids?.includes(b.file_id))throw new Error('估读必须引用本轮实际读过且属于该记录的原图');}
    const cell=validateCell(p,args.field,visualEstimateCell(p,args.field,args.items,runId,row.cells[args.field],args.mode));
    commitAgentCells(p,[{record_id:row.id,field:args.field,cell}],runId,'依据原图保存数值估读及误差');saveProject(p);revised=true;emit(pid,'result','已保存图片估算与误差范围',{detail:args.field});return {saved:true,cell};
  });
  if(start.fields.some(f=>coordinateAxis(f.name,start.fields))){
  tool('calibrate_grid','按实际看到的经纬网计算坐标与误差。必须先 read_visual；longitude_ticks.position 是经线的图像 x，latitude_ticks.position 是纬线的图像 y，刻度位置为本次图片 0–1000。目标 image_point 按 point_units 指定（推荐 pixels，直接读原图像素位置）。若 grid_line_hints 提供 longitude_ticks/latitude_ticks，对照图片确认北向上后直接复制这些刻度，勿混入外框。刻度位置对照 read_visual.grid_line_hints 的长直线（排除外框）；value 用十进制度，西经/南纬为负数，度分秒先换算。仅支持轴对齐的局部地图，目标点必须位于刻度之间。不要选择地图外框中心充当采样点。',object({evidence_id:string,image_point:pair,point_units:{type:'string',enum:['pixels','normalized']},longitude_ticks:tickSchema,latitude_ticks:tickSchema,point_error:{type:'number',minimum:2,maximum:100}},['evidence_id','image_point','point_units','longitude_ticks','latitude_ticks']),async args=>{
    const p=getProject(pid),b=p.blocks.find(b=>b.id===args.evidence_id);
    if(!p.coordinate_policy?.enabled)throw new Error('本项目禁止图片估算');
    if(!viewed.has(args.evidence_id)||b?.type!=='visual')throw new Error('必须先 read_visual 并使用返回的 visual ID');
    const hints=await visualGridHints(pid,b.id),tolerance=args.point_error??5;
    if([[args.longitude_ticks,hints.vertical_lines],[args.latitude_ticks,hints.horizontal_lines]].some(([ticks,lines])=>ticks.some(t=>!lines.some(v=>Math.abs(v-t.position)<=tolerance))))throw new Error(`刻度位置未对齐原图可见直线，不能计算误差偏小的估算。请对照像素读数重新选择带经纬度标签的刻度线，并排除外框：${JSON.stringify(hints)}`);
    for(const axis of ['longitude','latitude'])if(hints[axis+'_ticks']&&args[axis+'_ticks'].some(t=>!hints[axis+'_ticks'].some(h=>Math.abs(h.position-t.position)<=tolerance&&Math.abs(h.value-t.value)<.00001)))throw new Error(`刻度值与图中 OCR 角度标签不一致；这些候选已排除地图外框，请对照原图使用：${JSON.stringify({longitude_ticks:hints.longitude_ticks,latitude_ticks:hints.latitude_ticks})}`);
    const image_point=args.point_units==='pixels'?[args.image_point[0]/hints.width*1000,args.image_point[1]/hints.height*1000]:args.image_point;
    const calibration={...calibrateGrid({...args,image_point}),id:id('grid_'),evidence_id:b.id,full_page_point:pagePoint(image_point,b.bbox)};
    calibrations.set(calibration.id,calibration);return {...calibration,note:'用此 id 作为 save_coordinate_estimate.calibration_id，method=axis_interpolation；保存时采用程序结果。说明目标代表采样点还是研究区域代表位置。'};
  });
  tool('lookup_map_places','查询离线 GeoNames 地名参照库。提供图中实际可见的城市名和国家代码（英国GB）；返回真实城市坐标。城市不是采样点。',object({query:string,country:string},['query']),({query,country=''})=>({places:findPlaces(query,country),source:'GeoNames cities15000 / CC BY 4.0 / local snapshot 2026-09-16'}));
  tool('calibrate_map','从实际看过的地图选取3–8个分散的城市位置（建议至少4个），用离线地名坐标近似配准。image_point 与 controls.image_point 都是当前工具图像0–1000坐标。必须定位城市本身而非文字标签中心。程序计算目标坐标；不要用模型记忆报数。',object({evidence_id:string,image_point:pair,controls:{type:'array',minItems:3,maxItems:8,items:object({place_id:string,image_point:pair})}}),args=>{
    if(!viewed.has(args.evidence_id))throw new Error('配准前必须本轮实际读图');
    const b=getProject(pid).blocks.find(b=>b.id===args.evidence_id);
    const calculated=calibratePlaces(args.controls,args.image_point);
    const calibration={...calculated,id:id('cal_'),evidence_id:args.evidence_id,image_point:args.image_point,full_page_point:pagePoint(args.image_point,b.bbox),anchors:calculated.anchors.map(a=>({...a,full_page_point:pagePoint(a.image_point,b.bbox)}))};
    calibrations.set(calibration.id,calibration);
    return {...calibration,note:'将此 id 作为 calibration_id 传给 save_coordinate_estimate；保存时坐标和误差范围从计算结果读取，不受模型后续数字覆盖。图中选点与投影近似仍需复核。'};
  });
  tool('save_coordinate_estimate','保存经纬度近似值，X/Y原子成对更新。优先填写 calibrate_map 的 calibration_id；无可用参照时填空字符串。image_point为实际工具图片0–1000坐标。聚合行用明确标注的代表位置。',object({record_id:string,calibration_id:string,latitude:{type:'number',minimum:-90,maximum:90},longitude:{type:'number',minimum:-180,maximum:180},evidence_id:string,image_point:pair,method:{type:'string',enum:['visual_landmarks','axis_interpolation','affine_landmarks']},scope:{type:'string',enum:['sampling_point','group_representative','study_representative']},scope_note:string,basis:string,latitude_range:pair,longitude_range:pair,uncertainty_note:string}),args=>{
    const p=getProject(pid);
    const scope=p.runs.find(r=>r.id===runId)?.write_scope;
    const coordinateFields=p.fields.filter(f=>coordinateAxis(f.name,p.fields)&&(!scope||scope.cells.some(c=>c.record_id===args.record_id&&c.field===f.name)||p.records.find(r=>r.id===args.record_id)?.created_run_id===runId));
    if(!coordinateFields.length)throw new Error('本轮没有可修改的坐标列');
    if(isReview)for(const f of coordinateFields)assertPlanned(p,runId,args.record_id,f.name);
    if(!viewed.has(args.evidence_id))throw new Error('必须在本轮先用 read_visual 读取引用的图像');
    const calibration=args.calibration_id?calibrations.get(args.calibration_id):null;
    if(args.calibration_id&&(!calibration||calibration.evidence_id!==args.evidence_id))throw new Error('配准 ID 无效或不属于该图像');
    if(args.method==='affine_landmarks'&&!calibration)throw new Error('必须先调用 calibrate_map 获取真实换算结果');
    const b=p.blocks.find(b=>b.id===args.evidence_id);
    if(calibration){const grid=calibration.model==='axis_grid_linear',precision=grid?10000:100;args={...args,latitude:calibration.latitude,longitude:calibration.longitude,latitude_range:calibration.latitude_range.map((v,i)=>(i?Math.ceil(v*precision):Math.floor(v*precision))/precision),longitude_range:calibration.longitude_range.map((v,i)=>(i?Math.ceil(v*precision):Math.floor(v*precision))/precision),image_point:calibration.full_page_point,method:grid?'axis_interpolation':'affine_landmarks',basis:grid?gridBasis(calibration):calibrationBasis(calibration),uncertainty_note:calibration.uncertainty_note};}
    else args={...args,image_point:pagePoint(args.image_point,b.bbox)};
    const {record_id,latitude,longitude,...metadata}=args;
    const estimate={...metadata,calibration,run_id:runId,source_image_hash:b.image_hash,authorization:p.coordinate_policy?.reason};
    const note=`图片估算（非原文报告）：${[args.scope_note,args.basis,'不确定性：'+args.uncertainty_note].map(s=>s.replace(/[。\s]+$/,'')).join('。')}。`;
    const cells=reviseCoordinatePair(p,record_id,{latitude,longitude},estimate,note).filter(c=>coordinateFields.some(f=>f.name===c.field));
    const row=p.records.find(r=>r.id===record_id);
    commitAgentCells(p,cells.map(c=>({...c,record_id})),runId,target?.user_feedback||target?.feedback||'按用户约定从图片估算坐标');
    p.summary=`已保存 ${p.records.length} 条记录。坐标中标注“图片估算”的值为近似位置，含图像出处、位置含义和不确定范围，请复核后使用。`;
    saveProject(p);revised=true;emit(pid,'result','已成对保存图片估算坐标',{detail:row.label});return {saved:true,record_id,cells};
  });
  }
  tool('search_evidence','搜索当前论文及附件中的证据，返回匹配块及相邻块；使用原文关键词，如 sampling, mean, SD。',object({query:string,file_id:string,limit:{type:'integer',minimum:1,maximum:15}},['query']),({query,file_id,limit=8})=>{
    const p=getProject(pid);p.blocks=p.blocks.filter(b=>scopeFiles.has(b.file_id));const terms=normalize(query).split(/[^\p{L}\p{N}]+/u).filter(t=>t.length>1);
    const ranked=p.blocks.map((b,i)=>({b,i,score:terms.reduce((s,t)=>s+(normalize(b.text).includes(t)?1:0),0)})).filter(x=>x.score>0&&(!file_id||x.b.file_id===file_id)).sort((a,b)=>b.score-a.score).slice(0,limit);
    const indices=new Set(ranked.flatMap(x=>[x.i-1,x.i,x.i+1]).filter(i=>i>=0&&i<p.blocks.length&&(!file_id||p.blocks[i].file_id===file_id)));
    return {matches:[...indices].sort((a,b)=>a-b).map(i=>({...p.blocks[i],text:p.blocks[i].text.slice(0,10000),truncated:p.blocks[i].text.length>10000})),note:'搜索不能证明所有资料已覆盖，重要结果需回读方法和表格。'};
  });
  tool('read_evidence','读取证据块；可按 ids，或 file_id 与零基 page_start/page_end 读取连续页。每次最多 35 块；若 next_text_offset 非空，用 text_offset 继续读取该块剩余内容。',object({ids:strings,file_id:string,page_start:{type:'integer',minimum:0},page_end:{type:'integer',minimum:0},text_offset:{type:'integer',minimum:0}},[]),args=>{
    const p=getProject(pid);let blocks;
    if(args.ids?.length)blocks=p.blocks.filter(b=>args.ids.includes(b.id));
    else if(args.file_id)blocks=p.blocks.filter(b=>b.file_id===args.file_id&&(b.page_idx===null||b.page_idx>=(args.page_start??0)&&b.page_idx<=(args.page_end??args.page_start??999)));
    else throw new Error('请提供 ids 或 file_id');
    blocks=blocks.filter(b=>scopeFiles.has(b.file_id));const selected=blocks.slice(0,35);
    return {blocks:selected.map(b=>({...b,text:b.text.slice(args.text_offset||0,(args.text_offset||0)+16000),next_text_offset:b.text.length>(args.text_offset||0)+16000?(args.text_offset||0)+16000:null})),remaining_ids:blocks.slice(35).map(b=>b.id),source_is_data:true};
  });
  tool('list_records','查看已有记录以定位用户问题；默认返回记录摘要，record_ids 可读取完整单元格。支持 query 搜索及 offset 分页。',object({record_ids:strings,query:string,offset:{type:'integer',minimum:0}},[]),({record_ids=[],query='',offset=0})=>{
    const p=getProject(pid);const rows=p.records.filter(r=>(!record_ids.length||record_ids.includes(r.id))&&(!query||normalize(JSON.stringify(r)).includes(normalize(query))));
    return {total:rows.length,records:rows.slice(offset,offset+30).map(r=>record_ids.length?r:{id:r.id,label:r.label,source_file_ids:r.source_file_ids,values:Object.fromEntries(Object.entries(r.cells).map(([f,c])=>[f,c.value]))}),next_offset:rows.length>offset+30?offset+30:null};
  });
  tool('save_answer_items','分批保存长答案，避免输出截断。先创建论文记录；每批最多12个独立分组，首批 replace 清空旧答案，后续 append 追加。每项 text 是完整答案行（含分组、数值、单位、误差）；正文必须带原文 source_quotes。只有最后一批 complete=true。最后一批保存后即可结束。',object({record_id:string,field:string,mode:{type:'string',enum:['replace','append']},items:{...claimsSchema,maxItems:12},complete:{type:'boolean'},status:{type:'string',enum:['reported','derived','conflict','needs_review']},note:string}),args=>{
    const p=getProject(pid),c=assembleClaimBatch(p,args);checkCells(args.items.map(c=>({...c,record_id:args.record_id,field:args.field})));if(getProject(pid).records.find(r=>r.id===args.record_id)?.cells[args.field]?.review==='accepted'&&!args.complete)throw new Error('已审核答案请一次提交完整修改建议，不可分批覆盖');
    if(isReview)reviseCells(p,[{record_id:args.record_id,...c}],runId,target?.user_feedback||target?.feedback||'完整提取');
    else{const row=p.records.find(r=>r.id===args.record_id);const next=validateCell(p,args.field,c);p.history.push({id:id('h_'),at:now(),run_id:runId,record_id:row.id,record_label:row.label,field:args.field,before:row.cells[args.field],after:next,reason:'逐项补充提取'});row.cells[args.field]=next;}
    const saved=p.records.find(r=>r.id===args.record_id).cells[args.field];if(!args.complete&&saved.review!=='accepted')saved.needs_extraction=true;
    saveProject(p);emit(pid,'result',`已保存 ${c.claims.length} 项提取结果`,{detail:args.field});return {saved_items:c.claims.length,complete:args.complete};
  });
  tool('record_file_coverage','仅用于无法形成论文记录的例外：文件无相关数据或附件已处理时说明原因。正常论文保存答案后由系统自动登记，无需调用此工具。',object({file_id:string,outcome:{type:'string',enum:['study_extracted','supplement_reviewed','no_relevant_data']},reason:string}),args=>{
    const p=getProject(pid),f=p.files.find(f=>f.id===args.file_id&&f.role!=='template');
    if(!f||!scopeFiles.has(f.id)||f.role!=='document'||f.status!=='parsed'||!args.reason.trim())throw new Error('须指定已解析文件并说明处理结果');
    if(args.outcome==='study_extracted'&&!p.records.some(r=>Object.values(r.cells).some(c=>c.evidence_ids.some(eid=>p.blocks.find(b=>b.id===eid)?.file_id===f.id))))throw new Error('此论文尚无带来源证据的结果');
    const run=p.runs.find(r=>r.id===runId);run.file_results||=[];run.file_results=run.file_results.filter(x=>x.file_id!==f.id);run.file_results.push({...args,run_id:runId,at:now()});saveProject(p);return {recorded:true};
  });
  if(mode==='extract'){
    tool('set_fields','仅在没有 Excel 表头时，根据用户自然语言定义提取字段。',object({fields:{type:'array',items:object({name:string,description:string}),minItems:1,maxItems:60}}),({fields})=>{
      const p=getProject(pid);if(p.fields.length)throw new Error('已有表头，不可更改');if(new Set(fields.map(f=>f.name)).size!==fields.length)throw new Error('字段名重复');
      p.fields=fields.map((f,i)=>({...f,id:`f${i+1}`}));saveProject(p);return {saved:p.fields};
    });
    tool('set_common_fields','保存所有记录共享且有证据支持的字段；不可把某分组数值设置为共享值。',object({cells:{type:'array',items:cellSchema}}),({cells})=>{
      const p=getProject(pid);checkCells(cells);const allowed=new Set(p.fields.map(f=>f.name));const common={};
      for(const c of cells){if(!allowed.has(c.field))throw new Error(`未知字段 ${c.field}`);common[c.field]=validateCell(p,c.field,c);}
      p.common_cells=common;saveProject(p);return {saved_fields:Object.keys(common)};
    });
    tool('submit_records','保存实际提取结果。每条记录提供唯一英文 id、明确分组 label、字段 cells；自动继承共享字段。多项答案用 claims 给各分句附独立证据；claims.text 必须是 value 的顺序子串，证据须属于该单元格 evidence_ids。图中数据先 read_visual，引用返回的 visual 证据。',object({records:{type:'array',minItems:1,maxItems:4,items:object({id:string,label:string,cells:{type:'array',items:cellSchema}})}}),({records})=>{
      const p=getProject(pid);if(!p.fields.length)throw new Error('先定义提取字段');
      const merged=records.map(r=>({...r,cells:[...Object.entries(p.common_cells||{}).filter(([name])=>!r.cells.some(c=>c.field===name)).map(([field,c])=>({field,...c})),...r.cells]}));
      for(const r of merged)checkCells(r.cells,[...new Set(r.cells.flatMap(c=>(c.evidence_ids||[]).map(eid=>p.blocks.find(b=>b.id===eid)?.file_id)).filter(Boolean))]);
      const n=applyRecords(p,merged,p.runs.length>1?'重新提取':'首次提取');
      for(const raw of records){const row=p.records.find(r=>r.id===String(raw.id).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80));row.created_run_id=runId;row.source_file_ids=[...new Set(Object.values(row.cells).flatMap(c=>c.evidence_ids.map(eid=>p.blocks.find(b=>b.id===eid)?.file_id)).filter(Boolean))];}
      saveProject(p);emit(pid,'result',`已保存 ${n} 条记录`,{detail:records.map(r=>r.label).join('、')});return {saved:n,total:p.records.length};
    });
    tool('finish_extraction','全部提取保存后结束。明确列出源文冲突、缺失信息和覆盖限制。',object({summary:string,issues:strings}),({summary,issues})=>{
      const p=getProject(pid);if(!p.records.length)throw new Error('没有已提交的记录，请先保存结果；如果原文不能支持任何记录，明确说明并保留任务未完成。');
      const run=p.runs.find(r=>r.id===runId);
      if(target?.action==='pilot'&&!latestProtocol(p))throw new Error('请先 save_protocol 汇总试提取规范，以便后续对话校准');
      completeSavedFiles(p,runId,pendingAtStart);
      if(p.records.some(r=>Object.values(r.cells).some(c=>c.needs_extraction)))throw new Error('仍有未保存完的提取结果，请完成最后一批保存。');
      p.summary=summary;p.warnings=[...new Set([...p.warnings,...issues])];saveProject(p);finished=true;return {finished:true,records:p.records.length};
    });
  }else {
    tool('set_review_plan','解析问题后列出需要修改的记录和字段，记录各自原因；可随新证据更新。新增论文可先 targets=[] 说明新增计划，也可列出拟新增的 ID；必须先保存新论文记录，再修订它的字段。此计划不需用户再次确认。',object({issue:string,targets:{type:'array',items:object({record_id:string,fields:strings,reason:string})}}),args=>{
      const p=getProject(pid),plan=setReviewPlan(p,runId,args);saveProject(p);emit(pid,'plan','已定位本轮问题与处理范围',{detail:args.issue});return plan;
    });
    tool('revise_cells','一次修订多个相关行、多个字段；每个单元格必须独立引用依据。整批校验成功才保存；失败时整批均未写入，可将其他有效结果单独提交。未找到坐标时允许 value:null、status:not_found，不需要成对坐标工具或估算授权。仅修改计划范围；不要对无关记录传播。图片估算用 save_coordinate_estimate。',object({updates:{type:'array',minItems:1,maxItems:60,items:object({record_id:string,...cellSchema.properties},['record_id',...cellSchema.required])}}),({updates})=>{
      const p=getProject(pid);checkCells(updates);const n=reviseCells(p,updates,runId,target?.user_feedback||target?.feedback||'根据新资料复核');saveProject(p);revised=true;emit(pid,'result',`已处理 ${n} 个单元格（已审核答案保留，修改建议待确认）`);return {saved:n,...runChanges(p,runId)};
    });
    const paperSchema=object({id:string,label:string,source_file_ids:strings,cells:{type:'array',items:cellSchema}});
    const savePapers=records=>{
      const p=getProject(pid);
      for(const r of records){checkCells(r.cells,r.source_file_ids);if(r.source_file_ids.some(fid=>!scopeFiles.has(fid)||p.files.find(f=>f.id===fid)?.role!=='document'))throw new Error('新增记录来源须为本轮目标论文');}
      if(!p.runs.find(r=>r.id===runId).review_plan)setReviewPlan(p,runId,{issue:target?.feedback||'新增已上传论文',targets:records.map(r=>({record_id:r.id,fields:r.cells.map(c=>c.field),reason:'按当前列定义保存新上传论文的提取结果'}))});
      const n=appendRecords(p,records,runId);saveProject(p);revised=true;emit(pid,'result',`新增 ${n} 条记录，保留原有结果`);return {saved:n,total:p.records.length};
    };
    if(start.granularity==='paper')tool('add_paper','一次保存一篇新论文。id、label、source_file_ids、cells 都在同一对象内，不要包 records 数组。不需要预先生成修改计划。每项按列名保存答案；长答案可先建记录再用 save_answer_items 分批填入。',paperSchema,args=>savePapers([args]));
    else tool('add_records','新增论文/分组记录；每条提供 id、label、source_file_ids 和 cells，不继承其他论文的共享字段。每批最多4条。',object({records:{type:'array',minItems:1,maxItems:4,items:paperSchema}}),({records})=>savePapers(records));
    tool('finish_review','完成本轮复核或继续提取。说明修改、缺失和限制；无需修改时 no_change，指代不明时 needs_clarification 并提出明确问题。不得声称修改未保存的内容。',object({summary:string,outcome:{type:'string',enum:['updated','no_change','needs_clarification']},issues:strings,learning_note:string},['summary','outcome','issues']),({summary,outcome,issues,learning_note})=>{
      const p=getProject(pid),run=p.runs.find(r=>r.id===runId),delta=runChanges(p,runId);
      const requested=run.write_scope?.cells||[];
      if(outcome!=='needs_clarification'&&requested.some(c=>!p.history.some(h=>h.run_id===runId&&h.record_id===c.record_id&&h.field===c.field)&&!delta.proposed_changes.some(h=>h.record_id===c.record_id&&h.field===c.field)))throw new Error('本轮指定单元格仍未保存，请只完成剩余项后结束');
      run.learning_note=learning_note||(run.learned_skills?.length?'已从本轮对话保存项目技能':'');
      if(!run.review_plan)run.review_plan={issue:target?.feedback||'本轮讨论',targets:[],at:now()};
      if(mode==='learn'&&outcome!=='needs_clarification'&&!p.workflow?.protocols.some(v=>v.run_id===runId))throw new Error('请先实际阅读示范并 save_protocol 保存学习结果');
      if(target?.action==='pilot'&&!latestProtocol(p))throw new Error('请先 save_protocol 总结试提取规范');
      if(outcome==='updated'&&!delta.changes.length&&!delta.proposed_changes.length&&!delta.added_records.length&&!p.workflow?.protocols.some(v=>v.run_id===runId)&&!run.learned_skills?.length)throw new Error('没有保存修改，不能声称已更新');
      if(outcome==='no_change'&&(delta.changes.length||delta.proposed_changes.length||delta.added_records.length))throw new Error('已保存修改，请如实选择 updated 或 needs_clarification');
      if(mode==='continue'&&outcome!=='needs_clarification')completeSavedFiles(p,runId,pendingAtStart);
      if(mode==='continue'&&p.experience==='extract'&&outcome!=='needs_clarification'&&p.records.some(r=>Object.values(r.cells).some(c=>c.needs_extraction)))throw new Error('仍有待提取单元格。请按列定义逐一保存结果或未找到原因，不能忽略新增的列。');
      run.review_outcome=outcome;run.review_summary=summary;run.issues=issues;
      p.warnings=[...new Set([...p.warnings,...issues])];saveProject(p);finished=true;return {finished:true,outcome,...delta};
    });
  }

  tool('read_conversation','检索本项目完整用户/助手对话，不局限最近8条。query筛选；offset按时间正序分页。用于恢复先前指代、决定和未解决问题。',object({query:string,offset:{type:'integer',minimum:0}},[]),({query='',offset=0})=>{const messages=getProject(pid).messages.filter(m=>m.queue_status!=='queued'&&(!query||m.text.includes(query)));return {total:messages.length,messages:messages.slice(offset,offset+15),next_offset:offset+15<messages.length?offset+15:null};});
  tool('read_examples','读取用户已提取的示范结果。它们是教学案例，不是新论文事实。可查询或分页；返回原表工作表/行号及原文关联。',object({query:string,offset:{type:'integer',minimum:0}},[]),({query='',offset=0})=>{const examples=(getProject(pid).examples||[]).filter(e=>!query||normalize(JSON.stringify(e.values)).includes(normalize(query)));return {total:examples.length,examples:examples.slice(offset,offset+15),next_offset:offset+15<examples.length?offset+15:null};});
  if(start.workflow){
    tool('link_example_sources','按DOI、标题等依据关联示范数据行。file_ids必须只传list_documents返回的role=reference文件ID，禁止传role=example结果表ID。reference就是示范正文和附件。不能猜测关联。',object({example_ids:strings,file_ids:strings,reason:string}),({example_ids,file_ids,reason})=>{const p=getProject(pid);linkExamples(p,example_ids,file_ids,reason);saveProject(p);return {linked:example_ids.length};});
    tool('save_protocol','保存可复用的提取规范草案：字段含义、行粒度、单位/换算、缺失与冲突处理。不要复制单篇数值。field用真实列名；跨字段的粒度/缺失等约定用 *。仅替换提交字段的规则，其余保留。questions列尚未解决的关键问题，无则[]。',object({summary:string,rules:{type:'array',minItems:1,maxItems:100,items:object({field:string,instruction:string,basis:{type:'string',enum:['inferred','supported','user_defined']},rationale:string,example_ids:strings,evidence_ids:strings})},questions:strings}),args=>{const p=getProject(pid),v=saveProtocol(p,args,runId);saveProject(p);writeProtocolArtifact(p,v);change(pid,p=>{p.runs.find(r=>r.id===runId).learned_skills=[...(p.runs.find(r=>r.id===runId).learned_skills||[]),{id:'project-protocol',title:'项目提取规范',version:v.version}];});emit(pid,'protocol',`已整理提取规范 v${v.version}`,{detail:v.summary});return v;});
  }
  const sessionDir=path.join(directory(pid),'sessions');fs.mkdirSync(sessionDir,{recursive:true});
  const modelProfile=`${connections.model.id}:${connections.model.version}`;
  const persisted=mode==='learn'&&start.pi_model_profile===modelProfile&&start.extraction_runtime===11&&start.pi_session_file&&fs.existsSync(start.pi_session_file)&&path.resolve(start.pi_session_file).startsWith(sessionDir+path.sep);
  const manager=persisted?SessionManager.open(start.pi_session_file,sessionDir):SessionManager.create(ROOT,sessionDir);
  if(mode==='learn'&&!persisted&&start.messages.length&&!start.context_isolation_reset){const old=start.messages.filter(m=>m.queue_status!=='queued'&&m.role==='user').map(m=>({role:m.role,text:m.text,record_id:m.record_id,field:m.field}));manager.appendCustomMessageEntry('sie-conversation-import','历史对话导入（原记录完整保留，可用 read_conversation 回查）：'+JSON.stringify(old).slice(-100000),false);}
  change(pid,p=>{if(!persisted&&p.pi_session_file)p.archived_pi_sessions=[...new Set([...(p.archived_pi_sessions||[]),p.pi_session_file])];p.extraction_runtime=11;p.pi_session_file=manager.getSessionFile();const run=p.runs.find(r=>r.id===runId);run.protocol_version=protocol?.version||null;run.session_id=manager.getSessionId();run.context_resumed=!!persisted;});
  change(pid,p=>{p.pi_model_profile=modelProfile;});
  const {session}=await createAgentSession({cwd:ROOT,agentDir,modelRuntime:runtime,model,settingsManager:settings,resourceLoader:loader,sessionManager:manager,thinkingLevel:'off',tools:tools.map(t=>t.name),customTools:tools});
  const transform=session.agent.transformContext;
  session.agent.transformContext=async(messages,signal)=>limitVisionContext(transform?await transform(messages,signal):messages,4);
  const labels={read_conversation:'回查项目对话',read_examples:'阅读教学案例',link_example_sources:'关联案例与原文',save_protocol:'保存提取规范',lookup_map_places:'查询离线地名参照',calibrate_map:'计算图像坐标换算',calibrate_grid:'按经纬网计算坐标与误差',read_visual:'读取原始图像',select_visual_sources:'判断字段相关图片',save_visual_estimate:'保存图片估算与误差',save_coordinate_estimate:'保存经纬度估算与依据',list_documents:'检查文献结构',search_evidence:'搜索原文证据',read_evidence:'阅读原文片段',set_fields:'生成提取字段',set_common_fields:'提取共享信息',submit_records:'保存提取记录',finish_extraction:'完成提取',list_records:'定位相关记录',set_review_plan:'解析问题并定位字段',revise_cells:'批量修订对应单元格',add_records:'新增文献记录',record_file_coverage:'记录资料处理结果',finish_review:'汇总本轮修改',save_answer_items:'分批保存逐项数据',add_paper:'保存新论文'};
  let streamText='',lastStreamWrite=0,saveFailure=null;
  const generationStarted=Date.now(),toolStarts=new Map(),toolTimings=[];
  const detectSaveLoop=saveRetryGuard();
  const messageStart=session.messages.length;
  session.subscribe(e=>{
    if(e.type==='tool_execution_start')toolStarts.set(e.toolCallId,Date.now());
    if(e.type==='tool_execution_end'){const began=toolStarts.get(e.toolCallId);if(began!==undefined){toolTimings.push({tool:e.toolName,duration_ms:Date.now()-began,error:!!e.isError});toolStarts.delete(e.toolCallId);}}
    const failure=detectSaveLoop(e);if(failure){saveFailure=failure;void session.abort();}
    if(e.type==='message_start'&&e.message?.role==='assistant')streamText='';
    if(e.type==='message_update'&&e.assistantMessageEvent?.type==='text_delta'){streamText+=e.assistantMessageEvent.delta;if(Date.now()-lastStreamWrite>500){lastStreamWrite=Date.now();change(pid,p=>{p.runs.find(r=>r.id===runId).live_text=streamText;});}}
    if(e.type==='tool_execution_start')change(pid,p=>{p.runs.find(r=>r.id===runId).last_operation=toolOperation(e.toolName,e.args);});
    if(e.type==='tool_execution_start')emit(pid,'tool',labels[e.toolName]||e.toolName,{tool:e.toolName,detail:e.args?.query||''});
    if(e.type==='tool_execution_end'&&e.isError)emit(pid,'tool_error','工具执行未成功，Agent 正在处理',{tool:e.toolName,detail:(e.result?.content||[]).filter(c=>c.type==='text').map(c=>c.text).join(' ').slice(0,300)});
  });
  const promptSession=async text=>{try{await session.prompt(text);}catch(error){throw saveFailure?new Error(saveFailure):error;}if(saveFailure)throw new Error(saveFailure);const last=session.messages.at(-1);if(last?.role==='assistant'&&last.stopReason==='error')throw new Error(`模型请求失败：${last.errorMessage||'未知错误'}。已保存的提取进度保留。`);};
  const abort=()=>session.abort();signal.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{session.abort();},24*60*1000);
  try {
    const p=getProject(pid);
    const prompt=mode==='learn'?`从用户提供的已完成提取表学习规范。先 read_examples、list_documents，对照示范正文方法和表格，按DOI或标题 link_example_sources。归纳每列含义、输出粒度、单位、取值边界、缺失/冲突处理；规则要可泛化而非具体数值。逐行样本可分页。原文不支持的习惯标 inferred，并列出关键问题；用户明确要求优先。save_protocol 后 finish_review，summary说明学到了什么、哪些有原文核对、哪些需澄清。用户的本轮补充：${target?.feedback||'无'}。严禁将示范行写到待提取结果。`:mode==='extract'
      ? `开始提取。项目：${p.name}。按列名和可选列说明自主提取，无需任务要求。行粒度：${p.granularity==='point'?'仅原文明示的独立采样点；若只有分组汇总，明确无法恢复各点，不把汇总伪装成点级记录。':p.granularity==='paper'?'每篇论文一行，按列名和可选说明简洁提取核心结果及主要比较分组，禁止自行平均。':'按用户要求及最新规范确定实验/样品分组，每组一条；只有明确要求整体汇总且原文单独报告时才另建整体行。不要将引言或讨论引用的其他研究当作本研究。'}。先查看文献结构，再读取与所选字段有关的原文和表格。仅提取已定义列，共享字段也必须属于当前论文和现有列。ID列可生成标签但 PointID 仅原文明确给出才填写。按现有字段名称提交，缺失值 null，证据ID必须真实。完成后 finish_extraction。`
      : `本轮是${mode==='continue'?'继续提取新资料':'项目级复核'}。用户当前反馈：${target?.feedback||'请按当前表头提取新上传的全部资料，独立论文新增记录，相关附件补充对应研究。保留现有记录及人工确认。'}。可选的参考单元格（不限制用户明确要求的范围）：${JSON.stringify({record_id:target?.record_id,field:target?.field})}。待纳入的文件：${JSON.stringify(pendingAtStart)}。先 list_documents 和 list_records 识别不同研究，读取相关证据；只有修改已有结果时才用 set_review_plan 记录受影响行列。复核多行多列请 revise_cells；新增论文请 ${p.granularity==='paper'?'add_paper':'add_records'}，按该论文实际设计分组，不能套用其他论文的分组分类或数据。先核对是否已有该研究/分组，禁止重复新增。新增论文可直接保存，无需单独建立修改计划；不要在记录存在前尝试修改它的坐标。资料内容或问题不清楚则保留相应值并提出具体问题。保存本轮答案后直接 finish_review，文件完成状态由系统登记。不要加载或保存自定义系统提示词与 Skills。允许坐标估算时先 read_visual 再 save_coordinate_estimate，先将目标行X/Y加入计划。`;
    await promptSession(prompt);
    if(saveFailure)throw new Error(saveFailure);
    if(!finished&&!signal.aborted)await promptSession(mode==='extract'?'保存本轮尚未写入的答案后直接调用 finish_extraction，不启动额外的补读或核查。':'请完成已识别的问题，实际保存修改后调用 finish_review。不能据现有资料判断时用 needs_clarification，明确提出问题；不强制修改无问题的单元格。');
    if(saveFailure)throw new Error(saveFailure);
    signal.throwIfAborted();
    const texts=session.messages.slice(messageStart).filter(m=>m.role==='assistant').map(m=>m.content.filter(c=>c.type==='text').map(c=>c.text).join('\n')).filter(Boolean).at(-1)||'';
    if(!finished)throw new Error('Agent 尚未提交完成状态，已保存的进度与修改仍保留');
    change(pid,p=>{
      const run=p.runs.find(r=>r.id===runId),delta=runChanges(p,runId);
      for(const coverage of run.file_results||[]){const f=p.files.find(f=>f.id===coverage.file_id);if(f)f.coverage=coverage;}
      run.result=delta;delete run.live_text;
      if(p.workflow){if(target?.action==='pilot'||mode==='learn')p.workflow.stage='calibration';else if(target?.action==='batch')p.workflow.stage='ready';}
      const answer=mode==='extract'?(p.summary||texts||'提取完成，请核对证据。'):(run.review_summary||texts||'已完成本轮复核。');
      if(isReview&&revised)p.summary=`当前共 ${p.records.length} 条记录。本轮新增 ${delta.added_records.length} 条，复核更新 ${delta.changes.length} 个单元格。${answer}`;
      p.messages.push({id:id('msg_'),role:'assistant',protocol_version:p.workflow?.protocols.find(v=>v.run_id===runId)?.version,learned_skills:run.learned_skills||[],learning_note:run.learning_note,text:answer,at:now(),run_id:runId,...delta,outcome:run.review_outcome});
    });
  } finally {
    clearTimeout(timer);signal.removeEventListener('abort',abort);
    const runPath=path.join(directory(pid),'runs',runId);fs.mkdirSync(runPath,{recursive:true});fs.writeFileSync(path.join(runPath,'pi-messages.json'),JSON.stringify(redactSecrets(session.messages.slice(messageStart),Object.values(connections)),null,2));
    const usages=session.messages.slice(messageStart).filter(m=>m.role==='assistant'&&m.usage).map(m=>m.usage);
    change(pid,p=>{p.runs.find(r=>r.id===runId).metrics={elapsed_ms:Date.now()-generationStarted,model_calls:usages.length,peak_input_tokens:Math.max(0,...usages.map(u=>u.input||0)),output_tokens:usages.reduce((n,u)=>n+(u.output||0),0),tool_calls:toolTimings.length,tool_errors:toolTimings.filter(t=>t.error).length,tool_duration_ms:toolTimings.reduce((n,t)=>n+t.duration_ms,0)};});
    session.dispose();
  }
}

export function enqueue(pid,mode='extract',target=null) {
  const p=getProject(pid);if(mode==='extract'&&p.records.some(r=>Object.values(r.cells).some(c=>c.review==='accepted')))throw new Error('已有人工确认答案，请使用继续未完成项或单元格重提；不能全量覆盖');if(isBusy(p))throw Object.assign(new Error('当前任务仍在运行'),{status:409});
  if(mode!=='correction'&&!p.files.some(f=>f.role!=='template'&&f.status!=='unsupported'))throw new Error('请先上传可解析的正文或附件');
  if(mode!=='correction'&&!p.fields.length)throw new Error('请先添加提取列或导入表头');
  const connections=selectedConnections();
  if(!connections.model?.model)throw new Error('请先在“API 配置”中添加并选择提取模型');
  const controller=new AbortController();const runId=id('run_');jobs.set(pid,controller);
  change(pid,p=>{p.coordinate_policy=coordinatePolicy(p.coordinate_policy,'');p.status='queued';p.stage='排队中';p.error=null;delete p.failure;p.runs.push({id:runId,mode,started_at:now(),status:'queued',model:connections.model.model,connections:connectionSnapshot(connections),...(target?.write_scope?{write_scope:structuredClone(target.write_scope)}:{})});if(mode==='extract')p.common_cells={};if(p.workflow&&target?.action){p.workflow.stage=target.action==='learn'?'learning':target.action;if(target.action==='pilot')p.workflow.pilot_file_ids=target.file_ids;}p.runs.at(-1).workflow_action=target?.action||null;});
  emit(pid,'queue',mode==='extract'?'提取任务已加入队列':mode==='continue'?'新资料提取已加入队列':'项目复核已加入队列');
  chain=chain.catch(()=>{}).then(async()=>{
    let phase='parsing';
    try {
      controller.signal.throwIfAborted();
      if(mode==='extract'){
        const prior=getProject(pid);
        if(prior.records.length){const dir=path.join(directory(pid),'runs',runId);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'previous-results.json'),JSON.stringify({records:prior.records,fields:prior.fields,summary:prior.summary,at:now()},null,2));}
        change(pid,p=>{p.records=[];for(const f of p.files)if(!target?.file_ids||target.file_ids.includes(f.id))delete f.coverage;p.summary=null;p.warnings=[...(p.import_warnings||[]),...p.files.flatMap(f=>f.parsing_warnings||[]),...p.files.filter(f=>f.status==='unsupported').map(f=>`未支持的文件：${f.name}`)];});
      }
      change(pid,p=>{p.status='parsing';p.stage='检查并解析新资料';const run=p.runs.find(r=>r.id===runId);run.status='running';run.input_file_ids=target?.file_ids||p.files.filter(f=>mode==='learn'?['example','reference'].includes(f.role):f.role==='document'||mode==='correction'&&f.role==='reference').map(f=>f.id);});
      await parseProject(pid,controller.signal,target?.file_ids||(mode==='learn'?p.files.filter(f=>['example','reference'].includes(f.role)).map(f=>f.id):p.files.filter(f=>f.role==='document'||mode==='correction'&&f.role==='reference').map(f=>f.id)),connections.mineru);
      const ready=getProject(pid);if(!ready.blocks.length&&mode!=='correction')throw new Error('没有可用的解析内容');
      change(pid,p=>{p.status=mode==='extract'?'extracting':'correcting';p.stage=mode==='learn'?'对照示范学习规范':mode==='extract'?'提取数据':mode==='continue'?'提取新资料':'复核与修订';});
      phase='extracting';
      await sessionFor(pid,runId,controller.signal,mode,target,connections);
      change(pid,p=>{p.status='completed';const run=p.runs.find(r=>r.id===runId);p.stage=run.review_outcome==='needs_clarification'?'待补充说明':mode==='correction'?'复核完成':'提取完成';run.status='completed';run.finished_at=now();});emit(pid,'success',mode==='extract'?'提取完成，可逐项复核并导出':'已完成证据复核与修订');
    }catch(e) {
      e=new Error(redactError(e,Object.values(connections)));
      console.error('[run]',pid,e.message);
      change(pid,p=>{p.status=controller.signal.aborted?'cancelled':'error';p.stage=controller.signal.aborted?'已停止':'需要处理';p.error=controller.signal.aborted?null:e.message;const run=p.runs.find(r=>r.id===runId);run.status=p.status;run.finished_at=now();run.error=e.message;if(!controller.signal.aborted){run.failure=failureInfo(p,e,phase,run);p.failure=run.failure;}});emit(pid,controller.signal.aborted?'info':'error',controller.signal.aborted?'任务已停止，已有结果已保留':e.message);
    }finally{jobs.delete(pid);resumeFeedback(pid);}
  });
  return {run_id:runId,status:'queued'};
}

export function resumeFeedback(pid){
  const p=getProject(pid);if(isBusy(p)||!p.pending_feedback?.length)return;
  const next=p.pending_feedback[0];
  change(pid,p=>{p.pending_feedback.shift();const m=p.messages.find(m=>m.id===next.message_id);if(m)m.queue_status='running';if(next.policy)p.coordinate_policy=next.policy;});
  try{const run=enqueue(pid,'correction',{record_id:next.record_id,field:next.field,feedback:next.feedback});change(pid,p=>{const m=p.messages.find(m=>m.id===next.message_id);if(m){m.run_id=run.run_id;delete m.queue_status;}});}catch(e){change(pid,p=>{const m=p.messages.find(m=>m.id===next.message_id);if(m){m.queue_status='failed';m.queue_error=e.message;}});emit(pid,'error',e.message);}
}
