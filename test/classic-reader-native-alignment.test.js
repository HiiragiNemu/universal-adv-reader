import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { classicApp, classicModules } from '../test-support/classic-module-loader.js';
import { readNativeCorpusExpectation, assertSelectedSourceVariants, assertRawNativeRows, assertDisplayConservesRows } from '../test-support/native-corpus-expectations.js';

const modules = classicModules();
const routing = modules.load('lib/legacy-vn-voice-routing.ts');
const parser = modules.load('lib/story-parser.ts');
const alignment = () => modules.load('lib/legacy-vn-alignment.ts');
const publicRoot = path.resolve(process.env.ADV_CLASSIC_PUBLIC_ROOT ?? path.join(classicApp, 'public'));
const publicFile = file => path.join(publicRoot, file.replace(/^\/+/, ''));
const { index: stories, sources } = readNativeCorpusExpectation(publicRoot);
function fixture(story) {
  const readLines = file => file ? parser.parseStoryContent(fs.readFileSync(publicFile(file), 'utf8'), { filename: file.split('/').at(-1), mergeConsecutiveTextLines: false }).lines : [];
  const route = routing.parseLegacyVoiceRouteDocument(JSON.parse(fs.readFileSync(publicFile(routing.legacyVoiceRoutePath(story.source_identity)), 'utf8')), story.source_identity);
  return { route, cn: readLines(story.path_cn), jp: readLines(story.path_jp) };
}
function pageState(f, edit = false, edited = [], mode = 'split') {
  const a = alignment();
  const display = lines => parser.parseStoryContent(lines.map(parser.serializeStoryLine).join('\n'), { mergeConsecutiveTextLines: true }).lines;
  return modules.fragments('app/reader/[id]/page.tsx', [
    'activeLegacyVoiceSlot', 'nativeAlignmentState', 'nativePresentationState', 'cnVoiceSlots', 'jpVoiceSlots', 'renderList', 'activeVoiceSlots',
  ], {
    ...routing, ...a, currentNativeEditSource: null, nativeEditState: { error: '' }, ...modules.load('lib/native-reader-revision.ts'), useMemo: fn => fn(), legacyVoiceRoute: f.route, cnEventLines: f.cn, jpEventLines: f.jp,
    isEditMode: edit, editedCnLines: edited, mode, alignStoryLines: parser.alignStoryLines,
    currentNativeCorrespondence: null, nativeCorrespondenceState: { error: '' }, currentLegacyVoiceRoutePath: '/data/legacy-vn/fixture.routes.json',
    displayedCnLines: edit ? edited : display(f.cn), displayedJpLines: edit ? f.jp : display(f.jp),
    legacyVoiceSlotState: { cn: routing.buildLegacyVoiceSlots(f.route, 'zh-CN', f.cn), jp: routing.buildLegacyVoiceSlots(f.route, 'ja-JP', f.jp) },
  });
}

test('Himeko EP01 independently merged row479 counterexample now shares exact event groups in actual page pipeline', () => {
  const f = fixture(stories.find(s => s.id === 'legacy-narcissu-himeko-himeko_ep01'));
  const state = pageState(f);
  assert.equal(state.nativeAlignmentState.error, '');
  const rows = state.renderList.filter(row => row.jpSlot?.eventIds.some(id => ['mjo-1649f', 'mjo-16501'].includes(id)));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.cnSlot.eventIds), rows.map(row => row.jpSlot.eventIds));
  assert.match(rows[0].cn.text, /难道很疼吗/); assert.doesNotMatch(rows[0].cn.text, /毫不客气/);
  assert.match(rows[1].cn.text, /毫不客气/);
});

