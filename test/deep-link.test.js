import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BRIDGE_REVISION,
  buildStoryDeepLink,
  canSynchronizeExactEvent,
  parseStoryDeepLink,
} from '../packages/bridge/src/deep-link.js';

test('stable story location survives a deep-link round trip', () => {
  const location = {
    canonicalStoryId: 'demo/arrival',
    variantId: 'demo/default',
    sectionId: 'prologue',
    eventId: 'branch-platform',
  };
  const url = buildStoryDeepLink('https://reader.example/apps/web/?embed=1', location, {
    storyRevision: 'demo-story-r1',
    catalogRevision: 'demo-catalog-r1',
  });
  const parsed = parseStoryDeepLink(url, {
    bridgeRevision: BRIDGE_REVISION,
    storyRevision: 'demo-story-r1',
    catalogRevision: 'demo-catalog-r1',
  });

  assert.deepEqual(parsed.location, {
    ...location,
    storyRevision: 'demo-story-r1',
    catalogRevision: 'demo-catalog-r1',
    bridgeRevision: BRIDGE_REVISION,
  });
  assert.deepEqual(parsed.revision, { bridge: 'exact', story: 'exact', catalog: 'exact' });
  assert.equal(canSynchronizeExactEvent(parsed.revision), true);
});

test('revision mismatch blocks exact event synchronization without dropping location', () => {
  const parsed = parseStoryDeepLink(
    'https://reader.example/?canonicalStoryId=demo%2Farrival&eventId=line-001&storyRevision=old',
    { storyRevision: 'new' },
  );
  assert.equal(parsed.location.eventId, 'line-001');
  assert.equal(parsed.revision.story, 'mismatch');
  assert.equal(canSynchronizeExactEvent(parsed.revision), false);
});
