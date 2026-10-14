import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readPublishedJson, sameRelease, hashFileMap, assertFileMapUnchanged, outputInventory, assertOutputUnchanged } from '../tools/cloudflare/release-integrity.mjs';

const release = { buildId: 'current', sourceSha256: 'source', publicInputSha256: 'public', indexSha256: 'index', revisionRegistrySha256: 'registry', buildToolSha256: 'tool', gitRevision: 'commit', sourceDirty: false };
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('Readback recovers from 522 and an old release without repeating upload', async () => {
  const responses = [new Response('origin timeout', { status: 522 }), json({ ...release, buildId: 'old' }), json(release)];
  const waits = [], retries = [];
  const result = await readPublishedJson('https://public.test/release.json', { fetchImpl: async () => responses.shift(), validate: value => sameRelease(value, release), sleep: async ms => waits.push(ms), onRetry: e => retries.push(e) });
  assert.deepEqual(result, release); assert.deepEqual(waits, [1000, 2000]); assert.equal(retries.length, 2);
});

test('Readback stops at its bound and never accepts stale content', async () => {
  let calls = 0;
  await assert.rejects(readPublishedJson('https://public.test/release.json', { attempts: 3, fetchImpl: async () => { calls++; return json({ ...release, indexSha256: 'wrong' }); }, validate: value => sameRelease(value, release), sleep: async () => {} }), /expected release/);
  assert.equal(calls, 3);
});

test('Readback does not retry authentication and permission failures', async () => {
  let calls = 0;
  await assert.rejects(readPublishedJson('https://public.test/release.json', { fetchImpl: async () => { calls++; return new Response('forbidden', { status: 403 }); }, sleep: async () => assert.fail('should not wait') }), /403/);
  assert.equal(calls, 1);
});

test('Readback honors bounded Retry-After and consumes only the expected JSON', async () => {
  const responses = [new Response('busy', { status: 429, headers: { 'Retry-After': '3600' } }), json(release)];
  const waits = [];
  assert.deepEqual(await readPublishedJson('https://public.test/release.json', { fetchImpl: async () => responses.shift(), sleep: async ms => waits.push(ms), maxDelayMs: 5000 }), release);
  assert.deepEqual(waits, [5000]);
});

test('Release identity includes the source commit and dirty state', () => {
  assert.equal(sameRelease(release, release), true);
  for (const key of Object.keys(release)) assert.equal(sameRelease({ ...release, [key]: 'changed' }, release), false, key);
  assert.equal(sameRelease({}, {}), false);
});

test('Input fingerprint catches added, removed and modified build dependencies', () => {
  const input = { 'app/page.tsx': 'one', 'tools/data.json': 'two' };
  assert.equal(hashFileMap(input), hashFileMap({ 'tools/data.json': 'two', 'app/page.tsx': 'one' }));
  assertFileMapUnchanged(input, { ...input }, 'test');
  for (const altered of [{ ...input, 'app/new.tsx': 'new' }, { 'app/page.tsx': 'one' }, { ...input, 'tools/data.json': 'changed' }]) {
    assert.throws(() => assertFileMapUnchanged(input, altered, 'test'), /rebuild/);
  }
});

test('Deploy inventory detects same-size edits and injected output files', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'adv-integrity-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  await fs.writeFile(path.join(folder, 'index.html'), 'safe');
  const inventory = await outputInventory(folder);
  await assertOutputUnchanged(inventory, folder);
  await fs.writeFile(path.join(folder, 'index.html'), 'edit');
  await assert.rejects(assertOutputUnchanged(inventory, folder), /output changed/);
  await fs.writeFile(path.join(folder, 'index.html'), 'safe');
  await fs.writeFile(path.join(folder, '.env'), 'private test fixture');
  await assert.rejects(assertOutputUnchanged(inventory, folder), /output changed/);
  await assert.rejects(assertOutputUnchanged([{ path: 'index.html', bytes: 4 }], folder), /lacks output hashes/);
});

test('Invalid retry configuration is rejected before any network access', async () => {
  await assert.rejects(readPublishedJson('https://public.test', { attempts: 0 }), RangeError);
  await assert.rejects(readPublishedJson('https://public.test', { baseDelayMs: -1 }), RangeError);
});
