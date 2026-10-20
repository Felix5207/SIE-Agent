import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareArguments,toolOperation} from '../server/tool-arguments.mjs';
const schema={type:'object',properties:{cells:{type:'array',items:{type:'object',properties:{value:{type:'string'},evidence_ids:{type:'array',items:{type:'string'}}}}}}};
test('serialized array arguments decode without modifying answer values or caller input',()=>{
 const args={cells:JSON.stringify([{value:'[2024, 0]',evidence_ids:'["b"]'}])};
 const result=prepareArguments(args,schema);
 assert.deepEqual(result,{cells:[{value:'[2024, 0]',evidence_ids:['b']}]});assert.equal(typeof args.cells,'string');
});
test('only a redundant tool closing brace after a complete array is recoverable',()=>{
 assert.deepEqual(prepareArguments({cells:'[{"value":"12"}]}'},schema).cells,[{value:'12'}]);
 for(const cells of ['[{"value":"12"}','[] extra','[] {}','[1] trailing}'])assert.equal(prepareArguments({cells},schema).cells,cells);
});
test('operation reporting cannot crash on malformed model arguments',()=>{
 for(const args of [{cells:'[]'}, {updates:{}}, {cells:[null,1]},null])assert.deepEqual(toolOperation('add_paper',args),{tool:'add_paper',cells:[],file_id:null});
 assert.deepEqual(toolOperation('revise_cells',{updates:[{record_id:'r',field:'a'}]}).cells,[{record_id:'r',field:'a'}]);
});
