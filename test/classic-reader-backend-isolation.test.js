import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import test from 'node:test';
import { classicApp, classicModules, React, renderToStaticMarkup, ts } from '../test-support/classic-module-loader.js';
import { buildCurrentGenericProgress } from '../apps/classic-reader/lib/generic-progress-server.ts';
const root=path.resolve(classicApp,'../..');
const publishedIndex=JSON.parse(fs.readFileSync(path.join(classicApp,'public/story_index.json'),'utf8'));
const publishedAdapter=JSON.parse(fs.readFileSync(path.join(classicApp,'public/data/legacy-vn/manifests/reader-adapter.json'),'utf8'));
const expectedTotal=publishedIndex.length,expectedChinese=publishedIndex.filter(e=>e.has_cn).length;
const expectedNative=publishedIndex.filter(e=>e.source_format!=='supplemental-text/v1').length;
const expectedPending=publishedIndex.filter(e=>(e.pending_review_rows??0)>0).length;
const expectedReviewed=publishedIndex.filter(e=>e.human_verified).length;
const expectedWorks=['main_story','event_story','character_story','supplement_story'].map(c=>publishedIndex.filter(e=>e.category===c).length);
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const routes=walk(path.join(classicApp,'app/api')).filter(f=>f.endsWith('route.ts')&&!f.includes(path.sep+'native-reviews'+path.sep));
const pages=['app/review/submissions/page.tsx','app/review/machine-translations/page.tsx','app/review/exedra-localization/page.tsx','app/proofreading/status/page.tsx'];

