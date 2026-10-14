import test from 'node:test';
import assert from 'node:assert/strict';
import { classicModules } from '../test-support/classic-module-loader.js';
const { loadSeekableVoiceBlob, MAX_SEEKABLE_VOICE_BYTES } = classicModules().load('lib/audio/seekable-voice-source.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
const signal = () => new AbortController().signal;
const bytes = new Uint8Array([79, 103, 103, 83, 1, 2, 3, 4]);
const response = () => new Response(bytes, { headers: { 'Content-Type': 'audio/ogg', 'Content-Length': String(bytes.length) } });

test('Static voice transport preserves every encoded byte without transcoding', async () => {
  let options;
  const blob = await loadSeekableVoiceBlob('/corpus/test.ogg', signal(), async (url, config) => { options = config; return response(); });
  assert.equal(blob.type, 'audio/ogg'); assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
  assert.equal(options.cache, 'force-cache'); assert.equal(options.credentials, 'same-origin');
});
test('Static voice transport rejects HTML, partial responses and declared oversized files', async () => {
  for (const r of [new Response('error', { headers: { 'Content-Type': 'text/html' } }), new Response(bytes, { status: 206, headers: { 'Content-Type': 'audio/ogg' } }), new Response(bytes, { headers: { 'Content-Type': 'audio/ogg', 'Content-Length': String(MAX_SEEKABLE_VOICE_BYTES + 1) } })]) {
    assert.equal(await loadSeekableVoiceBlob('/corpus/test.ogg', signal(), async () => r), null);
  }
});
test('Static voice transport bounds streamed responses even without Content-Length', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(MAX_SEEKABLE_VOICE_BYTES + 1)); }, cancel() { cancelled = true; } });
  assert.equal(await loadSeekableVoiceBlob('/corpus/test.ogg', signal(), async () => new Response(stream, { headers: { 'Content-Type': 'audio/ogg' } })), null);
  assert.equal(cancelled, true);
});
test('Static voice transport rejects truncated content and does not fetch an aborted request', async () => {
  assert.equal(await loadSeekableVoiceBlob('/corpus/test.ogg', signal(), async () => new Response(bytes, { headers: { 'Content-Type': 'audio/ogg', 'Content-Length': '100' } })), null);
  const controller = new AbortController(); controller.abort();
  assert.equal(await loadSeekableVoiceBlob('/corpus/test.ogg', controller.signal, async () => assert.fail('aborted request fetched')), null);
});
test('Aborting a stalled voice body cancels and releases the stream', async () => {
  let cancelled = false;
  const controller = new AbortController(), stream = new ReadableStream({ cancel() { cancelled = true; } });
  const result = loadSeekableVoiceBlob('/corpus/test.ogg', controller.signal, async () => new Response(stream, { headers: { 'Content-Type': 'audio/ogg' } }));
  await tick(); controller.abort(); assert.equal(await result, null); assert.equal(cancelled, true);
});

function setup(t, fetcher) {
  const saved = { window: globalThis.window, Audio: globalThis.Audio, fetch: globalThis.fetch, flag: process.env.NEXT_PUBLIC_ADV_STATIC, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const urls = [], revoked = [], instances = [];
  class FakeAudio {
    constructor() { instances.push(this); this.currentTime = 0; this.duration = 8; this.seekable = { length: 1, end: () => 0 }; this.starts = 0; }
    play() { this.paused = false; this.starts++; return Promise.resolve(); }
    pause() { this.paused = true; }
    load() { this.loads = (this.loads || 0) + 1; }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
  }
  globalThis.window = {}; globalThis.Audio = FakeAudio; globalThis.fetch = fetcher;
  process.env.NEXT_PUBLIC_ADV_STATIC = '1';
  URL.createObjectURL = blob => { const url = 'blob:test-' + urls.length; urls.push({ url, blob }); return url; };
  URL.revokeObjectURL = url => revoked.push(url);
  const controller = classicModules().load('lib/audio/voice-player.ts').voicePlaybackController;
  t.after(() => {
    controller.stop(); globalThis.fetch = saved.fetch;
    for (const key of ['window', 'Audio']) { if (saved[key] === undefined) delete globalThis[key]; else globalThis[key] = saved[key]; }
    if (saved.flag === undefined) delete process.env.NEXT_PUBLIC_ADV_STATIC; else process.env.NEXT_PUBLIC_ADV_STATIC = saved.flag;
    URL.createObjectURL = saved.create; URL.revokeObjectURL = saved.revoke;
  });
  return { controller, instances, urls, revoked };
}
const voice = '/corpus/archive/voice/test.ogg';
test('Seek repair reuses activated audio, retains cue identity/time and revokes its Blob on end', async t => {
  const { controller: c, instances, urls, revoked } = setup(t, async () => response());
  const complete = c.playAndWait('original-cue', voice); await tick();
  const audio = instances[0]; audio.currentTime = 0.75; audio.onloadedmetadata(); await tick(); await tick();
  assert.equal(urls.length, 1); assert.equal(instances.length, 1); assert.match(audio.src, /^blob:/);
  audio.duration = 10; audio.onloadedmetadata(); await tick();
  assert.equal(audio.currentTime, 0.75); assert.equal(c.getSnapshot().sourceUrl, voice); assert.equal(c.getSnapshot().cueId, 'original-cue'); assert.equal(c.getSnapshot().status, 'playing');
  audio.onended(); assert.equal(await complete, 'ended'); assert.deepEqual(revoked, ['blob:test-0']);
});
test('Seek repair retains explicit pause and never starts a replaced or stopped session', async t => {
  let resolveFetch;
  const { controller: c, instances, urls } = setup(t, () => new Promise(resolve => { resolveFetch = resolve; }));
  const old = c.playAndWait('old', voice); await tick(); instances[0].onloadedmetadata(); c.stop();
  resolveFetch(response()); await tick(); await tick(); assert.equal(await old, 'stopped'); assert.equal(urls.length, 0); assert.equal(c.getSnapshot().status, 'idle');
  const current = c.playAndWait('paused', voice); await tick(); const audio = instances[1]; audio.currentTime = 0.5; audio.onloadedmetadata(); c.pause();
  resolveFetch(response()); await tick(); await tick(); audio.onloadedmetadata(); await tick();
  assert.equal(c.getSnapshot().status, 'paused'); assert.equal(audio.paused, true); assert.equal(audio.currentTime, 0.5);
  c.stop(); assert.equal(await current, 'stopped');
});
test('A seekable stream is not fetched again and Blob allocation failure leaves original playback running', async t => {
  let requests = 0;
  const { controller: c, instances } = setup(t, async () => { requests++; return response(); });
  const first = c.playAndWait('range-capable', voice); await tick(); instances[0].seekable = { length: 1, end: () => 8 }; instances[0].onloadedmetadata(); await tick();
  assert.equal(requests, 0); c.stop(); assert.equal(await first, 'stopped');
  URL.createObjectURL = () => { throw Error('allocation failed'); };
  const second = c.playAndWait('fallback', voice); await tick(); const audio = instances[1]; audio.onloadedmetadata(); await tick(); await tick();
  assert.equal(audio.src, voice); assert.equal(audio.paused, false); assert.equal(c.getSnapshot().status, 'playing'); c.stop(); assert.equal(await second, 'stopped');
});
