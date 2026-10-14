import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sha256, projectPublicProgress, publicInputHashes, addWindowsRscAliases } from '../tools/cloudflare/static-projection.mjs';

async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adv-static-projection-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('Public progress validates input bindings and publishes the API payload, not the storage wrapper', async t => {
  const root = await temporary(t), progress = { schema: 'generic-progress/v1', entries: [{ id: 'test', pending: 1 }] };
  await fs.writeFile(path.join(root, 'story_index.json'), '[]');
  const snapshot = { bindings: { 'story_index.json': sha256('[]') }, progress };
  await fs.writeFile(path.join(root, 'generic-progress.json'), JSON.stringify(snapshot));
  assert.deepEqual(await projectPublicProgress(root), progress);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'generic-progress.json'), 'utf8')), snapshot);
  await fs.writeFile(path.join(root, 'story_index.json'), '[{}]');
  await assert.rejects(projectPublicProgress(root), /Stale progress binding/);
});

test('Public progress rejects absent bindings, invalid digests and traversal', async t => {
  const root = await temporary(t);
  for (const bindings of [{}, { '../private.json': 'a'.repeat(64) }, { 'x.json': 'not-a-sha' }]) {
    await fs.writeFile(path.join(root, 'generic-progress.json'), JSON.stringify({ bindings, progress: {} }));
    await assert.rejects(projectPublicProgress(root));
  }
});

test('Windows RSC aliases preserve exact bytes and originals, remain idempotent and reject collisions', async t => {
  const root = await temporary(t);
  const nested = path.join(root, 'proofreading/status/__next.proofreading/status/__PAGE__.txt');
  await fs.mkdir(path.dirname(nested), { recursive: true });
  const bytes = Buffer.from('0:{"children":"校对"}\n', 'utf8');
  await fs.writeFile(nested, bytes);
  const mappings = await addWindowsRscAliases(root);
  assert.equal(mappings.length, 1);
  assert.equal(mappings[0].alias, 'proofreading/status/__next.proofreading.status.__PAGE__.txt');
  const alias = path.join(root, mappings[0].alias);
  assert.deepEqual(await fs.readFile(alias), bytes);
  assert.deepEqual(await fs.readFile(nested), bytes);
  assert.deepEqual(await addWindowsRscAliases(root), mappings);
  await fs.writeFile(alias, 'different');
  await assert.rejects(addWindowsRscAliases(root), /alias collision/);
});

test('Build input hashing detects content changes even when the story index remains identical', async t => {
  const root = await temporary(t);
  await fs.mkdir(path.join(root, 'data'), { recursive: true });
  await fs.writeFile(path.join(root, 'story_index.json'), '[]');
  await fs.writeFile(path.join(root, 'data/story.txt'), '原译文');
  const first = await publicInputHashes(root);
  await fs.writeFile(path.join(root, 'data/story.txt'), '修订后的译文');
  const second = await publicInputHashes(root);
  assert.equal(first['story_index.json'], second['story_index.json']);
  assert.notEqual(first['data/story.txt'], second['data/story.txt']);
});
