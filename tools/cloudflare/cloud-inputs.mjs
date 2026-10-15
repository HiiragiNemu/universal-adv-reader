import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const maxAssetBytes = 25 * 1024 * 1024;

export function validateBuildAssets(manifest) {
  if (manifest?.schema !== 'adv-public-build-assets/v1' || !Array.isArray(manifest.files)) throw Error('Invalid public build asset manifest');
  const names = new Set();
  for (const asset of manifest.files) {
    if (!/^fonts\/[a-zA-Z0-9_./-]+\.(woff2?|ttf|otf|ttc)$/.test(asset.path || '') || asset.path.split('/').includes('..') || names.has(asset.path)) throw Error('Unsafe or repeated public build asset path');
    names.add(asset.path);
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > maxAssetBytes || !/^[a-f0-9]{64}$/.test(asset.sha256 || '')) throw Error('Invalid public build asset identity');
    if (!Array.isArray(asset.sources) || !asset.sources.length) throw Error('Missing public build asset origin');
    for (const source of asset.sources) {
      const url = new URL(source);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !/^(?:[a-f0-9]+\.)?magireader\.pages\.dev$/.test(url.hostname) || decodeURIComponent(url.pathname) !== '/' + asset.path || url.search || url.hash) throw Error('Unapproved public build asset origin');
    }
  }
  return manifest.files;
}

/** No private credentials or local research paths are needed in a Git build. */
export async function restoreCloudInputs(root, { fetchImpl = fetch, sleep = delay } = {}) {
  const config = path.join(root, 'config/cloudflare');
  const work = path.join(root, 'work/cloudflare');
  const publicRoot = path.join(root, 'apps/classic-reader/public');
  const manifest = JSON.parse(await fs.readFile(path.join(config, 'public-build-assets.json'), 'utf8'));
  const assets = validateBuildAssets(manifest);
  await fs.mkdir(work, { recursive: true });
  for (const file of ['media-manifest.json', 'media-deployment.json']) {
    const bytes = await fs.readFile(path.join(config, file));
    JSON.parse(bytes.toString('utf8'));
    await fs.writeFile(path.join(work, file), bytes);
  }
  const restored = [];
  for (const asset of assets) {
    const destination = path.join(publicRoot, asset.path);
    const existing = await fs.readFile(destination).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (existing && existing.length === asset.bytes && hash(existing) === asset.sha256) { restored.push({ path: asset.path, source: 'verified-existing', sha256: asset.sha256 }); continue; }
    if (existing) throw Error('Existing public build asset differs from its pinned identity: ' + asset.path);
    let bytes, origin, lastError;
    for (let attempt = 0; attempt < 3 && !bytes; attempt++) {
      for (const source of asset.sources) {
        try {
          const response = await fetchImpl(source, { signal: AbortSignal.timeout(60000), redirect: 'error' });
          if (!response.ok) { await response.body?.cancel(); throw Error('HTTP ' + response.status); }
          if (response.headers.get('content-length') && Number(response.headers.get('content-length')) !== asset.bytes) { await response.body?.cancel(); throw Error('Wrong public asset byte count'); }
          const chunks = []; let size = 0;
          for await (const chunk of response.body) { size += chunk.length; if (size > asset.bytes) throw Error('Public asset exceeded pinned size'); chunks.push(Buffer.from(chunk)); }
          const candidate = Buffer.concat(chunks);
          if (candidate.length !== asset.bytes || hash(candidate) !== asset.sha256) throw Error('Public asset checksum mismatch');
          bytes = candidate; origin = source; break;
        } catch (error) { lastError = error; }
      }
      if (!bytes && attempt < 2) await sleep(1000 * 2 ** attempt);
    }
    if (!bytes) throw Error('Cannot restore pinned public asset ' + asset.path + ': ' + lastError?.message);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    // wx prevents replacing a concurrent writer or following an existing file symlink.
    await fs.writeFile(destination, bytes, { flag: 'wx' });
    restored.push({ path: asset.path, source: origin, sha256: asset.sha256 });
  }
  await fs.writeFile(path.join(work, 'cloud-input-receipt.json'), JSON.stringify({ schema: 'adv-cloud-input-receipt/v1', restored }, null, 2) + '\n');
  return restored;
}
