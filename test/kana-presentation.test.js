import assert from 'node:assert/strict';
import test from 'node:test';
import { classicModules } from '../test-support/classic-module-loader.js';

const modules = classicModules();
const routing = modules.load('lib/legacy-vn-voice-routing.ts');
const alignment = modules.load('lib/legacy-vn-alignment.ts');

function fixture() {
  const ids = ['space', 'a', 'b', 'c'];
  const group = { schema: 'ikura-presentation-group/v1', id: 'kana/fixture/append-1',
    displayJoinMode: 'native-append', sourceEventIds: ids,
    visibleEventIdsByLocale: { 'zh-CN': ['a', 'b'], 'ja-JP': ['a', 'b', 'c'] },
    firstVisibleEventIdByLocale: { 'zh-CN': 'a', 'ja-JP': 'a' },
    speaker: { 'zh-CN': '', 'ja-JP': '' } };
  const header = { speaker: '', text: 'header', isHeader: true, headerSection: '1' };
  const value = { schema: 'classic-reader-story-routes/v1', canonicalStoryId: 'kana-okaeri/fixture',
    chineseVariantId: 'shared', japaneseVariantId: 'shared',
    voiceRouting: { schema: 'classic-reader-voice-routing/v1', defaultState: 'collapsed', expandedSlotMode: 'all-lines', unresolvedLineBehavior: 'visible' },
    media: [], variantRoutes: [{ variantId: 'shared', readerLocales: ['zh-CN', 'ja-JP'],
      textLineCounts: { 'zh-CN': 2, 'ja-JP': 3 }, sections: [{ sectionId: 'main',
        events: ids.map((eventId, position) => ({ eventId, kind: 'line', source: { presentationGroup: { ...group, position } },
          textLineIndex: position === 0 ? {} : position === 3 ? { 'ja-JP': 2 } : { 'zh-CN': position - 1, 'ja-JP': position - 1 } })) }] }] };
  return { value, route: routing.parseLegacyVoiceRouteDocument(value, value.canonicalStoryId),
    cn: [header, { speaker: '旁白', text: '愿明天的我' }, { speaker: '旁白', text: '更加优秀。' }],
    jp: [header, { speaker: '旁白', text: '明日の俺が' }, { speaker: '旁白', text: '優れた人間でありますように' }, { speaker: '旁白', text: '。' }] };
}

test('KANA native append starts at the first visible event and joins asymmetrical typewriter fragments only for reading', () => {
  const f = fixture(), before = JSON.stringify(f), raw = alignment.buildSharedNativeAlignment(f.route, f.cn, f.jp);
  assert.equal(raw.length, 4);
  const compact = alignment.mergeNativeAlignedRows(raw);
  assert.equal(compact.length, 2);
  assert.equal(compact[1].cn.text, '愿明天的我更加优秀。');
  assert.equal(compact[1].jp.text, '明日の俺が優れた人間でありますように。');
  assert.deepEqual(compact[1].cnIndices, [1, 2]);
  assert.deepEqual(compact[1].jpIndices, [1, 2, 3]);
  assert.equal(compact[1].nativeKeys.length, 3);
  assert.deepEqual(compact[1].cnSlot.eventIds, ['a', 'b']);
  assert.deepEqual(compact[1].jpSlot.eventIds, ['a', 'b', 'c']);
  assert.equal(alignment.seedNativeEditableLines(raw, 'current').length, 4);
  assert.throws(() => alignment.seedNativeEditableLines(compact, 'current'), /未合并/);
  assert.equal(JSON.stringify(f), before, 'source lines, routes and metadata remain immutable');
});

test('Majiro native continuation uses the declared separator and preserves every following voice occurrence', () => {
  const f = fixture();
  const events = f.value.variantRoutes[0].sections[0].events;
  for (const event of events) {
    event.source.presentationGroup.schema = 'majiro-presentation-group/v1';
    event.source.presentationGroup.allowFollowingVoiceCues = true;
    event.source.presentationGroup.joinBeforeByEventId = { b: '\n', c: '' };
  }
  const route = routing.parseLegacyVoiceRouteDocument(f.value, f.value.canonicalStoryId);
  const raw = alignment.buildSharedNativeAlignment(route, f.cn, f.jp);
  const cue = { cueId: 'native-voice', eventId: 'b', mediaId: 'voice', url: '/voice', mimeType: 'audio/ogg', sourceKey: 'v' };
  raw[2].jpSlot.cues.push(cue, cue);
  const compact = alignment.mergeNativeAlignedRows(raw);
  assert.equal(compact.length, 2);
  assert.equal(compact[1].cn.text, '愿明天的我\n更加优秀。');
  assert.equal(compact[1].jp.text, '明日の俺が\n優れた人間でありますように。');
  assert.deepEqual(compact[1].jpSlot.cues, [cue, cue]);
});

test('KANA append rejects altered member order and does not absorb a structural boundary, new voice or edited speaker', () => {
  const f = fixture(), raw = alignment.buildSharedNativeAlignment(f.route, f.cn, f.jp);
  const reordered = [...raw.slice(0, 1), raw[2], raw[1], raw[3]];
  assert.equal(alignment.mergeNativeAlignedRows(reordered).length, 4);
  const structural = [...raw.slice(0, 2), { ...raw[0], nativeKeys: ['choice'], cn: { speaker: '', text: 'choice', isChoice: true } }, ...raw.slice(2)];
  assert.equal(alignment.mergeNativeAlignedRows(structural).length, 5);
  const voice = structuredClone(raw);
  voice[2].jpSlot.cues.push({ cueId: 'new', eventId: 'b', mediaId: 'voice', url: '/voice', mimeType: 'audio/ogg', sourceKey: 'v' });
  assert.equal(alignment.mergeNativeAlignedRows(voice).length, 4);
  const speaker = structuredClone(raw); speaker[2].cn.speaker = '加奈';
  assert.equal(alignment.mergeNativeAlignedRows(speaker).length, 4);
  const wrong = structuredClone(f.value); wrong.variantRoutes[0].sections[0].events[2].source.presentationGroup.position = 0;
  assert.throws(() => routing.parseLegacyVoiceRouteDocument(wrong, wrong.canonicalStoryId), /续写组/);
});
