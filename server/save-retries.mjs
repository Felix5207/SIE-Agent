const saveTools=new Set(['add_paper','add_records','submit_records','save_answer_items','revise_cells','set_common_fields','save_coordinate_estimate']);
export function saveRetryGuard(limit=3) {
  let failures=0;
  return event=>{
    if(event.type!=='tool_execution_end'||!saveTools.has(event.toolName))return null;
    if(!event.isError){failures=0;return null;}
    if(++failures<limit)return null;
    const reason=(event.result?.content||[]).filter(c=>c.type==='text').map(c=>c.text).join(' ').slice(0,250);
    return `结果连续 ${limit} 次保存失败，已停止重复生成并保留解析进度。失败工具：${event.toolName}。${reason}`;
  };
}
