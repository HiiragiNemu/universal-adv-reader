import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { allStoryEvents } from '../packages/contracts/src/index.js';
import { voiceSlotForEvent } from '../packages/core/src/reader-session.js';
import { fixtureJson, repositoryRoot } from '../test-support/helpers.js';

test('web manifest and markup expose all-story voice routing controls', async () => {
  const webRoot = path.join(repositoryRoot, 'apps', 'web');
  const manifest = JSON.parse(await readFile(
    path.join(webRoot, '.well-known', 'adv-app.json'),
    'utf8',
  ));
  const html = await readFile(path.join(webRoot, 'index.html'), 'utf8');
  const story = await fixtureJson('demo-story.json');
  const lines = allStoryEvents(story).filter((event) => event.kind === 'line');

  assert.equal(manifest.voiceControls.availableForAllStories, true);
  assert.equal(manifest.voiceControls.unresolvedCueBehavior, 'visible');
  assert.match(html, /id="voice-toggle"/);
  assert.match(html, /所有剧情均可展开/);
  assert.equal(lines.map(voiceSlotForEvent).every(Boolean), true);

  await Promise.all([
    access(path.join(webRoot, 'media', 'demo-voice.wav')),
    access(path.join(webRoot, 'media', 'demo-step.wav')),
    access(path.join(webRoot, 'media', 'platform.svg')),
  ]);
});
