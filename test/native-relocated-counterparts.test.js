import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as anchors from '../apps/classic-reader/lib/native-section-anchors.ts';
import {parseStoryContent} from '../apps/classic-reader/lib/story-parser.ts';
import {parseLegacyVoiceRouteDocument} from '../apps/classic-reader/lib/legacy-vn-voice-routing.ts';
import {buildSharedNativeAlignment, mergeNativeAlignedRows, applyNativeEditedLines, seedNativeEditableLines} from '../apps/classic-reader/lib/legacy-vn-alignment.ts';
import {buildParallelNativeAlignment} from '../apps/classic-reader/lib/legacy-vn-correspondence.ts';

const root = path.resolve(import.meta.dirname, '..');
const publicRoot = process.env.ADV_CLASSIC_PUBLIC_ROOT ?? path.join(root, 'apps/classic-reader/public');
const identity = 'narcissu-3rd/nar3_05';
const storyId = 'legacy-narcissu-3rd-nar3_05';
const relations = [
  {
    id:'nar3_05-father-recollection-jp-to-cn',
    source_locale:'ja-JP', source_event_ids:['mjo-521e', 'mjo-526f'],
    target_story_id:storyId, target_locale:'zh-CN', target_event_id:'mjo-3eac',
    message_cn:'两版本的父亲回忆段落位置不同：对应中文原文位于本章妹妹对话之前；原文顺序分别保留。',
    message_jp:'対応する中国語原文を参照。',
  },
  {
    id:'nar3_05-father-recollection-cn-to-jp',
    source_locale:'zh-CN', source_event_ids:['mjo-3eac'],
    target_story_id:storyId, target_locale:'ja-JP', target_event_id:'mjo-521e',
    message_cn:'对应日文为妹妹回忆之后的两个连续原生段落；两版本不交叉拼接。',
    message_jp:'対応する日本語原文を参照。',
  },
];
const stem = path.join(publicRoot, 'data/legacy-vn', identity);
const read = file => fs.readFileSync(file, 'utf8');
const parse = file => parseStoryContent(read(file), {mergeConsecutiveTextLines:false}).lines;
const route = parseLegacyVoiceRouteDocument(JSON.parse(read(stem + '.routes.json')), identity);
const cn = parse(stem + '_cn.txt'), jp = parse(stem + '_jp.txt');
const originalRows = buildSharedNativeAlignment(route, cn, jp)
  ?? buildParallelNativeAlignment(route, cn, jp, JSON.parse(read(stem + '.alignment.json')));
const key = (archive, id) => JSON.stringify([`mjo/narcissu3/${archive}.arc.unpacked/nar3_05`, 'main']) + '/' + id;
const originalKey = key('update', 'mjo-3eac');
const jpKeys = ['mjo-521e', 'mjo-526f'].map(id => key('scenario', id));
const fixture = (forwardOnly = false) => ({
  story: {id:storyId, cross_chapter_relations:structuredClone(relations)
    .filter(relation => !forwardOnly || relation.source_locale === 'ja-JP')},
  rows:structuredClone(originalRows),
});
const rowFor = (rows, nativeKey) => rows.find(row => row.nativeKeys.includes(nativeKey));
const resolve = (story, rows) => {
  const before = JSON.stringify({story, rows});
  try { return anchors.resolveSameStoryNativeCounterparts(story, rows); }
  finally { assert.equal(JSON.stringify({story, rows}), before, 'classification must not mutate source data'); }
};
const empty = context => {
  assert.equal(context.byKey.size, 0);
  assert.equal(context.readonlyTranslationKeys.size, 0);
  assert.equal(context.requiredTranslationKeys.size, 0);
};

test('nar3_05 original source retains 309 raw rows and resolves 2 JP references to one original CN without mutation', () => {
  assert.equal(typeof anchors.resolveSameStoryNativeCounterparts, 'function');
  const {story, rows} = fixture();
  assert.equal(rows.length, 309);
  const originalText = '不知为何，想起了那被人称之“匪徒”的父亲。想起了那拥有灰暗眼睛的杀人者。';
  assert.equal(rowFor(rows, originalKey).cn.text, originalText);
  assert.equal(rows.filter(row => row.cn?.text === originalText).length, 1);
  assert.ok(jpKeys.every(nativeKey => !rowFor(rows, nativeKey).cn));
  const context = resolve(story, rows);
  assert.equal(context.byKey.size, 3);
  assert.deepEqual([...context.readonlyTranslationKeys].sort(), [...jpKeys].sort());
  assert.deepEqual([...context.requiredTranslationKeys], [originalKey]);
  for (const nativeKey of jpKeys) {
    const relation = anchors.nativeCounterpartForRow(context, rowFor(rows, nativeKey));
    assert.equal(relation.target_event_id, 'mjo-3eac');
    assert.equal(anchors.nativeChapterRelationHref(relation), '/reader/legacy-narcissu-3rd-nar3_05#source-cn-mjo-3eac');
  }
  assert.equal(anchors.nativeCounterpartForRow(context, rowFor(rows, originalKey)).target_event_id, 'mjo-521e');
  const display = mergeNativeAlignedRows(rows);
  assert.equal(display.length, 301);
  assert.equal(display.indexOf(rowFor(display, originalKey)), 219);
  assert.deepEqual(jpKeys.map(k => display.indexOf(rowFor(display, k))), [222, 223]);
  const mergedContext = resolve(story, display);
  assert.deepEqual([...mergedContext.byKey], [...context.byKey]);
});

