import assert from 'node:assert/strict';
import test from 'node:test';

import { isLegacyVnVoiceUrl } from './voice-cue.ts';

test('legacy VN voice URLs accept only mounted audio files', () => {
  assert.equal(
    isLegacyVnVoiceUrl(
      '/corpus/archive/raw/narcissu3/voice.arc.unpacked/n3kiri_0049.ogg',
    ),
    true,
  );
  assert.equal(
    isLegacyVnVoiceUrl(
      '/corpus/archive/raw/narcissu10-original-ja-JP/narci_himeko/voice.arc.unpacked/c77setu_0002.wav',
    ),
    true,
  );
});

for (const invalid of [
  '',
  '/audio/example.ogg',
  '/corpus/example.txt',
  '/corpus/../secret.ogg',
  '/corpus/%2e%2e/secret.ogg',
  '/corpus/archive%2Fsecret.ogg',
  '/corpus/archive\\secret.ogg',
  '/corpus/archive/voice.ogg?download=1',
  '/corpus/archive/voice.wav#fragment',
  'https://example.invalid/corpus/archive/voice.ogg',
]) {
  test(`legacy VN voice URL rejects ${JSON.stringify(invalid)}`, () => {
    assert.equal(isLegacyVnVoiceUrl(invalid), false);
  });
}
