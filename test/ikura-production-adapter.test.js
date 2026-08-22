import assert from 'node:assert/strict';
import test from 'node:test';

import { createIkuraProductionAdapter } from '../packages/adapters/src/ikura-production-v1.js';
import { fixtureJson } from '../test-support/helpers.js';

test('IKURA production adapter accepts only normalized stories with exact provenance', async () => {
  const adapter = createIkuraProductionAdapter();
  const story = await fixtureJson('corpora/kana/ev494.story.json');
  const loaded = await adapter.load({
    storyEntry: { source: './story.json' },
    io: { fetchJson: async () => story },
  });
  assert.equal(loaded.adapterId, 'ikura-production-v1');
  assert.equal(loaded.provenance.engine, 'ikura');
  assert.equal(loaded.provenance.sourceSchema, 'vn-ikura-script/v1');

  const invalid = structuredClone(story);
  invalid.provenance.engine = 'majiro';
  await assert.rejects(
    adapter.load({ storyEntry: {}, io: { fetchJson: async () => invalid } }),
    /provenance\.engine="ikura"/,
  );
});
