import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MediaResolverRegistry,
  createManifestMediaResolver,
} from '../packages/core/src/media-resolver-registry.js';
import { fixtureJson } from '../test-support/helpers.js';

test('manifest resolver returns an exact voice route and explicit unresolved states', async () => {
  const manifest = await fixtureJson('media.json');
  const story = await fixtureJson('demo-story.json');
  const registry = new MediaResolverRegistry();
  registry.register(createManifestMediaResolver(manifest, {
    baseUrl: 'https://reader.example/apps/web/data/media.json',
  }));
  const [resolvedCue] = story.variants[0].sections[0].events[0].cues
    .filter((cue) => cue.kind === 'voice');
  const [missingCue] = story.variants[0].sections[0].events[1].cues;

  const resolved = await registry.resolve(resolvedCue);
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.url, 'https://reader.example/apps/web/media/demo-voice.wav');

  const missing = await registry.resolve(missingCue);
  assert.equal(missing.status, 'unresolved');
  assert.equal(missing.reason, 'mediaId was not found');

  const mismatch = await registry.resolve({ ...resolvedCue, kind: 'sfx' });
  assert.equal(mismatch.status, 'unresolved');
  assert.match(mismatch.reason, /is voice, not requested sfx/);
});
