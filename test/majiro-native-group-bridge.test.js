import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Majiro N:M bridge retains raw evidence and rejects changed words, short text, native boundaries and ambiguous anchors', () => {
  const result = spawnSync('python', ['-B', 'test/majiro_native_group_bridge_test.py'], {
    cwd: root, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error));
  assert.match(result.stderr, /Ran 7 tests/);
});
