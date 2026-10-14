import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { finished } from 'node:stream/promises';
import { computeContentPipelineRevision } from './lib/content-pipeline-revision.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=path.join(root,'apps/classic-reader');
const out=path.join(root,'reports/verification/content-repair-20261013/build');
const bundle=JSON.parse(await fs.readFile(path.join(app,'public/data/legacy-vn/manifest.json'),'utf8'));
const promotion=JSON.parse(await fs.readFile(path.join(out,'promotion.json'),'utf8'));
if(promotion.result!=='PASS'||promotion.revision!==bundle.revision||bundle.sourcePipelineRevision!==await computeContentPipelineRevision(root))
  throw Error('Run final gates only after current content has been verified and promoted');
const appTests=['reader-character-ruler','reader-display-preferences','screen-effects','floating-geometry','viewport-filter',
  'legacy-vn-corpus','legacy-vn-voice-routing','legacy-vn-voice-routing-corpus'].map(name=>'lib/'+name+'.test.ts');
const gates=[
  {id:'source-check',cwd:root,args:['tools/check.mjs']},
  {id:'root-tests',cwd:root,args:['--test',...(await fs.readdir(path.join(root,'test'))).filter(name=>name.endsWith('.test.js')).sort().map(name=>'test/'+name)]},
  {id:'app-tests',cwd:app,args:['--experimental-strip-types','--test',...appTests]},
  {id:'typescript',cwd:app,args:['node_modules/typescript/bin/tsc','--noEmit','--incremental','false']},
  {id:'production-build',cwd:app,args:['node_modules/next/dist/bin/next','build','--webpack']},
];
const requested=process.argv.find(arg=>arg.startsWith('--only='))?.slice(7);
if(requested&&!gates.some(gate=>gate.id===requested))throw Error('Unknown gate');
const filename=path.join(out,'gates.json');
const previous=JSON.parse(await fs.readFile(filename,'utf8').catch(error=>{if(error.code==='ENOENT')return '{}';throw error;}));
const records=previous.revision===bundle.revision?(previous.records??[]):[];
for(const gate of gates.filter(gate=>!requested||gate.id===requested)){
  const started=new Date().toISOString(),start=Date.now();
  const previousGate=records.find(item=>item.id===gate.id);
  const attempt=previousGate?(previousGate.previousAttempts?.length??0)+2:1;
  const attemptSuffix=attempt===1?'':'.attempt-'+attempt;
  const stdoutPath=path.join(out,gate.id+attemptSuffix+'.stdout.log'),stderrPath=path.join(out,gate.id+attemptSuffix+'.stderr.log');
  const stdout=createWriteStream(stdoutPath),stderr=createWriteStream(stderrPath);
  const child=spawn(process.execPath,gate.args,{cwd:gate.cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(stdout);child.stderr.pipe(stderr);
  const exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  await Promise.all([finished(stdout),finished(stderr)]);
  const record={id:gate.id,command:[process.execPath,...gate.args],cwd:gate.cwd,started,elapsedMs:Date.now()-start,
    exitCode,result:exitCode===0?'PASS':'FAIL',stdoutPath,stderrPath};
  const oldIndex=records.findIndex(item=>item.id===gate.id);
  if(oldIndex>=0){const {previousAttempts=[],...previousRecord}=records[oldIndex];record.previousAttempts=[...previousAttempts,previousRecord];records.splice(oldIndex,1);}
  records.push(record);
  const report={schema:'content-repair-command-gates/v1',revision:bundle.revision,timestamp:new Date().toISOString(),
    result:records.some(item=>item.exitCode!==0)?'FAIL':records.length===gates.length?'PASS':'INCOMPLETE',records};
  await fs.writeFile(filename,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({id:gate.id,result:record.result,exitCode,elapsedMs:record.elapsedMs}));
}
if(records.some(record=>record.exitCode!==0))process.exitCode=1;
