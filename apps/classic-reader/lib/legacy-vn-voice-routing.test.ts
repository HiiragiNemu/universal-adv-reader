import assert from 'node:assert/strict';
import test from 'node:test';

import type { StoryLine } from './story-parser.ts';
import {
  buildLegacyVoiceSlots,
  buildUnresolvedLegacyVoiceSlots,
  legacyVoiceRoutePath,
  parseLegacyVoiceRouteDocument,
  summarizeLegacyVoiceSlots,
} from './legacy-vn-voice-routing.ts';

const rawRoute = {
  schema: 'classic-reader-story-routes/v1',
  canonicalStoryId: 'narcissu-3rd/nar3_01',
  japaneseVariantId: 'jp',
  chineseVariantId: 'cn',
  voiceRouting: {
    schema: 'classic-reader-voice-routing/v1',
    defaultState: 'collapsed',
    expandedSlotMode: 'all-lines',
    unresolvedLineBehavior: 'visible',
  },
  variantRoutes: [
    {
      variantId: 'cn',
      readerLocales: ['zh-CN'],
      textLineCounts: { 'zh-CN': 3 },
      sections: [{
        events: [
          {
            eventId: 'line-0',
            kind: 'line',
            textLineIndex: { 'zh-CN': 0 },
            cues: [{
              cueId: 'cue-0123456789abcdef',
              kind: 'voice',
              mediaId: 'asset/a-0123456789abcdef',
              raw: { sourceKey: 'VOICE_A' },
            }],
          },
          {
            eventId: 'line-1',
            kind: 'line',
            textLineIndex: { 'zh-CN': 1 },
          },
          {
            eventId: 'line-2',
            kind: 'line',
            textLineIndex: { 'zh-CN': 2 },
          },
        ],
      }],
    },
    {
      variantId: 'jp',
      readerLocales: ['ja-JP'],
      textLineCounts: { 'ja-JP': 3 },
      sections: [{
        events: [
          { eventId: 'jp-0', kind: 'line', textLineIndex: { 'ja-JP': 0 } },
          { eventId: 'jp-1', kind: 'line', textLineIndex: { 'ja-JP': 1 } },
          { eventId: 'jp-2', kind: 'line', textLineIndex: { 'ja-JP': 2 } },
        ],
      }],
    },
  ],
  media: [{
    mediaId: 'asset/a-0123456789abcdef',
    role: 'voice',
    url: '/corpus/archive/raw/narcissu3/voice.arc.unpacked/VOICE_A.ogg',
    mimeType: 'audio/ogg',
  }],
};

const eventLines: StoryLine[] = [
  { speaker: '', text: 'Section', isHeader: true },
  { speaker: '旁白', text: '第一行' },
  { speaker: '旁白', text: '第二行' },
  { speaker: '', text: '选择', isChoice: true },
  { speaker: '角色', text: '第三行' },
];

test('route path is derived only from a stable source identity', () => {
  assert.equal(
    legacyVoiceRoutePath('narcissu-3rd/nar3_01'),
    '/data/legacy-vn/narcissu-3rd/nar3_01.routes.json',
  );
  assert.equal(legacyVoiceRoutePath('../narcissu-3rd/nar3_01'), null);
  assert.equal(legacyVoiceRoutePath('narcissu-3rd/../nar3_01'), null);
  assert.equal(legacyVoiceRoutePath('narcissu-3rd'), null);
});

test('all text lines get a slot and merged paragraphs aggregate exact cues', () => {
  const route = parseLegacyVoiceRouteDocument(
    rawRoute,
    'narcissu-3rd/nar3_01',
  );
  const slots = buildLegacyVoiceSlots(route, 'zh-CN', eventLines);

  assert.equal(slots.eventSlots.length, 5);
  assert.equal(slots.displaySlots.length, 4);
  assert.deepEqual(slots.eventSlots[1]?.eventIds, ['line-0']);
  assert.deepEqual(slots.eventSlots[2]?.eventIds, ['line-1']);
  assert.deepEqual(slots.displaySlots[1]?.eventIds, ['line-0', 'line-1']);
  assert.equal(slots.displaySlots[1]?.cues.length, 1);
  assert.equal(slots.displaySlots[3]?.cues.length, 0);
  assert.deepEqual(slots.detachedCues, []);
  assert.deepEqual(summarizeLegacyVoiceSlots(slots.displaySlots), {
    cueCount: 1,
    resolvedLines: 1,
    totalLines: 2,
  });
});

test('unresolved routing still exposes a slot for every displayed text row', () => {
  const slots = buildUnresolvedLegacyVoiceSlots(eventLines);
  assert.equal(slots.displaySlots.length, 4);
  assert.deepEqual(slots.detachedCues, []);
  assert.deepEqual(summarizeLegacyVoiceSlots(slots.displaySlots), {
    cueCount: 0,
    resolvedLines: 0,
    totalLines: 2,
  });
});

test('route parsing rejects a different story and incomplete exact coverage', () => {
  assert.throws(
    () => parseLegacyVoiceRouteDocument(rawRoute, 'kana-okaeri/ev31'),
    /当前剧情不一致/u,
  );
  const route = parseLegacyVoiceRouteDocument(
    structuredClone(rawRoute),
    'narcissu-3rd/nar3_01',
  );
  route.variantRoutes[0].textLineCounts['zh-CN'] = 2;
  assert.throws(
    () => buildLegacyVoiceSlots(route, 'zh-CN', eventLines),
    /行数不一致/u,
  );
});
