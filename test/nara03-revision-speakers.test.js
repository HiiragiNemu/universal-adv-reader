import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {publicRoot,root} from '../tools/build-native-edit-sources.mjs';
import {loadNativeRevisionContext} from '../tools/read-native-reader-revision.mjs';
import {serializeNativeRevisionText} from '../apps/classic-reader/lib/native-reader-revision.ts';
import {readerRowFragments,rowProps,React,renderToStaticMarkup} from '../test-support/classic-module-loader.js';

const input=process.env.ADV_TEST_PUBLIC ? path.resolve(process.env.ADV_TEST_PUBLIC) : publicRoot;
const index=JSON.parse(await fs.readFile(path.join(input,'story_index.json')));
const state=await loadNativeRevisionContext(index.find(e=>e.source_identity==='narcissu-3rd/nara03'),input);
const expected=[
 {jp:'mjo-32d1',cn:'mjo-213d',name:'海璃',rawHex:'8a43979e'},
 {jp:'mjo-3344',cn:'mjo-218b',name:'英治',rawHex:'89708ea1'},
 {jp:'mjo-3407',cn:'mjo-221f',name:'海璃',rawHex:'8a43979e'},
];
const key=id=>`["mjo/narcissu3/scenario.arc.unpacked/nara03","main"]/${id}`;

test('nara03 relocated translation retains the names proven by native bytes and source baseline',()=>{
 for(const item of expected){
  assert.equal(new TextDecoder('shift_jis',{fatal:true}).decode(Buffer.from(item.rawHex,'hex')),item.name);
  const base=state.base.document.rows.find(r=>r.key===key(item.jp));
  assert.equal(base.baseline.speaker,item.name);
  const source=state.story.variants.find(v=>v.variantId==='mjo/narcissu3/update.arc.unpacked/nara03')
   .sections.find(s=>s.sectionId==='main').events.find(e=>e.eventId===item.cn);
  assert.equal(source.source.nativeUnit.speakerRaw.rawHex,item.rawHex);
  assert.equal(source.source.nativeUnit.speakerRaw.decodedText,item.name);
  const current=state.rows.find(r=>r.nativeKeys[0]===key(item.jp));
  assert.equal(current.cn.speaker,item.name);
  assert.equal(current.jp.speaker,item.name);
 }
});

test('nara03 repair recipe uses decoded names rather than mismatched source encoding',async()=>{
 const recipe=JSON.parse(await fs.readFile(path.join(root,'tools/content/chinese-reading-repairs-20261014.json')));
 for(const item of expected){
  const op=recipe.operations.find(o=>o.identity==='narcissu-3rd/nara03'&&o.targetJpEventIds?.includes(item.jp));
  assert.equal(op.speaker,item.name);
  assert.equal(op.origin,'existing-translation');
  assert(op.sources.some(s=>s.eventIds.includes(item.cn)));
 }
});

test('current reader row HTML and revision TXT expose the same corrected names',()=>{
 const downloaded=serializeNativeRevisionText(state.source).trimEnd().split('\n').slice(1).map(JSON.parse);
 for(const item of expected){
  assert.equal(downloaded.find(r=>r.key===key(item.jp)).speaker,item.name);
  const row=state.rows.find(r=>r.nativeKeys[0]===key(item.jp));
  for(const theme of ['light','paper','green','dark','frost'])for(const mode of ['cn','split']){
   const {StoryRow}=readerRowFragments(theme);
   const html=renderToStaticMarkup(React.createElement(StoryRow,{...rowProps,theme,mode,row}));
   assert.match(html,new RegExp(`class="magi-reader-speaker-label[^"]*"[^>]*>${item.name}<`));
   assert(!/奀棡|塸帯/.test(html));
  }
 }
});
