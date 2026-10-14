import assert from 'node:assert/strict';
import test from 'node:test';
import { clampFloatingPoint } from './floating-geometry.ts';
const bounds = { left: 0, top: 0, width: 402, height: 820 };

test('floating controls leave room at every visible viewport edge', () => {
  assert.deepEqual(clampFloatingPoint({ x: 999, y: 999 }, 264, 54, bounds, 24), { x: 114, y: 742 });
  assert.deepEqual(clampFloatingPoint({ x: -9, y: -9 }, 264, 54, bounds, 24), { x: 24, y: 24 });
});

test('expanding and resizing reclamp the full hit target', () => {
  assert.deepEqual(clampFloatingPoint({ x: 310, y: 742 }, 264, 54, { ...bounds, width: 360, height: 640 }, 24), { x: 72, y: 562 });
  assert.deepEqual(clampFloatingPoint({ x: 24, y: 28 }, 362, 607, bounds), { x: 24, y: 28 });
});

test('oversized and keyboard-constrained windows retain a reachable top edge', () => {
  assert.deepEqual(clampFloatingPoint({ x: 999, y: 999 }, 410, 840, bounds), { x: 0, y: 0 });
  assert.deepEqual(clampFloatingPoint({ x: 0, y: 999 }, 264, 54, { left: 0, top: 100, width: 402, height: 300 }, 24), { x: 24, y: 322 });
});
