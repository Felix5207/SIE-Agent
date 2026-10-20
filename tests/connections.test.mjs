import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sie-connections-'));
process.env.SIE_DATA_DIR=temp;process.env.PI_MODELS_PATH=path.join(temp,'absent-models.json');
delete process.env.QWEN_BASE_URL;
delete process.env.MINERU_URL;delete process.env.MINERU_MODEL_URL;
const {db}=await import('../server/core.mjs');
const {readConnections,connectionView,saveConnection,selectConnections,deleteConnection,selectedConnections,connectionSnapshot,redactError}=await import('../server/connections.mjs');
const {registerConnectionRoutes}=await import('../server/connection-routes.mjs');
const app=express();app.use(express.json());registerConnectionRoutes(app);app.use((e,req,res,next)=>res.status(e.status||400).json({error:e.message}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
const payload={name:'Test API',base_url:'https://api.example.org/v1',api:'openai-completions',model:'custom-vision',vision:true,api_key:'literal-secret-token'};
test('new installations can start without the old local provider file',()=>{assert.equal(readConnections().models.length,0);assert.equal(connectionView().active_model_id,null);assert.equal(readConnections().mineru.length,0);assert.equal(connectionView().active_mineru_id,null);});
test('credentials stay server-side, file is private, updates preserve/replace/clear keys',()=>{
 const saved=saveConnection('models',payload),id=saved.connection.id;
 assert.equal(saved.connection.has_api_key,true);assert.ok(!JSON.stringify(saved).includes(payload.api_key));
 assert.equal(fs.statSync(path.join(temp,'connections.json')).mode&0o777,0o600);
 const v2=saveConnection('models',{...saved.connection,name:'Renamed',api_key:''},id);
 assert.equal(selectedConnections().model.api_key,payload.api_key);assert.equal(v2.connection.version,2);
 assert.throws(()=>saveConnection('models',{...saved.connection,name:'stale'},id),/已更新/);
 saveConnection('models',{...v2.connection,api_key:'replacement-key'},id);assert.equal(selectedConnections().model.api_key,'replacement-key');
 saveConnection('models',{clear_api_key:true},id);assert.equal(selectedConnections().model.api_key,'');
});
test('changing endpoint origin cannot accidentally reuse a stored credential',()=>{
 const saved=saveConnection('models',payload);
 assert.throws(()=>saveConnection('models',{base_url:'https://elsewhere.example/v1'},saved.connection.id),/重新填写密钥/);
 assert.throws(()=>saveConnection('models',{...payload,base_url:'https://user:password@example.org/v1'}),/账号/);
 assert.throws(()=>saveConnection('models',{...payload,base_url:'file:///tmp/config'}),/地址/);
});
test('selection snapshots remain stable while settings change and omit secrets',()=>{
 const a=saveConnection('models',{...payload,model:'model-a'}).connection,b=saveConnection('models',{...payload,model:'model-b'}).connection;
 selectConnections({active_model_id:a.id});const snapshot=selectedConnections();
 selectConnections({active_model_id:b.id});saveConnection('models',{model:'model-a-updated'},a.id);
 assert.equal(snapshot.model.model,'model-a');assert.equal(selectedConnections().model.model,'model-b');
 assert.ok(!JSON.stringify(connectionSnapshot(snapshot)).includes(payload.api_key));
 assert.throws(()=>deleteConnection('models',b.id),/先切换/);deleteConnection('models',a.id);
});
test('MinerU cloud configuration needs a token; model service URL is only required for HTTP backend',()=>{
 assert.throws(()=>saveConnection('mineru',{name:'Cloud',kind:'cloud',base_url:'https://mineru.net'}),/Token/);
 const c=saveConnection('mineru',{name:'Cloud',kind:'cloud',base_url:'https://mineru.net',api_key:'mineru-secret'}).connection;
 assert.equal(c.has_api_key,true);assert.equal(c.model_url,'');
 const local=saveConnection('mineru',{name:'Pipeline',kind:'self-hosted',base_url:'http://localhost:8001',backend:'pipeline'}).connection;assert.equal(local.backend,'pipeline');
});
test('public endpoints never return keys; invalid selection is rejected without a mutation',async()=>{
 const response=await fetch(base+'/api/connections');assert.equal(response.status,200);const text=await response.text();assert.ok(!text.includes('literal-secret-token'));assert.ok(!text.includes('mineru-secret'));
 const before=readConnections().active_model_id;
 const bad=await fetch(base+'/api/connections/active',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({active_model_id:'missing'})});assert.equal(bad.status,400);assert.equal(readConnections().active_model_id,before);
});
test('provider errors redact literal API keys and bearer credentials',()=>{const msg=redactError(new Error('failed literal-secret-token Bearer other-token'),[{api_key:'literal-secret-token'}]);assert.ok(!msg.includes('literal-secret-token'));assert.ok(!msg.includes('other-token'));});
test.after(async()=>{await new Promise(r=>server.close(r));db.close();fs.rmSync(temp,{recursive:true,force:true});});
