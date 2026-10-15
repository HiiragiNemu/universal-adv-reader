import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { restoreCloudInputs } from './cloudflare/cloud-inputs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'apps/classic-reader');
const run = (cmd, args, cwd = root) => {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  if (result.error || result.status !== 0) throw Error('Cloud build command failed: ' + cmd + ' ' + args.join(' ') + ' (' + (result.error?.message || result.status) + ')');
};
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
if (!/^[a-f0-9]{40}$/.test(revision)) throw Error('A Git checkout is required');
if (process.env.CF_PAGES_COMMIT_SHA && process.env.CF_PAGES_COMMIT_SHA !== revision) throw Error('Cloudflare checked out an unexpected commit');
if (process.env.CF_PAGES_BRANCH && process.env.CF_PAGES_BRANCH !== 'main') throw Error('Only the approved main branch is published');
process.env.ADV_BUILD_MODE = 'cloudflare-git';
// Cloudflare skips its implicit install; this nested package's lock is authoritative.
if (process.env.ADV_REUSE_INSTALLED_DEPS !== '1') {
  if (process.env.npm_execpath) run(process.execPath, [process.env.npm_execpath, 'ci', '--no-fund'], app);
  else run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--no-fund'], app);
}
const assets = await restoreCloudInputs(root);
console.log('Restored verified cloud inputs:', assets.length, 'public assets; no local game installation or deployment credential required.');
run(process.execPath, ['tools/verify-cloudflare-local.mjs']);
run(process.execPath, ['tools/build-cloudflare-pages.mjs']);
const receipt = JSON.parse(await fs.readFile(path.join(root, 'work/cloudflare/build-receipt.json'), 'utf8'));
if (receipt.gitRevision !== revision || receipt.sourceDirty) throw Error('Cloud build source changed during validation');
const config = { schema: 'adv-cloud-build-status/v1', provider: 'cloudflare-pages-git', commit: revision, buildId: receipt.buildId, automatic: true, githubActionsRequired: false, checks: ['locked-dependencies', 'pinned-public-assets', 'root-tests', 'app-tests', 'typescript', 'dependency-audit', 'static-export', 'source-and-output-integrity'] };
await fs.writeFile(path.join(root, 'work/cloudflare/cloud-build-status.json'), JSON.stringify(config, null, 2) + '\n');
console.log('Cloudflare Git build validated: ' + JSON.stringify(config));
// Pages publishes the export itself after a successful exit. No Wrangler upload,
// GitHub token, Cloudflare API token, Windows path, or local service is used here.
