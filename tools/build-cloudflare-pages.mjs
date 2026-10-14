import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { publicInputHashes, projectPublicProgress, addWindowsRscAliases } from './cloudflare/static-projection.mjs';
import { buildInputHashes, hashFileMap, assertFileMapUnchanged, outputInventory } from './cloudflare/release-integrity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'apps/classic-reader');
const work = path.join(root, 'work/cloudflare');
// Keep the same directory depth as apps/classic-reader, so the retained
// relative imports into root packages/tools keep their exact meaning.
const stage = path.join(root, 'work/cloudflare-app');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = p => fs.access(p).then(() => true, () => false);
const inputFiles = await buildInputHashes(root);
await fs.mkdir(stage, { recursive: true });
const marker = path.join(stage, '.adv-build-stage');
if (!(await exists(marker)) && (await fs.readdir(stage)).length) throw Error('Refusing to overwrite an unmanaged build directory');
await fs.writeFile(marker, 'Generated build projection of apps/classic-reader; never edit this directory.\n');
const before = {};
for (const folder of ['app', 'components', 'lib']) {
  const destination = path.join(stage, folder);
  await fs.rm(destination, { recursive: true, force: true });
  await fs.cp(path.join(source, folder), destination, { recursive: true, filter: p => {
    const rel = path.relative(source, p).replaceAll('\\', '/');
    return !/^app\/(api|corpus)(\/|$)/.test(rel) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(rel);
  } });
  for (const ent of await fs.readdir(destination, { recursive: true, withFileTypes: true })) {
    if (ent.isFile()) {
      const file = path.join(ent.parentPath, ent.name), rel = path.relative(stage, file).replaceAll('\\', '/');
      before[rel] = hash(await fs.readFile(path.join(source, rel)));
    }
  }
}
for (const file of ['postcss.config.mjs', 'package-lock.json', 'cloudflare-env.d.ts']) {
  if (await exists(path.join(source, file))) await fs.copyFile(path.join(source, file), path.join(stage, file));
}
const pkg = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify(pkg, null, 2));
const deps = path.join(stage, 'node_modules');
if (!(await exists(deps))) await fs.symlink(path.join(source, 'node_modules'), deps, process.platform === 'win32' ? 'junction' : 'dir');
if (await fs.realpath(deps) !== await fs.realpath(path.join(source, 'node_modules'))) throw Error('Build dependency link changed');
const indexBytes = await fs.readFile(path.join(source, 'public/story_index.json'));
const stories = JSON.parse(indexBytes);
if (!Array.isArray(stories) || stories.length < 1 || new Set(stories.map(s => s.id)).size !== stories.length) throw Error('Invalid story index');
const ids = [...stories.map(s => s.id), 'local'];
if (ids.some(id => !/^[a-zA-Z0-9_-]+$/.test(id))) throw Error('Unsupported static route ID');
await fs.writeFile(path.join(stage, 'app/reader/[id]/layout.tsx'), `import { Suspense } from 'react';\nexport function generateStaticParams() { return ${JSON.stringify(ids)}.map(id => ({ id })); }\nexport const dynamicParams = false;\nexport default function StaticReaderLayout({ children }: { children: React.ReactNode }) { return <Suspense fallback={null}>{children}</Suspense>; }\n`);
const rootLayout = path.join(stage, 'app/layout.tsx');
let layout = await fs.readFile(rootLayout, 'utf8');
layout = "import { Suspense } from 'react';\n" + layout.replace('{children}', '<Suspense fallback={null}>{children}</Suspense>');
await fs.writeFile(rootLayout, layout);
await fs.writeFile(path.join(stage, 'next.config.mjs'), `import path from 'node:path';\nexport default { output: 'export', images: { unoptimized: true }, outputFileTracingRoot: process.cwd(), experimental: { optimizePackageImports: ['lucide-react'], cpus: 8 }, webpack(config) { config.resolve.alias = { ...config.resolve.alias, '@vercel/og': false, resvg: false, sharp: false, 'yoga-wasm-web': false }; return config; } };\n`);
const ts = JSON.parse(await fs.readFile(path.join(source, 'tsconfig.json'), 'utf8'));
ts.include = ['next-env.d.ts', 'cloudflare-env.d.ts', 'app/**/*.ts', 'app/**/*.tsx', 'components/**/*.tsx', '.next/types/**/*.ts'];
ts.exclude = ['node_modules', '**/*.test.ts', '**/*.test.tsx'];
await fs.writeFile(path.join(stage, 'tsconfig.json'), JSON.stringify(ts, null, 2));
const sourceData = path.join(source, 'public');
const publicFiles = await publicInputHashes(sourceData);
const publicInputSha256 = hash(Object.entries(publicFiles).sort(([a], [b]) => a.localeCompare(b)).map(([p, h]) => p + '\0' + h + '\n').join(''));
const projectedProgress = await projectPublicProgress(sourceData);
await fs.rm(path.join(stage, 'public'), { recursive: true, force: true });
await fs.cp(sourceData, path.join(stage, 'public'), { recursive: true });
await fs.writeFile(path.join(stage, 'public/generic-progress.json'), JSON.stringify(projectedProgress, null, 2) + '\n');
for (const [file, key, value] of [
  ['data/legacy-vn/manifests/playback-media.json', 'root', '/corpus/archive'],
  ['data/legacy-vn/manifests/supplemental-texts.json', 'sourceRoot', '站长提供的中文文本资料'],
]) {
  const target = path.join(stage, 'public', file), data = JSON.parse(await fs.readFile(target, 'utf8'));
  data[key] = value;
  await fs.writeFile(target, JSON.stringify(data, null, 2) + '\n');
}
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout?.trim() || 'unknown';
const dirty = Boolean(spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout?.trim());
const sourceSha256 = hashFileMap(inputFiles);
const indexSha256 = hash(indexBytes);
const revisionRegistrySha256 = hash(await fs.readFile(path.join(sourceData, 'native-reader-revisions.json')));
const buildToolSha256 = hash((await fs.readFile(fileURLToPath(import.meta.url), 'utf8')) + await fs.readFile(path.join(root, 'tools/cloudflare/static-projection.mjs'), 'utf8'));
const buildId = hash(sourceSha256 + publicInputSha256 + buildToolSha256 + await fs.readFile(path.join(source, 'package-lock.json'))).slice(0, 20);
const release = { schema: 'universal-adv-release/v1', buildId, builtAt: new Date().toISOString(), gitRevision: revision, sourceDirty: dirty, sourceSha256, indexSha256, revisionRegistrySha256, stories: stories.length, gameScripts: stories.filter(s => s.category !== 'supplement_story').length, supplementalEntries: stories.filter(s => s.category === 'supplement_story').length, pendingRows: stories.reduce((sum, s) => sum + (s.pending_review_rows || 0), 0), next: pkg.dependencies.next, react: pkg.dependencies.react, delivery: 'local-build-cloudflare-direct-upload', githubActionsRequired: false };
Object.assign(release, { publicInputSha256, buildToolSha256 });
await fs.writeFile(path.join(stage, 'public/release.json'), JSON.stringify(release, null, 2) + '\n');
const config = { schema: 'generic-reader-backend/v1', backend: 'public-static-export', submissions_enabled: false, turnstile_site_key: '', target_branch: 'main', source_revision: buildId, github_admin_auth: false, shared_admin_auth: false, server_pr_creation: false, turnstile_test_mode: false, local: { patch_schema: 'native-reader-translation-patch/v1', revision_registry: '/native-reader-revisions.json', native_review_mode: 'export-only', native_review_endpoint: null, text_schema: 'native-reader-text/v1', workflow: ['edit-in-browser', 'export-patch', 'import-patch'] }, contributions: { provider: 'github-issues', repository: 'HiiragiNemu/universal-adv-reader', url: 'https://github.com/HiiragiNemu/universal-adv-reader/issues', authentication: 'github-hosted', requiresExplicitConfirmation: true, directApiEnabled: false, importCommand: 'npm run review:github -- --issue NUMBER', autoApply: false, githubActionsRequired: false }, missing: [] };
await fs.writeFile(path.join(stage, 'public/deployment-config.json'), JSON.stringify(config, null, 2) + '\n');
const media = JSON.parse(await fs.readFile(path.join(work, 'media-manifest.json'), 'utf8'));
const mediaDeploymentFile = path.join(work, 'media-deployment.json');
const deployed = await exists(mediaDeploymentFile) ? JSON.parse(await fs.readFile(mediaDeploymentFile, 'utf8')) : {};
const largeBase = process.env.ADV_LARGE_MEDIA_URL || deployed.largeMediaUrl;
if (!largeBase || !/^https:\/\/[a-z0-9.-]+\.workers\.dev$/.test(largeBase)) throw Error('Deploy the dedicated large-media Worker before the public frontend build');
const redirects = ['/api/proofreading/config /deployment-config.json 200', '/api/proofreading/machine-status /generic-progress.json 200'];
for (const row of media.media.filter(r => r.delivery === 'r2')) redirects.push(`${row.url} ${largeBase}/${row.key} 302`);
const mediaPrefixes = new Map();
for (const row of media.media.filter(r => r.delivery.startsWith('pages-'))) {
  const parts = row.relativePath.split('/'), prefix = parts.slice(0, Math.min(3, parts.length - 1)).join('/');
  if (mediaPrefixes.has(prefix) && mediaPrefixes.get(prefix) !== row.delivery) throw Error('Media prefix crosses delivery shards: ' + prefix);
  mediaPrefixes.set(prefix, row.delivery);
}
for (const [prefix, delivery] of mediaPrefixes) redirects.push(`/corpus/${prefix}/* https://universal-adv-media-${delivery.slice(6)}.pages.dev/corpus/${prefix}/:splat 302`);
await fs.writeFile(path.join(stage, 'public/_redirects'), redirects.join('\n') + '\n');
await fs.writeFile(path.join(stage, 'public/_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Cache-Control: public, max-age=0, must-revalidate\n  Content-Security-Policy: object-src \'none\'; base-uri \'self\'\n/_next/static/*\n  ! Cache-Control\n  Cache-Control: public, max-age=31536000, immutable\n');
// Build only the generated public projection; the local development server and
// its private filesystem-backed API handlers are never moved or overwritten.
const result = spawnSync(process.execPath, [path.join(source, 'node_modules/next/dist/bin/next'), 'build', '--webpack'], { cwd: stage, stdio: 'inherit', env: { ...process.env, NEXT_PUBLIC_ADV_STATIC: '1', NEXT_TELEMETRY_DISABLED: '1' } });
if (result.status !== 0) throw Error('Static production build failed (' + result.status + ')');
for (const [rel, expected] of Object.entries(before)) if (hash(await fs.readFile(path.join(source, rel))) !== expected) throw Error('Source changed during build: ' + rel);
if (hash(await fs.readFile(path.join(sourceData, 'story_index.json'))) !== indexSha256) throw Error('Story index changed during build');
const currentPublic = await publicInputHashes(sourceData);
if (Object.keys(currentPublic).length !== Object.keys(publicFiles).length || Object.entries(publicFiles).some(([p, h]) => currentPublic[p] !== h)) throw Error('Public input files changed during build');
assertFileMapUnchanged(inputFiles, await buildInputHashes(root), 'Build inputs');
const output = path.join(stage, 'out');
const rscAliases = await addWindowsRscAliases(output);
const inventory = await outputInventory(output);
for (const row of inventory) {
  const rel = row.path, size = row.bytes;
  if (size > 25 * 1024 * 1024 || /(^|\/)(?:\.env|\.git|\.dev\.vars)/.test(rel) || rel.endsWith('.map')) throw Error('Unsafe or oversized deploy asset: ' + rel);
}
if (inventory.length > 20000 || !(await exists(path.join(output, '404.html')))) throw Error('Invalid Pages export');
await fs.writeFile(path.join(work, 'build-receipt.json'), JSON.stringify({ ...release, output, fileCount: inventory.length, bytes: inventory.reduce((n, r) => n + r.bytes, 0), sourceFiles: before, inputFiles, publicFiles, rscAliases, inventory }, null, 2) + '\n');
console.log(JSON.stringify({ ...release, fileCount: inventory.length, output }, null, 2));