test('effective shared and single-language variants preserve all raw keys, text, choices, branches and native append groups; parallel variants require evidence', () => {
  const a = alignment(), categories = { shared: [], parallel: [], singleLanguage: [] };
  let expectedChoices = 0, actualChoices = 0;
  for (const story of stories) {
    const f = fixture(story), rawBefore = JSON.stringify(f);
    assertSelectedSourceVariants(story, f.route, sources);
    const rows = a.buildSharedNativeAlignment(f.route, f.cn, f.jp);
    if (f.route.chineseVariantId && f.route.chineseVariantId !== f.route.japaneseVariantId) {
      assert.equal(rows, null, 'distinct native variants never fall back to positional alignment');
      categories.parallel.push(story.source_identity); continue;
    }
    categories[f.route.chineseVariantId ? 'shared' : 'singleLanguage'].push(story.source_identity);
    assert.ok(rows);
    const expected = assertRawNativeRows(f.route, rows, f.cn, f.jp);
    const choiceKeys = new Set([...expected.cn, ...expected.jp].filter(unit => unit.kind === 'choice').map(unit => unit.key));
    expectedChoices += choiceKeys.size;
    actualChoices += rows.filter(row => row.cn?.isChoice || row.jp?.isChoice).length;
    const compact = a.mergeNativeAlignedRows(rows);
    assertDisplayConservesRows(rows, compact, f.cn, f.jp);
    for (const [lang, locale, lines] of [['cn', 'zh-CN', f.cn], ['jp', 'ja-JP', f.jp]]) {
      const beforeSlots = routing.buildLegacyVoiceSlots(f.route, locale, lines);
      assert.deepEqual(compact.flatMap(row => row[lang + 'Slot']?.cues ?? []), beforeSlots.eventSlots.flatMap(slot => slot?.cues ?? []));
    }
    for (const row of rows) if (row.cn && row.jp && !row.cn.isHeader && !row.cn.isChoice) {
      assert.deepEqual(row.cnSlot?.eventIds, row.jpSlot?.eventIds);
    }
    if (!f.route.chineseVariantId) {
      assert.equal(f.cn.length, 0, 'Japanese-only source does not acquire fabricated Chinese body');
      assert.ok(rows.every(row => !row.cn && row.cnIndices.length === 0 && row.cnSlot === null));
    }
    const rawKeys = rows.flatMap(row => row.nativeKeys);
    const editable = a.seedNativeEditableLines(rows, 'current');
    assert.deepEqual(editable.map(line => line.nativeAlignmentKey), rawKeys);
    const applied = a.applyNativeEditedLines(rows, [...editable].reverse());
    assert.deepEqual(applied.map(row => row.nativeKeys[0]), rawKeys, 'editing order is bound to native identity');
    assert.equal(JSON.stringify(f), rawBefore, 'alignment and editor seeding do not mutate source text/control/voice');
    const actual = pageState(f);
    assert.deepEqual(actual.renderList, compact);
    for (const [locale, slots] of [['zh-CN', actual.cnVoiceSlots], ['ja-JP', actual.jpVoiceSlots]]) {
      const plan = routing.buildLegacyVoiceSequence(f.route, locale, slots);
      for (const item of plan) if (item.rowIndex !== null) assert.ok(slots[item.rowIndex]?.eventIds.includes(item.eventId));
    }
  }
  assert.deepEqual(Object.values(categories).flat().sort(), [...sources.keys()].sort(), 'all effective sources have exactly one variant treatment');
  assert.equal(actualChoices, expectedChoices, 'every source option appears exactly once, including Japanese-only bonus choices');
  assert.ok(expectedChoices > 0);
});

test('choice IDs distinguish two native arms even when both jump to the same target', () => {
  const f = fixture(stories.find(s => s.id === 'legacy-kana-okaeri-ev00'));
  const rows = alignment().buildSharedNativeAlignment(f.route, f.cn, f.jp).filter(row => row.cn?.isChoice);
  assert.equal(rows.length, 2); assert.notDeepEqual(rows[0].nativeKeys, rows[1].nativeKeys);
  assert.equal(rows[0].cn.choiceTargetId, rows[1].cn.choiceTargetId);
  assert.match(rows[0].jp.text, /いた/); assert.match(rows[1].jp.text, /いる/);
});

