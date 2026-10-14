import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'apps/classic-reader/public');
const corpusRoot = path.resolve(process.env.ADV_CORPUS_REPOSITORY || path.join(root, '../narcissu-kana-research'));
const output = path.join(root, 'reports/verification/cloudflare-20261014');
const urls = new Set(), groups = {}, absolutePathFiles = [];
let files = 0;
for (const ent of await fs.readdir(publicRoot, { recursive: true, withFileTypes: true })) {
  if (!ent.isFile()) continue;
  const file = path.join(ent.parentPath, ent.name), rel = path.relative(publicRoot, file).replaceAll('\\', '/');
  const size = (await fs.stat(file)).size, group = rel.split('/')[0];
  const row = groups[group] ??= { count: 0, bytes: 0, max: 0 };
  row.count++; row.bytes += size; row.max = Math.max(row.max, size); files++;
  if (!ent.name.endsWith('.json')) continue;
  const text = await fs.readFile(file, 'utf8');
  for (const match of text.matchAll(/"(\/corpus\/[^"\s]+)"/g)) urls.add(match[1]);
  if (/[A-Z]:\\\\/.test(text)) absolutePathFiles.push(rel);
}
const media = [], missing = [], types = {};
for (const url of [...urls].sort()) {
  const rel = decodeURIComponent(url.slice('/corpus/'.length));
  const file = path.resolve(corpusRoot, rel);
  if (!file.startsWith(corpusRoot + path.sep)) throw Error('Corpus path escapes root: ' + url);
  try {
    const size = (await fs.stat(file)).size;
    media.push({ url, relativePath: rel, bytes: size });
    const ext = path.extname(file); types[ext] = (types[ext] || 0) + 1;
  } catch (error) { missing.push({ url, error: error.code || error.message }); }
}
const index = await fs.readFile(path.join(publicRoot, 'story_index.json'));
const report = { schema: 'adv-cloudflare-readiness/v1', generatedAt: new Date().toISOString(),
  indexSha256: createHash('sha256').update(index).digest('hex'), publicFiles: files, groups,
  mediaCount: media.length, mediaBytes: media.reduce((sum, r) => sum + r.bytes, 0),
  maxMediaBytes: Math.max(0, ...media.map(r => r.bytes)), types, missing,
  absolutePathFiles, media };
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, 'readiness.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, media: media.slice(0, 4), absolutePathFiles: absolutePathFiles.slice(0, 15) }, null, 2));
if (missing.length) process.exitCode = 1;
