import React from 'react';
export function CoordinateEstimate({estimate}){
  if(!estimate)return null;
  if(estimate.kind==='visual_readout')return <section className="coordinate-estimate-details" aria-label="图片估算及误差范围"><strong>图片估算 · 非原文报告值</strong>{estimate.items.map((item,i)=><div key={`${item.evidence_id}-${i}`}><p>{item.label}</p><dl><dt>估读值</dt><dd>{item.value} {item.unit}</dd><dt>读图范围</dt><dd>{item.range.join(' ～ ')} {item.unit}</dd></dl><p>{item.basis}</p><p>{item.uncertainty_note}</p></div>)}</section>;
  const digits=estimate.method==='axis_interpolation'?4:2;
  const range=values=>values?.map(v=>Number(v).toFixed(digits)).join(' ～ ')+'°';
  return <section className="coordinate-estimate-details" aria-label="图片估算及误差范围"><strong>图片估算 · 非原文报告值</strong><p>{estimate.scope_note}</p><dl><dt>经度读图范围</dt><dd>{range(estimate.longitude_range)}</dd><dt>纬度读图范围</dt><dd>{range(estimate.latitude_range)}</dd></dl><p>{estimate.uncertainty_note}</p></section>;
}
