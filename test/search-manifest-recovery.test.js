import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { classicApp, classicModules } from '../test-support/classic-module-loader.js';
const { getSearchIndexSources } = classicModules().load('lib/search-index-scope.ts');
const manifest = JSON.parse(fs.readFileSync(path.join(classicApp, 'public/search_index_manifest.generic.json'), 'utf8'));
const load = (fetcher, signal = new AbortController().signal, expected = manifest.story_index_sha256) => getSearchIndexSources(signal, expected, 'generic', fetcher);

test('search manifest automatically recovers from one transient 503 without page reload', async () => {
  let calls = 0;
  const result = await load(async () => ++calls === 1 ? new Response('temporary', {status:503}) : Response.json(manifest));
  assert.equal(calls,2); assert.equal(result[0].sha256,manifest.sha256);
});
test('search manifest retries a network failure but keeps its original same-origin URL', async () => {
  let calls = 0;
  const result = await load(async (url, options) => {
    assert.equal(url,'/search_index_manifest.generic.json'); assert.equal(options.cache,'no-store'); assert.equal(options.credentials,'same-origin');
    if (++calls === 1) throw new TypeError('network disconnected');
    return Response.json(manifest);
  });
  assert.equal(calls,2); assert.equal(result.length,1);
});
test('search manifest retries are bounded and never produce an empty successful index', async () => {
  let calls=0;
  await assert.rejects(()=>load(async()=>{calls++;return new Response('temporary',{status:503});}),/503/);
  assert.equal(calls,3);
});
test('search manifest permission failures do not retry', async () => {
  let calls=0;
  await assert.rejects(()=>load(async()=>{calls++;return new Response('forbidden',{status:403});}),/403/);
  assert.equal(calls,1);
});
test('search manifest abort during backoff prevents all following requests', async () => {
  let calls=0; const abort=new AbortController();
  const pending=load(async()=>{calls++;setTimeout(()=>abort.abort(),25);return new Response('temporary',{status:503});},abort.signal);
  await assert.rejects(()=>pending,error=>error.name==='AbortError'); assert.equal(calls,1);
});
test('search manifest retry cannot bypass catalogue identity verification', async () => {
  let calls=0;
  await assert.rejects(()=>load(async()=>{calls++;return Response.json(manifest);},undefined,'0'.repeat(64)),/不匹配/);
  assert.equal(calls,1);
});
test('valid search manifest requires exactly one request', async () => {
  let calls=0;
  await load(async()=>{calls++;return Response.json(manifest);}); assert.equal(calls,1);
});
