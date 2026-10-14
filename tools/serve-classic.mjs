import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function classicLaunchPlan(env = process.env) {
  const cwd = path.join(root, 'apps/classic-reader');
  const port = String(env.PORT || '4176');
  if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw Error('PORT must be an integer from 1024 through 65535.');
  const require = createRequire(path.join(cwd, 'package.json'));
  const next = require.resolve('next/dist/bin/next');
  if (!existsSync(path.join(cwd, 'app/page.tsx'))) throw Error('Retained Classic entry is missing.');
  return { cwd, executable: process.execPath, args: [next, 'dev', '--webpack', '-H', '127.0.0.1', '-p', port], url: `http://127.0.0.1:${port}/apps/web/` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const plan = classicLaunchPlan();
  if (process.argv.includes('--check')) console.log(JSON.stringify(plan));
  else {
    // Existing dependencies only: no install, remote deploy, or fallback to the legacy shell.
    // An explicitly occupied port is left to its owner; Next exits rather than incrementing.
    console.log(`CLASSIC ${plan.url}`);
    const child = spawn(plan.executable, plan.args, { cwd: plan.cwd, stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
    child.once('error', error => { console.error(error.message); process.exitCode = 1; });
    child.once('exit', code => { process.exitCode = code ?? 1; });
  }
}
