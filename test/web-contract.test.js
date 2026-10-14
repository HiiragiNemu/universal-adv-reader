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
  const app = await readFile(path.join(webRoot, 'app.js'), 'utf8');
  const classicCss = await readFile(
    path.join(webRoot, 'classic', 'authority', 'current-reader-layout.css'),
    'utf8',
  );
  const story = await fixtureJson('demo-story.json');
  const lines = allStoryEvents(story).filter((event) => event.kind === 'line');

  assert.equal(manifest.voiceControls.availableForAllStories, true);
  assert.equal(manifest.voiceControls.unresolvedCueBehavior, 'visible');
  assert.match(html, /magi-reader-header-actions/u);
  assert.match(html, /magi-reader-film-calibration/u);
  assert.match(html, /magi-reader-film-ruler/u);
  assert.match(html, /classic\/authority\/current-reader-layout\.css/u);
  assert.doesNotMatch(html, /classic\/authority\/(?:globals|ui-refinements)\.css/u);
  assert.match(html, /magi-madeinmagius-text/u);
  assert.match(html, />MadeIn</u);
  assert.match(html, />Magius</u);
  assert.match(app, /reader-adapter\.json/u);
  assert.match(app, /buildResearchCatalog/u);
  assert.match(app, /loadAuthorityTemplates/u);
  assert.match(app, /magi-home-category-node/u);
  assert.match(app, /folder-card-template\.html/u);
  assert.match(app, /magi-reader-story-expand-button/u);
  assert.match(app, /magi-reader-film-ruler-mark/u);
  assert.match(app, /voiceSlotForEvent/u);
  assert.match(classicCss, /\.magi-reader-sidebar/u);
  assert.match(classicCss, /\.magi-reader-film-ruler-mark/u);
  assert.match(classicCss, /\.magi-folder-source-card/u);
  assert.equal(lines.map(voiceSlotForEvent).every(Boolean), true);

  await Promise.all([
    access(path.join(webRoot, 'textures', 'magi-lofi-grain.png')),
    access(path.join(webRoot, 'media', 'demo-voice.wav')),
    access(path.join(webRoot, 'media', 'demo-step.wav')),
    access(path.join(webRoot, 'media', 'platform.svg')),
  ]);
});
