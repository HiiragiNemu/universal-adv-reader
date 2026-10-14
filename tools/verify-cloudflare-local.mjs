import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'apps/classic-reader');
const output = path.join(root, 'reports/verification/cloudflare-20261014');
await fs.mkdir(output, { recursive: true });
const report = { schema: 'adv-local-release-gate/v1', startedAt: new Date().toISOString(), checks: [] };
const run = async (name, cmd, args, cwd = root) => {
  const started = Date.now();
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  await fs.writeFile(path.join(output, name + '.log'), (result.stdout || '') + (result.stderr || ''));
  report.checks.push({ name, exitCode: result.status, durationMs: Date.now() - started });
  await fs.writeFile(path.join(output, 'local-release-gate.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(name + ': exit ' + result.status);
  if (result.status !== 0) throw Error(name + ' failed: ' + ((result.stdout || '') + (result.stderr || '')).slice(-3500));
};
await run('root-tests-final', process.execPath, ['--test', 'test/*.test.js']);
await run('app-tests-final', process.execPath, ['--experimental-strip-types', '--test',
  'lib/reader-character-ruler.test.ts', 'lib/reader-display-preferences.test.ts', 'lib/screen-effects.test.ts',
  'lib/floating-geometry.test.ts', 'lib/viewport-filter.test.ts', 'lib/legacy-vn-corpus.test.ts',
  'lib/legacy-vn-voice-routing.test.ts', 'lib/legacy-vn-voice-routing-corpus.test.ts'], app);
await run('typescript-final', process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false'], app);
const physical = await fs.realpath(path.join(app, 'node_modules'));
if (physical !== path.join(app, 'node_modules')) throw Error('App dependencies must not point at a different project');
const npm = process.env.npm_execpath;
if (npm) await run('npm-audit-final', process.execPath, [npm, 'audit', '--omit=dev', '--audit-level=moderate', '--json'], app);
else {
  const cmd = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  await run('npm-audit-final', cmd, process.platform === 'win32' ? ['/d', '/s', '/c', 'npm audit --omit=dev --audit-level=moderate --json'] : ['audit', '--omit=dev', '--audit-level=moderate', '--json'], app);
}
report.result = 'PASS'; report.finishedAt = new Date().toISOString();
await fs.writeFile(path.join(output, 'local-release-gate.json'), JSON.stringify(report, null, 2) + '\n');
console.log('Local release gate passed.');
