import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { assertPublishedRepository } from './cloudflare/repository-state.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'apps/classic-reader');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false', NEXT_TELEMETRY_DISABLED: '1', ADV_BROWSER_PROXY: process.env.ADV_BROWSER_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '' };
const run = (script, args = [], extra = {}) => new Promise((resolve, reject) => {
  console.log('\n>>> ' + script + ' ' + args.join(' '));
  const child = spawn(process.execPath, [path.join(root, script), ...args], { cwd: root, env: { ...env, ...extra }, stdio: 'inherit' });
  child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error(script + ' failed with exit ' + code)));
});
const releaseLockPath = path.join(root, 'work/cloudflare/release.lock');
await fs.mkdir(path.dirname(releaseLockPath), { recursive: true });
const releaseLock = await fs.open(releaseLockPath, 'wx');
try {
await releaseLock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n');
console.log('Repository release preflight:', JSON.stringify(assertPublishedRepository(root)));
await run('tools/verify-cloudflare-local.mjs');
if (process.argv.includes('--media')) {
  await run('tools/prepare-cloudflare-media.mjs');
  await run('tools/deploy-cloudflare.mjs', ['--media', '--media-only']);
}
await run('tools/build-cloudflare-pages.mjs');
const port = Number(process.env.ADV_VERIFY_PORT || 4181);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid verification port');
await new Promise((resolve, reject) => {
  const probe = net.createServer(); probe.once('error', reject); probe.listen(port, '127.0.0.1', () => probe.close(resolve));
});
const preview = spawn(process.execPath, [path.join(app, 'node_modules/wrangler/bin/wrangler.js'), 'pages', 'dev', path.join(root, 'work/cloudflare-app/out'), '--ip', '127.0.0.1', '--port', String(port), '--compatibility-date', '2026-10-01'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let previewLog = ''; preview.stdout.on('data', b => { previewLog += b; }); preview.stderr.on('data', b => { previewLog += b; });
const local = 'http://127.0.0.1:' + port;
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (preview.exitCode !== null) throw Error('Production preview exited: ' + previewLog.slice(-1500));
    try { const r = await fetch(local + '/release.json', { signal: AbortSignal.timeout(1500) }); ready = r.ok; await r.body?.cancel(); if (ready) break; } catch { /* Await local startup, not the user's dev server. */ }
    await delay(500);
  }
  if (!ready) throw Error('Production preview failed to become ready');
  await run('tools/cloudflare/verify-browser.mjs', [], { ADV_TEST_BASE: local, ADV_TEST_NAME: 'release-local/content' });
  await run('tools/cloudflare/verify-public-workflow.mjs', [], { ADV_TEST_BASE: local, ADV_TEST_NAME: 'release-local/workflow' });
  await run('tools/cloudflare/verify-search-recovery.mjs', [], { ADV_TEST_BASE: local, ADV_TEST_NAME: 'release-local/search' });
} finally {
  preview.kill();
  await fs.writeFile(path.join(root, 'reports/verification/cloudflare-20261014/release-preview.log'), previewLog);
}
await run('tools/deploy-cloudflare.mjs');
await run('tools/cloudflare/verify-public-http.mjs');
const site = 'https://universal-adv-reader.pages.dev';
await run('tools/cloudflare/verify-browser.mjs', [], { ADV_TEST_BASE: site, ADV_TEST_NAME: 'release-public/content' });
await run('tools/cloudflare/verify-public-workflow.mjs', [], { ADV_TEST_BASE: site, ADV_TEST_NAME: 'release-public/workflow' });
await run('tools/cloudflare/verify-search-recovery.mjs', [], { ADV_TEST_BASE: site, ADV_TEST_NAME: 'release-public/search' });
console.log('\nCloudflare publication and public verification passed. No GitHub Actions were invoked. Git synchronization remains a separate explicitly authorized operation.');
} finally {
  await releaseLock.close();
  await fs.unlink(releaseLockPath);
}
