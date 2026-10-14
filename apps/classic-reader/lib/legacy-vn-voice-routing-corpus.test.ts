import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  buildLegacyVoiceSlots,
  legacyVoiceRoutePath,
  parseLegacyVoiceRouteDocument,
  summarizeLegacyVoiceSlots,
} from './legacy-vn-voice-routing.ts';
import { parseStoryContent } from './story-parser.ts';

type StoryIndexEntry = {
  path_cn: string | null;
  path_jp: string | null;
  source_identity: string;
  source_format?: string;
};

const publicRoot = process.env.ADV_READER_PUBLIC_ROOT || resolve('public');
const readPublic = (publicPath: string): string => readFileSync(
  resolve(publicRoot, publicPath.replace(/^\/+/, '')),
  'utf8',
);

test('all selected stories expose exact expandable voice slots for their published languages', () => {
  const published = JSON.parse(
    readFileSync(resolve(publicRoot, 'story_index.json'), 'utf8'),
  ) as StoryIndexEntry[];
  const stories = published.filter(story=>story.source_format!=='supplemental-text/v1');
  const manifest = JSON.parse(readPublic('/data/legacy-vn/manifests/reader-adapter.json')) as { stories: Array<{ canonicalStoryId: string; readerIdentity?: string; resource: { reader: { decision: string } } }> };
  const expectedIds = manifest.stories.filter(item => item.resource.reader.decision === 'include').map(item => item.readerIdentity ?? item.canonicalStoryId);
  assert.deepEqual(stories.map(item => item.source_identity).sort(), expectedIds.sort());

  const voicedStories = { 'zh-CN': 0, 'ja-JP': 0 };
  const cueCounts = { 'zh-CN': 0, 'ja-JP': 0 };
  const detachedCueCounts = { 'zh-CN': 0, 'ja-JP': 0 };
  const expectedVoicedStories = { 'zh-CN': 0, 'ja-JP': 0 };
  const expectedCueCounts = { 'zh-CN': 0, 'ja-JP': 0 };
  const expectedDetachedCueCounts = { 'zh-CN': 0, 'ja-JP': 0 };

  for (const story of stories) {
    const routePath = legacyVoiceRoutePath(story.source_identity);
    assert.ok(routePath, story.source_identity);
    const route = parseLegacyVoiceRouteDocument(
      JSON.parse(readPublic(routePath)),
      story.source_identity,
    );

    for (const [locale, textPath] of [
      ['zh-CN', story.path_cn],
      ['ja-JP', story.path_jp],
    ] as const) {
      const variantId = locale === 'zh-CN' ? route.chineseVariantId : route.japaneseVariantId;
      const variant = route.variantRoutes.find(item => item.variantId === variantId);
      assert.equal(Boolean(textPath), Boolean(variant), `${story.source_identity}/${locale} source presence`);
      const nativeEvents = variant?.sections.flatMap(section => section.events) ?? [];
      const expectedCues = nativeEvents.reduce((count, event) => count + (event.cues ?? []).filter(cue => cue.kind === 'voice').length, 0);
      const expectedDetached = nativeEvents.filter(event => event.kind !== 'line' || event.textLineIndex?.[locale] === undefined).reduce((count, event) => count + (event.cues ?? []).filter(cue => cue.kind === 'voice').length, 0);
      expectedCueCounts[locale] += expectedCues; expectedDetachedCueCounts[locale] += expectedDetached;
      if (expectedCues) expectedVoicedStories[locale] += 1;
      const raw = textPath ? readPublic(textPath) : '';
      const filename = textPath?.split('/').at(-1);
      const eventLines = parseStoryContent(raw, {
        filename,
        mergeConsecutiveTextLines: false,
      }).lines;
      const displayLines = parseStoryContent(raw, {
        filename,
        mergeConsecutiveTextLines: true,
      }).lines;
      const slots = buildLegacyVoiceSlots(route, locale, eventLines);
      if (!variant) {
        assert.deepEqual(eventLines, []); assert.deepEqual(slots.eventSlots, []);
        assert.deepEqual(slots.displaySlots, []); assert.deepEqual(slots.detachedCues, []);
      }
      assert.equal(slots.eventSlots.length, eventLines.length, story.source_identity);
      assert.equal(slots.displaySlots.length, displayLines.length, story.source_identity);
      const summary = summarizeLegacyVoiceSlots(slots.eventSlots);
      assert.equal(
        summary.totalLines,
        eventLines.filter(line => !line.isHeader && !line.isChoice).length,
        story.source_identity,
      );
      cueCounts[locale] += summary.cueCount + slots.detachedCues.length;
      detachedCueCounts[locale] += slots.detachedCues.length;
      if (summary.cueCount + slots.detachedCues.length > 0) voicedStories[locale] += 1;
    }
  }

  assert.deepEqual(voicedStories, expectedVoicedStories);
  assert.deepEqual(cueCounts, expectedCueCounts);
  assert.deepEqual(detachedCueCounts, expectedDetachedCueCounts);
});
