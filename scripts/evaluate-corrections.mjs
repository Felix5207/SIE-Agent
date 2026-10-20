import fs from 'node:fs';
import {evaluateCorrectionCases} from '../shared/correction-evaluation.mjs';
const [casesFile,resultFile]=process.argv.slice(2);
if(!casesFile||!resultFile){console.error('用法：node scripts/evaluate-corrections.mjs 纠错样例.json 本轮项目结果.json');process.exit(2);}
const input=JSON.parse(fs.readFileSync(casesFile,'utf8')),project=JSON.parse(fs.readFileSync(resultFile,'utf8'));
const report=evaluateCorrectionCases(input.cases||[],project);
console.log(JSON.stringify(report,null,2));
if(!report.total||report.rows.some(r=>!r.matched||!r.evidence_valid))process.exitCode=1;
