import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { classicApp, classicModules, ts } from '../test-support/classic-module-loader.js';
const root = path.resolve(classicApp, '../..');
const pub = process.env.ADV_CLASSIC_PUBLIC_ROOT ?? path.join(classicApp, 'public');
const read = p => fs.readFileSync(path.join(pub, p));
const stories = JSON.parse(read('story_index.json'));
const selectedAdapterStories = JSON.parse(read('data/legacy-vn/manifests/reader-adapter.json')).stories
  .filter(story => story.resource?.reader?.decision === 'include');
const categoryByGame = {
  'kana-okaeri': 'character_story', 'narcissu-3rd': 'event_story',
  'narcissu-himeko': 'main_story', 'narcissu-iris': 'main_story',
  'narcissu-one-two': 'main_story', 'narcissu-sumire': 'main_story', 'narcissu-zero': 'main_story',
};
const supplements=stories.filter(s=>s.source_format==='supplemental-text/v1');
const registry=JSON.parse(read('native-reader-revisions.json'));
const selectedWorkCounts = { main_story: 0, event_story: 0, character_story: 0, supplement_story:supplements.length };
for (const story of selectedAdapterStories) {
  assert.ok(categoryByGame[story.gameId], 'unmapped source game: ' + story.gameId);
  selectedWorkCounts[categoryByGame[story.gameId]] += 1;
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const modules = classicModules();
const manifest = () => JSON.parse(read('search_index_manifest.generic.json'));
const indexBytes = m => Buffer.concat(m.chunks.map((_, i) => read(`search-chunks/generic/${m.sha256}/${String(i).padStart(4, '0')}.part`)));
async function workerHarness(m, failure = false) {
  let listener; const messages = [], urls = [];
  const sandbox = { Uint8Array, Uint32Array, TextDecoder, TextEncoder, AbortController, DOMException, URL, crypto: webcrypto, setTimeout,
    self: { addEventListener(_name, fn) { listener = fn; }, postMessage(message) { messages.push(message); } },
    fetch: async (url, options) => { urls.push(url); assert.match(url, /^\/search-chunks\/generic\/[a-f0-9]{64}\/\d{4}\.part$/); if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (failure) return new Response('missing', { status: 404 });
      return new Response(read(url.slice(1))); },
  };
  vm.runInNewContext(fs.readFileSync(path.join(classicApp, 'public/search-worker.js'), 'utf8'), sandbox);
  const send = data => listener({ data });
  const wait = async predicate => { for(let i=0;i<1000;i++){ const found = messages.find(predicate); if(found) return JSON.parse(JSON.stringify(found)); await new Promise(r=>setTimeout(r,5)); } throw Error('Worker result timed out'); };
  send({ type: 'init', sources: [{ ...m, chunk_base_url: `/search-chunks/generic/${m.sha256}/` }] });
  return { send, wait, messages, urls };
}
test('generic search artifacts bind the current selected catalog, every CN/JP body and chunk digest', () => {
  const m = manifest(); assert.equal(m.story_index_sha256, sha(read('story_index.json')));
  const bytes = indexBytes(m); assert.equal(sha(bytes), m.sha256); assert.equal(bytes.length, m.bytes);
  for(let i=0;i<m.chunks.length;i++){const chunk=read(`search-chunks/generic/${m.sha256}/${String(i).padStart(4,'0')}.part`);assert.equal(sha(chunk),m.chunks[i].sha256);assert.equal(chunk.length,m.chunks[i].bytes);}
  const entries=JSON.parse(bytes); assert.equal(entries.length,m.entries);
  const expected=[]; const { parseStoryContent }=modules.load('lib/story-parser.ts');
  for(const s of stories) for(const l of ['cn','jp']) if(s[`path_${l}`]||(l==='cn'&&registry.entries[s.source_identity])) {
    const record=l==='cn'?registry.entries[s.source_identity]:null;
    const lines=record?read(record.textPath.slice(1)).toString('utf8').trimEnd().split('\n').slice(1).map(JSON.parse).filter(r=>r.target):parseStoryContent(read(s[`path_${l}`].slice(1)).toString('utf8'),{mergeConsecutiveTextLines:false}).lines;
    for(const row of lines) if(!row.isHeader && (row.choiceLabel || row.text).trim()) expected.push({id:s.id,l,c:[row.speaker,row.choiceLabel || row.text].filter(Boolean).join('：')});
  }
  assert.deepEqual(entries,expected);assert.deepEqual([...new Set(entries.map(e=>e.id))].sort(),stories.map(s=>s.id).sort());
  assert.deepEqual(stories.filter(s=>!s.supplement_source).map(s=>s.source_identity).sort(),selectedAdapterStories.map(s=>s.readerIdentity??s.canonicalStoryId).sort());
  assert.equal(new Set(stories.map(s=>s.id)).size,stories.length);assert.deepEqual(m.works,selectedWorkCounts);
});
test('actual source resolver accepts only hash-bound generic local chunks without upstream fallback', async () => {
  const { getSearchIndexSources,isSearchIndexManifest }=modules.load('lib/search-index-scope.ts');const m=manifest();
  const fetcher=async url=>{assert.equal(url,'/search_index_manifest.generic.json');return Response.json(m);};
  const sources=await getSearchIndexSources(new AbortController().signal,m.story_index_sha256,'generic',fetcher);
  assert.equal(sources.length,1);assert.equal(sources[0].url,undefined);assert.equal(sources[0].chunk_base_url,`/search-chunks/generic/${m.sha256}/`);
  assert.equal(isSearchIndexManifest({...m,object_key:`search/magireco/${m.sha256}.json`},'generic'),false);
  await assert.rejects(()=>getSearchIndexSources(new AbortController().signal,'0'.repeat(64),'generic',fetcher),/不匹配/);
});
test('real inherited worker prepares local chunks, reports progress and filters Japanese body results', async () => {
  const m=manifest(),h=await workerHarness(m),entries=JSON.parse(indexBytes(m));h.send({type:'prepare'});await h.wait(x=>x.type==='status'&&x.status==='ready');
  assert.ok(h.messages.some(x=>x.type==='progress'&&x.loadedBytes===m.bytes&&x.totalBytes===m.bytes));assert.equal(h.urls.length,m.chunks.length);
  const query='病院',normalize=modules.load('lib/search.ts').normalizeSearchText;
  for(const [sequence,includeJapanese] of [[1,false],[2,true]]){
    h.send({type:'search',sequence,query,includeJapanese});const result=await h.wait(x=>x.type==='results'&&x.sequence===sequence);
    const expected=[...new Set(entries.filter(e=>(includeJapanese||e.l==='cn')&&normalize(e.c).includes(normalize(query))).map(e=>e.id))];
    assert.deepEqual(result.matches.map(x=>x[0]),expected);assert.equal(result.truncated,false);
  }
  assert.equal(h.urls.length,m.chunks.length,'loaded index is reused');
});
test('local worker failures stay local and can retry after a failed request', async () => {
  const h=await workerHarness(manifest(),true);h.send({type:'search',sequence:1,query:'病院',includeJapanese:true});await h.wait(x=>x.type==='error'&&x.sequence===1);
  h.send({type:'search',sequence:2,query:'病院',includeJapanese:true});await h.wait(x=>x.type==='error'&&x.sequence===2);assert.equal(h.urls.length,2);
  assert.ok(h.messages.some(x=>x.type==='status'&&x.status==='error'));
});
function homeGrouping(bindings) {
  const filename=path.join(classicApp,'app/page.tsx'),source=fs.readFileSync(filename,'utf8');const tree=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found;
  const visit=n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(tree)==='{ categories, displayedGroups }')found=n;ts.forEachChild(n,visit);};visit(tree);assert.ok(found);
  return modules.compile(`const ${found.getText(tree)};export {categories,displayedGroups};`,filename,{
    useMemo:fn=>fn(),enrichedStories:stories,lastCategory:'main_story',normalizedQuery:'',searchMode:'title',textMatches:{},onlyNeedsReview:false,
    selectedCategories:new Set(['main_story']),sourceConnections:new Map(),ALL_SOURCE_CONNECTION:new Set(['all']),storyMatchesCategorySourceFilters:()=>true,
    ...modules.load('lib/search.ts'),...modules.load('lib/generic-search-catalog.ts'),...modules.load('lib/category-order.ts'),...modules.load('lib/native-story-navigation.ts'),
    NATURAL_COLLATOR:new Intl.Collator(['zh-CN','ja-JP'],{numeric:true}),searchJp:false,...bindings,
  });
}
test('actual home grouping exposes all three games and the separate text archive and honors category/title/body/all/language filters', () => {
  const counts=selectedWorkCounts;
  for(const [category,count]of Object.entries(counts)){
    const state=homeGrouping({lastCategory:category,selectedCategories:new Set([category])});assert.equal(state.displayedGroups.flatMap(g=>g.items).length,count);assert.equal(state.categories.length,4);
  }
  const all=new Set(Object.keys(counts));assert.equal(homeGrouping({selectedCategories:all}).displayedGroups.flatMap(g=>g.items).length,stories.length);
  const artificial={...stories[0],title:'普通',title_cn:'中文独名',title_jp:'日本語固有名'};
  assert.equal(homeGrouping({enrichedStories:[artificial],selectedCategories:all,normalizedQuery:'日本語固有名',searchJp:false}).displayedGroups.length,0);
  assert.equal(homeGrouping({enrichedStories:[artificial],selectedCategories:all,normalizedQuery:'日本語固有名',searchJp:true}).displayedGroups.length,1);
  assert.equal(homeGrouping({selectedCategories:new Set(['character_story']),normalizedQuery:'任意',searchMode:'content',textMatches:{[stories[0].id]:'任意'}}).displayedGroups.length,0);
  assert.equal(homeGrouping({selectedCategories:all,normalizedQuery:'任意',searchMode:'all',textMatches:{[stories[0].id]:'任意'}}).displayedGroups.length,1);
});
test('actual home uses formal progress/retry client and all-work selection without old game switch or global label mutation', () => {
  const p=fs.readFileSync(path.join(classicApp,'app/page.tsx'),'utf8'),layout=fs.readFileSync(path.join(classicApp,'app/layout.tsx'),'utf8');
  assert.doesNotMatch(p,/switchStorySystem|switchToStorySystem|切换到 Magia|const storySystem/);assert.doesNotMatch(layout,/CategoryLabelNormalizer/);
  assert.match(p,/createSearchWorkerClient<SearchWorkerMessage>/);assert.match(p,/data-index-status=\{searchIndexStatus\}/);
  assert.match(p,/aria-label="显示全部作品与文本资料"/);
  const {genericCategory}=modules.load('lib/generic-search-catalog.ts');assert.equal(genericCategory('exedra_main'),'main_story');assert.equal(genericCategory('character_story'),'character_story');
  const calls=[];const {selectAllWorks}=modules.fragments('app/page.tsx',['selectAllWorks'],{GENERIC_CATEGORIES:['main_story','event_story','character_story'],createAllSourceConnection:()=>new Set(['all']),setSelectedCategories:v=>calls.push([...v]),setSourceConnections(){},setOnlyNeedsReview(){},updateSearchTerm(){}});selectAllWorks();assert.deepEqual(calls,[['main_story','event_story','character_story']]);
});
test('generic index producer repeats the exact artifact bytes and materializer invokes the same producer', () => {
  const output=path.join(root,'work/reader-inheritance-20261012/generic-search-regeneration');
  const script = "const {buildGenericSearchIndex}=await import('./tools/build-generic-search-index.mjs'); await buildGenericSearchIndex(process.argv[1],process.argv[2]);";
  const r=spawnSync(process.execPath,['--input-type=module','--eval',script,pub,output],{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  const m=manifest();assert.equal(fs.readFileSync(path.join(output,'search_index_manifest.generic.json'),'utf8'),read('search_index_manifest.generic.json').toString());
  for(let i=0;i<m.chunks.length;i++){const f=`search-chunks/generic/${m.sha256}/${String(i).padStart(4,'0')}.part`;assert.ok(fs.readFileSync(path.join(output,f)).equals(read(f)));}
  const materializer=fs.readFileSync(path.join(root,'tools/materialize-classic-reader-data.mjs'),'utf8');assert.match(materializer,/await buildGenericSearchIndex\(publicRoot, publicRoot\)/);
});

test('inherited worker client retries only current initialization/query and isolates stale or stopped workers', async () => {
  const {createSearchWorkerClient}=modules.load('lib/search-worker-client.ts'),workers=[],delivered=[];
  const client=createSearchWorkerClient({retryDelay:0,onmessage:e=>delivered.push(e.data),onerror:()=>delivered.push('error'),createWorker:()=>{
    const worker={sent:[],postMessage(m){this.sent.push(m);},terminate(){this.stopped=true;},onmessage:null,onerror:null};workers.push(worker);return worker;
  }});
  client.postMessage({type:'init',sources:['current']});client.postMessage({type:'search',sequence:1});client.postMessage({type:'search',sequence:2});
  await Promise.resolve();assert.equal(workers.length,1);assert.deepEqual(workers[0].sent.map(m=>m.sequence||m.type),['init',2]);
  const stale=workers[0].onmessage;workers[0].onerror({preventDefault(){}});await new Promise(r=>setTimeout(r,5));
  assert.equal(workers.length,2);assert.equal(workers[0].stopped,true);assert.deepEqual(workers[1].sent.map(m=>m.sequence||m.type),['init',2]);
  stale({data:'old'});workers[1].onmessage({data:'current'});assert.deepEqual(delivered,['current']);
  client.terminate();assert.equal(workers[1].stopped,true);client.postMessage({type:'search',sequence:3});assert.equal(workers[1].sent.length,2);
});

test('actual home content-mode actions prepare with no query, cancel title mode and retain native source progress handler', () => {
  const calls=[],ref={current:'title'},workerRef={current:{postMessage:m=>calls.push(m)}};
  const bindings={useCallback:fn=>fn,normalizeSearchText:modules.load('lib/search.ts').normalizeSearchText,searchSequenceRef:{current:0},workerRef,
    setTextMatches(){},setSearchTruncated(){},setSearchError(){},setSearchLoading:v=>calls.push(['loading',v]),setSearchIndexStatus:v=>calls.push(['status',v]),setSearchIndexProgress:v=>calls.push(['progress',v]),
    latestSearchRef:{current:{term:'',mode:'title',includeJapanese:false}},searchModeRef:ref,setSearchMode(){},searchTerm:'',searchJp:false};
  const {updateSearchMode}=modules.fragments('app/page.tsx',['requestContentSearch','updateSearchMode'],bindings);
  updateSearchMode('content');assert.equal(ref.current,'content');assert.ok(calls.some(x=>x.type==='prepare'));assert.ok(calls.some(x=>x.type==='cancel'&&x.keepLoading));
  calls.length=0;updateSearchMode('title');assert.ok(calls.some(x=>x.type==='cancel'&&!x.keepLoading));assert.ok(calls.some(x=>x[0]==='status'&&x[1]==='idle'));
});