function omissionFixture() {
  const header = { speaker: '', text: 'header', isHeader: true, headerSection: '1', headerId: 'sec-fixture-1' };
  return { route: { canonicalStoryId: 'fixture/story', japaneseVariantId: 'same', chineseVariantId: 'same', media: [],
    variantRoutes: [{ variantId: 'same', readerLocales: ['zh-CN', 'ja-JP'], textLineCounts: { 'zh-CN': 2, 'ja-JP': 3 }, sections: [{ sectionId: 'main', events: [
      { kind: 'line', eventId: 'a', textLineIndex: { 'zh-CN': 0, 'ja-JP': 0 } },
      { kind: 'line', eventId: 'b', textLineIndex: { 'ja-JP': 1 } },
      { kind: 'line', eventId: 'c', textLineIndex: { 'zh-CN': 1, 'ja-JP': 2 } },
    ] }] }] }, cn: [header, { speaker: '甲', text: '甲一' }, { speaker: '甲', text: '甲三' }],
    jp: [header, { speaker: 'A', text: 'A1' }, { speaker: 'A', text: 'A2' }, { speaker: 'A', text: 'A3' }] };
}
test('a missing Chinese event is an empty cell, not shifted subtitles or dropped source text', () => {
  const f = omissionFixture(), a = alignment(), rows = a.buildSharedNativeAlignment(f.route, f.cn, f.jp);
  assert.equal(rows.length, 4); assert.equal(rows[2].cn, undefined); assert.equal(rows[2].jp.text, 'A2');
  assert.equal(rows[3].cn.text, '甲三'); assert.equal(rows[3].jp.text, 'A3');
  assert.equal(a.mergeNativeAlignedRows(rows).length, 4);
});
test('edited lines bind by native key even after reordering and fill omitted events without changing source indices', () => {
  const f = omissionFixture(), a = alignment(), rows = a.buildSharedNativeAlignment(f.route, f.cn, f.jp);
  const edited = a.seedNativeEditableLines(rows, 'current'); assert.equal(edited[2].text, '');
  edited[2] = { ...edited[2], speaker: '', text: '补充二\n下一行' };
  const reordered = [...edited].reverse(), applied = a.applyNativeEditedLines(rows, reordered);
  assert.equal(applied[2].cn, edited[2]); assert.equal(applied[2].cn.speaker, '');
  assert.equal(applied[2].cn.text, '补充二\n下一行'); assert.deepEqual(applied[2].cnIndices, []);
  assert.equal(applied[3].cn.text, '甲三'); assert.deepEqual(applied[3].cnIndices, [2]);
  assert.throws(() => a.applyNativeEditedLines(rows, [edited[0], edited[0], ...edited.slice(2)]), /事件键/);
  const state = pageState(f, true, reordered); assert.equal(state.renderList[2].cn, edited[2]);
  assert.equal(new Map(reordered.map((line, i) => [line, i])).get(state.renderList[2].cn), 1);
});
test('joint merge respects either-language speaker boundary, source formatting and structural barriers', () => {
  const a = alignment(), f = omissionFixture(); f.route.variantRoutes[0].textLineCounts['zh-CN'] = 3;
  f.route.variantRoutes[0].sections[0].events[1].textLineIndex['zh-CN'] = 1;
  f.route.variantRoutes[0].sections[0].events[2].textLineIndex['zh-CN'] = 2;
  f.cn.splice(2, 0, { speaker: '甲', text: '甲二' }); f.jp[2] = { ...f.jp[2], speaker: 'B' };
  const rows = a.buildSharedNativeAlignment(f.route, f.cn, f.jp);
  assert.equal(a.mergeNativeAlignedRows(rows).length, 4);
  f.jp[2].speaker = 'A'; f.jp[2].position = 'right';
  assert.equal(a.mergeNativeAlignedRows(a.buildSharedNativeAlignment(f.route, f.cn, f.jp)).length, 4);
});
test('voice presentation merges only identical native occurrences with per-event multiplicity', () => {
  const a = alignment(); const cue = { cueId: 'cue-x', mediaId: 'asset-x', url: '/corpus/a/x.ogg', eventId: 'a', mimeType: 'audio/ogg', sourceKey: 'x' };
  assert.deepEqual(a.mergeNativeVoiceCues([cue, cue], [cue, cue]), [cue, cue]);
  assert.equal(a.mergeNativeVoiceCues([cue], [{ ...cue, eventId: 'b' }]).length, 2);
  assert.equal(a.mergeNativeVoiceCues([cue], [{ ...cue, cueId: 'different-version-cue' }]).length, 2);
});
test('native TXT import keeps keys/structure and rejects missing rows or changed branch targets', () => {
  const a = alignment(), f = omissionFixture(), rows = a.buildSharedNativeAlignment(f.route, f.cn, f.jp);
  const original = a.seedNativeEditableLines(rows, 'current'), imported = original.map(x => ({ ...x }));
  imported[1].text = '新的文本'; imported[1].speaker = '';
  const edited = a.importNativeEditableLines(rows, imported); assert.equal(edited[1].text, '新的文本'); assert.equal(edited[1].speaker, '');
  assert.equal(edited[1].nativeAlignmentKey, original[1].nativeAlignmentKey);
  assert.throws(() => a.importNativeEditableLines(rows, imported.slice(1)), /事件数量/);
  imported[0].headerId = 'wrong'; assert.throws(() => a.importNativeEditableLines(rows, imported), /标题结构/);
});
test('actual editing initializer uses native event rows, and shared-variant structure errors do not silently zip', () => {
  const a = alignment(), f = omissionFixture(), rows = a.buildSharedNativeAlignment(f.route, f.cn, f.jp), calls = [];
  const { initializeEditing } = modules.fragments('app/reader/[id]/page.tsx', ['initializeEditing'], {
    useCallback: callback => callback,
    ...a, currentNativeEditSource: {}, nativeEditState: { error: '' }, nativeAlignmentState: { rows, error: '' }, legacyVoiceRoute: f.route, currentStory: { source_identity: 'fixture/story' },
    cnEventLines: f.cn, jpEventLines: f.jp, setEditMessage: x => calls.push(['message', x]),
    setEditedCnLines: x => calls.push(['edited', x]), setMode: x => calls.push(['mode', x]),
    seedEditableLines() { throw Error('Native fixture reached old zip seeding'); },
  });
  assert.equal(initializeEditing('current'), true);
  assert.equal(calls.find(([key]) => key === 'edited')[1][2].text, '');
  const broken = structuredClone(f); broken.cn.splice(1, 1);
  assert.throws(() => a.buildSharedNativeAlignment(broken.route, broken.cn, broken.jp), /不一致/);
});
