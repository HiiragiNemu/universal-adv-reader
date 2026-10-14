import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { randomUUID, createHash } from 'node:crypto';
import test from 'node:test';
import { createNativeReviewStore, reviewRoot } from '../tools/native-review-store.mjs';
import { createNativeReviewApi } from '../apps/classic-reader/lib/native-review-api.ts';
import { loadNativeRevisionContext } from '../tools/read-native-reader-revision.mjs';
import { stageNativeReaderRevision, installNativeReaderRevision } from '../tools/stage-native-reader-revision.mjs';
import { createNativeTranslationPatch } from '../apps/classic-reader/lib/native-translation-patch.ts';
import { seedNativeEditableLines } from '../apps/classic-reader/lib/legacy-vn-alignment.ts';
import { classicModules, classicApp, React, renderToStaticMarkup, ts } from '../test-support/classic-module-loader.js';
import { createReviewHarness } from '../test-support/native-review-harness.js';
const publicRoot=path.join(classicApp,'public'),directory=path.join(reviewRoot,'work/reader-inheritance-20261012/native-review',randomUUID());
await fs.mkdir(directory,{recursive:true});
const index=JSON.parse(await fs.readFile(path.join(publicRoot,'story_index.json'),'utf8'));
const protectedPaths=['story_index.json','native-reader-revisions.json','search_index_manifest.generic.json'];
const originals=await Promise.all(protectedPaths.map(f=>fs.readFile(path.join(publicRoot,f))));
const contexts=new Map();
const stateFor=async identity=>{if(!contexts.has(identity))contexts.set(identity,loadNativeRevisionContext(index.find(e=>e.source_identity===identity)));return contexts.get(identity);};
async function fixture(name,producer){
 const base=path.join(directory,name),target=path.join(base,'public');await fs.mkdir(target,{recursive:true});
 await fs.symlink(path.join(publicRoot,'data'),path.join(target,'data'),'junction');
 for(const f of protectedPaths)await fs.copyFile(path.join(publicRoot,f),path.join(target,f));
 await fs.cp(path.join(publicRoot,'native-reader-revisions'),path.join(target,'native-reader-revisions'),{recursive:true});
 return createNativeReviewStore({directory:path.join(base,'store'),publicRoot:target,fixture:true,producer});
}
async function patchFor(identity='narcissu-himeko/himeko_ep01',kind='empty'){
 const state=await stateFor(identity),lines=seedNativeEditableLines(state.rows,'current'),defs=state.source.document.rows;
 if(kind==='choice'){const i=defs.findIndex(r=>r.allowed.includes('choiceLabel'));assert.ok(i>=0);lines[i]={...lines[i],choiceLabel:'',text:'【】'};}
 else{const i=defs.findIndex(r=>r.allowed.includes('speaker')&&r.baseline.speaker&&r.baseline.text);assert.ok(i>=0);lines[i]={...lines[i],text:kind==='empty'?'':'LOCAL_NATIVE_REVIEW_FIXTURE',speaker:''};}
 return {state,lines,patch:createNativeTranslationPatch(state.source,lines)};
}
const submission=patch=>({requestId:randomUUID(),author:'fixture-author',note:'isolated test, not human approval',patch});
const operation=(record,action,extra={})=>({action,expectedVersion:record.version,actor:'fixture-reviewer',note:'test only',confirm:record.id,operationId:randomUUID(),...extra});
const rejection=code=>error=>error.code===code;
let completeRecord;

