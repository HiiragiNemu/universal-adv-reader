import assert from 'node:assert/strict';
import test from 'node:test';

import { createMajiroProductionAdapter } from '../packages/adapters/src/majiro-production-v1.js';
import { fixtureJson } from '../test-support/helpers.js';

test('Majiro production adapter accepts only normalized stories with exact provenance', async () => {
  const adapter = createMajiroProductionAdapter();
  const story = await fixtureJson('corpora/narcissu10/himeko-ep00.story.json');
  const loaded = await adapter.load({
    storyEntry: { source: './story.json' },
    io: { fetchJson: async () => story },
  });
  assert.equal(loaded.adapterId, 'majiro-production-v1');
  assert.equal(loaded.provenance.engine, 'majiro');
  assert.equal(loaded.provenance.sourceSchema, 'vn-mjo-reader-script/v1');

  const invalid = structuredClone(story);
  invalid.provenance.engine = 'ikura';
  await assert.rejects(
    adapter.load({ storyEntry: {}, io: { fetchJson: async () => invalid } }),
    /provenance\.engine="majiro"/,
  );
});
