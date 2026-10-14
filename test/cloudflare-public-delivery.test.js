import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import worker, { parseRange } from '../tools/cloudflare/large-media-worker.mjs';

const key = 'a'.repeat(64) + '.wav';
const bytes = new Uint8Array([82, 73, 70, 70, 4, 5, 6, 7]);
function environment() {
  const calls = [];
  return { calls, MEDIA: {
    async head(name) { calls.push(['head', name]); return name === key ? { size: bytes.length } : null; },
    async get(name, options) {
      calls.push(['get', name, options]);
      const r = options?.range;
      return { body: r ? bytes.slice(r.offset, r.offset + r.length) : bytes };
    },
  } };
}

test('Cloudflare media supports bounded single, suffix and open-ended ranges', () => {
  assert.equal(parseRange(null, 8), null);
  assert.deepEqual(parseRange('bytes=0-3', 8), { offset: 0, length: 4, end: 3 });
  assert.deepEqual(parseRange('bytes=-3', 8), { offset: 5, length: 3, end: 7 });
  assert.deepEqual(parseRange('bytes=5-', 8), { offset: 5, length: 3, end: 7 });
  assert.deepEqual(parseRange('bytes=2-999', 8), { offset: 2, length: 6, end: 7 });
  for (const input of ['bytes=8-', 'bytes=2-1', 'bytes=-0', 'bytes=0-1,4-5', 'bytes=9007199254740992-', 'bad']) assert.throws(() => parseRange(input, 8), RangeError);
});

test('Cloudflare media GET and HEAD have exact bytes and safe CORS', async () => {
  const env = environment();
  const response = await worker.fetch(new Request('https://media.test/' + key, { headers: { Range: 'bytes=0-3' } }), env);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 0-3/8');
  assert.equal(response.headers.get('content-length'), '4');
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes.slice(0, 4));
  env.calls.length = 0;
  const head = await worker.fetch(new Request('https://media.test/' + key, { method: 'HEAD' }), env);
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  assert.equal(env.calls.some(c => c[0] === 'get'), false);
});

test('Cloudflare media rejects writes, traversal, wrong keys and impossible ranges', async () => {
  for (const method of ['PUT', 'POST', 'DELETE', 'PATCH']) {
    const env = environment();
    const response = await worker.fetch(new Request('https://media.test/' + key, { method }), env);
    assert.equal(response.status, 405); assert.equal(env.calls.length, 0);
  }
  for (const suffix of ['%2e%2e%2fsecret', '.env', 'list', key + '?token=x']) {
    const env = environment();
    assert.equal((await worker.fetch(new Request('https://media.test/' + suffix), env)).status, 404);
    assert.equal(env.calls.length, 0);
  }
  const invalid = await worker.fetch(new Request('https://media.test/' + key, { headers: { Range: 'bytes=8-20' } }), environment());
  assert.equal(invalid.status, 416); assert.equal(invalid.headers.get('content-range'), 'bytes */8');
});

test('Cloudflare conditional media requests do not return stale partial data', async () => {
  const etag = '"' + 'a'.repeat(64) + '"';
  const unchanged = await worker.fetch(new Request('https://media.test/' + key, { headers: { 'If-None-Match': etag } }), environment());
  assert.equal(unchanged.status, 304);
  const changed = await worker.fetch(new Request('https://media.test/' + key, { headers: { 'If-Range': '"wrong"', Range: 'bytes=0-1' } }), environment());
  assert.equal(changed.status, 200); assert.deepEqual(new Uint8Array(await changed.arrayBuffer()), bytes);
});

test('Public static route keeps local filenames and text off network URLs', async () => {
  const picker = await fs.readFile(new URL('../apps/classic-reader/components/LocalStoryPicker.tsx', import.meta.url), 'utf8');
  assert.match(picker, /\? '\/reader\/local\?local=1'/);
  assert.doesNotMatch(picker, /\/reader\/local\?[^'`\n]*id=/);
  const build = await fs.readFile(new URL('../tools/build-cloudflare-pages.mjs', import.meta.url), 'utf8');
  assert.match(build, /output: 'export'/);
  assert.match(build, /sourceDirty: dirty/);
  assert.match(build, /api\|corpus/);
  assert.match(build, /githubActionsRequired: false/);
});
