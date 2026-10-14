import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const publicRoot=path.join(root,'apps/classic-reader/public');
const corpusRoot=path.resolve(root,'../narcissu-kana-research');
const base='http://127.0.0.1:4176';
const output=path.join(root,'reports/verification/content-repair-20261013/build/http.json');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const localPath=url=>{
  assert.match(url,/^\//);const full=path.resolve(publicRoot,'.'+url);
  assert.ok(full.startsWith(publicRoot+path.sep));return full;
};
const records=[],failures=[];
async function check(url,assertion,options={}) {
  const started=Date.now();
  try {
    assert.ok(url.startsWith('/')&&!url.startsWith('//'));
    const response=await fetch(base+url,{...options,signal:AbortSignal.timeout(120000),cache:'no-store'});
    const bytes=Buffer.from(await response.arrayBuffer());
    await assertion(response,bytes);
    records.push({url,status:response.status,bytes:bytes.length,sha256:sha(bytes),elapsedMs:Date.now()-started});
    return bytes;
  } catch(error) {failures.push({url,error:String(error),elapsedMs:Date.now()-started});return null;}
}
const matchesLocal=(url)=>async(response,bytes)=>{
  assert.equal(response.status,200);assert.ok(bytes.equals(await fs.readFile(localPath(url))),'HTTP bytes differ from published file');
};
const localBundle=JSON.parse(await fs.readFile(localPath('/data/legacy-vn/manifest.json'),'utf8'));
const localIndex=JSON.parse(await fs.readFile(localPath('/story_index.json'),'utf8'));
const search=JSON.parse(await fs.readFile(localPath('/search_index_manifest.generic.json'),'utf8'));
await check('/apps/web/',(response,bytes)=>{assert.equal(response.status,200);assert.match(bytes.toString('utf8'),/<html[\s>]/);});
for(const url of ['/story_index.json','/apps/web/story_index.json','/data/legacy-vn/manifest.json','/data/story_ids.generated.json','/search_index_manifest.generic.json'])await check(url,matchesLocal(url));
const queue=[...new Set([
  ...localIndex.flatMap(item=>[item.path_cn,item.path_jp].filter(Boolean).map(p=>'/'+p.replace(/^\//,''))),
  ...localBundle.entries.flatMap(item=>[item.routePath,'/data/legacy-vn/'+item.canonicalStoryId+'.edit-source.json',
    ...(item.corpusId==='narcissu3'?['/data/legacy-vn/'+item.canonicalStoryId+'.alignment.json']:[])]),
  ...Object.values(localBundle.sourceManifests),
  ...search.chunks.map((_,i)=>'/search-chunks/generic/'+search.sha256+'/'+String(i).padStart(4,'0')+'.part'),
])];
let cursor=0;
await Promise.all(Array.from({length:6},async()=>{while(cursor<queue.length){const url=queue[cursor++];await check(url,matchesLocal(url));}}));
for(const id of ['legacy-narcissu-3rd-product','legacy-narcissu-himeko-omake_062','legacy-narcissu-3rd-nar3_07']){
  assert.ok(localIndex.some(item=>item.id===id));
  await check('/reader/'+id,(response,bytes)=>{assert.equal(response.status,200);assert.match(bytes.toString('utf8'),/<html[\s>]/);});
}
const sampled=new Set();
for(const entry of localBundle.entries){
  if(sampled.has(entry.corpusId))continue;
  const route=JSON.parse(await fs.readFile(localPath(entry.routePath),'utf8'));
  const cue=route.variantRoutes.flatMap(v=>v.sections.flatMap(s=>s.events.flatMap(e=>e.cues??[]))).find(c=>c.kind==='voice');
  const media=route.media.find(m=>m.mediaId===cue?.mediaId);
  if(!media)continue;
  const relative=decodeURIComponent(media.url.slice('/corpus/'.length));
  const filename=path.resolve(corpusRoot,relative);
  assert.ok(media.url.startsWith('/corpus/')&&filename.startsWith(corpusRoot+path.sep));
  const original=await fs.readFile(filename),length=Math.min(4096,original.length);
  await check(media.url,(response,bytes)=>{
    assert.equal(response.status,206);assert.equal(bytes.length,length);
    assert.equal(response.headers.get('content-range'),'bytes 0-'+(length-1)+'/'+original.length);
    assert.ok(bytes.equals(original.subarray(0,length)));
  },{headers:{Range:'bytes=0-'+(length-1)}});
  sampled.add(entry.corpusId);
}
const progress=await check('/api/proofreading/machine-status',(response,bytes)=>{
  assert.equal(response.status,200);
  const data=JSON.parse(bytes);
  assert.equal(data.sourceRevision,localBundle.revision);
  assert.equal(data.total,localIndex.length);
  assert.equal(data.humanVerified,null);
});
const report={schema:'content-repair-http-verification/v1',result:failures.length?'FAIL':'PASS',
  timestamp:new Date().toISOString(),base,revision:localBundle.revision,
  browserValidation:false,hydrationValidation:false,audiblePlaybackValidation:false,
  note:'Read-only HTTP bytes, native media range responses and server progress; this is not a browser or hearing acceptance.',
  counts:{requests:records.length+failures.length,passed:records.length,failed:failures.length,
    publishedStories:localIndex.length,storyTextFiles:localIndex.reduce((n,s)=>n+1+Number(Boolean(s.path_cn)),0),
    mediaCorporaSampled:sampled.size},progress:progress?JSON.parse(progress):null,records,failures};
await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,progress:undefined,records:undefined},null,2));
if(failures.length)process.exitCode=1;
