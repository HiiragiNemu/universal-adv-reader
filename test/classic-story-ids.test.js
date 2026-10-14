import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { classicStoryIds } from '../tools/generate-classic-story-ids.mjs';
import { repositoryRoot } from '../test-support/helpers.js';

test('generated membership is exactly the current reviewed public story set', async () => {
  const publicRoot = path.join(repositoryRoot, 'apps/classic-reader/public');
  const index = JSON.parse(await readFile(path.join(publicRoot, 'story_index.json'), 'utf8'));
  const generated = JSON.parse(await readFile(path.join(publicRoot, 'data/story_ids.generated.json'), 'utf8'));
  assert.deepEqual(generated, classicStoryIds(index));
  const selection = JSON.parse(await readFile(path.join(publicRoot, 'data/legacy-vn/manifests/reader-selection.json'), 'utf8'));
  const supplemental=JSON.parse(await readFile(path.join(publicRoot,'data/legacy-vn/manifests/supplemental-texts.json'),'utf8'));
  assert.equal(generated.length, selection.records.filter(record => record.decision === 'include').length+supplemental.entries.length);
  assert.deepEqual(index.filter(s=>s.source_format==='supplemental-text/v1').map(s=>s.id).sort(),supplemental.entries.map(s=>s.id).sort());
  assert.ok(generated.every(id => /^legacy-(?:narcissu|kana)-/.test(id)));
});

test('membership generation accepts reviewed count changes and rejects unsafe or duplicated routes', () => {
  const index = Array.from({ length: 200 }, (_, n) => ({ id: `legacy-narcissu-test-${n}` }));
  assert.equal(classicStoryIds(index.slice(1)).length, 199);
  assert.equal(classicStoryIds([...index,{id:'legacy-narcissu-3rd-product'}]).length, 201);
  assert.throws(() => classicStoryIds([]), /nonempty|empty|bounded|Missing/i);
  for (const id of ['101001', '../legacy-x', index[0].id, index[0].id.replace('narcissu', 'NARCISSU')]) {
    assert.throws(() => classicStoryIds([...index.slice(0, 199), { id }]), /identity|Duplicate/);
  }
});
