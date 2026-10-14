import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveKanaNativeSections,
  partitionKanaReaderEvents,
} from '../tools/lib/kana-native-sections.mjs';

const line = (index, text, extra = {}) => ({
  instructionIndex: index, kind: 'message', jaOffset: index * 10,
  zhOffset: index * 11, jaText: text, zhText: text, ...extra,
});
const fixture = (alignments) => ({
  summary: { instructionPairs: 100 },
  textAlignments: alignments,
  crossScriptTransfers: [{ kind: 'load-script', jaTargetScript: 'TITLE', sourceInstructionIndex: 90 }],
});

test('KANA native titles keep the untitled opening and omit only post-TITLE diagnostics', () => {
  const route = fixture([
    line(2, 'opening'),
    line(20, 'first native chapter', { kind: 'title' }),
    line(25, 'body'),
    line(60, 'second native chapter', { kind: 'title' }),
    line(80, 'closing'),
    line(95, 'engine error'),
  ]);
  const sections = deriveKanaNativeSections(route, { fallbackTitle: { 'zh-CN': '延续', 'ja-JP': '継続' } });
  assert.deepEqual(sections.map(({ sectionId, sourceInstructionStart, sourceInstructionEndExclusive }) =>
    [sectionId, sourceInstructionStart, sourceInstructionEndExclusive]), [
    ['native-opening', 0, 20], ['native-title-20', 20, 60], ['native-title-60', 60, 90],
  ]);
  assert.equal(sections[0].title['zh-CN'], '延续');
  assert.equal(sections[2].firstJapaneseTextIndex, 3);
});

test('KANA native navigation never rewrites or duplicates cross-title choice edges', () => {
  const route = fixture([
    line(10, 'A', { kind: 'title' }),
    line(15, 'choose', { kind: 'localized-label' }),
    line(20, 'B', { kind: 'title' }),
    line(25, 'last'),
  ]);
  const sections = deriveKanaNativeSections(route);
  const events = [
    { eventId: 'a', kind: 'line', source: { instructionIndex: 10 }, text: { 'ja-JP': 'A', 'zh-CN': '甲' }, nextEventId: 'choice' },
    { eventId: 'choice', kind: 'choice', source: { selectorInstructionIndex: 17 }, choices: [{ choiceId: 'go-b', label: { 'ja-JP': 'B' }, nextEventId: 'b' }] },
    { eventId: 'b', kind: 'line', source: { instructionIndex: 20 }, text: { 'ja-JP': 'B', 'zh-CN': '乙' }, nextEventId: 'last' },
    { eventId: 'last', kind: 'line', source: { instructionIndex: 25 }, text: { 'ja-JP': 'last', 'zh-CN': '末尾' }, nextEventId: 'end-001' },
    { eventId: 'end-001', kind: 'end' },
  ];
  const original = JSON.stringify(events);
  const split = partitionKanaReaderEvents(events, sections);
  assert.deepEqual(split.map((s) => s.events.map((e) => e.eventId)), [['a', 'choice'], ['b', 'last']]);
  assert.equal(split[0].events[1].choices[0].nextEventId, 'b');
  assert.equal(split[1].targetEventIdByLocale['zh-CN'], 'b');
  assert.equal(JSON.stringify(events), original);
  assert.equal(split[0].events[1], events[1]);
});

test('KANA inherited titles do not create empty prefaces before an initial title', () => {
  const route = fixture([line(3, 'first', { kind: 'title' }), line(7, 'body')]);
  const sections = deriveKanaNativeSections(route);
  assert.deepEqual(sections.map((s) => s.sectionId), ['native-title-3']);
  assert.throws(() => partitionKanaReaderEvents([
    { eventId: 'orphan', kind: 'line', source: { instructionIndex: 99 } },
  ], sections), /no native title range/u);
});
