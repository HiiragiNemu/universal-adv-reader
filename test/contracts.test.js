import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ContractError,
  allStoryEvents,
  validateCatalog,
  validateMediaManifest,
  validateStoryDocument,
} from '../packages/contracts/src/index.js';
import { fixtureJson } from '../test-support/helpers.js';

test('production catalog and isolated adapter fixtures satisfy strict contracts', async () => {
  const catalog = validateCatalog(await fixtureJson('catalog.json'));
  const story = validateStoryDocument(await fixtureJson('demo-story.json'));
  const media = validateMediaManifest(await fixtureJson('media.json'));

  assert.deepEqual(catalog.corpora.map((corpus) => corpus.corpusId), [
    'narcissu10',
    'narcissu3',
    'kana',
  ]);
  assert.equal(catalog.corpora.some((corpus) => corpus.corpusId === 'architecture-demo'), false);
  assert.equal(allStoryEvents(story).length, 9);
  assert.equal(media.entries.length, 3);
});

test('story validation rejects a dangling branch edge', async () => {
  const story = structuredClone(await fixtureJson('demo-story.json'));
  story.variants[0].sections[0].events[2].choices[1].nextEventId = 'missing-event';

  assert.throws(
    () => validateStoryDocument(story),
    (error) => error instanceof ContractError
      && error.path.endsWith('choices[1].nextEventId')
      && error.message.includes('does not resolve'),
  );
});
