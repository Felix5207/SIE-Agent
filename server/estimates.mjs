// Validation is separate from inference: estimates are never reported measurements.
export function coordinateAxis(field,fields=[]) {
  if (/^(longitude|lon|lng|经度)$/i.test(field)) return 'longitude';
  if (/^(latitude|lat|纬度)$/i.test(field)) return 'latitude';
  // X/Y are arbitrary variables in many disciplines. Only legacy templates
  // explicitly defining them as geographic coordinates receive map tooling.
  const definition=fields.find(f=>f.name===field);
  const meaning=definition?.instructions??definition?.description??'';
  if(/^X$/i.test(field)&&/经度|longitude/i.test(meaning))return 'longitude';
  if(/^Y$/i.test(field)&&/纬度|latitude/i.test(meaning))return 'latitude';
  return null;
}

// Compare the printed coordinate, allowing only PDF/Markdown typography noise.
// Do not turn a range into a point or convert DMS to decimal degrees here.
export function coordinateTextMatches(value, blocks) {
  if(typeof value!=='string'||!value.trim()||!/[0-9]/.test(value))return false;
  const clean=s=>String(s).normalize('NFKC').replace(/\\(?:sim|textasciitilde)\b/g,'~')
    .replace(/\\([~°])/g,'$1').replace(/[′’']/g,"'").replace(/[″”"]/g,'"')
    .replace(/[–—−～]/g,'~').replace(/[\s${}]/g,'');
  const text=clean(value);
  return blocks.some(b=>b?.type==='visual'&&b.image_hash||clean(b?.text||'').includes(text));
}

export function coordinatePolicy(previous, feedback, mode = 'auto') {
  if (!['auto', 'allow', 'forbid'].includes(mode)) throw new Error('未知图片估算设置');
  // A prohibition on place-name/model-memory inference does not revoke an
  // explicit allowance to interpolate the paper's own graticule.
  const policyText=feedback.replace(/(?:不要|禁止|不得|不能)(?:使用|用|依据|根据)?(?:城市)?(?:地名库|模型记忆|模型常识).{0,12}(?:估算|估计|推断)/g,'');
  const deny = /(?:不要|禁止|不允许|不可|不得|停止|不再|不从).{0,12}(?:估算|估计|目测|读图)|(?:只用|仅用|仅限|仅提取|只提取).{0,8}(?:原文|报告).{0,8}(?:坐标|值)|(?:do not|don't|never)\s+(?:estimate|approximate)/i.test(policyText);
  const allow = /估算|估计|目测|读图|estimat|approximat/i.test(policyText);
  if (mode === 'forbid' || (mode === 'auto' && deny)) return {enabled:false, reason:feedback};
  if (mode === 'allow' || (mode === 'auto' && allow)) return {enabled:true, reason:feedback,...(/经纬网|网格|grid/i.test(feedback)?{methods:['axis_interpolation']}:{})};
  // Workspace default explicitly requested by the user. Preserve project-level
  // prohibitions; older {enabled:false} objects without a reason were defaults.
  return previous?.reason ? previous : {enabled:true,methods:['axis_interpolation'],source:'workspace_default',reason:'正文和表格缺失坐标时必须读图；用户允许按经纬网估读，标注图片估算和误差范围。'};
}

export function validateEstimate(p, field, cell) {
  const e = cell.estimate;
  if (!e || typeof e !== 'object') throw new Error('图片估算必须保存方法、图像和不确定范围');
  if (!p.coordinate_policy?.enabled) throw new Error('尚未收到用户允许图片估算的要求');
  const b = p.blocks.find(b => b.id === e.evidence_id);
  if (!b || b.type !== 'visual' || !b.image_hash || !cell.evidence_ids.includes(b.id)) throw new Error('估算必须引用实际读取过的原始图像');
  if (!['visual_landmarks','axis_interpolation','affine_landmarks'].includes(e.method)) throw new Error('未知读图估算方法');
  if(p.coordinate_policy.methods&&!p.coordinate_policy.methods.includes(e.method))throw new Error('当前仅允许按原图经纬网估读，不能用地名或模型记忆推断坐标');
  if(e.method==='axis_interpolation'&&e.calibration?.model!=='axis_grid_linear')throw new Error('经纬网估读必须先用 calibrate_grid 计算并保存网格参照与误差范围');
  if (!['sampling_point','group_representative','study_representative'].includes(e.scope)) throw new Error('请明确坐标代表单点、分组还是研究区域');
  if (!e.basis?.trim() || !e.uncertainty_note?.trim() || !e.scope_note?.trim()) throw new Error('请说明读图参照、位置含义与误差范围的依据');
  const point = e.image_point;
  if (!Array.isArray(point) || point.length !== 2 || point.some(v=>!Number.isFinite(v)||v<0||v>1000)) throw new Error('图像定位必须为原页 0–1000 归一化坐标');
  const box = b.bbox || [0,0,1000,1000];
  if (point[0]<box[0]||point[0]>box[2]||point[1]<box[1]||point[1]>box[3]) throw new Error('估算位置超出了已读取的图像区域');
  for (const [axis,limit] of [['latitude',90],['longitude',180]]) {
    const range=e[axis+'_range'];
    if (!Array.isArray(range)||range.length!==2||range.some(v=>!Number.isFinite(v)||Math.abs(v)>limit)||range[0]>=range[1]) throw new Error(`${axis} 不确定范围无效`);
    if (coordinateAxis(field,p.fields)===axis && (cell.value<range[0]||cell.value>range[1])) throw new Error('估算值不在所声明的不确定范围内');
  }
  if (!e.run_id) throw new Error('缺少图片读取运行记录');
  return structuredClone(e);
}

export function reviseCoordinatePair(p, rowId, values, estimate, reason) {
  const row=p.records.find(r=>r.id===rowId);
  if (!row) throw new Error('目标记录不存在');
  const fields=Object.fromEntries(p.fields.map(f=>[coordinateAxis(f.name,p.fields),f.name]).filter(([a])=>a));
  if (!fields.latitude||!fields.longitude) throw new Error('成对估算需要纬度与经度两个字段');
  return ['latitude','longitude'].map(axis=>{
    const value=values[axis];
    if (!Number.isFinite(value)||Math.abs(value)>(axis==='latitude'?90:180)) throw new Error('经纬度必须是有效十进制度');
    // Pixel-based, approximate values should not suggest survey-level precision.
    const precision=estimate.method==='axis_interpolation'?10000:100;
    const cell={value:Math.round(value*precision)/precision,status:'estimated',evidence_ids:[estimate.evidence_id],note:reason,review:'pending',estimate};
    cell.estimate=validateEstimate(p,fields[axis],cell);
    return {field:fields[axis],cell};
  });
}
