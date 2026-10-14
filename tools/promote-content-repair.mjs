import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { computeContentPipelineRevision } from './lib/content-pipeline-revision.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const reportRoot=path.join(root,'reports/verification/content-repair-20261013');
const option = key => {
  const index=process.argv.indexOf(key);
  if(index<0)return undefined;
  if(!process.argv[index+1]||process.argv[index+1].startsWith('--'))throw Error('Missing option '+key);
  return process.argv[index+1];
};
const candidate=path.resolve(option('--candidate')??path.join(reportRoot,'candidate-public'));
const verification=path.resolve(option('--verification')??path.join(reportRoot,'build/candidate-verification.json'));
const receiptPath=path.resolve(option('--receipt')??path.join(reportRoot,'build/promotion.json'));
const backupRoot=option('--backup')?path.resolve(option('--backup')):null;
for(const value of [candidate,verification,receiptPath,...(backupRoot?[backupRoot]:[])])
  if(!value.startsWith(path.join(root,'reports')+path.sep))throw Error('Promotion evidence and candidate must stay inside this checkout reports directory');
const target=path.join(root,'apps/classic-reader/public');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const gate=JSON.parse(await fs.readFile(verification,'utf8'));
const bundle=JSON.parse(await fs.readFile(path.join(candidate,'data/legacy-vn/manifest.json'),'utf8'));
if(gate.result!=='PASS'||gate.failures.length||gate.paths.storyIndex!==path.join(candidate,'story_index.json')
  ||gate.revision!==bundle.revision||bundle.sourcePipelineRevision!==await computeContentPipelineRevision(root))
  throw Error('Candidate must pass verification against the current generators before promotion');
const registryName='native-reader-revisions.json';
const registry=await fs.readFile(path.join(candidate,registryName));
const ensureRegistry=async()=>{if(!registry.equals(await fs.readFile(path.join(target,registryName))))throw Error('Native revision registry changed since candidate generation');};
await ensureRegistry();
const walk=async(dir,prefix='')=>{
  const output=[];
  for(const e of await fs.readdir(dir,{withFileTypes:true})){
    if(e.isSymbolicLink())throw Error('Candidate must not contain symlinks');
    const relative=prefix+e.name;
    if(e.isDirectory())output.push(...await walk(path.join(dir,e.name),relative+'/'));
    else if(e.isFile())output.push(relative);
    else throw Error('Unexpected candidate file type');
  }return output;
};
const files=await walk(candidate);
const allowed=relative=>relative===registryName
  ||['story_index.json','apps/web/story_index.json','data/story_ids.generated.json','search_index_manifest.generic.json'].includes(relative)
  ||/^data\/legacy-vn\/[a-z0-9-]+\/[a-z0-9_.%-]+$/u.test(relative)
  ||/^data\/legacy-vn\/manifest\.json$/u.test(relative)
  ||/^search-chunks\/generic\/[a-f0-9]{64}\/[0-9]{4}\.part$/u.test(relative)
  ||/^native-revisions\//u.test(relative);
if(files.some(file=>!allowed(file)))throw Error('Candidate contains an undeclared output');
const pointers=new Set(['data/legacy-vn/manifest.json','data/story_ids.generated.json','story_index.json','apps/web/story_index.json','search_index_manifest.generic.json']);
files.sort((a,b)=>Number(pointers.has(a))-Number(pointers.has(b))||a.localeCompare(b));
if(process.argv.includes('--check-only')){
  console.log(JSON.stringify({result:'PASS',candidate,target,files:files.length,revision:bundle.revision}));process.exit(0);
}
if(backupRoot){
  if(await fs.stat(backupRoot).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}))throw Error('Promotion baseline already exists');
  await fs.mkdir(backupRoot,{recursive:true});
}
const records=[];
for(const relative of files){
  const bytes=await fs.readFile(path.join(candidate,relative)),hash=sha(bytes),destination=path.join(target,relative);
  const before=await fs.readFile(destination).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(relative===registryName){if(!before?.equals(bytes))throw Error('Registry race');continue;}
  if(pointers.has(relative))await ensureRegistry();
  const changed=!before?.equals(bytes);
  if(changed){
    if(backupRoot&&before){
      const snapshot=path.join(backupRoot,relative);
      await fs.mkdir(path.dirname(snapshot),{recursive:true});
      await fs.writeFile(snapshot,before,{flag:'wx'});
    }
    const current=await fs.readFile(destination).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if((before===null)!==(current===null)||before&&!before.equals(current))throw Error('Target changed concurrently: '+relative);
    await fs.mkdir(path.dirname(destination),{recursive:true});
    const temporary=destination+'.content-repair-'+randomUUID()+'.tmp';
    await fs.writeFile(temporary,bytes,{flag:'wx'});
    try{await fs.rename(temporary,destination);}catch(error){await fs.unlink(temporary).catch(()=>{});throw error;}
  }
  if(sha(await fs.readFile(destination))!==hash)throw Error('Promoted hash differs: '+relative);
  records.push({path:relative,bytes:bytes.length,beforeSha256:before?sha(before):null,sha256:hash,changed});
}
await ensureRegistry();
const receipt={schema:'content-repair-promotion/v1',result:'PASS',timestamp:new Date().toISOString(),candidate,target,
 revision:bundle.revision,counts:bundle.counts,files:records.length,changed:records.filter(r=>r.changed).length,
 deletedFiles:0,nativeRevisionRegistryPreserved:true,records};
await fs.mkdir(path.dirname(receiptPath),{recursive:true});
await fs.writeFile(receiptPath,JSON.stringify({...receipt,backupRoot},null,2)+'\n');
console.log(JSON.stringify({...receipt,records:undefined},null,2));
