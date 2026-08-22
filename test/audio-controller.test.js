import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioController } from '../packages/core/src/audio-controller.js';

class FakeAudioBackend {
  stopped = false;
  played = false;
  ended = () => {};
  failed = () => {};

  onEnded(callback) { this.ended = callback; }
  onError(callback) { this.failed = callback; }
  async play() { this.played = true; }
  stop() { this.stopped = true; }
}

test('audio controller maintains one primary channel and reports unresolved routes', async () => {
  const backends = [];
  const controller = new AudioController({
    backendFactory() {
      const backend = new FakeAudioBackend();
      backends.push(backend);
      return backend;
    },
  });
  const cueA = { cueId: 'voice:a', kind: 'voice' };
  const cueB = { cueId: 'voice:b', kind: 'voice' };
  const route = { status: 'resolved', url: 'https://reader.example/a.wav' };

  await controller.play(cueA, route);
  assert.equal(controller.getSnapshot().status, 'playing');
  await controller.play(cueB, route);
  assert.equal(backends[0].stopped, true);
  assert.equal(controller.getSnapshot().cueId, 'voice:b');

  await controller.play(cueA, { status: 'unresolved', reason: 'not mapped' });
  assert.equal(backends[1].stopped, true);
  assert.deepEqual(controller.getSnapshot(), {
    status: 'error',
    cueId: 'voice:a',
    error: 'not mapped',
  });
  controller.dispose();
});
