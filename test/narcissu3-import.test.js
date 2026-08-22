import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allStoryEvents,
  validateMediaManifest,
  validateStoryDocument,
} from '../packages/contracts/src/index.js';
import { voiceSlotForEvent } from '../packages/core/src/reader-session.js';
import { fixtureJson } from '../test-support/helpers.js';

test('Narcissu 3 production story preserves Japanese anchors and exact media operands', async () => {
  const story = validateStoryDocument(await fixtureJson('corpora/narcissu3/nard14.story.json'));
  const media = validateMediaManifest(await fixtureJson('corpora/narcissu3/nard14.media.json'));
  const report = await fixtureJson('corpora/narcissu3/nard14.import-report.json');

  assert.equal(story.canonicalStoryId, 'narcissu-3rd/nard14');
  assert.equal(story.provenance.engine, 'majiro');
  assert.equal(story.variants.length, 1);
  const lines = allStoryEvents(story).filter((event) => event.kind === 'line');
  assert.equal(lines.length, 30);
  assert.match(lines[0].text['ja-JP'], /７階/u);
  assert.equal(lines.map(voiceSlotForEvent).every(Boolean), true);
  assert.equal(lines.every((line) => /^mjo-[0-9a-f]+$/u.test(line.source.mjoAnchor)), true);

  const cues = allStoryEvents(story).flatMap((event) => event.cues ?? []);
  assert.deepEqual([...new Set(cues.map((cue) => cue.kind))].sort(), ['bgm', 'image', 'voice']);
  assert.equal(cues.some((cue) => cue.raw?.sourceKey === 'b3'), true);
  assert.equal(cues.some((cue) => cue.raw?.sourceKey === 'n3tisa_0986'), true);
  assert.deepEqual(report.generated.mediaEntriesByRole, {
    voice: 2,
    bgm: 1,
    sfx: 0,
    image: 4,
  });
  assert.equal(media.entries.length, 7);
  assert.deepEqual(report.unresolvedMediaKeys, []);
});

test('Narcissu 3 nar3_01 publishes a full scene with routed background, voices, and effects', async () => {
  const story = validateStoryDocument(await fixtureJson('corpora/narcissu3/nar3_01.story.json'));
  const media = validateMediaManifest(await fixtureJson('corpora/narcissu3/nar3_01.media.json'));
  const report = await fixtureJson('corpora/narcissu3/nar3_01.import-report.json');
  const events = allStoryEvents(story);
  const lines = events.filter((event) => event.kind === 'line');
  const cues = events.flatMap((event) => event.cues ?? []);

  assert.equal(story.canonicalStoryId, 'narcissu-3rd/nar3_01');
  assert.equal(lines.length, 385);
  assert.equal(lines.map(voiceSlotForEvent).every(Boolean), true);
  assert.equal(cues.some((cue) => cue.raw?.sourceKey === '3008'
    && cue.raw?.presentationRole === 'scene'), true);
  assert.equal(cues.some((cue) => cue.raw?.sourceKey === 'b3'
    && cue.raw?.presentationRole === 'transition'), true);
  assert.equal(cues.filter((cue) => cue.kind === 'voice').length > 100, true);
  assert.deepEqual(report.generated.mediaEntriesByRole, {
    voice: 114,
    bgm: 2,
    sfx: 3,
    image: 28,
  });
  assert.equal(media.entries.length, 147);
  assert.deepEqual(report.unresolvedMediaKeys, []);
});
