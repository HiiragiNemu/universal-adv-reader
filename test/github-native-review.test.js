import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { githubNativeReviewDraft, parseGithubNativeReviewBody, ADV_GITHUB_URL } from '../apps/classic-reader/lib/github-native-review.ts';
import { importGithubReview } from '../tools/import-github-review.mjs';
import { createNativeReviewStore, reviewRoot } from '../tools/native-review-store.mjs';
import { loadNativeRevisionContext } from '../tools/read-native-reader-revision.mjs';
import { createNativeTranslationPatch } from '../apps/classic-reader/lib/native-translation-patch.ts';
import { seedNativeEditableLines } from '../apps/classic-reader/lib/legacy-vn-alignment.ts';

const simple = () => ({schema:'native-reader-translation-patch/v1',storyId:'fixture/story',sourceSha256:'a'.repeat(64),locale:'zh-CN',
  binding:{route:'a',cnText:'b',jpText:'c',adapter:'d',normalizedStory:'e'},changes:[{key:'event-1',field:'text',before:'原文',after:'修订：中文与「日本語」\\n```'}]});
const issueFor = patch => ({id:'I_fixture_001',number:12,url:`${ADV_GITHUB_URL}/issues/12`,state:'OPEN',author:{login:'fixture-author'},updatedAt:'2026-10-15T00:00:00Z',body:new URL(githubNativeReviewDraft(patch).url).searchParams.get('body')});

test('GitHub draft is fixed-repository and round-trips Unicode, delimiters and source bindings without network',()=>{
  const patch=simple(),draft=githubNativeReviewDraft(patch),url=new URL(draft.url);
  assert.equal(draft.inline,true);assert.equal(url.origin,'https://github.com');assert.equal(url.pathname,'/HiiragiNemu/universal-adv-reader/issues/new');
  assert.deepEqual(parseGithubNativeReviewBody(url.searchParams.get('body')),patch);
  assert.equal(url.searchParams.has('access_token'),false);assert.ok(draft.url.length<=6000);
});

test('large revisions never truncate a patch into a URL; file export remains complete',()=>{
  const patch=simple();patch.changes[0].after='长文本'.repeat(5000);
  const draft=githubNativeReviewDraft(patch);assert.equal(draft.inline,false);assert.ok(draft.url.length<=6000);
  assert.deepEqual(JSON.parse(draft.serialized),patch);assert.throws(()=>parseGithubNativeReviewBody(new URL(draft.url).searchParams.get('body')));
});

test('empty, ambiguous, malformed and oversized issue patches fail closed',()=>{
  assert.throws(()=>githubNativeReviewDraft({...simple(),changes:[]}));
  const body=issueFor(simple()).body;
  assert.throws(()=>parseGithubNativeReviewBody(body+body));
  assert.throws(()=>parseGithubNativeReviewBody('```json\n{}\n```'));
  assert.throws(()=>parseGithubNativeReviewBody(body.replace('native-reader-translation-patch/v1','other/v1')));
  assert.throws(()=>parseGithubNativeReviewBody('x'.repeat(200001)));
});

test('issue import accepts only the named open repository issue and does not call a store on identity failure',async()=>{
  let calls=0;const issue=issueFor(simple()),store={submit:async()=>{calls++;throw Error('must not run');}};
  for(const changed of [{url:'https://github.com/other/project/issues/12'},{state:'CLOSED'},{number:13},{author:{login:'invalid/name'}},{updatedAt:'invalid'}]){
    await assert.rejects(importGithubReview({number:12,readIssue:async()=>({...issue,...changed}),store}));
  }
  assert.equal(calls,0);
});

test('real GitHub import stores only a source-validated pending record; retries are idempotent and stale sources rejected',async()=>{
  const originalPublic=path.join(reviewRoot,'apps/classic-reader/public'),base=path.join(reviewRoot,'work/github-review-test',randomUUID()),publicRoot=path.join(base,'public');
  await fs.mkdir(publicRoot,{recursive:true});
  const protectedFiles=['story_index.json','native-reader-revisions.json','search_index_manifest.generic.json'];
  const originals=await Promise.all(protectedFiles.map(f=>fs.readFile(path.join(originalPublic,f))));
  for(let i=0;i<protectedFiles.length;i++)await fs.writeFile(path.join(publicRoot,protectedFiles[i]),originals[i]);
  await fs.symlink(path.join(originalPublic,'data'),path.join(publicRoot,'data'),process.platform==='win32'?'junction':'dir');
  await fs.cp(path.join(originalPublic,'native-reader-revisions'),path.join(publicRoot,'native-reader-revisions'),{recursive:true});
  const index=JSON.parse(originals[0]),entry=index.find(e=>e.source_identity==='narcissu-himeko/himeko_ep01');
  const context=await loadNativeRevisionContext(entry,publicRoot),lines=seedNativeEditableLines(context.rows,'current');
  const row=context.source.document.rows.findIndex(r=>r.allowed.includes('text')&&r.baseline.text);
  assert.ok(row>=0);lines[row]={...lines[row],text:'GITHUB_IMPORT_TEST_ONLY'};
  const patch=createNativeTranslationPatch(context.source,lines),store=createNativeReviewStore({directory:path.join(base,'store'),publicRoot,fixture:true});
  const draft=githubNativeReviewDraft(patch),issue=issueFor(simple());
  // Some actual native keys are intentionally long; test the explicit attachment route too.
  if(draft.inline)issue.body=new URL(draft.url).searchParams.get('body');
  const options={number:12,readIssue:async()=>issue,store,patchFileText:draft.inline?null:JSON.stringify(patch)};
  const first=await importGithubReview(options),second=await importGithubReview(options);
  assert.equal(first.recordId,second.recordId);assert.equal(first.status,'pending');assert.equal(first.githubWritePerformed,false);assert.equal(first.installationPerformed,false);
  assert.equal((await store.list()).length,1);const record=await store.read(first.recordId);
  assert.equal(record.author,'GitHub:fixture-author');assert.match(record.note,/github.com\/HiiragiNemu\/universal-adv-reader\/issues\/12/);
  assert.deepEqual(record.events.map(e=>e.action),['submit']);assert.equal(record.fixture,true);
  const stale={...patch,sourceSha256:'0'.repeat(64)};
  await assert.rejects(importGithubReview({...options,patchFileText:JSON.stringify(stale)}));
  for(let i=0;i<protectedFiles.length;i++)assert.deepEqual(await fs.readFile(path.join(originalPublic,protectedFiles[i])),originals[i]);
});

test('portable regression fixture bytes match recorded upstream provenance',async()=>{
  const base=path.join(reviewRoot,'test-support/fixtures'),manifest=JSON.parse(await fs.readFile(path.join(base,'provenance.json'),'utf8'));
  assert.equal(manifest.files.length,25);
  for(const f of manifest.files){const bytes=await fs.readFile(path.join(base,f.file));assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256,f.file);}
});
