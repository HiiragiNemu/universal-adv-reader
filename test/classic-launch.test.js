import assert from 'node:assert/strict';
import test from 'node:test';
import { classicLaunchPlan } from '../tools/serve-classic.mjs';

test('Classic launch targets the retained inherited app with an explicit local port', () => {
  const plan = classicLaunchPlan({});
  assert.match(plan.cwd.replaceAll('\\', '/'), /\/apps\/classic-reader$/);
  assert.equal(plan.url, 'http://127.0.0.1:4176/apps/web/');
  assert.deepEqual(plan.args.slice(1), ['dev', '--webpack', '-H', '127.0.0.1', '-p', '4176']);
  assert.doesNotMatch(plan.args.join(' '), /tools\/serve\.mjs|shells\/next/);
});

test('an explicit Classic port stays explicit and malformed ports fail early', () => {
  assert.equal(classicLaunchPlan({ PORT: '4186', HOST: '0.0.0.0' }).url, 'http://127.0.0.1:4186/apps/web/');
  for (const PORT of ['0', '80', '65536', '4176x', '-1', '4.5']) assert.throws(() => classicLaunchPlan({ PORT }), /PORT/);
});
