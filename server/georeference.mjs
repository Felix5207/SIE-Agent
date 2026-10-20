import fs from 'node:fs';
const places=JSON.parse(fs.readFileSync(new URL('../resources/places.json',import.meta.url),'utf8'));
const byId=new Map(places.map(p=>[p.id,p]));
const key=s=>s.normalize('NFKC').toLowerCase().trim();
export function findPlaces(query,country='') {
  const q=key(query);
  return places.filter(p=>(!country||p.country===country.toUpperCase())&&[p.name,p.ascii,...p.aliases].some(n=>key(n).includes(q)))
    .sort((a,b)=>Number(key(b.name)===q)-Number(key(a.name)===q)||b.population-a.population).slice(0,8)
    .map(({aliases,...p})=>({...p,source:`https://www.geonames.org/${p.id}/`,datum:'WGS84',dataset:'GeoNames cities15000, 2026-09-16'}));
}
function solve(matrix,vector) {
  const a=matrix.map((r,i)=>[...r,vector[i]]);
  for(let k=0;k<3;k++){
    let pivot=k;for(let i=k+1;i<3;i++)if(Math.abs(a[i][k])>Math.abs(a[pivot][k]))pivot=i;
    [a[k],a[pivot]]=[a[pivot],a[k]];
    if(Math.abs(a[k][k])<1e-9)throw new Error('参照点接近共线，无法配准；选择分散在地图不同方向的城市');
    const d=a[k][k];for(let j=k;j<4;j++)a[k][j]/=d;
    for(let i=0;i<3;i++)if(i!==k){const f=a[i][k];for(let j=k;j<4;j++)a[i][j]-=f*a[k][j];}
  }
  return a.map(r=>r[3]);
}
const merc=lat=>Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))*180/Math.PI;
const inv=y=>(2*Math.atan(Math.exp(y*Math.PI/180))-Math.PI/2)*180/Math.PI;
export function fitCoordinates(anchors,point) {
  if(anchors.length<3||anchors.length>8)throw new Error('需 3–8 个分散的参照点，建议至少4个');
  const all=[point,...anchors.map(a=>a.image_point)];
  if(all.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||v<0||v>1000)))throw new Error('图像坐标须在0–1000范围');
  if(anchors.some(a=>!Number.isFinite(a.latitude)||Math.abs(a.latitude)>80||!Number.isFinite(a.longitude)||Math.abs(a.longitude)>180))throw new Error('此配准支持纬度 ±80° 以内的区域地图');
  if(Math.max(...anchors.map(a=>a.longitude))-Math.min(...anchors.map(a=>a.longitude))>180)throw new Error('跨日期变更线地图暂不支持此配准');
  const rows=anchors.map(a=>[1,a.image_point[0]/1000,a.image_point[1]/1000]);
  const matrix=Array.from({length:3},(_,i)=>Array.from({length:3},(_,j)=>rows.reduce((s,r)=>s+r[i]*r[j],0)));
  const fit=values=>solve(matrix,[0,1,2].map(i=>rows.reduce((s,r,k)=>s+r[i]*values[k],0)));
  const east=fit(anchors.map(a=>a.longitude)),north=fit(anchors.map(a=>merc(a.latitude)));
  const at=(c,p)=>c[0]+c[1]*p[0]/1000+c[2]*p[1]/1000;
  const longitude=at(east,point),latitude=inv(at(north,point));
  if(!Number.isFinite(longitude)||Math.abs(longitude)>180||!Number.isFinite(latitude)||Math.abs(latitude)>80)throw new Error('换算结果异常，请检查参照点');
  const latResidual=Math.max(...anchors.map(a=>Math.abs(inv(at(north,a.image_point))-a.latitude)));
  const lonResidual=Math.max(...anchors.map(a=>Math.abs(at(east,a.image_point)-a.longitude)));
  const outside_control_bbox=[0,1].some(i=>point[i]<Math.min(...anchors.map(a=>a.image_point[i]))||point[i]>Math.max(...anchors.map(a=>a.image_point[i])));
  const latitude_error=Math.max(.3,latResidual*2)*(outside_control_bbox?2:1),longitude_error=Math.max(.5,lonResidual*2)*(outside_control_bbox?2:1);
  return {latitude,longitude,latitude_range:[Math.max(-90,latitude-latitude_error),Math.min(90,latitude+latitude_error)],longitude_range:[Math.max(-180,longitude-longitude_error),Math.min(180,longitude+longitude_error)],max_control_residual_degrees:{latitude:latResidual,longitude:lonResidual},outside_control_bbox,model:'Affine fit in spherical Mercator; approximate local map projection',uncertainty_note:'范围采用参照点最大拟合偏差的两倍，并至少保留纬度±0.3°、经度±0.5°；位于参照框外时加倍。这是粗略工程容差，不是经验证精度或统计置信区间，投影、地名标签偏移和读图误差仍需复核。'};
}
export function calibratePlaces(controls,point) {
  if(new Set(controls.map(c=>c.place_id)).size!==controls.length)throw new Error('城市参照点重复');
  const anchors=controls.map(c=>{
    const place=byId.get(c.place_id);if(!place)throw new Error('请先查询本地地名库，使用真实 place_id');
    const {aliases,...p}=place;return {...p,image_point:c.image_point,source:`https://www.geonames.org/${p.id}/`};
  });
  return {...fitCoordinates(anchors,point),anchors};
}

export function calibrationBasis(c) {
  return `实际读取原图后，以 ${c.anchors.map(a=>a.name).join('、')} 的图像位置及 GeoNames WGS84 城市坐标作为参照，在球面墨卡托空间进行局部仿射近似换算。目标图像位置 [${c.image_point.join(', ')}]/1000；程序计算纬度 ${c.latitude.toFixed(2)}°、经度 ${c.longitude.toFixed(2)}°。参照点最大拟合残差：纬度 ${c.max_control_residual_degrees.latitude.toFixed(3)}°、经度 ${c.max_control_residual_degrees.longitude.toFixed(3)}°。残差不是独立验证精度；代表点由读图选择，未计算全部站点的质心或密度中心。`;
}
