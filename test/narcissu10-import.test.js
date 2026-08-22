import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allStoryEvents,
  validateMediaManifest,
  validateStoryDocument,
} from '../packages/contracts/src/index.js';
import { voiceSlotForEvent } from '../packages/core/src/reader-session.js';
import { fixtureJson } from '../test-support/helpers.js';

test('Narcissu 10th production slice preserves aligned text, source anchors, and exact media routes', async () => {
  const story = validateStoryDocument(await fixtureJson(
    'corpora/narcissu10/himeko-ep00.story.json',
  ));
  const media = validateMediaManifest(await fixtureJson(
    'corpora/narcissu10/himeko-ep00.media.json',
  ));
  const report = await fixtureJson('corpora/narcissu10/himeko-ep00.import-report.json');

  assert.equal(story.canonicalStoryId, 'narcissu-himeko/himeko_ep00');
  assert.equal(story.provenance.engine, 'majiro');
  assert.equal(story.variants.length, 3);
  const eventIds = story.variants.map((variant) =>
    variant.sections[0].events.map((event) => event.eventId));
  assert.deepEqual(eventIds[1], eventIds[0]);
  assert.deepEqual(eventIds[2], eventIds[0]);

  const linesByVariant = story.variants.map((variant) =>
    variant.sections[0].events.filter((event) => event.kind === 'line'));
  assert.deepEqual(linesByVariant.map((lines) => lines.length), [13, 13, 13]);
  assert.match(linesByVariant[0][0].text['zh-CN'], /富士山/u);
  assert.match(linesByVariant[0][0].text['ja-JP'], /富士山/u);
  assert.match(linesByVariant[2][0].text.en, /Mount Fuji/u);
  assert.equal(linesByVariant.flat().map(voiceSlotForEvent).every(Boolean), true);

  const cues = allStoryEvents(story).flatMap((event) => event.cues ?? []);
  const kinds = new Set(cues.map((cue) => cue.kind));
  assert.deepEqual([...kinds].sort(), ['bgm', 'image', 'sfx', 'voice']);
  assert.equal(cues.every((cue) => cue.raw?.sourceKey && Number.isInteger(cue.raw.codeOffset)), true);
  assert.equal(linesByVariant.flat().every((line) => /^mjo-[0-9a-f]+$/u.test(line.source.mjoAnchor)), true);

  const mediaIds = new Set(media.entries.map((entry) => entry.mediaId));
  assert.equal(cues.every((cue) => mediaIds.has(cue.mediaId)), true);
  assert.equal(media.entries.every((entry) => entry.url.startsWith('/corpus/archive/')), true);
  assert.deepEqual(report.unresolvedMediaKeys, []);
  assert.deepEqual(report.generated.mediaEntriesByRole, {
    voice: 22,
    bgm: 2,
    sfx: 10,
    image: 18,
  });
});