// Execute complete checked-out route modules. Cloud/runtime and network calls
// fail the fixture; no credentials or upstream services are supplied.
function serverModules() {
  const cache=new Map(),require=createRequire(path.join(classicApp,'package.json')),calls=[];
  const forbidden=name=>(..._args)=>{calls.push(name);throw Error('Unexpected '+name);};
  const load=filename=>{
    if(cache.has(filename))return cache.get(filename);
    if(filename.endsWith('.json'))return JSON.parse(fs.readFileSync(filename,'utf8'));
    const baseline=path.join(root,'test-support/fixtures/backend',path.relative(root,filename));
    const input=process.env.GENERIC_PROGRESS_BASELINE==='1'&&fs.existsSync(baseline)?baseline:filename;
    const code=ts.transpileModule(fs.readFileSync(input,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
    const module={exports:{}};cache.set(filename,module.exports);
    const localRequire=spec=>{
      if(spec==='@opennextjs/cloudflare')return {getCloudflareContext:forbidden('cloud-context')};
      if(!spec.startsWith('@/')&&!spec.startsWith('.'))return require(spec);
      const base=spec.startsWith('@/')?path.join(classicApp,spec.slice(2)):path.resolve(path.dirname(filename),spec);
      const resolved=[base,base+'.ts',base+'.tsx',base+'.json'].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());assert.ok(resolved,spec);return load(resolved);
    };
    const execute=vm.runInThisContext(`(function(require,module,exports,fetch){${code}\n})`,{filename});
    execute(localRequire,module,module.exports,forbidden('fetch'));cache.set(filename,module.exports);return module.exports;
  };
  return {load,calls};
}

test('all12 actual API modules export17 local handlers; native progress stays live without cloud or upstream',async()=>{
  assert.equal(routes.length,12);const h=serverModules();let count=0;const cwd=process.cwd();process.chdir(classicApp);
  try {
  for(const file of routes){const api=h.load(file);for(const [method,handler]of Object.entries(api).filter(([k])=>/^(GET|POST|PATCH|DELETE)$/.test(k))){
    count++;const request=new Proxy({}, {get(){throw Error('Request data should not be read before configuration');}});
    const result=await handler(request,{params:Promise.resolve({id:'legacy-narcissu-3rd-nar1_00',voiceId:'vo_001',language:'cn',index:'0'})});
    const configuration=file.endsWith(path.join('proofreading','config','route.ts'));
    if(file.endsWith(path.join('proofreading','machine-status','route.ts'))){assert.equal(result.status,200);const p=await result.json();assert.equal(p.schema,'generic-reader-progress/v2');assert.equal(p.total,expectedTotal);assert.equal(p.withChinese,expectedChinese);assert.equal(p.humanVerified,expectedReviewed);continue;}
    assert.equal(result.status,configuration?200:503,`${file} ${method}`);assert.equal(result.headers.get('cache-control'),'no-store');
    const body=await result.json();assert.equal(body.backend,'unconfigured');assert.equal(body.submissions_enabled,false);assert.equal(body.github_admin_auth,false);assert.equal(body.server_pr_creation,false);
    assert.equal(body.turnstile_site_key,'');assert.equal(body.target_branch,null);assert.equal(body.missing.length,4);
    if(!configuration)assert.equal(body.code,'GENERIC_BACKEND_NOT_CONFIGURED');
  }}assert.equal(count,17);assert.deepEqual(h.calls,[]);
  } finally {process.chdir(cwd);}
});

test('generic configuration contains no environment switch that can enable inherited credentials',()=>{
  const code=fs.readFileSync(path.join(classicApp,'lib/generic-backend.ts'),'utf8');
  assert.doesNotMatch(code,/process\.env|getCloudflareContext|localStorage|sessionStorage|fetch\(/);
  const {GENERIC_BACKEND_STATUS:s}=classicModules().load('lib/generic-backend.ts');
  assert.deepEqual(s.local.workflow,['edit','export-patch','stage','install-local','rollback-local']);
  assert.equal(s.local.revision_registry,'/native-reader-revisions.json');
  assert.deepEqual(s.missing.map(x=>x.id),['GEN11-REMOTE','GEN11-AUTH','GEN11-STORE','GEN11-APPLY']);
});

test('all4 actual review/status exports preserve progress versus submission roles across five themes without old credentials',()=>{
  for(const theme of ['light','paper','green','dark','frost']){const m=classicModules(theme);
    for(const file of pages){const Page=m.load(file).default;const html=renderToStaticMarkup(React.createElement(Page));
      const progress=file.includes('machine-translations')||file.includes('exedra-localization');
      assert.ok(html.includes(`data-theme="${theme}"`));
      if(progress){assert.match(html,/data-generic-progress="native"/);assert.match(html,/筛选作品/);assert.match(html,/筛选中文覆盖/);assert.match(html,/Narcissu／加奈/);}
      else if(file==='app/review/submissions/page.tsx'){assert.match(html,/data-generic-review="local-native"/);assert.match(html,/原生补丁投稿与审核/);}
      else {assert.match(html,/data-generic-backend="unconfigured"/);assert.match(html,/stage-native-reader-revision\.mjs/);assert.match(html,/native-reader-revisions\.json/);assert.equal((html.match(/data-requirement=/g)||[]).length,4);}
      assert.doesNotMatch(html,/<input[^>]*type="password"|turnstile|api\.github\.com|魔法纪录|Exedra/);
    }
  }
});

test('retained API and review implementations are preserved except export renaming, not deleted or rewritten',()=>{
  const base=path.join(root,'test-support/fixtures/backend');
  for(const file of [...routes,...pages.map(p=>path.join(classicApp,p))]){
    const relative=path.relative(root,file),old=fs.readFileSync(path.join(base,relative),'utf8').replaceAll('\r\n','\n');
    let now=fs.readFileSync(file,'utf8').replaceAll('\r\n','\n');
    if(file.endsWith('route.ts')){
      now=now.replace(/^import \{ (genericBackendResponse|buildCurrentGenericProgress|loadCurrentGenericProgress) \} from '@\/lib\/(generic-backend|generic-progress-server)';\n/,'');
      now=now.slice(0,now.indexOf('\n// Generic runtime exports:')).replace(/async function retainedReader(GET|POST|PATCH|DELETE)\(/g,'export async function $1(');
    }else{
      now=now.replace(/\n\nimport (GenericBackendStatus|GenericProgressReview|GenericNativeReview) from '@\/components\/\1';/,'');
      now=now.slice(0,now.indexOf('\n// Generic runtime default:')).replace(/function retainedReader([A-Za-z]+Page)\(/,'export default function $1(');
    }
    assert.equal(now.trimEnd(),old.trimEnd(),relative);
  }
});

test('real progress separates original accepted translations, owner supplements and source correspondence',async()=>{
  const p=await buildCurrentGenericProgress(path.join(classicApp,'public'));
  assert.equal(p.total,expectedTotal);assert.equal(p.withChinese,expectedChinese);assert.equal(p.withoutChinese,expectedTotal-expectedChinese);assert.equal(p.needsReview,expectedPending);assert.equal(p.humanVerified,expectedReviewed);
  assert.equal(p.rows,p.entries.reduce((sum,e)=>sum+e.rows,0));assert.equal(p.chineseRows,p.entries.reduce((sum,e)=>sum+e.chineseRows,0));assert.deepEqual(p.works.map(w=>w.total),expectedWorks);
  assert.deepEqual(p.entries.map(e=>e.identity).sort(),publishedIndex.map(e=>e.source_identity).sort());
  assert.deepEqual(p.archive,{games:publishedAdapter.games.length,stories:publishedAdapter.stories.length,visible:expectedNative,excluded:publishedAdapter.stories.length-expectedNative,variants:publishedAdapter.counts.variants,textEvents:publishedAdapter.counts.textEvents,chineseStories:publishedAdapter.counts.chineseStories});
  const bonus=p.entries.find(e=>e.identity==='narcissu-himeko/omake_062');assert.ok(bonus);assert.equal(bonus.hasChinese,true);assert.equal(bonus.review,'pending');assert.equal(bonus.pendingReviewRows,125);assert.equal(bonus.unmatchedJapaneseRows,0);
  assert.ok(p.entries.some(e=>e.identity==='narcissu-3rd/product'&&e.hasChinese));
  for(const theme of ['light','paper','green','dark','frost']){
    const Page=classicModules(theme).load('components/GenericProgressReview.tsx').default;
    const html=renderToStaticMarkup(React.createElement(Page,{initialProgress:p}));
    assert.equal((html.match(/<article /g)||[]).length,expectedTotal);assert.equal((html.match(/\?edit=1/g)||[]).length,expectedTotal);
    assert.ok(html.includes(String(p.chineseRows)));assert.ok(html.includes(String(p.rows)));assert.ok(html.includes(String(p.pendingReviewRows)));assert.ok(html.includes(String(p.supplementalSources)));assert.doesNotMatch(html,/魔法纪录|Exedra|已完成人工/);
  }
});

test('native slot counting handles missing, blank and choice rows without guessing translation quality or cross pairing',()=>{
  const {nativeCoverage}=classicModules().load('lib/generic-progress.ts');
  const rows=[{jp:{text:'header',isHeader:true}},{jp:{text:'原文'},pairing:'unpaired-jp'},{cn:{text:''},jp:{text:'空译文'},pairing:'verified'},{cn:{text:'【选项】',choiceLabel:'选项',isChoice:true},jp:{text:'choice'},pairing:'verified'},{cn:{text:'独立中文'},pairing:'unpaired-cn'}];
  const c=nativeCoverage(rows);assert.equal(c.rows,4);assert.equal(c.chineseRows,2);assert.equal(c.nonemptyChineseRows,2);assert.equal(c.japaneseRows,3);assert.equal(c.unmatchedChineseRows,1);assert.equal(c.unmatchedJapaneseRows,2);assert.equal(c.coveragePercent,50);assert.equal(c.review,'reviewed');assert.equal(c.pendingReviewRows,0);
  assert.equal(nativeCoverage([{jp:{text:'未有中文'}}]).review,'no-chinese');
  const blank=nativeCoverage([{cn:{text:''},jp:{text:'原文'}}]);
  assert.equal(blank.chineseRows,0);assert.equal(blank.nonemptyChineseRows,0);assert.equal(blank.hasChinese,false);assert.equal(blank.review,'no-chinese');
  assert.equal(nativeCoverage([{cn:{text:' ',choiceLabel:'选择'},jp:{text:'choice'}}]).hasChinese,true);
  assert.equal(nativeCoverage([{cn:{text:'【选项】',choiceLabel:' '},jp:{text:'choice'}}]).hasChinese,false);
});

test('actual home filters and paragraph-weighted progress use one original-reviewed/owner-pending denominator',()=>{
  const m=classicModules(),sources=m.load('lib/source-progress-metrics.ts');
  const f=m.fragments('app/page.tsx',['storyProgress','CATEGORY_SOURCE_FILTERS','emptyCategorySourceFilterProgress','categorySourceFilterProgressForStories','categorySourceProgressText','storyMatchesCategorySourceFilter','enrichedStories'],{
    ...sources,useMemo:fn=>fn(),stories:[{id:'a',has_cn:false},{id:'b',has_cn:true}],proofreadingStatus:{entries:[
      {id:'a',hasChinese:true,coveragePercent:50,rows:100,chineseRows:50,reviewedRows:49,pendingReviewRows:1},
      {id:'b',hasChinese:false,coveragePercent:0,rows:20,chineseRows:0,reviewedRows:0,pendingReviewRows:0}]}});
  assert.deepEqual(f.CATEGORY_SOURCE_FILTERS.map(x=>x.value),['all','with-cn','without-cn','needs-review']);
  assert.equal(f.enrichedStories[0].percent,50);assert.equal(f.enrichedStories[0].human_verified,false);assert.equal(f.enrichedStories[1].has_cn,false);
  const metric=f.categorySourceFilterProgressForStories(f.enrichedStories,true);
  assert.deepEqual(Object.values(metric).map(m=>m.maximum),[120,120,120,120]);
  assert.equal(metric.all.value,49);assert.equal(metric['with-cn'].value,50);assert.equal(metric['without-cn'].value,70);assert.equal(metric['needs-review'].value,1);
  assert.equal(f.storyMatchesCategorySourceFilter(f.enrichedStories[0],'needs-review'),true);
  assert.equal(f.storyMatchesCategorySourceFilter({...f.enrichedStories[0],pending_review_rows:0},'needs-review'),false);
  assert.equal(f.storyMatchesCategorySourceFilter(f.enrichedStories[1],'without-cn'),true);
  const source=fs.readFileSync(path.join(classicApp,'app/page.tsx'),'utf8');assert.doesNotMatch(source,/manual_closed|已完成人工校验闭环|魔法纪录人工校验总览/);
});

test('active home offers discoverable local revision status using inherited controls without changing the native catalog',()=>{
  const home=fs.readFileSync(path.join(classicApp,'app/page.tsx'),'utf8');assert.match(home,/data-generic-revisions-link/);assert.match(home,/href="\/proofreading\/status"/);
  const ids=JSON.parse(fs.readFileSync(path.join(classicApp,'public/data/story_ids.generated.json'),'utf8'));assert.equal(ids.length,expectedTotal);assert.ok(ids.every(id=>/^legacy-(?:narcissu|kana)-/.test(id)));
});

test('actual progress filtering and refresh handle category, bilingual queries, failure, retry and cancellation',async()=>{
  const status=await buildCurrentGenericProgress(path.join(classicApp,'public')),m=classicModules();
  const entries=(work,coverage,query='')=>m.fragments('components/GenericProgressReview.tsx',['entries'],{status,work,coverage,query,GENERIC_PROGRESS_WORKS:m.load('lib/generic-progress.ts').GENERIC_PROGRESS_WORKS,useMemo:f=>f()}).entries;
  assert.equal(entries('all','with-cn').length,expectedChinese);assert.equal(entries('all','without-cn').length,expectedTotal-expectedChinese);assert.equal(entries('all','needs-review').length,expectedPending);
  assert.equal(entries('main_story','all').length,expectedWorks[0]);assert.equal(entries('event_story','all').length,expectedWorks[1]);assert.equal(entries('character_story','all').length,expectedWorks[2]);assert.equal(entries('supplement_story','all').length,expectedWorks[3]);
  assert.ok(entries('all','all',status.entries[0].titleJp).some(e=>e.id===status.entries[0].id));
  assert.equal(entries('all','all','加奈，欢迎回来！').length,expectedWorks[2]);
  const updates=[],errors=[],loads=[];let failure=true;
  const {readGenericProgress}=m.load('lib/generic-progress.ts');
  const {refresh}=m.fragments('components/GenericProgressReview.tsx',['refresh'],{useCallback:f=>f,setLoading:v=>loads.push(v),setMessage:v=>errors.push(v),setStatus:v=>updates.push(v),readGenericProgress,
    fetch:async (url,{signal})=>{assert.equal(url,'/api/proofreading/machine-status');if(signal?.aborted)throw Error('aborted');return failure?Response.json({error:'fixture'},{status:503}):Response.json(status);}});
  await refresh();assert.equal(updates.length,0);assert.match(errors.at(-1),/HTTP 503/);assert.equal(loads.at(-1),false);
  failure=false;await refresh();assert.equal(updates.length,1);assert.equal(updates[0].total,expectedTotal);
  const aborted=new AbortController();aborted.abort();await refresh(aborted.signal);assert.equal(updates.length,1);
});


test('generic review routes mount one actual shared optical viewport with theme materials and readiness',()=>{
  for(const theme of ['light','paper','green','dark','frost'])for(const file of pages){
    const Page=classicModules(theme).load(file).default,html=renderToStaticMarkup(React.createElement(Page));
    assert.equal((html.match(/id="magi-home-display"/g)||[]).length,1,file+' shared bounded viewport');
    assert.match(html,new RegExp('magi-home-'+theme+'-root'));
    assert.equal((html.match(/data-display-readiness="owned"/g)||[]).length,1);
    assert.match(html,/magi-scene-content/);assert.match(html,/magi-home-story-scroll/);
    assert.equal(html.includes('data-frost-glass="shared"'),theme==='frost');
    assert.match(html,['dark','frost'].includes(theme)?/magi-night-surface/:/magi-reader-tube-lens/);
  }
  const providers=fs.readFileSync(path.join(classicApp,'app/providers.tsx'),'utf8');
  assert.match(providers,/pathname === '\/proofreading\/status'/);
});
