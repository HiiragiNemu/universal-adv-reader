import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.join(root, 'work/cloudflare');
const corpusRoot = await fs.realpath(process.env.ADV_CORPUS_REPOSITORY || path.join(root, '../narcissu-kana-research'));
const auditPath = path.join(root, 'reports/verification/cloudflare-20261014/readiness.json');
const auditRun = spawnSync(process.execPath, [path.join(root, 'tools/audit-cloudflare-readiness.mjs')], { cwd: root, stdio: 'inherit' });
if (auditRun.status !== 0) throw Error('Corpus readiness audit failed');
const audit = JSON.parse(await fs.readFile(auditPath, 'utf8'));
const maxBytes = 25 * 1024 * 1024;
const media = [], objects = new Map(), counts = { a: 0, b: 0 };
const digests = { a: createHash('sha256'), b: createHash('sha256') };
for (const row of audit.media) {
  const source = await fs.realpath(path.resolve(corpusRoot, row.relativePath));
  if (!source.startsWith(corpusRoot + path.sep)) throw Error('Source escaped corpus root');
  const bytes = await fs.readFile(source), sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== row.bytes) throw Error('Corpus changed during audit: ' + row.url);
  if (bytes.length > maxBytes) {
    if (!source.toLowerCase().endsWith('.wav')) throw Error('Unexpected oversized media type: ' + row.url);
    const key = sha256 + '.wav';
    objects.set(key, { key, bytes: bytes.length, sha256, relativePath: row.relativePath });
    media.push({ ...row, sha256, delivery: 'r2', key });
    continue;
  }
  const shard = row.relativePath.startsWith('archive/raw/narcissu10-') ? 'b' : 'a';
  const dest = path.join(work, 'media-' + shard, 'corpus', row.relativePath);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try { await fs.unlink(dest); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  // Same-volume hard links avoid copying original media; deployment never modifies these files.
  try { await fs.link(source, dest); } catch (e) { if (e.code !== 'EXDEV') throw e; await fs.copyFile(source, dest); }
  counts[shard]++;
  digests[shard].update(row.url + '\0' + sha256 + '\n');
  media.push({ ...row, sha256, delivery: 'pages-' + shard });
  if (media.length % 3000 === 0) console.log('Prepared media: ' + media.length + '/' + audit.media.length);
}
const roots = {};
for (const shard of ['a', 'b']) {
  if (counts[shard] + 3 > 20000) throw Error('Media shard exceeds Pages file limit');
  roots[shard] = digests[shard].digest('hex');
  const dir = path.join(work, 'media-' + shard);
  await fs.writeFile(path.join(dir, '_headers'), '/*\n  Access-Control-Allow-Origin: *\n  Access-Control-Expose-Headers: ETag, Content-Length, Content-Range, Accept-Ranges\n  Cross-Origin-Resource-Policy: cross-origin\n  X-Content-Type-Options: nosniff\n  Cache-Control: public, max-age=86400\n');
  await fs.writeFile(path.join(dir, '404.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>资源不存在</title><p>资源不存在。</p></html>');
  await fs.writeFile(path.join(dir, 'media-release.json'), JSON.stringify({ schema: 'adv-media-shard/v1', shard, sha256: roots[shard], files: counts[shard] }, null, 2) + '\n');
}
const manifest = { schema: 'adv-cloudflare-media/v1', generatedAt: new Date().toISOString(), indexSha256: audit.indexSha256, counts, roots, objectBytes: [...objects.values()].reduce((sum, r) => sum + r.bytes, 0), objects: [...objects.values()], media };
await fs.mkdir(work, { recursive: true });
await fs.writeFile(path.join(work, 'media-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await fs.mkdir(path.join(work, 'large-media'), { recursive: true });
await fs.copyFile(path.join(root, 'tools/cloudflare/large-media-worker.mjs'), path.join(work, 'large-media/worker.mjs'));
await fs.writeFile(path.join(work, 'large-media/wrangler.jsonc'), JSON.stringify({ name: 'universal-adv-large-media', main: 'worker.mjs', compatibility_date: '2026-10-14', account_id: '9810127b0434fc919d963595b0418768', workers_dev: true, r2_buckets: [{ binding: 'MEDIA', bucket_name: 'universal-adv-media' }] }, null, 2) + '\n');
console.log(JSON.stringify({ counts, roots, oversizedUrlCount: media.filter(r => r.delivery === 'r2').length, uniqueObjects: objects.size, objectBytes: manifest.objectBytes }, null, 2));
