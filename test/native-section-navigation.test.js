import assert from 'node:assert/strict';
import test from 'node:test';
import { classicModules, React, renderToStaticMarkup, readerRowFragments, rowProps } from '../test-support/classic-module-loader.js';

const slot = (...eventIds) => ({ eventIds, cues: [] });
const section = (id,cn,jp) => ({
  id, anchorId:id, title_cn:'章节标题', title_jp:'章の題名', ordinal:1,
  target_event_id_cn:cn, target_event_id_jp:jp, native_title_event:true,
});

test('native chapter targets retain language identity and locate off-page merged events', () => {
  const { indexNativeEventRows, indexNativeSectionAnchors } = classicModules().load('lib/native-section-anchors.ts');
  const rows = Array.from({length:305},() => ({}));
  rows[3] = { jpSlot:slot('ikura-10') };
  rows[233] = { cnSlot:slot('ikura-10','ikura-11'), jpSlot:slot('ikura-99') };
  const maps = indexNativeEventRows(rows);
  assert.equal(maps.cn.get('ikura-10'),233);
  assert.equal(maps.jp.get('ikura-10'),3);
  assert.equal(maps.cn.get('ikura-11'),233);
  const anchors = indexNativeSectionAnchors({native_sections:[section('native-title-80','ikura-11','ikura-99')]},rows);
  assert.equal(anchors.byAnchor.get('native-title-80'),233);
  assert.equal(anchors.byRow.get(233)[0].title_cn,'章节标题');
  assert.equal(Math.floor(anchors.byAnchor.get('native-title-80') / 100),2);
});

test('native chapter title rows are headings only when backed by a native title instruction', () => {
  const { isNativeSectionTitleRow } = classicModules().load('lib/native-section-anchors.ts');
  const title = section('native-title-1','ikura-1','ikura-1');
  assert.equal(isNativeSectionTitleRow({cn:{text:'#章节标题'},jp:{text:'章の題名'}},title),true);
  assert.equal(isNativeSectionTitleRow({cn:{text:'这句正文必须保留。'},jp:{text:'章の題名'}},title),false);
  assert.equal(isNativeSectionTitleRow({cn:{text:'章节标题'}},{...title,native_title_event:false}),false);
  assert.equal(isNativeSectionTitleRow({cn:{text:'章节标题',isChoice:true}},title),false);
});

test('the actual reader choice callback uses the selected compiled-language event target', () => {
  const modules = classicModules();
  const { indexNativeEventRows } = modules.load('lib/native-section-anchors.ts');
  const cn = {isChoice:true,choiceTargetId:'mjo-700',choiceLabel:'中文选项'};
  const jp = {isChoice:true,choiceTargetId:'mjo-700',choiceLabel:'日本語の選択肢'};
  const rows = Array.from({length:220},() => ({}));
  rows[0] = {cn,jp}; rows[151] = {cnSlot:slot('mjo-700')}; rows[211] = {jpSlot:slot('mjo-700')};
  const calls = [];
  const { jumpToChoice } = modules.fragments('app/reader/[id]/page.tsx',['jumpToChoice'],{
    renderList:rows,nativeEventRows:indexNativeEventRows(rows),currentLegacyVoiceRoutePath:'/data/legacy-vn/example.routes.json',
    revealRow:(index,focus)=>calls.push([index,focus]),
    makeSectionAnchorId:()=>{throw Error('Native target must not fall through to header guessing');},
  });
  jumpToChoice(0,cn); jumpToChoice(0,jp);
  assert.deepEqual(calls,[[151,true],[211,true]]);
  jumpToChoice(0,{...cn,choiceTargetId:'mjo-missing'});
  assert.equal(calls.length,2);
});

test('actual native heading presents separate bilingual titles with the stable link target', () => {
  const modules = classicModules();
  const { NativeChapterHeading } = modules.fragments('app/reader/[id]/page.tsx',['NativeChapterHeading'],{...React});
  const html = renderToStaticMarkup(React.createElement(NativeChapterHeading,{
    section:section('native-title-80','ikura-11','ikura-99'),mode:'split',
  }));
  assert.ok(html.includes('id="native-title-80"'));
  assert.ok(html.includes('章节标题')); assert.ok(html.includes('章の題名'));
  assert.ok(!html.includes('旁白'));
});


