import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { publicInputHashes } from './cloudflare/static-projection.mjs';
import { readPublishedJson, sameRelease, buildInputHashes, assertFileMapUnchanged, assertOutputUnchanged } from './cloudflare/release-integrity.mjs';
import { assertPublishedRepository, assertReleaseRepository } from './cloudflare/repository-state.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.join(root, 'work/cloudflare');
const app = path.join(root, 'apps/classic-reader');
const wrangler = path.join(app, 'node_modules/wrangler/bin/wrangler.js');
const logs = path.join(root, 'reports/verification/cloudflare-20261014');
const require = createRequire(path.join(app, 'package.json'));
const { fetch, EnvHttpProxyAgent } = require('undici');
const dispatcher = new EnvHttpProxyAgent();
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_ACCOUNT_ID: '9810127b0434fc919d963595b0418768', CI: '1', NO_COLOR: '1' };
await fs.mkdir(logs, { recursive: true });
const lockFile = path.join(work, 'deploy.lock');
const run = async (args, label) => {
  console.log('RUN ' + label);
  const startedAt = new Date().toISOString();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wrangler, ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', b => { output += b.toString(); }); child.stderr.on('data', b => { output += b.toString(); });
    const timer = setTimeout(() => { child.kill(); }, 45 * 60 * 1000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', async code => {
      clearTimeout(timer);
      await fs.writeFile(path.join(logs, label + '.log'), output);
      await fs.writeFile(path.join(logs, label + '.json'), JSON.stringify({ args, startedAt, finishedAt: new Date().toISOString(), exitCode: code }, null, 2) + '\n');
      if (code !== 0) reject(Error(label + ' failed: ' + output.slice(-2500)));
      else { console.log('PASS ' + label + '\n' + output.slice(-650)); resolve(output); }
    });
  });
};
const readRemote = (url, validate = () => true, attempts = 8) => readPublishedJson(url, {
  fetchImpl: fetch, dispatcher, validate, attempts,
  onRetry: event => console.log(`READBACK RETRY ${event.attempt}/${event.attempts}: ${event.error}; waiting ${event.waitMs}ms`),
});
const readJson = async p => JSON.parse(await fs.readFile(p, 'utf8'));
const mediaFile = path.join(work, 'media-manifest.json');
const media = await readJson(mediaFile);
const deploymentFile = path.join(work, 'media-deployment.json');
let deployment;
try { deployment = await readJson(deploymentFile); } catch { deployment = { schema: 'adv-media-deployment/v1', largeMediaUrl: process.env.ADV_LARGE_MEDIA_URL || '', objects: {}, shards: {} }; }
const saveDeployment = () => fs.writeFile(deploymentFile, JSON.stringify(deployment, null, 2) + '\n');
const ensurePages = async name => {
  const output = await run(['pages', 'project', 'list', '--json'], 'pages-projects-read');
  const start = output.indexOf('[\n');
  const projects = JSON.parse(start >= 0 ? output.slice(start) : output);
  if (!projects.some(p => p['Project Name'] === name)) await run(['pages', 'project', 'create', name, '--production-branch', 'main'], 'create-' + name);
};
const lock = await fs.open(lockFile, 'wx').catch(error => { throw Error(error.code === 'EEXIST' ? 'Another ADV deploy holds work/cloudflare/deploy.lock. Do not run concurrent deployments.' : 'Cannot acquire deploy lock: ' + error.message); });
try {
  await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  if (process.argv.includes('--media')) {
    console.log('Media repository preflight:', JSON.stringify(assertPublishedRepository(root)));
    const result = await run(['deploy', '--config', path.join(work, 'large-media/wrangler.jsonc')], 'large-worker-deploy');
    const url = result.match(/https:\/\/universal-adv-large-media\.[a-z0-9.-]+\.workers\.dev/);
    if (!url) throw Error('Dedicated large-media Worker URL not returned');
    deployment.largeMediaUrl = url[0]; await saveDeployment();
    const corpus = await fs.realpath(process.env.ADV_CORPUS_REPOSITORY || path.join(root, '../narcissu-kana-research'));
    for (let i = 0; i < media.objects.length; i += 3) {
      await Promise.all(media.objects.slice(i, i + 3).map(async object => {
        const source = path.resolve(corpus, object.relativePath);
        if (!source.startsWith(corpus + path.sep)) throw Error('Object source escapes corpus');
        const bytes = await fs.readFile(source);
        if (createHash('sha256').update(bytes).digest('hex') !== object.sha256) throw Error('Oversized media source changed');
        let uploaded = false;
        try {
          const head = await fetch(deployment.largeMediaUrl + '/' + object.key, { method: 'HEAD', dispatcher, signal: AbortSignal.timeout(30000) });
          uploaded = head.status === 200 && Number(head.headers.get('content-length')) === object.bytes && head.headers.get('etag') === '"' + object.sha256 + '"';
          await head.body?.cancel();
        } catch { /* A first upload has no remote object. */ }
        if (!uploaded) await run(['r2', 'object', 'put', 'universal-adv-media/' + object.key, '--remote', '--file', source, '--content-type', 'audio/wav', '--cache-control', 'public, max-age=31536000, immutable'], 'r2-' + object.sha256.slice(0, 12));
        deployment.objects[object.key] = { sha256: object.sha256, bytes: object.bytes };
      }));
      await saveDeployment();
    }
    for (const shard of ['a', 'b']) {
      const name = 'universal-adv-media-' + shard;
      await ensurePages(name);
      let same = false;
      try { same = (await readRemote('https://' + name + '.pages.dev/media-release.json', undefined, 1)).sha256 === media.roots[shard]; } catch { /* New deployment. */ }
      if (!same) await run(['pages', 'deploy', path.join(work, 'media-' + shard), '--project-name', name, '--branch', 'main', '--commit-dirty=true'], 'deploy-media-' + shard);
      const remote = await readRemote('https://' + name + '.pages.dev/media-release.json', value => value.sha256 === media.roots[shard] && value.files === media.counts[shard]);
      if (remote.sha256 !== media.roots[shard] || remote.files !== media.counts[shard]) throw Error('Media shard readback mismatch');
      deployment.shards[shard] = remote;
      await saveDeployment();
    }
    console.log('Media publication verified.');
  }
  if (!process.argv.includes('--media-only')) {
    const receipt = await readJson(path.join(work, 'build-receipt.json'));
    if (path.resolve(receipt.output) !== path.join(root, 'work/cloudflare-app/out')) throw Error('Unexpected build output directory');
    assertFileMapUnchanged(receipt.inputFiles, await buildInputHashes(root), 'Application/config/support/media inputs');
    await assertOutputUnchanged(receipt.inventory, receipt.output);
    const currentPublic = await publicInputHashes(path.join(app, 'public'));
    if (!receipt.publicFiles || Object.keys(currentPublic).length !== Object.keys(receipt.publicFiles).length || Object.entries(receipt.publicFiles).some(([p, h]) => currentPublic[p] !== h)) throw Error('Public files differ from build inputs; rebuild first');
    if (createHash('sha256').update(await fs.readFile(path.join(app, 'public/story_index.json'))).digest('hex') !== receipt.indexSha256) throw Error('Current content differs from built content; rebuild first');
    for (const [rel, expected] of Object.entries(receipt.sourceFiles)) if (createHash('sha256').update(await fs.readFile(path.join(app, rel))).digest('hex') !== expected) throw Error('Source differs from built source: ' + rel);
    for (const shard of ['a', 'b']) await readRemote('https://universal-adv-media-' + shard + '.pages.dev/media-release.json', value => value.sha256 === media.roots[shard]);
    const project = 'universal-adv-reader';
    const pendingFile = path.join(work, 'site-upload.json');
    let pending = null;
    try { pending = await readJson(pendingFile); } catch { /* First upload. */ }
    const verifyOnly = process.argv.includes('--verify-only');
    if (verifyOnly && (!pending || !sameRelease(pending.release, receipt))) throw Error('No matching recorded upload to verify; use normal publish');
    console.log('Upload repository preflight:', JSON.stringify(assertReleaseRepository(root, receipt)));
    if (!verifyOnly && (!pending || !sameRelease(pending.release, receipt))) {
      await ensurePages(project);
      const output = await run(['pages', 'deploy', receipt.output, '--project-name', project, '--branch', 'main', '--commit-hash', receipt.gitRevision, '--commit-dirty=' + receipt.sourceDirty, '--commit-message', 'Universal ADV ' + receipt.buildId + ' local direct upload; no Actions'], 'deploy-reader');
      const immutable = output.match(/https:\/\/[a-f0-9]+\.universal-adv-reader\.pages\.dev/);
      if (!immutable) throw Error('Upload returned no immutable deployment URL; inspect deployment log before retry');
      const { sourceFiles, inputFiles, publicFiles, inventory, rscAliases, output: outputPath, ...release } = receipt;
      pending = { schema: 'adv-site-upload/v1', release, immutableUrl: immutable[0], uploadedAt: new Date().toISOString(), status: 'uploaded-awaiting-readback' };
      await fs.writeFile(pendingFile, JSON.stringify(pending, null, 2) + '\n');
    }
    try {
      await readRemote(pending.immutableUrl + '/release.json', value => sameRelease(value, receipt));
      const remote = await readRemote('https://' + project + '.pages.dev/release.json', value => sameRelease(value, receipt));
      await fs.writeFile(path.join(work, 'site-deployment.json'), JSON.stringify({ ...remote, publicUrl: 'https://' + project + '.pages.dev', immutableUrl: pending.immutableUrl, verifiedAt: new Date().toISOString(), githubActionsRunsStarted: 0 }, null, 2) + '\n');
      pending.status = 'verified'; delete pending.readbackError;
    } catch (error) {
      pending.readbackError = error.message;
      throw error;
    } finally {
      pending.lastCheckedAt = new Date().toISOString();
      await fs.writeFile(pendingFile, JSON.stringify(pending, null, 2) + '\n');
    }
    console.log('Public site verified: https://' + project + '.pages.dev');
  }
} finally {
  await dispatcher.close();
  await lock.close(); await fs.unlink(lockFile);
}
