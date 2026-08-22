import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { validateCatalog } from '../packages/contracts/src/index.js';
import { repositoryRoot } from '../test-support/helpers.js';

test('catalog exposes category-folder-story-episode navigation at every UI contract breakpoint', async () => {
  const webRoot = path.join(repositoryRoot, 'apps', 'web');
  const catalog = validateCatalog(JSON.parse(await readFile(
    path.join(webRoot, 'data', 'catalog.json'),
    'utf8',
  )));
  const app = await readFile(path.join(webRoot, 'app.js'), 'utf8');
  const styles = await readFile(path.join(webRoot, 'styles.css'), 'utf8');

  assert.equal(catalog.corpora.flatMap((corpus) => corpus.stories)
    .every((story) => story.folderId && story.folderTitle), true);
  assert.match(app, /dataset\.treeItem = 'category'/u);
  assert.match(app, /dataset\.treeItem = 'folder'/u);
  assert.match(app, /dataset\.treeItem = 'story'/u);
  assert.match(app, /dataset\.treeItem = 'episode'/u);
  assert.match(app, /ArrowDown/u);
  assert.match(app, /ArrowRight/u);
  assert.match(styles, /@media \(max-width: 767px\)/u);
  assert.match(styles, /@media \(max-width: 639px\)/u);
  assert.match(styles, /@media \(min-width: 1280px\)/u);
  assert.match(styles, /@media \(max-height: 511px\)/u);
  assert.match(styles, /min-height: 44px/u);
});
