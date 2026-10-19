import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { validateBuildAssets, restoreCloudInputs } from '../tools/cloudflare/cloud-inputs.mjs';
const hash = b => createHash('sha256').update(b).digest('hex');
const read = p => fs.readFile(new URL('../' + p, import.meta.url), 'utf8');

const data = Buffer.from('synthetic-test-asset');
const asset = { path: 'fonts/test.woff2', bytes: data.length, sha256: hash(data), sources: ['https://magireader.pages.dev/fonts/test.woff2'] };
const fixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adv-cloud-input-test-'));
  await fs.mkdir(path.join(root, 'config/cloudflare'), { recursive: true });
  await fs.writeFile(path.join(root, 'config/cloudflare/public-build-assets.json'), JSON.stringify({ schema: 'adv-public-build-assets/v1', files: [asset] }));
  for (const name of ['media-manifest.json', 'media-deployment.json']) await fs.writeFile(path.join(root, 'config/cloudflare', name), '{}');
  return root;
};

test('cloud asset restore is source-pinned and rejects paths or untrusted hosts', async () => {
  const official = JSON.parse(await read('config/cloudflare/public-build-assets.json'));
  assert.equal(validateBuildAssets(official).length, 9);
  for (const bad of [{ path: 'fonts/../../private.woff2' }, { sources: ['https://example.com/fonts/test.woff2'] }, { sha256: 'bad' }, { bytes: -1 }]) {
    assert.throws(() => validateBuildAssets({ schema: 'adv-public-build-assets/v1', files: [{ ...asset, ...bad }] }));
  }
  assert.throws(() => validateBuildAssets({ schema: 'adv-public-build-assets/v1', files: [asset, asset] }));
});

test('cloud input restore downloads once then verifies local cache without a network request', async () => {
  const root = await fixture(); let requests = 0;
  try {
    const fetchImpl = async () => { requests++; return new Response(data); };
    const result = await restoreCloudInputs(root, { fetchImpl });
    assert.equal(result.length, 1); assert.equal(requests, 1);
    await restoreCloudInputs(root, { fetchImpl }); assert.equal(requests, 1);
    assert.deepEqual(await fs.readFile(path.join(root, 'apps/classic-reader/public/fonts/test.woff2')), data);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('cloud input restore rejects corrupt remote data and never overwrites existing data', async () => {
  const root = await fixture();
  try {
    await assert.rejects(restoreCloudInputs(root, { fetchImpl: async () => new Response(Buffer.alloc(data.length)), sleep: async () => {} }), /checksum mismatch/);
    const file = path.join(root, 'apps/classic-reader/public/fonts/test.woff2');
    await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, 'preserve-me');
    await assert.rejects(restoreCloudInputs(root, { fetchImpl: async () => { throw Error('Must not fetch'); } }), /differs from its pinned/);
    assert.equal(await fs.readFile(file, 'utf8'), 'preserve-me');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('About retains exactly the requested menu kinds and native complete staff roles', async () => {
  const source = await read('apps/classic-reader/components/AboutModal.tsx');
  const links = JSON.parse(source.match(/const LINKS = (\[[\s\S]*?\n\]);/)[1]);
  assert.deepEqual(links.map(l => l.icon), ['QQ', 'B站', '剧情', 'L2D', '3D', '下载', '搜索', 'WIKI', '进度']);
  assert.equal(links[0].subtitle, 'QQ：254489200');
  assert.match(source, /贡献名单/); assert.match(source, /赞助支持/);
  assert.doesNotMatch(source, /928098518|858083286|圆环攻略组|汉化修订与投稿帮助|本地修订索引/);
  const credits = JSON.parse(await read('apps/classic-reader/lib/adv-contributors.json'));
  for (const name of ['风铃汉化组','妹乃萌汉化组','陆怡帆','盆栽','明日酱X傲娇','50kg','梦想残光霞','Liknight','cheong00','沙发的均势','片岡とも','山田一']) assert(JSON.stringify(credits).includes(name), 'Missing credited contributor: ' + name);
  const product = await read('apps/classic-reader/public/data/legacy-vn/narcissu-3rd/product_cn.txt');
  const native = product.split(/\r?\n/).find(l => l.startsWith('旁白: 主催：')).replace(/^旁白: /, '').split('\\n');
  const group = credits.groups.find(g => g.title === '风铃汉化组 · Narcissu 3rd');
  assert.equal(group.sourceSha256, hash(product));
  assert.deepEqual(group.roles.map(([r,n]) => r + '：' + n), native.map(s => s.trim()));
});

test('native Git build publishes on Cloudflare without a local deploy script or credential', async () => {
  const source = await read('tools/build-cloudflare-git.mjs');
  assert.match(source, /CF_PAGES_COMMIT_SHA/); assert.match(source, /restoreCloudInputs/);
  assert.match(source, /verify-cloudflare-local/); assert.match(source, /build-cloudflare-pages/);
  assert.doesNotMatch(source, /run\([^\n]*(?:deploy-cloudflare|release-cloudflare|wrangler)/);
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.scripts['build:cloudflare:git'], 'node tools/build-cloudflare-git.mjs');
});
