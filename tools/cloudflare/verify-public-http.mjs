import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readPublishedJson, sameRelease } from './release-integrity.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'apps/classic-reader/package.json'));
const { fetch, EnvHttpProxyAgent } = require('undici'), dispatcher = new EnvHttpProxyAgent();
const site = process.env.ADV_TEST_BASE || 'https://universal-adv-reader.pages.dev';
const receipt = JSON.parse(await fs.readFile(path.join(root, 'work/cloudflare/build-receipt.json'), 'utf8'));
const media = JSON.parse(await fs.readFile(path.join(root, 'work/cloudflare/media-manifest.json'), 'utf8'));
const index = JSON.parse(await fs.readFile(path.join(root, 'apps/classic-reader/public/story_index.json'), 'utf8'));
const expected = JSON.parse(await fs.readFile(path.join(root, 'apps/classic-reader/public/generic-progress.json'), 'utf8')).progress;
const corpus = path.resolve(process.env.ADV_CORPUS_REPOSITORY || path.join(root, '../narcissu-kana-research'));
const report = { schema: 'adv-public-http/v1', site, startedAt: new Date().toISOString(), buildId: receipt.buildId, checks: [], readbackRetries: [] };
const check = async (name, fn) => { try { report.checks.push({ name, result: 'PASS', details: await fn() }); } catch (e) { report.checks.push({ name, result: 'FAIL', error: e.message }); } };
const request = (route, options = {}) => fetch(site + route, { ...options, dispatcher, signal: AbortSignal.timeout(45000) });
// The upload verifier uses no-cache. Also wait for ordinary public reads to
// converge: a Pages alias may briefly return the prior release after upload.
// Only GETs retry; persistent mismatches still fail and never repeat deployment.
const readPublic = (route, validate) => readPublishedJson(site + route, {
  fetchImpl: (url, options) => fetch(url, { ...options, headers: undefined }),
  dispatcher, validate,
  onRetry: event => { report.readbackRetries.push(event); console.log(`PUBLIC READBACK ${event.attempt}/${event.attempts}: ${event.error}`); },
});
try {
  await check('Current release, source index and public progress payload', async () => {
    const release = await readPublic('/release.json', value => sameRelease(value, receipt)); assert.equal(release.buildId, receipt.buildId); assert.equal(release.publicInputSha256, receipt.publicInputSha256);
    const response = await request('/story_index.json'), bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), receipt.indexSha256);
    assert.match(response.headers.get('cache-control') || '', /max-age=0/);
    const progress = await readPublic('/api/proofreading/machine-status', value => value.total === index.length && value.pendingReviewRows === expected.pendingReviewRows && value.chineseRows === expected.chineseRows);
    assert.equal(progress.total, index.length); assert.equal(progress.entries.length, index.length); assert.equal(progress.pendingReviewRows, expected.pendingReviewRows); assert.equal(progress.needsReview, expected.needsReview);
    assert.equal(progress.rows, progress.chineseRows);
    const config = await readPublic('/api/proofreading/config', value => value.source_revision === receipt.buildId); assert.equal(config.submissions_enabled, false); assert.equal(config.source_revision, receipt.buildId);
    return { buildId: release.buildId, stories: progress.total, pendingRows: progress.pendingReviewRows, chineseRows: progress.chineseRows, publicSubmissionEnabled: false };
  });
  const routes = ['/', '/apps/web', '/reader/local', '/review/machine-translations', '/review/submissions', '/proofreading/status', ...index.map(row => '/reader/' + row.id)];
  for (let i = 0; i < routes.length; i += 8) {
    await Promise.all(routes.slice(i, i + 8).map(route => check('Page ' + route, async () => {
      const r = await request(route, { method: 'HEAD' }); assert.equal(r.status, 200); assert.match(r.headers.get('content-type') || '', /text\/html/); return { status: r.status };
    })));
  }
  const prefixes = new Map();
  for (const row of media.media.filter(r => r.delivery.startsWith('pages-'))) { const group = row.relativePath.split('/').slice(0, 4).join('/'); if (!prefixes.has(group)) prefixes.set(group, row); }
  const samples = [...prefixes.values(), ...media.objects.map(object => media.media.find(row => row.key === object.key))];
  for (let i = 0; i < samples.length; i += 4) {
    await Promise.all(samples.slice(i, i + 4).map(row => check('Original media integrity ' + row.url, async () => {
      const r = await request(row.url, { headers: { Range: 'bytes=0-31' } });
      try {
        assert.equal(r.headers.get('access-control-allow-origin'), '*');
        const type = r.headers.get('content-type') || '';
        assert(!type.includes('text/html'), 'Media must never fall back to an HTML page');
        if (row.delivery === 'r2') assert.equal(r.status, 206, 'Oversized media must retain byte-range support');
        else assert([200, 206].includes(r.status), 'Static asset must return complete or valid partial content');
        const actual = Buffer.from(await r.arrayBuffer());
        if (r.status === 206) {
          assert.equal(r.headers.get('content-range'), 'bytes 0-31/' + row.bytes);
          const handle = await fs.open(path.join(corpus, row.relativePath), 'r'), original = Buffer.alloc(32);
          try { await handle.read(original, 0, 32, 0); } finally { await handle.close(); }
          assert.deepEqual(actual, original);
        } else {
          // RFC 9110 allows a server to ignore Range. Pages returns the full
          // static file; validate EVERY byte, not a relaxed status-only check.
          assert.equal(actual.length, row.bytes);
          assert.equal(createHash('sha256').update(actual).digest('hex'), row.sha256);
        }
        return { status: r.status, verifiedBytes: actual.length, bytes: row.bytes, delivery: row.delivery, finalUrl: r.url, validation: r.status === 206 ? 'exact-range' : 'full-sha256' };
      } finally { if (!r.bodyUsed) await r.body?.cancel(); }
    })));
  }
  for (const route of ['/.env', '/.git/config', '/api/native-reviews']) await check('Private resource absent ' + route, async () => { const r = await request(route, { method: 'HEAD' }); assert.equal(r.status, 404); return { status: r.status }; });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) await check('Public site rejects ' + method, async () => { const r = await request('/api/native-reviews', { method, headers: { 'content-type': 'application/json' }, body: '{}' }); assert([404, 405].includes(r.status)); await r.body?.cancel(); return { status: r.status }; });
  const asset = receipt.inventory.find(row => row.path.startsWith('_next/static/') && row.path.endsWith('.js'));
  await check('Hashed application assets use immutable caching', async () => { const r = await request('/' + asset.path, { method: 'HEAD' }); assert.equal(r.status, 200); assert.match(r.headers.get('cache-control') || '', /immutable/); assert.match(r.headers.get('cache-control') || '', /31536000/); return { cacheControl: r.headers.get('cache-control') }; });
  report.result = report.checks.every(check => check.result === 'PASS') ? 'PASS' : 'FAIL';
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(root, 'reports/verification/cloudflare-20261014/public-http.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ result: report.result, checks: report.checks.length, failed: report.checks.filter(c => c.result !== 'PASS') }, null, 2));
} finally { await dispatcher.close(); }
if (report.result !== 'PASS') process.exitCode = 1;
