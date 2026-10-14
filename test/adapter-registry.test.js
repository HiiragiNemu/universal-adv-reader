import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdvIrAdapter } from '../packages/adapters/src/adv-ir-v1.js';
import { AdapterRegistry, AdapterRegistryError } from '../packages/core/src/adapter-registry.js';
import { fixtureJson } from '../test-support/helpers.js';

const inputs = async () => {
  const corpus = {
    corpusId: 'architecture-demo',
    title: 'Adapter fixture',
    adapterId: 'adv-ir-v1',
    sourceFormat: 'adv-story/v1',
    stories: [{
      canonicalStoryId: 'demo/arrival',
      title: 'Arrival',
      source: './data/demo-story.json',
      mediaManifest: './data/media.json',
      preferredVariantId: 'demo/default',
    }],
  };
  return {
    corpus,
    storyEntry: corpus.stories[0],
    story: await fixtureJson('demo-story.json'),
  };
};

test('adapter registry loads only the exact declared adapter and format', async () => {
  const { corpus, storyEntry, story } = await inputs();
  const registry = new AdapterRegistry();
  registry.register(createAdvIrAdapter());

  const loaded = await registry.loadStory(corpus, storyEntry, {
    fetchJson: async (source) => {
      assert.equal(source, './data/demo-story.json');
      return story;
    },
  });
  assert.equal(loaded.canonicalStoryId, 'demo/arrival');
});

test('adapter registry does not fall back to another installed adapter', async () => {
  const { corpus, storyEntry, story } = await inputs();
  let calls = 0;
  const registry = new AdapterRegistry();
  registry.register({
    id: 'another-adapter',
    sourceFormats: ['adv-story/v1'],
    async load() {
      calls += 1;
      return story;
    },
  });

  await assert.rejects(
    registry.loadStory(corpus, storyEntry, { fetchJson: async () => story }),
    (error) => error instanceof AdapterRegistryError
      && error.message.includes('declared adapter "adv-ir-v1" is not installed'),
  );
  assert.equal(calls, 0);
});

test('adapter registry rejects an undeclared source format', async () => {
  const { corpus, storyEntry, story } = await inputs();
  const registry = new AdapterRegistry();
  registry.register(createAdvIrAdapter());

  await assert.rejects(
    registry.loadStory({ ...corpus, sourceFormat: 'legacy-script/v9' }, storyEntry, {
      fetchJson: async () => story,
    }),
    /does not accept source format/,
  );
});
