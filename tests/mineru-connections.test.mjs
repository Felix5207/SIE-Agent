import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sie-mineru-connections-'));
process.env.SIE_DATA_DIR=temp;process.env.PI_MODELS_PATH=path.join(temp,'missing.json');
const {db,PYTHON,createProject,getProject}=await import('../server/core.mjs');
const {extractWithMineru,parserFingerprint,testMineru}=await import('../server/mineru-client.mjs');
const {addFile,parseProject}=await import('../server/documents.mjs');
const {readerDocument}=await import('../server/reader.mjs');
const archive=path.join(temp,'fixture.zip');
execFileSync(PYTHON,['-c',`import sys,json,zipfile
with zipfile.ZipFile(sys.argv[1],'w') as z:
 z.writestr('content_list.json',json.dumps([{'type':'text','text':'There were 42 samples.','page_idx':0,'bbox':[100,100,600,200]}]))
 z.writestr('layout.json',json.dumps({'pdf_info':[{'page_idx':0,'page_size':[300,180]}]}))
 z.writestr('full.md','There were 42 samples.')
`,archive]);
const zip=fs.readFileSync(archive),requests=[];let cloudState='done',authFailure=false,batch=0;
const server=http.createServer(async(req,res)=>{
 const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);
 requests.push({url:req.url,method:req.method,auth:req.headers.authorization,body});
 const json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
 if(req.url.startsWith('/api/v4')&&authFailure){res.statusCode=401;json({msg:'secret must never appear in errors'});return;}
 if(req.url==='/api/v4/file-urls/batch'){batch++;json({code:0,data:{batch_id:'batch-'+batch,file_urls:[base+'/upload?signature=signed-url']}});}
 else if(req.url.startsWith('/upload')){res.end();}
 else if(req.url.startsWith('/api/v4/extract-results/batch/'))json({code:0,data:{extract_result:[{file_name:'paper.pdf',state:cloudState,full_zip_url:base+'/result.zip?signature=download-secret'}]}});
 else if(req.url==='/tasks'&&req.method==='POST')json({task_id:'self-task'});
 else if(req.url==='/tasks/self-task')json({status:'completed'});
 else if(req.url==='/tasks/self-task/result'||req.url.startsWith('/result.zip')){res.setHeader('Content-Type','application/zip');res.end(zip);}
 else{res.statusCode=404;json({error:'missing'});}
});server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
const config={id:'cloud',name:'Cloud',kind:'cloud',base_url:base,api_key:'mineru-secret',model_version:'vlm',language:'en'};
const input=path.join(temp,'paper.pdf');fs.writeFileSync(input,'%PDF-1.4 mock input');
const fixture=()=>({id:'file1',name:'paper.pdf',path:input,ext:'.pdf'});
function folder(){return fs.mkdtempSync(path.join(temp,'run-'));}
test('official cloud API uploads bytes, polls and downloads ZIP without forwarding its token to storage',async()=>{
 let checkpoint;const output=await extractWithMineru(fixture(),folder(),config,new AbortController().signal,{checkpoint:t=>checkpoint=t,pollMs:1});
 assert.equal(checkpoint.kind,'cloud');assert.equal(checkpoint.fingerprint,parserFingerprint(config));
 assert.ok(fs.existsSync(path.join(output,'content_list.json')));
 assert.equal(requests.find(r=>r.url==='/api/v4/file-urls/batch').auth,'Bearer mineru-secret');
 assert.equal(requests.find(r=>r.url.startsWith('/upload')).auth,undefined);
 assert.equal(requests.find(r=>r.url.startsWith('/result.zip')).auth,undefined);
 const payload=JSON.parse(requests.find(r=>r.url==='/api/v4/file-urls/batch').body);assert.equal(payload.model_version,'vlm');assert.equal(payload.language,'en');
});
test('completed cloud job resumes only for the same endpoint and credential',async()=>{
 const before=batch,file={...fixture(),parse_connection:{fingerprint:parserFingerprint(config),task_id:'known-batch',kind:'cloud'}};
 await extractWithMineru(file,folder(),config,new AbortController().signal,{pollMs:1});assert.equal(batch,before);
 await extractWithMineru(file,folder(),{...config,api_key:'another-account'},new AbortController().signal,{pollMs:1});assert.equal(batch,before+1);
});
test('cloud result names feed the full parse and evidence reader; already parsed files are reused',async()=>{
 const p=createProject('Cloud parser');const f=await addFile(p.id,input,'study.pdf');
 await parseProject(p.id,new AbortController().signal,[f.id],config);
 const parsed=getProject(p.id);assert.equal(parsed.files[0].status,'parsed');assert.equal(parsed.blocks[0].text,'There were 42 samples.');assert.deepEqual(parsed.blocks[0].page_size,[300,180]);assert.equal(parsed.blocks[0].parse_version,'mineru-cloud-v4');
 assert.equal(readerDocument(parsed,f.id).blocks[0].text,'There were 42 samples.');
 const before=batch;await parseProject(p.id,new AbortController().signal,[f.id],{...config,api_key:'changed'});assert.equal(batch,before);
 assert.ok(!JSON.stringify(parsed).includes(config.api_key));assert.ok(!JSON.stringify(parsed).includes('signed-url'));
});
test('self-hosted API supports authentication and configured model URL',async()=>{
 const c={...config,kind:'self-hosted',backend:'vlm-http-client',model_url:'http://model.internal:9000'};
 await extractWithMineru(fixture(),folder(),c,new AbortController().signal,{pollMs:1});
 const submission=requests.find(r=>r.url==='/tasks');assert.equal(submission.auth,'Bearer mineru-secret');assert.ok(submission.body.toString().includes(c.model_url));
 const before=requests.filter(r=>r.url==='/tasks').length;
 await extractWithMineru({...fixture(),parse_connection:{fingerprint:parserFingerprint(c),task_id:'self-task'}},folder(),c,new AbortController().signal,{pollMs:1});assert.equal(requests.filter(r=>r.url==='/tasks').length,before);
});
test('authentication failures do not leak upstream messages or trigger unbounded submissions',async()=>{
 authFailure=true;const before=batch;
 try{await assert.rejects(()=>extractWithMineru(fixture(),folder(),config,new AbortController().signal),/HTTP 401/);assert.equal(batch,before);}finally{authFailure=false;}
});
test('failed cloud jobs clear checkpoint so an explicit retry can submit a new job',async()=>{
 cloudState='failed';let checkpoint;
 try{await assert.rejects(()=>extractWithMineru(fixture(),folder(),config,new AbortController().signal,{checkpoint:c=>checkpoint=c,pollMs:1}),/解析失败/);assert.equal(checkpoint,null);}finally{cloudState='done';}
});
test('poll cancellation keeps uploaded job metadata for resume',async()=>{
 cloudState='pending';const controller=new AbortController();let checkpoint;
 try{await assert.rejects(()=>extractWithMineru(fixture(),folder(),config,controller.signal,{checkpoint:c=>{checkpoint=c;controller.abort(new Error('stop'));},pollMs:1}),/stop/);assert.ok(checkpoint.task_id);}finally{cloudState='done';}
});
test('explicit parser test uses a synthetic PDF and checks the resulting evidence format',async()=>{assert.equal((await testMineru(config)).ok,true);const upload=requests.filter(r=>r.url.startsWith('/upload')).at(-1);assert.ok(upload.body.toString().includes('SIE connection test.'));});
test.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));db.close();fs.rmSync(temp,{recursive:true,force:true});});
