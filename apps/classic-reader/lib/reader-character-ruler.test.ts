import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCharacterTicks } from './reader-character-ruler.ts';

test('short physical line continues to the full text cell with an exact active endpoint', () => {
  const ticks = buildCharacterTicks([16, 32, 48], 160, 16);
  assert.equal(ticks.at(-1)?.x, 160);
  assert.deepEqual(ticks.filter(t => t.active), [{ count: 3, x: 48, active: true, major: false }]);
});
test('proportional punctuation keeps actual glyph coordinates without doubling or half-page offsets', () => {
  const ticks = buildCharacterTicks([9, 25, 41, 48], 127, 16);
  assert.equal(ticks.find(t => t.active)?.x, 48);
  assert.equal(ticks.find(t => t.count === 5)?.x, 64);
  assert.ok(ticks.every(t => t.x >= 0 && t.x <= 127));
  assert.equal(ticks.at(-1)?.x, 112);
});
test('empty and hidden cells do not fabricate an active line', () => {
  assert.deepEqual(buildCharacterTicks([12], 0, 16), []);
  assert.deepEqual(buildCharacterTicks([12], 100, 0), []);
  assert.equal(buildCharacterTicks([], 100, 16).some(t => t.active), false);
});