test('cross-chapter deep links switch to the correct locale and reveal the actual off-page source event', () => {
  const modules = classicModules();
  const anchors = modules.load('lib/native-section-anchors.ts');
  const rows = Array.from({length:310},()=>({}));
  rows[9] = {cnSlot:slot('mjo-c5')};
  rows[260] = {jpSlot:slot('mjo-c5','mjo-ef')};
  const maps = anchors.indexNativeEventRows(rows);
  assert.deepEqual(anchors.resolveNativeSourceAnchor('source-jp-mjo-ef',maps),{rowIndex:260,mode:'jp'});
  assert.deepEqual(anchors.resolveNativeSourceAnchor('source-cn-mjo-c5',maps),{rowIndex:9,mode:'cn'});
  assert.equal(anchors.resolveNativeSourceAnchor('source-cn-mjo-ef',maps),undefined);
  assert.equal(anchors.resolveNativeSourceAnchor('source-jp-../outside',maps),undefined);
  const calls=[];
  const make = (mode,visibleRows) => modules.fragments('app/reader/[id]/page.tsx',['revealAnchor'],{
    ...anchors,mode,window:{location:{hash:'#source-jp-mjo-c5'}},
    nativeEventRows:anchors.indexNativeEventRows(visibleRows),nativeSourceEventRows:maps,
    nativeSectionAnchors:{byAnchor:new Map()},renderList:visibleRows,
    setMode:value=>calls.push(['mode',value]),revealRow:(index,highlight)=>calls.push(['row',index,highlight]),
  }).revealAnchor;
  // The requested JP event is initially hidden by the reader's CN-only filter.
  make('cn',[rows[9]])();
  assert.deepEqual(calls,[['mode','jp']]);
  make('jp',rows)();
  assert.deepEqual(calls,[['mode','jp'],['row',260,true]]);
});

test('known cross-chapter scenes show source-location links without rewriting either raw language stream', () => {
  const modules=classicModules();
  const anchors=modules.load('lib/native-section-anchors.ts');
  const relation={
    id:'iris-border-scene-cn',source_locale:'zh-CN',source_event_ids:['mjo-51e0','mjo-51fb'],
    target_story_id:'legacy-narcissu-3rd-nar3_07',target_locale:'ja-JP',target_event_id:'mjo-c5',
    message_cn:'中日版本的分章位置不同：本章末段的对应日文位于下一章开头。',
    message_jp:'章の区切りが異なります。',
  };
  const row={cn:{speaker:'旁白',text:'―几天后。'},jp:null,cnSlot:slot('mjo-51e0'),
    nativeKeys:['original-cn-51e0'],pairing:'unpaired-cn'};
  const before=JSON.stringify(row),story={cross_chapter_relations:[relation]};
  assert.equal(anchors.crossChapterRelationForRow(story,row),relation);
  assert.equal(anchors.crossChapterRelationForRow(story,{...row,jp:{text:'paired'}}),undefined);
  assert.equal(anchors.crossChapterRelationForRow(story,{jpSlot:slot('mjo-51e0'),jp:{text:'same offset, different locale'}}),undefined);
  const href='/reader/legacy-narcissu-3rd-nar3_07#source-jp-mjo-c5';
  assert.equal(anchors.nativeChapterRelationHref(relation),href);
  const {NativeChapterRelationNotice}=modules.fragments('app/reader/[id]/page.tsx',['NativeChapterRelationNotice'],anchors);
  const note=renderToStaticMarkup(React.createElement(NativeChapterRelationNotice,{relation,mode:'split'}));
  assert.ok(note.includes(relation.message_cn));assert.ok(note.includes(href));
  const {StoryRow}=readerRowFragments();
  const html=renderToStaticMarkup(React.createElement(StoryRow,{...rowProps,row,counterpartRelation:relation}));
  assert.ok(html.includes('―几天后。'));assert.ok(html.includes(href));assert.ok(html.includes('查看对应日文原文'));
  assert.equal(JSON.stringify(row),before);
});


test('native N:M editor points to existing Chinese members and does not offer a duplicate translation field', () => {
  const {StoryRow}=readerRowFragments();
  const row={cn:{speaker:'旁白',text:''},jp:{speaker:'ナレーション',text:'「それとも…お前こそ…死にたかったのか…」'},
    nativeKeys:['original-jp-event'],pairing:'verified'};
  const html=renderToStaticMarkup(React.createElement(StoryRow,{...rowProps,row,isEditMode:true,
    editedLines:[row.cn],nativeSpeakerEditable:false,nativeReadOnlyReason:'translation-on-native-group-members'}));
  assert.ok(html.includes('译文位于同一句段的中文事件，请修改对应中文行。'));
  assert.ok(html.includes(row.jp.text));assert.ok(html.includes('original-jp-event'));
  assert.ok(!html.includes('<textarea'));assert.ok(!html.includes('等待翻译'));
});
