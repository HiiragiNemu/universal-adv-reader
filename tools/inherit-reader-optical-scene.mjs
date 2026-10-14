import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'apps/classic-reader');
const dir = path.join(root, 'reports/verification/reader-inheritance-20261012/atom03');
const sourceRepo = 'D:/magia/MyProducts/magi-reader';
const commit = '56309ca742130e36d8d10fdb4f72de2a04cda02a';
const seeds = [
  'app/layout.tsx', 'app/providers.tsx', 'app/loading.tsx', 'app/reader/loading.tsx',
  'app/reader/reader-current-refinements.css', 'app/home-optical-refinements.css',
  'app/review/layout.tsx', 'components/ReaderFontSettings.tsx',
  'components/ScreenEffectsSettings.tsx', 'components/SiteSettingsWindow.tsx',
  'components/FloatingWindow.tsx', 'components/DraggableReaderWidget.tsx',
  'components/RetroDisplaySurface.tsx', 'components/ReaderStyleScope.tsx',
  'components/IOSViewportHost.tsx', 'components/IOSHeaderSurface.tsx',
];
const localPatches = ['app/page.tsx', 'components/ClassicHome.tsx', 'app/reader/[id]/page.tsx'];
const source = file => execFileSync('git', ['-C', sourceRepo, 'show', `${commit}:website/${file}`], { maxBuffer: 80000000 });
const snapshotPath = path.join(dir, 'manifest.json');
if (process.argv.includes('--apply')) {
  const m = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  for (const e of m.entries) {
    const target = path.join(app, e.file);
    if (e.existed ? !fs.existsSync(target) || !fs.readFileSync(target).equals(fs.readFileSync(path.join(dir, 'baseline', e.file))) : fs.existsSync(target)) throw Error(`Concurrent change: ${e.file}`);
  }
  for (const e of m.entries) {
    const target = path.join(app, e.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, fs.readFileSync(path.join(dir, 'modified', e.file)));
  }
  console.log(`APPLIED ${m.entries.length} scoped scene files`);
  process.exit(0);
}
if (fs.existsSync(snapshotPath)) throw Error('Existing checkpoint must be resumed, not replaced.');
const tree = new Set(execFileSync('git', ['-C', sourceRepo, 'ls-tree', '-r', '--name-only', commit, 'website'], { encoding: 'utf8', maxBuffer: 10000000 }).trim().split('\n').map(x => x.slice('website/'.length)));
const pending = [...seeds], selected = new Map(), retained = new Set(), assets = new Set();
while (pending.length) {
  const file = pending.shift();
  if (selected.has(file)) continue;
  let bytes = source(file);
  if (file === 'app/layout.tsx') bytes = Buffer.from(bytes.toString().replace("title: 'MagiReader'", "title: 'Universal ADV Reader'").replace("description: 'Magia Record Story Archive'", "description: 'Narcissu 系列与加奈欢迎回来剧情阅读及汉化'"));
  if (file === 'app/providers.tsx') bytes = Buffer.from(bytes.toString().replace("let volatileCategory = 'main_story'", "let volatileCategory = 'event_story'").replace("const serverCategory = (): string => 'main_story'", "const serverCategory = (): string => 'event_story'"));
  selected.set(file, bytes);
  const text = bytes.toString();
  const imports = [...text.matchAll(/(?:from\s*|import\s*|@import\s*)(['"])([^'"\r\n]+)\1/g)].map(x => x[2]);
  for (const spec of imports) {
    if (!spec.startsWith('@/') && !spec.startsWith('.')) continue;
    const base = spec.startsWith('@/') ? spec.slice(2) : path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
    const resolved = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find(x => tree.has(x));
    if (!resolved) throw Error(`Unresolved source dependency ${file}: ${spec}`);
    if (seeds.includes(resolved) || resolved.endsWith('.css') || !fs.existsSync(path.join(app, resolved))) pending.push(resolved);
    else retained.add(resolved);
  }
  for (const match of text.matchAll(/["'(](\/(?:textures|fonts)\/[^"'()\s?#]+)(?:[?#][^"'()\s]*)?["')]/g)) {
    const asset = `public${match[1]}`;
    if (tree.has(asset)) assets.add(asset);
    else throw Error(`Pinned asset absent: ${file} -> ${asset}`);
  }
}
for (const asset of assets) selected.set(asset, source(asset));
for (const file of localPatches) selected.set(file, fs.readFileSync(path.join(app, file)));
const entries = [];
for (const [file, bytes] of selected) {
  const target = path.join(app, file), existed = fs.existsSync(target);
  const old = existed ? fs.readFileSync(target) : null;
  for (const [folder, content] of [['baseline', old], ['modified', bytes]]) {
    if (content === null) continue;
    const output = path.join(dir, folder, file);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, content);
  }
  entries.push({ file, existed, baselineBytes: old?.length ?? null, modifiedBytes: bytes.length, source: localPatches.includes(file) ? 'retained-local-awaiting-wiring' : `${commit}:website/${file}` });
}
fs.writeFileSync(snapshotPath, JSON.stringify({ schema: 1, root, app, sourceRepo, commit, entries, retainedDependencies: [...retained] }, null, 2));
console.log(JSON.stringify({ files: entries.length, codeAndCss: selected.size-assets.size-localPatches.length, assets: assets.size, overwrites: entries.filter(x=>x.existed).map(x=>x.file), retainedDependencies: [...retained], assetPaths: [...assets], dir }, null, 2));
