// A local, axis-aligned graticule: model identifies pixels and labelled ticks;
// arithmetic and readout uncertainty are calculated here, never guessed.
export function suggestedGridTicks(text,hints){
  const axes={longitude:[],latitude:[]};
  for(const match of String(text).matchAll(/(\d{1,3})\s*[°º]\s*(\d+(?:\.\d+)?)\s*['′’]\s*(?:(\d+(?:\.\d+)?)\s*["″”]\s*)?([NSEW])\b/gi)){
    const [,d,m,s,dir]=match,axis=/[EW]/i.test(dir)?'longitude':'latitude';
    if(Number(m)>=60||Number(s||0)>=60)continue;
    const value=(Number(d)+Number(m)/60+Number(s||0)/3600)*(/[SW]/i.test(dir)?-1:1);
    if(!axes[axis].some(v=>Math.abs(v-value)<1e-9))axes[axis].push(value);
  }
  const result={};
  for(const axis of ['longitude','latitude']){
    const values=axes[axis].sort((a,b)=>axis==='longitude'?a-b:b-a),lines=hints[axis==='longitude'?'vertical_lines':'horizontal_lines'];
    if(values.length<3||!lines||lines.length!==values.length+2)continue;
    const positions=lines.slice(1,-1),gaps=positions.slice(1).map((v,i)=>v-positions[i]);
    if(Math.max(...gaps)>Math.min(...gaps)*1.15)continue;
    const steps=values.slice(1).map((v,i)=>Math.abs(v-values[i]));
    if(Math.max(...steps)>Math.min(...steps)*1.01)continue;
    result[axis+'_ticks']=values.map((value,i)=>({position:positions[i],value}));
  }
  return result;
}
export function calibrateGrid({longitude_ticks,latitude_ticks,image_point,point_error=5}){
  if(!Array.isArray(image_point)||image_point.length!==2||image_point.some(v=>!Number.isFinite(v)||v<0||v>1000))throw new Error('目标点必须位于当前图片 0–1000 坐标内');
  if(!Number.isFinite(point_error)||point_error<2||point_error>100)throw new Error('读图位置误差须为 2–100（图片归一化单位）');
  const fit=(ticks,point,limit)=>{
    if(!Array.isArray(ticks)||ticks.length<2||ticks.length>8)throw new Error('每个轴需要 2–8 个实际可见的经纬网刻度');
    if(ticks.some(t=>!Number.isFinite(t.position)||t.position<0||t.position>1000||!Number.isFinite(t.value)||Math.abs(t.value)>limit))throw new Error('网格位置或经纬度数值无效；西经、南纬须为负数');
    const sorted=[...ticks].sort((a,b)=>a.position-b.position),span=sorted.at(-1).position-sorted[0].position;
    if(span<100||new Set(ticks.map(t=>t.position)).size!==ticks.length)throw new Error('请选相距至少图片宽/高 10% 的不同刻度');
    const values=ticks.map(t=>t.value),extent=Math.max(...values)-Math.min(...values);
    if(extent<=0||extent>15)throw new Error('线性经纬网估读仅适用于跨度不超过 15° 的局部地图；不能跨日期变更线');
    if(point<sorted[0].position||point>sorted.at(-1).position)throw new Error('目标点必须位于所选刻度之间，不允许外推');
    const px=ticks.reduce((s,t)=>s+t.position,0)/ticks.length,vy=values.reduce((s,v)=>s+v,0)/values.length;
    const slope=ticks.reduce((s,t)=>s+(t.position-px)*(t.value-vy),0)/ticks.reduce((s,t)=>s+(t.position-px)**2,0),intercept=vy-slope*px;
    const residual=Math.max(...ticks.map(t=>Math.abs(intercept+slope*t.position-t.value)));
    if(residual>extent*.02)throw new Error('网格刻度不一致或图像不是轴对齐地图，请核对读图位置与数值');
    const value=intercept+slope*point,error=Math.max(.0001,Math.abs(slope)*point_error*2+residual*2);
    return {value,range:[Math.max(-limit,value-error),Math.min(limit,value+error)],slope,intercept,residual};
  };
  const lon=fit(longitude_ticks,image_point[0],180),lat=fit(latitude_ticks,image_point[1],90);
  return {model:'axis_grid_linear',method:'axis_interpolation',image_point,longitude_ticks,latitude_ticks,point_error,longitude:lon.value,latitude:lat.value,longitude_range:lon.range,latitude_range:lat.range,uncertainty_note:`按图示经纬网线性内插；范围包含目标点与刻度各 ±${point_error}/1000 图片尺寸的位置读数容差，以及刻度拟合残差的两倍。这是读图容差，不是测量精度或统计置信区间；地图投影、原图绘制误差不包含在内。`};
}
export function gridBasis(c){return `原图经纬网内插；经度刻度 ${c.longitude_ticks.map(t=>`${t.position}/1000→${t.value}°`).join('，')}；纬度刻度 ${c.latitude_ticks.map(t=>`${t.position}/1000→${t.value}°`).join('，')}；目标图像点 [${c.image_point.join(', ')}]/1000。程序换算，不是原文明示坐标。`;}
