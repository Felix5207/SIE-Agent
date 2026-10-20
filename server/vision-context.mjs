// Keep full image evidence on disk; bound only the outgoing model request.
export function limitVisionContext(messages,limit=4){
  let remaining=limit;const seen=new Set();
  return messages.toReversed().map(m=>{
    if(!Array.isArray(m.content))return m;
    const content=m.content.toReversed().map(c=>{
      if(c.type!=='image')return c;
      if(remaining>0&&!seen.has(c.data)){remaining--;seen.add(c.data);return c;}
      return {type:'text',text:'此处历史图像像素未随本次请求发送；原始图像和证据记录仍保留。需要再次判断图中内容时重新 read_visual。'};
    }).toReversed();
    return {...m,content};
  }).toReversed();
}
