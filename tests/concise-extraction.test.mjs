import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.SIE_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'sie-concise-'));
const {normalizeColumn,updateColumn}=await import('../server/extraction.mjs');
const {duplicateColumn,saveColumnPreset,listColumnPresets}=await import('../server/columns.mjs');
const {runtimeColumn}=await import('../server/column-contract.mjs');
const {composeSystem}=await import('../server/prompts.mjs');
const {db}=await import('../server/core.mjs');
test('name-only columns support omitted, blank and whitespace instructions',()=>{
 for(const input of [{name:'微塑料丰度'},{name:'采样深度',instructions:''},{name:'采样时间',instructions:'   '}]){
  const f=normalizeColumn(input);assert.equal(f.instructions,'');assert.equal(f.type,'text');assert.equal(runtimeColumn(f).instructions,'');
 }
 assert.throws(()=>normalizeColumn({name:'',instructions:''}),/列名/);
 assert.throws(()=>normalizeColumn({name:'丰度',instructions:'x'.repeat(4001)}),/4000/);
});
test('clearing instructions removes old generated scope and preserves the old answer in history',()=>{
 const f=normalizeColumn({name:'丰度',instructions:'列出所有形态'});
 const p={fields:[f],records:[{id:'r',label:'Paper',cells:{丰度:{value:'old',evidence_ids:['b']}}}],history:[]};
 const next=updateColumn(p,{...f,instructions:''},f.id);
 assert.equal(next.instructions,'');assert.ok(!next.description.includes('列出所有形态'));
 assert.equal(p.history[0].before.value,'old');assert.equal(p.records[0].cells.丰度.needs_extraction,true);
});
test('duplicate and saved preset keep deliberately empty instructions',()=>{
 const f=normalizeColumn({name:'丰度',instructions:''}),p={fields:[f],records:[],history:[]};
 assert.equal(duplicateColumn(p,f.id).instructions,'');
 const preset=saveColumnPreset(f);assert.equal(preset.instructions,'');
 assert.equal(listColumnPresets().find(x=>x.id===preset.id).instructions,'');
});
test('runtime preserves explicit detailed requests but discards stale answer-format boilerplate',()=>{
 const legacy={name:'丰度',type:'text',instructions:'',description:'逐项列出全部相关数据'};
 const empty=runtimeColumn(legacy);assert.equal(empty.instructions,'');assert.equal(empty.description,undefined);
 const detailed=runtimeColumn({...legacy,instructions:'逐项提取所有形态的数值、SD、SE 和样本量。'});
 assert.equal(detailed.instructions,'逐项提取所有形态的数值、SD、SE 和样本量。');
 const old=runtimeColumn({name:'丰度',description:'保留原单位\n答案格式：逐项列出全部相关数据'});
 assert.equal(old.instructions,'保留原单位');
 const prompt=composeSystem({start:{fields:[legacy],granularity:'paper',instructions:''},scopeFiles:new Set(['paper']),mode:'extract',protocol:null});
 assert.ok(!prompt.includes('逐项列出全部相关数据'));
 assert.ok(prompt.includes('默认简洁规则不能删除用户要求的细节'));
});
test.after(()=>{db.close();fs.rmSync(process.env.SIE_DATA_DIR,{recursive:true,force:true});});
