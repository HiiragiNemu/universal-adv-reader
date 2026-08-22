import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ReaderRouteError,
  ReaderSession,
  voiceRouteSummary,
  voiceSlotForEvent,
} from '../packages/core/src/reader-session.js';
import { fixtureJson } from '../test-support/helpers.js';

test('reader session preserves explicit choices, branch history, and stable location', async () => {
  const story = await fixtureJson('demo-story.json');
  const session = new ReaderSession(story, { sectionId: 'prologue' });

  assert.equal(session.location.eventId, 'line-001');
  assert.equal(session.next(), true);
  assert.equal(session.next(), true);
  assert.equal(session.currentEvent.kind, 'choice');
  assert.throws(() => session.next(), ReaderRouteError);
  const choice = session.choose('platform');
  assert.equal(choice.nextEventId, 'branch-platform');
  assert.deepEqual(session.history, ['line-001', 'line-002', 'choice-001', 'branch-platform']);
  assert.equal(session.location.canonicalStoryId, 'demo/arrival');
  assert.equal(session.back(), true);
  assert.equal(session.currentEvent.eventId, 'choice-001');

  session.open({ sectionId: 'epilogue', eventId: 'line-101' });
  assert.equal(session.location.sectionId, 'epilogue');
  assert.equal(session.location.eventId, 'line-101');
});

test('every line receives a voice slot when the all-story panel is expanded', async () => {
  const story = await fixtureJson('demo-story.json');
  const lines = story.variants[0].sections.flatMap((section) => section.events)
    .filter((event) => event.kind === 'line');
  const slots = lines.map(voiceSlotForEvent);
  const summary = voiceRouteSummary(story);

  assert.equal(summary.expandableForAllStories, true);
  assert.equal(summary.eligibleEvents, lines.length);
  assert.equal(slots.length, 6);
  assert.equal(slots.every((slot) => slot.visibleWhenExpanded), true);
  assert.equal(slots.filter((slot) => slot.status === 'declared').length, 2);
  assert.equal(slots.filter((slot) => slot.status === 'empty').length, 4);
});