test('real native submission approval production install rollback keeps empty fields and source controls in isolated data only',async()=>{
 const store=await fixture('lifecycle'),{state,patch}=await patchFor(),input=submission(patch);
 assert.deepEqual(patch.changes.map(c=>c.after),['','']);
 let r=await store.submit(input);assert.equal(r.status,'pending');assert.equal(r.fixture,true);assert.equal(r.humanAccepted,false);assert.equal(r.remotePublished,false);
 assert.deepEqual(await store.submit(input),r);assert.equal((await store.list()).length,1);
 for(const target of r.targets){const row=state.rows.find(row=>row.nativeKeys.includes(target.key));assert.deepEqual(target.originalJapanese,row.jp?{text:row.jp.text,speaker:row.jp.speaker??''}:null);}
 const reopened=createNativeReviewStore({directory:store.directory,publicRoot:store.publicRoot,fixture:true});assert.deepEqual(await reopened.read(r.id),r);
 await assert.rejects(store.submit({...input,note:'changed under same requestId'}),rejection('IDEMPOTENCY'));
 await assert.rejects(store.act(r.id,operation(r,'stage')),rejection('STATE'));
 await assert.rejects(store.act(r.id,operation(r,'approve',{confirm:''})),rejection('CONFIRM'));
 const approval=operation(r,'approve');r=await store.act(r.id,approval);assert.equal(r.status,'approved');assert.equal(r.decision.fixture,true);assert.equal(r.decision.identityVerified,false);assert.deepEqual(await store.act(r.id,approval),r);
 r=await store.act(r.id,operation(r,'stage'));assert.equal(r.status,'staged');
 assert.equal(await fs.readFile(path.join(store.publicRoot,'native-reader-revisions.json'),'utf8'),originals[1].toString());
 const stage=JSON.parse(await fs.readFile(path.join(reviewRoot,r.stage.directory,'stage.json'),'utf8'));
 const story=JSON.parse(await fs.readFile(path.join(reviewRoot,r.stage.directory,'public',stage.record.storyPath),'utf8'));
 for(const originalVariant of state.story.variants){const next=story.variants.find(v=>v.variantId===originalVariant.variantId);for(const section of originalVariant.sections){const s=next.sections.find(s=>s.sectionId===section.sectionId);for(const event of section.events){const e=s.events.find(e=>e.eventId===event.eventId);for(const [k,value] of Object.entries(event))if(!['text','speaker'].includes(k))assert.deepEqual(e[k],value,'native control/media '+k);}}}
 for(const change of patch.changes){const t=r.targets.find(t=>t.key===change.key&&t.field===change.field).target;const e=story.variants.find(v=>v.variantId===t.variantId).sections.find(s=>s.sectionId===t.sectionId).events.find(e=>e.eventId===t.eventId);assert.equal(e[change.field]['zh-CN'],'');}
 r=await store.act(r.id,operation(r,'install'));assert.equal(r.status,'installed');
 const installed=JSON.parse(await fs.readFile(path.join(store.publicRoot,'native-reader-revisions.json'),'utf8'));assert.equal(installed.entries[patch.storyId].revision,r.stage.revision);
 r=await store.act(r.id,operation(r,'rollback'));assert.equal(r.status,'rolled_back');
 for(let i=0;i<protectedPaths.length;i++)assert.deepEqual(await fs.readFile(path.join(store.publicRoot,protectedPaths[i])),originals[i]);
 assert.deepEqual(r.events.map(e=>e.action),['submit','approve','stage','install','rollback']);assert.ok(r.events.every(e=>e.fixture));completeRecord=r;
});

test('source conflicts remain explicit and failure retry uses fresh receipt version without silently rebasing',async()=>{
 const store=await fixture('conflict'),{patch}=await patchFor(undefined,'changed');let first=await store.submit(submission(patch)),second=await store.submit(submission(patch));
 first=await store.act(first.id,operation(first,'approve'));first=await store.act(first.id,operation(first,'stage'));first=await store.act(first.id,operation(first,'install'));
 await assert.rejects(store.act(second.id,operation(second,'approve')),rejection('SOURCE_CONFLICT'));
 second=await store.read(second.id);assert.equal(second.status,'pending');assert.equal(second.lastError.code,'SOURCE_CONFLICT');assert.equal(second.events.at(-1).outcome,'failed');
 first=await store.act(first.id,operation(first,'rollback'));
 second=await store.act(second.id,operation(second,'approve'));assert.equal(second.status,'approved');assert.equal(second.lastError,null);
});

test('failed production preserves approval and patch, releases lock and supports a recorded explicit retry',async()=>{
 let fail=true;const store=await fixture('retry',{stageNativeReaderRevision:async(...args)=>{if(fail)throw Error('fixture producer unavailable');return stageNativeReaderRevision(...args);},installNativeReaderRevision});
 let r=await store.submit(submission((await patchFor()).patch));r=await store.act(r.id,operation(r,'approve'));
 const failed=operation(r,'stage');await assert.rejects(store.act(r.id,failed),rejection('PRODUCTION_FAILED'));
 r=await store.read(r.id);assert.equal(r.status,'approved');assert.equal(r.lastError.action,'stage');assert.equal(r.patch.changes[0].after,'');
 await assert.rejects(store.act(r.id,failed),rejection('PRODUCTION_FAILED'));assert.equal((await store.read(r.id)).version,r.version);
 fail=false;r=await store.act(r.id,operation(r,'stage'));assert.equal(r.status,'staged');assert.equal(r.events.filter(e=>e.action==='stage').length,2);
 assert.deepEqual(await fs.readFile(path.join(store.publicRoot,'native-reader-revisions.json')),originals[1]);
});

