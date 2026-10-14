import assert from 'node:assert/strict';
import test from 'node:test';

import {
  legacyCorpusAudioContentType,
  parseLegacyCorpusByteRange,
  resolveLegacyCorpusAudioPath,
} from './legacy-vn-corpus.ts';

test('legacy corpus audio paths remain inside the configured repository', () => {
  assert.match(
    resolveLegacyCorpusAudioPath('D:\\PROGETTO\\corpus', [
      'archive',
      'raw',
      'kana',
      'VOICE.unpacked',
      'MAS5009.OGG',
    ]),
    /archive[\\/]raw[\\/]kana[\\/]VOICE\.unpacked[\\/]MAS5009\.OGG$/u,
  );
  for (const segments of [
    ['archive', '..', 'secret.ogg'],
    ['archive', 'voice.txt'],
    ['archive', 'voice.ogg:stream'],
    ['archive\\raw', 'voice.ogg'],
  ]) {
    assert.throws(
      () => resolveLegacyCorpusAudioPath('D:\\PROGETTO\\corpus', segments),
      TypeError,
    );
  }
});

test('legacy corpus ranges support browser media requests', () => {
  assert.equal(parseLegacyCorpusByteRange(null, 1_000), null);
  assert.deepEqual(parseLegacyCorpusByteRange('bytes=0-31', 1_000), {
    start: 0,
    end: 31,
    length: 32,
  });
  assert.deepEqual(parseLegacyCorpusByteRange('bytes=900-', 1_000), {
    start: 900,
    end: 999,
    length: 100,
  });
  assert.deepEqual(parseLegacyCorpusByteRange('bytes=-64', 1_000), {
    start: 936,
    end: 999,
    length: 64,
  });
  assert.throws(() => parseLegacyCorpusByteRange('bytes=0-1,4-5', 1_000));
  assert.throws(() => parseLegacyCorpusByteRange('bytes=1000-', 1_000));
});

test('legacy corpus audio types are explicit', () => {
  assert.equal(legacyCorpusAudioContentType('voice.wav'), 'audio/wav');
  assert.equal(legacyCorpusAudioContentType('voice.OGG'), 'audio/ogg');
  assert.equal(legacyCorpusAudioContentType('voice.mp3'), 'audio/mpeg');
  assert.equal(legacyCorpusAudioContentType('voice.flac'), 'audio/flac');
  assert.throws(() => legacyCorpusAudioContentType('voice.txt'));
});