test('editing adds empty CN objects without erasing source-key counterpart lookup', () => {
  const {story, rows} = fixture(), context = resolve(story, rows);
  const edited = applyNativeEditedLines(rows, seedNativeEditableLines(rows, 'current'));
  for (const nativeKey of jpKeys) {
    const row = rowFor(edited, nativeKey);
    assert.ok(row.cn);
    assert.equal(anchors.crossChapterRelationForRow(story, row), undefined);
    assert.equal(anchors.nativeCounterpartForRow(context, row).target_event_id, 'mjo-3eac');
  }
  assert.equal(anchors.nativeCounterpartForRow(context, {nativeKeys:[jpKeys[0], originalKey]}), undefined);
  assert.equal(anchors.nativeCounterpartForRow(context, {nativeKeys:[jpKeys[0], 'not-resolved']}), undefined);
  assert.equal(anchors.nativeCounterpartForRow(context, {nativeKeys:[]}), undefined);
});

for (const [name, mutate] of [
  ['missing target', ({story}) => { story.cross_chapter_relations[0].target_event_id = 'mjo-absent'; }],
  ['wrong target locale', ({story}) => { story.cross_chapter_relations[0].target_locale = 'ja-JP'; }],
  ['wrong source locale', ({story}) => { story.cross_chapter_relations[0].source_locale = 'zh-CN'; }],
  ['different chapter', ({story}) => { story.cross_chapter_relations[0].target_story_id = 'legacy-narcissu-3rd-nar3_06'; }],
  ['absent source member', ({rows}) => { rows.splice(rows.findIndex(r => r.nativeKeys.includes(jpKeys[1])), 1); }],
  ['missing listed source event', ({story}) => { story.cross_chapter_relations[0].source_event_ids.push('mjo-absent'); }],
  ['empty CN target', ({rows}) => { rowFor(rows, originalKey).cn.text = ' \n '; }],
  ['target lacks native CN indices', ({rows}) => { rowFor(rows, originalKey).cnIndices = []; }],
  ['source lacks native JP indices', ({rows}) => { rowFor(rows, jpKeys[0]).jpIndices = []; }],
  ['source lacks native JP slot', ({rows}) => { rowFor(rows, jpKeys[0]).jpSlot = null; }],
  ['duplicate source event occurrence', ({rows}) => {
    const duplicate = structuredClone(rowFor(rows, jpKeys[0]));
    duplicate.nativeKeys = ['duplicate-jp-native-key'];
    rows.push(duplicate);
  }],
  ['duplicate target event occurrence', ({rows}) => {
    const duplicate = structuredClone(rowFor(rows, originalKey));
    duplicate.nativeKeys = ['duplicate-cn-native-key'];
    rows.push(duplicate);
  }],
  ['duplicate native key', ({rows}) => {
    const duplicate = structuredClone(rowFor(rows, originalKey));
    duplicate.cnSlot.eventIds = ['other-native-event'];
    rows.push(duplicate);
  }],
  ['duplicate relation source member', ({story}) => { story.cross_chapter_relations[0].source_event_ids.push('mjo-521e'); }],
]) test(`invalid relation grants no source-linked classification: ${name}`, () => {
  const input = fixture(true);
  mutate(input);
  empty(resolve(input.story, input.rows));
});

test('a relation covers every event of a merged source row, not one matching member', () => {
  const {story, rows} = fixture(true);
  const first = rowFor(rows, jpKeys[0]), second = rowFor(rows, jpKeys[1]);
  first.nativeKeys.push(...second.nativeKeys);
  first.jpSlot.eventIds.push(...second.jpSlot.eventIds);
  first.jpIndices.push(...second.jpIndices);
  first.jp.text += second.jp.text;
  rows.splice(rows.indexOf(second), 1);
  const complete = resolve(story, rows);
  assert.deepEqual([...complete.readonlyTranslationKeys].sort(), [...jpKeys].sort());
  assert.equal(anchors.nativeCounterpartForRow(complete, first), story.cross_chapter_relations[0]);
  story.cross_chapter_relations[0].source_event_ids = ['mjo-521e'];
  empty(resolve(story, rows));
});

test('overlapping valid relations are ambiguous and never lock any part of either source block', () => {
  const {story, rows} = fixture(true);
  story.cross_chapter_relations.push({...structuredClone(story.cross_chapter_relations[0]), id:'another-relation',
    source_event_ids:['mjo-521e'], target_event_id:'mjo-3e5b'});
  empty(resolve(story, rows));
});

for (const nativeKey of [jpKeys[0], originalKey]) test(`source-bound pending conflict throws without mutation: ${nativeKey}`, () => {
  const {story, rows} = fixture(true);
  rowFor(rows, nativeKey).pendingReviewPassage = {schema:'source-bound-bilingual-review-pending/v1', id:'pending-conflict'};
  assert.throws(() => resolve(story, rows), /pending|待核/u);
});

test('a real local Chinese translation takes precedence and is not locked by a location hint', () => {
  const {story, rows} = fixture(true);
  rowFor(rows, jpKeys[0]).cn = {text:'已有本行中文', speaker:''};
  const context = resolve(story, rows);
  assert.equal(context.byKey.has(jpKeys[0]), false);
  assert.equal(context.readonlyTranslationKeys.has(jpKeys[0]), false);
  assert.equal(context.readonlyTranslationKeys.has(jpKeys[1]), true);
});

test('missing context and unrelated cross-chapter links preserve the compatibility API', () => {
  const {story, rows} = fixture();
  empty(resolve(undefined, rows));
  const relation = story.cross_chapter_relations.find(r => r.source_locale === 'ja-JP');
  relation.target_story_id = 'legacy-narcissu-3rd-nar3_06';
  story.cross_chapter_relations = [relation];
  empty(resolve(story, rows));
  assert.equal(anchors.crossChapterRelationForRow(story, rowFor(rows, jpKeys[0])), relation);
});
