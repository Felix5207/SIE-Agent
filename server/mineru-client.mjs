import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {python} from './core.mjs';

export const parserFingerprint = c => crypto.createHash('sha256').update(JSON.stringify([c.kind,c.base_url,c.model_url,c.backend,c.model_version,c.language,c.api_key])).digest('hex');
const auth = c => c.api_key ? {Authorization:`Bearer ${c.api_key}`} : {};
const cloudBase = c => c.base_url.replace(/\/api\/v4$/,'')+'/api/v4';
async function request(url,options,signal,stage,timeout=60000) {
  let res;
  try { res=await fetch(url,{redirect:'error',...options,signal:AbortSignal.any([signal,AbortSignal.timeout(timeout)])}); }
  catch(e) { signal.throwIfAborted(); throw new Error(`${stage}失败：${e.name==='TimeoutError'?'请求超时':'无法连接服务，请检查地址与网络'}`); }
  if (!res.ok) throw new Error(`${stage}失败（HTTP ${res.status}）${res.status===401||res.status===403?'，请检查 API Token 和权限':res.status===429?'，请求限流或额度不足':''}`);
  return res;
}
async function cloudJSON(c,route,options,signal) {
  const res=await request(cloudBase(c)+route,{...options,headers:{...auth(c),'Content-Type':'application/json'}},signal,'MinerU 云 API');
  const body=await res.json();
  if (body.code!==0) {
    const code=String(body.code || 'unknown').replace(/[^\w-]/g,'').slice(0,30);
    const messages={A0202:'Token 无效',A0211:'Token 已过期','-60018':'当天解析额度已用完','-10002':'请求参数无效'};
    throw new Error(`MinerU 云 API 返回 ${code}：${messages[code] || '请求未成功，请核对服务配置或稍后重试'}`);
  }
  return body.data;
}
function storageURL(value) {
  let url; try {url=new URL(value);} catch {throw new Error('MinerU 返回的文件地址无效');}
  if (!['http:','https:'].includes(url.protocol)||url.username||url.password) throw new Error('MinerU 返回的文件地址协议无效');
  return url.href;
}
async function download(res,destination) {
  const limit=500*1024*1024;
  if (Number(res.headers.get('content-length'))>limit) {await res.body.cancel();throw new Error('MinerU 结果超过 500 MB，请拆分文献');}
  const chunks=[];let size=0;
  for await (const chunk of res.body) {size+=chunk.length;if(size>limit)throw new Error('MinerU 结果超过 500 MB，请拆分文献');chunks.push(chunk);}
  fs.writeFileSync(destination,Buffer.concat(chunks));
}
export async function extractWithMineru(file,folder,connection,signal,{checkpoint=()=>{},pollMs=1500,timeoutMs=20*60*1000}={}) {
  if (!connection) throw new Error('请先在“API 配置”中选择 MinerU 服务');
  if (connection.kind==='cloud'&&!connection.api_key) throw new Error('请先填写 MinerU API Token');
  const fingerprint=parserFingerprint(connection);
  const task=file.parse_connection?.fingerprint===fingerprint?file.parse_connection:null;
  const deadline=AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]);
  let taskId=task?.task_id;
  try {
    if (connection.kind==='cloud') {
      if (!['.pdf','.png','.jpg','.jpeg','.webp','.bmp','.pptx'].includes(file.ext)) throw new Error('MinerU 云 API 暂不支持此图片格式，请转换为 PDF、PNG 或 JPG');
      if (!taskId) {
        const data=await cloudJSON(connection,'/file-urls/batch',{method:'POST',body:JSON.stringify({files:[{name:path.basename(file.name),data_id:file.id}],model_version:connection.model_version,language:connection.language,enable_formula:true,enable_table:true})},deadline);
        if (!data?.batch_id||!Array.isArray(data.file_urls)||data.file_urls.length!==1) throw new Error('MinerU 未返回有效上传地址');
        // Storage URLs are signed by MinerU. Never send the API bearer token to storage.
        await request(storageURL(data.file_urls[0]),{method:'PUT',body:fs.readFileSync(file.path)},deadline,'MinerU 文件上传',120000);
        taskId=data.batch_id;
        checkpoint({fingerprint,task_id:taskId,kind:'cloud'});
      }
      while (true) {
        deadline.throwIfAborted();
        const data=await cloudJSON(connection,'/extract-results/batch/'+encodeURIComponent(taskId),{},deadline);
        const results=data?.extract_result;
        const result=Array.isArray(results)?results.find(r=>r.data_id===file.id)|| (results.length===1?results[0]:null):null;
        if (result?.state==='failed') {checkpoint(null);throw new Error('MinerU 云端解析失败，请检查文件格式、页数和清晰度后重试');}
        if (result?.state==='done') {
          if (!result.full_zip_url) throw new Error('MinerU 完成解析但没有返回结果文件');
          const response=await request(storageURL(result.full_zip_url),{redirect:'follow'},deadline,'MinerU 结果下载',120000);
          await download(response,path.join(folder,'result.zip'));break;
        }
        await delay(pollMs,undefined,{signal:deadline});
      }
    } else {
      if (taskId) {
        // Only resume jobs from this exact endpoint/account/backend.
        const res=await fetch(`${connection.base_url}/tasks/${encodeURIComponent(taskId)}`,{headers:auth(connection),redirect:'error',signal:AbortSignal.any([deadline,AbortSignal.timeout(15000)])});
        if (res.status===404) taskId=null;
        else if (!res.ok) throw new Error(`MinerU 任务查询失败（HTTP ${res.status}）`);
        else if ((await res.json()).status==='failed') taskId=null;
      }
      if (!taskId) {
        const form=new FormData();form.append('files',new Blob([fs.readFileSync(file.path)]),path.basename(file.name));
        const values={backend:connection.backend,return_md:'true',return_middle_json:'true',return_content_list:'true',return_images:'true',response_format_zip:'true'};
        if(connection.backend==='vlm-http-client')values.server_url=connection.model_url;
        for(const [k,v] of Object.entries(values))form.append(k,v);
        const res=await request(connection.base_url+'/tasks',{method:'POST',headers:auth(connection),body:form},deadline,'MinerU 任务提交');
        taskId=(await res.json()).task_id;
        if(typeof taskId!=='string'||!taskId)throw new Error('MinerU 未返回 task_id；自建服务须支持 /tasks 异步接口');
        checkpoint({fingerprint,task_id:taskId,kind:'self-hosted'});
      }
      while(true) {
        const res=await request(`${connection.base_url}/tasks/${encodeURIComponent(taskId)}`,{headers:auth(connection)},deadline,'MinerU 任务查询',15000);
        const status=await res.json();
        if(status.status==='completed')break;
        if(status.status==='failed'){checkpoint(null);throw new Error('MinerU 自建服务解析失败，请检查解析服务日志');}
        await delay(pollMs,undefined,{signal:deadline});
      }
      const res=await request(`${connection.base_url}/tasks/${encodeURIComponent(taskId)}/result`,{headers:auth(connection)},deadline,'MinerU 结果下载',120000);
      await download(res,path.join(folder,'result.zip'));
    }
    const output=path.join(folder,'mineru');
    fs.rmSync(output,{recursive:true,force:true});fs.mkdirSync(output,{recursive:true});
    await python({op:'unpack',path:path.join(folder,'result.zip'),output});
    return output;
  } catch(e) {
    signal.throwIfAborted();
    if(deadline.aborted)throw new Error('MinerU 解析等待超时，已保存任务信息，可稍后继续');
    throw e;
  }
}
// A one-page synthetic document for an explicit connection test; no user paper.
function testPDF() {
  const stream='BT /F1 18 Tf 40 120 Td (SIE connection test.) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 180] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let out='%PDF-1.4\n';const offsets=[0];
  objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(out));out+=`${i+1} 0 obj\n${o}\nendobj\n`;});
  const xref=Buffer.byteLength(out);out+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}
