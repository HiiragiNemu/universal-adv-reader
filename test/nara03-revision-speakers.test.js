import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {publicRoot,root} from '../tools/build-native-edit-sources.mjs';
import {loadNativeRevisionContext} from '../tools/read-native-reader-revision.mjs';
import {serializeNativeRevisionText} from '../apps/classic-reader/lib/native-reader-revision.ts';
import {nativeCoverage} from '../apps/classic-reader/lib/generic-progress.ts';
import {validateNativeTranslationPatch} from '../apps/classic-reader/lib/native-translation-patch.ts';
import {readerRowFragments,rowProps,React,renderToStaticMarkup} from '../test-support/classic-module-loader.js';

const input=process.env.ADV_TEST_PUBLIC ? path.resolve(process.env.ADV_TEST_PUBLIC) : publicRoot;
const index=JSON.parse(await fs.readFile(path.join(input,'story_index.json')));
const entry=index.find(e=>e.source_identity==='narcissu-3rd/nara03');
const state=await loadNativeRevisionContext(entry,input);
const expected=[
 {jp:'mjo-32d1',cn:'mjo-213d',name:'海璃',rawHex:'8a43979e'},
 {jp:'mjo-3344',cn:'mjo-218b',name:'英治',rawHex:'89708ea1'},
 {jp:'mjo-3407',cn:'mjo-221f',name:'海璃',rawHex:'8a43979e'},
];
const key=id=>`["mjo/narcissu3/scenario.arc.unpacked/nara03","main"]/${id}`;
const cnKey=id=>`["mjo/narcissu3/update.arc.unpacked/nara03","main"]/${id}`;

test('nara03 original and relocated Japanese rows retain source-proven names without duplicate Chinese',()=>{
 for(const item of expected){
  assert.equal(new TextDecoder('shift_jis',{fatal:true}).decode(Buffer.from(item.rawHex,'hex')),item.name);
  const base=state.base.document.rows.find(r=>r.key===key(item.jp));
  assert.equal(base.baseline.speaker,item.name);
  const source=state.story.variants.find(v=>v.variantId==='mjo/narcissu3/update.arc.unpacked/nara03')
   .sections.find(s=>s.sectionId==='main').events.find(e=>e.eventId===item.cn);
  assert.equal(source.source.nativeUnit.speakerRaw.rawHex,item.rawHex);
  assert.equal(source.source.nativeUnit.speakerRaw.decodedText,item.name);
  const current=state.rows.find(r=>r.nativeKeys[0]===key(item.jp));
  assert.equal(current.cn,undefined);
  assert.equal(current.jp.speaker,item.name);
  assert.deepEqual(current,state.built.rows.find(r=>r.nativeKeys[0]===key(item.jp)));
  const original=state.rows.find(r=>r.nativeKeys[0]===cnKey(item.cn));
  assert.equal(original.cn.speaker,item.name);
  assert.equal(state.rows.filter(r=>r.cn?.text?.trim()===original.cn.text.trim()).length,1);
 }
});

test('nara03 regeneration recipe no longer creates duplicate original translations',async()=>{
 const recipe=JSON.parse(await fs.readFile(path.join(root,'tools/content/chinese-reading-repairs-20261014.json')));
 for(const item of expected){
  assert(!recipe.operations.some(o=>o.identity==='narcissu-3rd/nara03'&&o.targetJpEventIds?.includes(item.jp)));
 }
});

test('current reader row HTML and revision TXT expose the same corrected names',()=>{
 const downloaded=serializeNativeRevisionText(state.source).trimEnd().split('\n').slice(1).map(JSON.parse);
 for(const item of expected){
  assert.equal(downloaded.find(r=>r.key===key(item.jp)),undefined);
  assert.equal(downloaded.find(r=>r.key===cnKey(item.cn)).speaker,item.name);
  const row=state.rows.find(r=>r.nativeKeys[0]===cnKey(item.cn));
  for(const theme of ['light','paper','green','dark','frost'])for(const mode of ['cn','split']){
   const {StoryRow}=readerRowFragments(theme);
   const html=renderToStaticMarkup(React.createElement(StoryRow,{...rowProps,theme,mode,row}));
   assert.match(html,new RegExp(`class="magi-reader-speaker-label[^"]*"[^>]*>${item.name}<`));
   assert(!/奀棡|塸帯/.test(html));
  }
 }
});

test('each relocated dialogue has its own reciprocal native event target',()=>{
 assert.equal(entry.cross_chapter_relations.length,6);
 for(const item of expected)for(const [sourceLocale,targetLocale,from,to]of [
  ['ja-JP','zh-CN',item.jp,item.cn],['zh-CN','ja-JP',item.cn,item.jp],
 ]){
  const relations=entry.cross_chapter_relations.filter(r=>r.source_locale===sourceLocale&&r.source_event_ids.includes(from));
  assert.equal(relations.length,1);assert.deepEqual(relations[0].source_event_ids,[from]);
  assert.equal(relations[0].target_event_id,to);assert.equal(relations[0].target_locale,targetLocale);
 }
});

test('all three originals are protected and all three duplicate JP translation fields are readonly',()=>{
 assert.deepEqual([...state.source.translationPolicy.requiredTextKeys].sort(),expected.map(e=>cnKey(e.cn)).sort());
 assert.deepEqual([...state.source.translationPolicy.readonlyKeys].sort(),expected.map(e=>key(e.jp)).sort());
 const make=(key,before,after)=>({schema:'native-reader-translation-patch/v1',storyId:entry.source_identity,
  sourceSha256:state.source.sha256,binding:state.source.document.binding,locale:'zh-CN',changes:[{key,field:'text',before,after}]});
 for(const item of expected){
  const original=state.rows.find(r=>r.nativeKeys[0]===cnKey(item.cn)).cn.text;
  assert.throws(()=>validateNativeTranslationPatch(state.source,make(cnKey(item.cn),original,'')),/清空前须先复核/);
  assert.throws(()=>validateNativeTranslationPatch(state.source,make(key(item.jp),'',original)),/原译位置/);
  assert.equal(validateNativeTranslationPatch(state.source,make(cnKey(item.cn),original,original+'测试')).changes.length,1);
 }
});

test('nara03 relocation retains all source rows and is not counted as missing translation',()=>{
 assert.equal(state.rows.length,1234);
 const coverage=nativeCoverage(state.rows,state.source.revision.translationReview,entry);
 assert.equal(coverage.relocatedJapaneseRows,3);assert.equal(coverage.missingChineseRows,0);
 assert.equal(coverage.pendingReviewRows,0);assert.equal(coverage.chineseRows+3,coverage.rows);
});
