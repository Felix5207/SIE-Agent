// A pending value is not necessarily a running job.
export function pendingAnswerState(project={}) {
  if(['extracting','correcting'].includes(project.status))return {label:'正在提取',running:true};
  if(['queued','parsing'].includes(project.status))return {label:'等待提取',running:true};
  if(project.status==='cancelled')return {label:'已停止 · 待重新提取',running:false};
  if(project.status==='interrupted')return {label:'已中断 · 待重新提取',running:false};
  if(project.status==='error')return {label:'提取失败 · 待重试',running:false};
  if(project.runs?.at(-1)?.review_outcome==='needs_clarification')return {label:'需要处理 · 查看任务说明',running:false};
  return {label:'待提取',running:false};
}
