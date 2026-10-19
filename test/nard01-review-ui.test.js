import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {classicApp,classicModules,readerRowFragments,React,renderToStaticMarkup,rowProps} from '../test-support/classic-module-loader.js';
const pub=path.resolve(process.env.ADV_CLASSIC_PUBLIC_ROOT??path.join(classicApp,'public'));
const read=p=>fs.readFileSync(path.join(pub,p),'utf8'), identity='narcissu-3rd/nard01',stem='data/legacy-vn/'+identity;
const m=classicModules(), route=m.load('lib/legacy-vn-voice-routing.ts').parseLegacyVoiceRouteDocument(JSON.parse(read(stem+'.routes.json')),identity);
const parse=s=>m.load('lib/story-parser.ts').parseStoryContent(s,{mergeConsecutiveTextLines:false}).lines;
const cn=parse(read(stem+'_cn.txt')),jp=parse(read(stem+'_jp.txt')),manifest=JSON.parse(read(stem+'.alignment.json'));
const raw=()=>m.load('lib/legacy-vn-correspondence.ts').buildParallelNativeAlignment(route,cn,jp,manifest);
const display=()=>m.load('lib/legacy-vn-alignment.ts').mergeNativeAlignedRows(raw());

test('nard01 displays four explicit AI correspondence reviews and three independent pending rows',()=>{
 const rows=display(),reviewed=rows.filter(r=>r.reviewedPassage),pending=rows.filter(r=>r.pendingReviewPassage);
 assert.equal(reviewed.length,4);assert.equal(pending.length,3);
 assert.deepEqual(pending.map(r=>[r.cnSlot?.eventIds??[],r.jpSlot?.eventIds??[]]),[
   [['mjo-582','mjo-5fd'],[]],[[],['mjo-5e7']],[[],['mjo-673','mjo-6df']]]);
 const {StoryRow}=readerRowFragments();
 for(const row of [...reviewed,...pending]){
  const html=renderToStaticMarkup(React.createElement(StoryRow,{...rowProps,row,sourceStoryId:identity}));
  assert.match(html,/data-correspondence-review=/);assert.match(html,/提交对应核验反馈/);
  assert.match(html,row.pendingReviewPassage?/对应待核验/:/AI 对应复核/);
  assert.doesNotMatch(html,/AI 翻译/);
 }
 const progress=m.load('lib/generic-progress.ts').nativeCoverage(rows);
 assert.equal(progress.pendingCorrespondenceRows,3);assert.equal(progress.pendingCorrespondenceJapaneseRows,2);
 assert.equal(progress.unmatchedJapaneseRows,2);assert.equal(progress.pendingReviewRows,0,'translation proofreading is a separate denominator');
 const chisato=reviewed.find(r=>r.cnSlot.eventIds.includes('mjo-4b7'));
 assert.equal(chisato.cn.speaker,'千里');assert.equal(chisato.jp.speaker,'チサト');
 assert.equal(chisato.cnSlot.cues.length,0);assert.ok(chisato.jpSlot.cues.some(c=>c.sourceKey==='n3tisa_0028'));
 assert.ok(reviewed.find(r=>r.cnSlot.eventIds.includes('mjo-42f')).cnSlot.cues.some(c=>c.sourceKey==='n3tisa_0028'));
});

test('correspondence draft is source-bound and makes no body edits',()=>{
 const helper=m.load('components/NativeCorrespondenceReview.tsx'),review=manifest.reviewedPassages[0];
 const url=new URL(helper.correspondenceReviewDraft(identity,review)),body=url.searchParams.get('body');
 assert.equal(url.origin,'https://github.com');assert.match(body,/humanVerified/);assert.ok(body.includes(review.evidenceSha256));
 assert.ok(body.includes(review.cnEventIds[0]));assert.ok(body.includes(review.jpEventIds[0]));assert.doesNotMatch(body,/native-reader-translation-patch/);
 const evidence=fs.readFileSync(path.resolve(classicApp,'../../tools/data/nard01-bilingual-review.json'));
 assert.equal(review.evidenceSha256,createHash('sha256').update(evidence).digest('hex'));
});
for(const [name,mutate] of [
 ['false approval',p=>p.humanVerified=true],['paired event',p=>p.cnEventIds=['mjo-4b7']],
 ['incomplete buffer',p=>p.cnEventIds=['mjo-582']],['bad hash',p=>p.evidenceSha256='bad'],
 ['duplicate event',p=>p.jpEventIds.push(p.jpEventIds[0])],
])test('pending metadata rejects '+name,()=>{
 const modified=structuredClone(manifest);mutate(modified.pendingReviewPassages[0]);
 assert.throws(()=>m.load('lib/legacy-vn-correspondence.ts').buildParallelNativeAlignment(route,cn,jp,modified));
});
test('classic voice controls start visible without autoplay',()=>{
 const source=fs.readFileSync(path.join(classicApp,'app/reader/[id]/page.tsx'),'utf8');
 assert.match(source,/\[voicePanelExpanded, setVoicePanelExpanded\] = useState\(true\)/);
 const player=fs.readFileSync(path.join(classicApp,'components/voice/VoicePlayButton.tsx'),'utf8');
 assert.doesNotMatch(player,/autoPlay\s*[=:]/);
});
