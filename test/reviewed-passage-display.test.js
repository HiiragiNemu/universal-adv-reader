import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { classicApp, classicModules, React, readerRowFragments, renderToStaticMarkup, rowProps } from '../test-support/classic-module-loader.js';
import { assertRawNativeRows, assertDisplayConservesRows } from '../test-support/native-corpus-expectations.js';
const root=path.resolve(classicApp,'../..');
const publicRoot=path.resolve(process.env.ADV_CLASSIC_PUBLIC_ROOT??path.join(classicApp,'public'));
const read=file=>fs.readFileSync(path.join(publicRoot,file.replace(/^\//,'')),'utf8');
const entries=JSON.parse(read('story_index.json'));
const sourceBytes=fs.readFileSync(path.join(root,'tools/data/narcissu3-bilingual-review.json'));
const evidence=JSON.parse(sourceBytes), evidenceSha256=createHash('sha256').update(sourceBytes).digest('hex');
const modules=classicModules(), routing=modules.load('lib/legacy-vn-voice-routing.ts'), parser=modules.load('lib/story-parser.ts');
const align=modules.load('lib/legacy-vn-alignment.ts'), correspondence=modules.load('lib/legacy-vn-correspondence.ts');
function fixture(identity){
 const story=entries.find(e=>e.source_identity===identity), route=routing.parseLegacyVoiceRouteDocument(JSON.parse(read(routing.legacyVoiceRoutePath(identity))),identity);
 const lines=file=>parser.parseStoryContent(read(file),{filename:file.split('/').at(-1),mergeConsecutiveTextLines:false}).lines;
 const cn=lines(story.path_cn),jp=lines(story.path_jp),manifest=JSON.parse(read(routing.legacyVoiceRoutePath(identity).replace('.routes.json','.alignment.json')));
 const source=evidence.stories.find(e=>e.storyId===identity);
 const reviewed=source.blocks.flatMap(b=>b.passages.map(p=>({...p,schema:evidence.schema,reviewer:'AI',humanVerified:false,translationQualityVerified:false,note:b.note,contextId:b.id,evidenceSha256})));
 if(manifest.reviewedPassages?.length)assert.deepEqual(manifest.reviewedPassages,reviewed,'published review matches the independently frozen source review');
 manifest.reviewedPassages=reviewed;
 for(const lang of ['cn','jp']){const covered=new Set(reviewed.flatMap(p=>p[lang+'EventIds']));manifest.unpaired[lang]=manifest.unpaired[lang].filter(id=>!covered.has(id));}
 return {story,route,cn,jp,manifest};
}
const project=f=>correspondence.buildParallelNativeAlignment(f.route,f.cn,f.jp,f.manifest);

test('all 342 explicit reviewed passages conserve native text, event identities, order, controls and repeated voice occurrences',()=>{
 let reviews=0,displayGroups=0;
 for(const source of evidence.stories){
  const f=fixture(source.storyId),before=JSON.stringify(f),raw=project(f),display=align.mergeNativeAlignedRows(raw);
  assertRawNativeRows(f.route,raw,f.cn,f.jp);assertDisplayConservesRows(raw,display,f.cn,f.jp);
  assert.equal(JSON.stringify(f),before,'review is a projection, not a native source edit');
  const visibleIds=new Set(display.filter(r=>r.pairing==='reviewed').flatMap(r=>[...(r.cnSlot?.eventIds??[]),...(r.jpSlot?.eventIds??[])]));
  for(const p of f.manifest.reviewedPassages){reviews++;for(const id of [...p.cnEventIds,...p.jpEventIds])assert.ok(visibleIds.has(id),p.id+'/'+id);}
  const seeded=align.seedNativeEditableLines(raw,'current');
  assert.deepEqual(seeded.map(e=>e.nativeAlignmentKey),raw.flatMap(r=>r.nativeKeys));
  raw.forEach((row,i)=>{if(row.nativeGroupReference){assert.equal(seeded[i].text,'');assert.equal(seeded[i].speaker,'');}});
  assert.equal(new Set(raw.flatMap(r=>r.nativeKeys)).size,raw.length);
  for(const row of display.filter(r=>r.reviewedParagraphs)){
   displayGroups++;assert.equal(row.pairing,'reviewed');assert.equal(row.reviewedPassage.humanVerified,false);
   assert.equal(row.reviewedPassage.translationQualityVerified,false);assert.equal(row.presentationGroup,undefined);
  }
 }
 assert.equal(reviews,342);assert.ok(displayGroups>20);
});

test('N:M passage preserves four independent Chinese paragraphs rather than synthesizing a long native sentence',()=>{
 const f=fixture('narcissu-3rd/nard04'),rows=align.mergeNativeAlignedRows(project(f));
 const row=rows.find(r=>r.cnSlot?.eventIds.includes('mjo-264'));
 assert.deepEqual(row.cnSlot.eventIds,['mjo-264','mjo-2aa','mjo-308','mjo-35a']);
 assert.equal(row.reviewedParagraphs.cn.length,4);assert.equal(row.reviewedParagraphs.jp.length,1);
 const {StoryRow}=readerRowFragments();
 const html=renderToStaticMarkup(React.createElement(StoryRow,{...rowProps,row,nativeSpeakerEditable:true}));
 assert.equal((html.match(/data-native-paragraph=/g)??[]).length,5);
 assert.match(html,/source-correspondence/);assert.doesNotMatch(html,/AI-source-review|非人工校对/);
 for(const paragraph of row.reviewedParagraphs.cn)assert.ok(html.includes(paragraph.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')));
});

test('a reviewed N:M group keeps an original append buffer intact and keeps the next independent paragraph separate',()=>{
 const f=fixture('narcissu-3rd/nar3_08'),row=align.mergeNativeAlignedRows(project(f)).find(r=>r.cnSlot?.eventIds.includes('mjo-7ecf'));
 assert.deepEqual(row.cnSlot.eventIds,['mjo-7e6f','mjo-7e84','mjo-7ecf']);
 assert.equal(row.reviewedParagraphs.cn.length,2);assert.equal(row.reviewedParagraphs.jp.length,1);
 assert.match(row.reviewedParagraphs.cn[0].text,/但是/);assert.match(row.reviewedParagraphs.cn[1].text,/好过头/);
});

test('reviewed 1:1 and N:M rows keep exact editable CN targets and never make JP references writable',async()=>{
 const {createNativeSourceContext}=await import('../tools/build-native-edit-sources.mjs');
 const context=await createNativeSourceContext(publicRoot),edit=modules.load('lib/native-translation-patch.ts');
 const hash=value=>createHash('sha256').update(value).digest('hex');
 for(const source of evidence.stories){
  const f=fixture(source.storyId),raw=project(f),loaded=await context.story(source.storyId),story=loaded.story;
  const before=structuredClone(story),binding={route:hash(JSON.stringify(f.route)),cnText:hash(JSON.stringify(f.cn)),jpText:hash(JSON.stringify(f.jp)),adapter:context.adapterSha256,normalizedStory:hash(JSON.stringify(story))};
  const document={schema:'native-reader-edit-source/v1',storyId:source.storyId,binding,nativeSources:[],rows:edit.buildNativeEditRows(story,raw)};
  const parsed=await edit.readNativeEditSource(JSON.stringify(document),{storyId:source.storyId,binding});
  const seeded=align.seedNativeEditableLines(raw,'current');
  assert.deepEqual(edit.createNativeTranslationPatch(parsed,seeded).changes,[]);
  for(const [i,row] of raw.entries()){
   if(row.pairing==='reviewed'&&row.cn&&!row.cn.isHeader){assert.equal(document.rows[i].target.variantId,f.route.chineseVariantId);assert.equal(document.rows[i].target.eventId,row.cnSlot.eventIds[0]);}
   if(row.nativeGroupReference)assert.deepEqual(document.rows[i].allowed,[]);
  }
  const index=raw.findIndex(row=>row.pairing==='reviewed'&&row.cn&&!row.cn.isHeader);
  const edited=structuredClone(seeded);edited[index].text+='〔本地回归测试〕';
  const patch=edit.createNativeTranslationPatch(parsed,edited);
  assert.equal(patch.changes.length,1);
  const after=await edit.applyNativeTranslationPatch(parsed,patch,story);
  assert.deepEqual(story,before);
  assert.deepEqual(after.variants.find(v=>v.variantId===f.route.japaneseVariantId),before.variants.find(v=>v.variantId===f.route.japaneseVariantId));
  assert.deepEqual(edit.importNativeTranslationPatch(parsed,patch,raw),edited);
 }
});

for(const [name,change] of [
 ['false human acceptance',f=>{f.manifest.reviewedPassages[0].humanVerified=true;}],
 ['duplicate events',f=>{f.manifest.reviewedPassages[1].cnEventIds=f.manifest.reviewedPassages[0].cnEventIds.slice();}],
 ['crossed language ordering',f=>{const a=f.manifest.reviewedPassages;[a[0].jpEventIds,a[1].jpEventIds]=[a[1].jpEventIds,a[0].jpEventIds];}],
 ['unknown native event',f=>{f.manifest.reviewedPassages[0].cnEventIds=['mjo-deadbeef'];}],
 ['ambiguous missing evidence hash',f=>{delete f.manifest.reviewedPassages[0].evidenceSha256;}],
])test('review projection rejects '+name,()=>{const f=fixture('narcissu-3rd/nar3_04');change(f);assert.throws(()=>project(f));});
