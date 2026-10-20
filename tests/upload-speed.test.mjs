import test from 'node:test';
import assert from 'node:assert/strict';
import {alignSourceQuote} from '../shared/quote-alignment.mjs';
import {validateQuotes,ungroundedClaimNumbers} from '../shared/evidence.mjs';
import {incrementalFileIds} from '../server/extraction-scope.mjs';
import {saveRetryGuard} from '../server/save-retries.mjs';
const source='The upper crop zone accounted for 49 %. The lowest abundance was in the middle crop zone (20 %) (Fig. 2A).';
test('written ordinal site labels do not reject valid results or legitimize unsupported measured values',()=>{
 const blocks=[{id:'b',text:'The highest abundance was obtained at the first site (0.14 and 0.10 items/m³).'}];
 const check=text=>ungroundedClaimNumbers([{text,evidence_ids:['b']}],blocks);
 assert.deepEqual(check('site 1R: 0.14 items/m³'),[]);
 assert.deepEqual(check('site 1R: 1 items/m³')[0].numbers,[1]);
 assert.deepEqual(check('site 2R: 0.14 items/m³')[0].numbers,[2]);
 assert.deepEqual(check('station 1: 0.14 items/m³')[0].numbers,[1]);
});
test('omitted figure reference resolves to the exact original source instead of rejecting the full paper',()=>{
 const q='The upper crop zone accounted for 49 %. The lowest abundance was in the middle crop zone (20 %).';
 const aligned=alignSourceQuote(source,q);assert.equal(aligned,source);
 assert.equal(validateQuotes([{evidence_id:'b',text:q}],['b'],[{id:'b',text:source}])[0].text,source);
});
test('only formatting is resolved: modified numbers, words and scientific qualifiers fail',()=>{
 assert.equal(alignSourceQuote(source,source.replace('49','40')),null);
 assert.equal(alignSourceQuote(source,source.replace('lowest','highest')),null);
 assert.equal(alignSourceQuote('The difference was observed (p > 0.05).','The difference was observed.'),null);
 assert.equal(alignSourceQuote('The concentration was 12.5 mg/kg (Table 2).','The concentration was 125 mg/kg.'),null);
 assert.throws(()=>validateQuotes([{evidence_id:'b',text:source.replace('49','40')}],['b'],[{id:'b',text:source}]),/证据 b.*原文：/);
});
test('whitespace offsets restore exact source and ambiguous matches are rejected',()=>{
 const text='Prefix. The concentration\nwas 12.5 mg/kg (Table 2). Suffix.';
 assert.equal(alignSourceQuote(text,'The concentration was 12.5 mg/kg.'),'The concentration\nwas 12.5 mg/kg (Table 2).');
 assert.equal(alignSourceQuote(text+' '+text,'The concentration was 12.5 mg/kg.'),null);
 assert.equal(alignSourceQuote('The counts were 1 2 in the sample.','The counts were 12 in the sample.'),null);
});
test('incremental uploads search only new papers but include existing papers with pending columns',()=>{
 const p={files:[{id:'old',role:'document'},{id:'new',role:'document'}],blocks:[{id:'b',file_id:'old'}],records:[{source_file_ids:['old'],cells:{x:{value:1,evidence_ids:['b']}}}]};
 assert.deepEqual(incrementalFileIds(p,[{id:'new'}]),['new']);
 p.records[0].cells.x.needs_extraction=true;assert.deepEqual(incrementalFileIds(p,[{id:'new'}]),['new','old']);
 delete p.records[0].source_file_ids;assert.deepEqual(incrementalFileIds(p,[{id:'new'}]),['new','old']);
});
test('repeated save errors stop after three attempts; reads do not hide the loop and a successful save resets it',()=>{
 const guard=saveRetryGuard(),failure={type:'tool_execution_end',toolName:'add_paper',isError:true,result:{content:[{type:'text',text:'invalid quote'}]}};
 assert.equal(guard(failure),null);assert.equal(guard({type:'tool_execution_end',toolName:'read_evidence'}),null);assert.equal(guard(failure),null);assert.match(guard(failure),/连续 3 次.*invalid quote/);
 guard({...failure,isError:false});assert.equal(guard(failure),null);
});
