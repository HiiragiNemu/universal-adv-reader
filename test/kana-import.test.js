import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allStoryEvents,
  validateMediaManifest,
  validateStoryDocument,
} from '../packages/contracts/src/index.js';
import { ReaderSession, voiceSlotForEvent } from '../packages/core/src/reader-session.js';
import { fixtureJson } from '../test-support/helpers.js';

test('KANA EV494 preserves aligned bilingual text, exact voices, images, BGM, and route anchors', async () => {
  const story = validateStoryDocument(await fixtureJson('corpora/kana/ev494.story.json'));
  const media = validateMediaManifest(await fixtureJson('corpora/kana/ev494.media.json'));
  const report = await fixtureJson('corpora/kana/ev494.import-report.json');

  assert.equal(story.canonicalStoryId, 'kana-okaeri/ev494');
  assert.equal(story.provenance.engine, 'ikura');
  assert.equal(story.provenance.routeTopologyEqual, true);
  assert.equal(story.variants.length, 3);
  const linesByVariant = story.variants.map((variant) =>
    variant.sections[0].events.filter((event) => event.kind === 'line'));
  assert.deepEqual(linesByVariant.map((lines) => lines.length), [40, 40, 40]);
  assert.match(linesByVariant[0][0].text['zh-CN'], /回到医院/u);
  assert.match(linesByVariant[0][0].text['ja-JP'], /病院/u);
  assert.equal(linesByVariant.flat().map(voiceSlotForEvent).every(Boolean), true);
  assert.equal(JSON.stringify(story).includes('ＧＤＬ内部でエラー'), false);

  const cues = allStoryEvents(story).flatMap((event) => event.cues ?? []);
  assert.deepEqual([...new Set(cues.map((cue) => cue.kind))].sort(), ['bgm', 'image', 'voice']);
  assert.equal(cues.filter((cue) => cue.kind === 'voice').length, 18);
  assert.equal(cues.some((cue) => cue.raw?.sourceKey === 'Kan2048'), true);
  assert.equal(cues.some((cue) => cue.raw?.sourceKey === 'TK11.ogg'), true);
  assert.equal(cues.some((cue) => cue.raw?.sourceKey === 'KE049P6'), true);
  assert.equal(cues.every((cue) => cue.raw?.routeTopologyEqual === true), true);
  assert.equal(media.entries.length, 10);
  assert.equal(report.generated.hiddenInternalTextAlignments, 1);
  assert.equal(report.routeVerification.nonTextOperandDifferenceCount, 0);
});

test('KANA EV00 exposes both localized user choices and preserves all three VM selector arms', async () => {
  const story = validateStoryDocument(await fixtureJson('corpora/kana/ev00.story.json'));
  const media = validateMediaManifest(await fixtureJson('corpora/kana/ev00.media.json'));
  const report = await fixtureJson('corpora/kana/ev00.import-report.json');
  const variant = story.variants[0];
  const events = variant.sections[0].events;
  const choice = events.find((event) => event.kind === 'choice');

  assert.equal(choice.choices.length, 2);
  assert.match(choice.choices[0].label['zh-CN'], /曾经/u);
  assert.match(choice.choices[1].label['ja-JP'], /妹がいる/u);
  assert.equal(choice.source.arms.length, 3);
  assert.deepEqual(choice.source.arms.map((arm) => arm.armIndex), [0, 1, 2]);
  assert.deepEqual(choice.cues.map((cue) => cue.mediaId), ['kana.ev00.image.COM_B']);
  assert.deepEqual(
    events.find((event) => event.eventId === 'branch-001-end').cues
      .map((cue) => cue.mediaId),
    ['kana.ev00.image.BLACK'],
  );
  assert.deepEqual(
    events.find((event) => event.eventId === 'branch-002-end').cues
      .map((cue) => cue.mediaId),
    ['kana.ev00.image.BLACK'],
  );
  assert.equal(events.some((event) => event.eventId === 'runtime-error-end'), true);

  const session = new ReaderSession(story, {
    canonicalStoryId: story.canonicalStoryId,
    variantId: variant.variantId,
    sectionId: 'main',
  });
  session.next();
  assert.equal(session.currentEvent.kind, 'choice');
  session.choose('route-1');
  assert.equal(session.currentEvent.eventId, 'branch-001-end');
  assert.equal(media.entries.length, 2);
  assert.equal(report.generated.preservedUserChoices, 2);
  assert.equal(report.generated.preservedSelectorArms, 3);
});
