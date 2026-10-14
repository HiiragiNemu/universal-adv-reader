import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { repositoryRoot } from '../test-support/helpers.js';

test('web uses one direct Classic architecture', async () => {
  const webRoot = path.join(repositoryRoot, 'apps', 'web');
  const html = await readFile(path.join(webRoot, 'index.html'), 'utf8');
  const app = await readFile(path.join(webRoot, 'app.js'), 'utf8');
  const stylesheetLinks = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/gu)]
    .map((match) => match[1]);

  assert.deepEqual(stylesheetLinks, [
    './classic/authority/current-reader-layout.css',
  ]);
  assert.doesNotMatch(html, /classic\/authority\/(?:globals|ui-refinements)\.css/u);
  assert.match(html, /class="[^"]*magi-home-shell[^"]*magi-home-frost-root/u);
  assert.match(html, /class="[^"]*magi-reader-sidebar/u);
  assert.match(html, /class="[^"]*magi-reader-film-calibration/u);
  assert.match(html, /class="[^"]*magi-reader-film-ruler/u);
  assert.match(html, /<section id="classic-dialog"[^>]*data-modeless="true"/u);
  assert.doesNotMatch(html, /<dialog\b/iu);
  assert.doesNotMatch(app, /\.showModal\(|\.close\(\)/u);
  assert.match(app, /magi-home-light-folder-header magi-home-light-folder-header-complete/u);
  assert.match(app, /magi-home-category-branch-overlay/u);
  assert.match(app, /magi-home-category-filter-overlay-menu/u);
  assert.match(app, /\['bloom', 'fringe-a', 'fringe-b'\]/u);
  assert.match(app, /bg-emerald-600 border-emerald-700 text-white/u);
  assert.match(app, /bg-emerald-900\/40 border-emerald-800 text-emerald-100/u);
  assert.match(app, /border-\[#A8D8B9\]/u);
  assert.match(app, /magi-floating-window-\$\{surfaceTheme\}/u);
  assert.doesNotMatch(html, /shells\/next|ui=next|next-shell/iu);

  const authorityRoot = path.join(webRoot, 'classic', 'authority');
  const [category, card, row] = await Promise.all([
    readFile(path.join(authorityRoot, 'home-category-template.html'), 'utf8'),
    readFile(path.join(authorityRoot, 'folder-card-template.html'), 'utf8'),
    readFile(path.join(authorityRoot, 'reader-row-template.html'), 'utf8'),
  ]);
  assert.match(category, /magi-home-category-node/u);
  assert.match(card, /magi-folder-source-card/u);
  assert.match(row, /magi-bilingual-pair-responsive/u);
});