export async function testMineru(connection) {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'sie-mineru-test-'));
  try {
    const file={id:'sie_test',ext:'.pdf',name:'sie-connection-test.pdf',path:path.join(folder,'test.pdf')};fs.writeFileSync(file.path,testPDF());
    const output=await extractWithMineru(file,folder,connection,AbortSignal.timeout(120000),{timeoutMs:115000});
    const files=allFiles(output);
    const listFile=files.find(isContentList);
    if(!listFile)throw new Error('解析接口可用，但结果缺少 content_list.json，不能提供 SIE 证据定位');
    const blocks=JSON.parse(fs.readFileSync(listFile,'utf8'));
    if(!Array.isArray(blocks)||!blocks.some(b=>b&&typeof b==='object'&&typeof b.type==='string'))throw new Error('解析结果未包含有效证据块，请检查 MinerU 输出格式');
    return {ok:true,message:'测试 PDF 已完成上传、解析和结果下载，证据格式可用。'};
  } finally {fs.rmSync(folder,{recursive:true,force:true});}
}
export function allFiles(folder) {return fs.readdirSync(folder,{withFileTypes:true}).flatMap(e=>e.isDirectory()?allFiles(path.join(folder,e.name)):[path.join(folder,e.name)]);}
export const isContentList = name => /(?:^|[/\\_])content_list\.json$/.test(name);
export const isLayout = name => /(?:^|[/\\_])middle\.json$/.test(name)||path.basename(name)==='layout.json';