test('rejection, optimistic version checks, duplicate concurrent review and immutable field validation are real store operations',async()=>{
 const store=await fixture('guards'),{patch}=await patchFor();let r=await store.submit(submission(patch));
 await assert.rejects(store.act(r.id,operation(r,'approve',{expectedVersion:0})),rejection('VERSION'));
 const results=await Promise.allSettled([store.act(r.id,operation(r,'approve')),store.act(r.id,operation(r,'reject'))]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 r=await store.read(r.id);assert.equal(r.events.length,2);
 const rejected=await store.submit(submission(patch));const final=await store.act(rejected.id,operation(rejected,'reject'));assert.equal(final.status,'rejected');await assert.rejects(store.act(final.id,operation(final,'stage')),rejection('STATE'));
 const tampered=structuredClone(patch);tampered.changes[0].field='voice';await assert.rejects(store.submit(submission(tampered)),rejection('PATCH'));
 const stale=structuredClone(patch);stale.sourceSha256='0'.repeat(64);await assert.rejects(store.submit(submission(stale)),rejection('PATCH'));
 const choice=await patchFor('kana-okaeri/ev00','choice');const record=await store.submit(submission(choice.patch));assert.equal(record.patch.changes[0].after,'');assert.ok(record.targets[0].target.choiceId);
 assert.throws(()=>createNativeReviewStore({fixture:true}),rejection('FIXTURE'));
});

const request=(url,method='GET',payload,headers={})=>new Request('http://127.0.0.1:4176'+url,{method,headers:{Origin:'http://127.0.0.1:4176','Content-Type':'application/json','X-Native-Review-Intent':'local',...headers},body:payload===undefined?undefined:JSON.stringify(payload)});
async function actualRoutes(api){
 const routes={};for(const f of ['app/api/native-reviews/route.ts','app/api/native-reviews/[id]/route.ts']){const filename=path.join(classicApp,f),source=await fs.readFile(filename,'utf8');const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const module={exports:{}};vm.runInThisContext(`(function(require,module,exports){${code}\n})`,{filename})(name=>{assert.equal(name,'@/lib/native-review-api');return{nativeReviewApi:api};},module,module.exports);routes[f.includes('[id]')?'detail':'list']=module.exports;}
 return routes;
}
test('actual route exports execute real fixture API/store with local-origin guards, bounded bodies and receipt lookup',async()=>{
 const store=await fixture('http'),api=createNativeReviewApi(store),routes=await actualRoutes(api),input=submission((await patchFor()).patch);
 assert.equal((await routes.list.POST(request('/api/native-reviews','POST',input,{Origin:'https://other.invalid'}))).status,403);
 assert.equal((await routes.list.POST(request('/api/native-reviews','POST',input,{'X-Native-Review-Intent':''}))).status,403);
 assert.equal((await api(new Request('http://reader.invalid/api/native-reviews'))).status,403);
 assert.equal((await routes.list.GET(request('/api/native-reviews','GET',undefined,{Host:'reader.invalid:4176'}))).status,403);
 const normalized=new Request('http://localhost:4176/api/native-reviews',{method:'POST',headers:{Host:'127.0.0.1:4176',Origin:'http://127.0.0.1:4176','Content-Type':'application/json','X-Native-Review-Intent':'local'},body:JSON.stringify({...input,requestId:randomUUID(),patch:{storyId:'narcissu-himeko/himeko_ep01'}})});
 const normalizedResult=await api(normalized);assert.equal(normalizedResult.status,400);assert.equal((await normalizedResult.json()).code,'PATCH');
 assert.equal((await routes.list.GET(request('/api/native-reviews','GET',undefined,{'X-Forwarded-For':'127.0.0.1'}))).status,200);
 assert.equal((await routes.list.GET(request('/api/native-reviews','GET',undefined,{'X-Forwarded-For':'192.0.2.1,127.0.0.1'}))).status,403);
 assert.equal((await routes.list.POST(request('/api/native-reviews','POST',input,{'Content-Length':String(3*1024*1024)}))).status,413);
 assert.equal((await routes.list.POST(request('/api/native-reviews','POST',{data:'x'.repeat(2*1024*1024)}))).status,413);
 const response=await routes.list.POST(request('/api/native-reviews','POST',input));assert.equal(response.status,201);assert.equal(response.headers.get('cache-control'),'no-store');let {record}=await response.json();
 const result=await routes.detail.PATCH(request('/api/native-reviews/'+record.id,'PATCH',operation(record,'approve')),{params:Promise.resolve({id:record.id})});assert.equal(result.status,200);record=(await result.json()).record;assert.equal(record.status,'approved');
 assert.equal((await routes.detail.GET(request('/api/native-reviews/'+record.id),{params:Promise.resolve({id:record.id})})).status,200);
 assert.equal((await routes.detail.GET(request('/api/native-reviews/bad'),{params:Promise.resolve({id:'bad'})})).status,404);
 assert.equal((await (await routes.list.GET(request('/api/native-reviews'))).json()).items.length,1);
});

test('actual submit handler retries a lost response without duplicate records and review renders exact empty fields in five themes',async()=>{
 const store=await fixture('client'),api=createNativeReviewApi(store),{state,patch,lines}=await patchFor();const m=classicModules();
 let lost=true;const messages=[],receipts=[],requestRef={current:null};
 const invoke=async(url,method,payload)=>{const response=await api(request(url,method,payload),url.startsWith('/api/native-reviews/')?url.split('/').at(-1):undefined);const body=await response.json();if(!response.ok)throw Error(body.error);if(lost){lost=false;throw Error('fixture lost response after durable save');}return body;};
 const {submit}=m.fragments('components/NativeReviewSubmit.tsx',['submit'],{source:state.source,lines,author:'fixture-author',note:'test only',request:requestRef,createNativeTranslationPatch,nativeReviewRequest:invoke,setBusy(){},setMessage:v=>messages.push(v),setReceipt:v=>receipts.push(v)});
 await submit();assert.equal(receipts.length,0);assert.equal((await store.list()).length,1);await submit();assert.equal(receipts.length,1);assert.equal((await store.list()).length,1);
 const record=receipts[0];assert.deepEqual(record.patch,patch);
 for(const theme of ['light','paper','green','dark','frost']){const mods=classicModules(theme),Page=mods.load('components/GenericNativeReview.tsx').default;const html=renderToStaticMarkup(React.createElement(Page,{initialRecord:record}));assert.equal((html.match(/id="magi-home-display"/g)||[]).length,1);assert.equal((html.match(/data-display-readiness="owned"/g)||[]).length,1);assert.equal((html.match(/data-native-review-change=/g)||[]).length,2);assert.match(html,/显式空文本/);assert.match(html,/日文来源（原生对应）/);assert.match(html,/隔离测试记录，不是人工审核/);assert.doesNotMatch(html,/<input[^>]*type="password"|魔法纪录|api.github.com/);}
 const events=[];const h=createReviewHarness({initialRecord:record,request:async(...args)=>{events.push(args);return invoke(...args);}});
 await h.render().act('approve');assert.equal(events.length,0);h.render().confirmCurrent(true);await h.render().act('approve');
 assert.equal(events.filter(e=>e[1]==='PATCH').length,1);assert.equal((await store.read(record.id)).status,'approved');
 assert.equal(h.state.selected.status,'approved');assert.equal(h.state.confirmed,false);
});

test('normal corpus pointers remain byte-identical and fixture approvals never become human acceptance or remote publication',async()=>{
 for(let i=0;i<protectedPaths.length;i++)assert.deepEqual(await fs.readFile(path.join(publicRoot,protectedPaths[i])),originals[i]);
 assert.equal(completeRecord.humanAccepted,false);assert.equal(completeRecord.remotePublished,false);
 const receipt={directory,fixture:true,completeRecord,normalCorpusPointers:protectedPaths.map((file,i)=>({file,sha256:createHash('sha256').update(originals[i]).digest('hex')})),normalCorpusTestWrites:0,humanAccepted:false,remotePublished:false};
 await fs.writeFile(path.join(reviewRoot,'reports/verification/reader-inheritance-20261012/atom21/native-review-fixture-verification.json'),JSON.stringify(receipt,null,2));
});
