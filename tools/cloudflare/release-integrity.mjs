import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const transient = new Set([404, 408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530]);

/** Retry public readback only; never retry a remote write or accept an old version. */
export async function readPublishedJson(url, options = {}) {
  const { fetchImpl = globalThis.fetch, dispatcher, attempts = 8, baseDelayMs = 1000,
    maxDelayMs = 15000, sleep = delay, validate = () => true, onRetry = () => {} } = options;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 20) throw new RangeError('Invalid readback attempts');
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0 || !Number.isFinite(maxDelayMs) || maxDelayMs < 0) throw new RangeError('Invalid readback delay');
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let retryAfterMs = 0;
    try {
      const response = await fetchImpl(url, { dispatcher, signal: AbortSignal.timeout(30000), headers: { 'Cache-Control': 'no-cache' } });
      if (!response.ok) {
        const seconds = Number(response.headers.get('retry-after'));
        if (Number.isFinite(seconds) && seconds > 0) retryAfterMs = seconds * 1000;
        await response.body?.cancel();
        const error = new Error(`Public readback ${url} returned HTTP ${response.status}`);
        error.permanent = !transient.has(response.status);
        throw error;
      }
      const result = await response.json();
      if (!await validate(result)) throw new Error(`Public readback ${url} has not reached the expected release`);
      return result;
    } catch (error) {
      lastError = error;
      if (error.permanent || attempt === attempts) break;
      const waitMs = Math.min(maxDelayMs, Math.max(retryAfterMs, baseDelayMs * 2 ** (attempt - 1)));
      onRetry({ url, attempt, attempts, waitMs, error: error.message });
      await sleep(waitMs);
    }
  }
  throw lastError;
}

export function sameRelease(actual, expected) {
  return ['buildId', 'sourceSha256', 'publicInputSha256', 'indexSha256',
    'revisionRegistrySha256', 'buildToolSha256', 'gitRevision', 'sourceDirty']
    .every(key => Object.hasOwn(expected, key) && actual?.[key] === expected[key]);
}

/** Hash every application/config/support input, including newly added files. */
export async function buildInputHashes(root) {
  const result = {};
  async function walk(folder, allowed) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Unexpected build input symlink: ' + file);
      if (entry.isDirectory()) {
        if (!['node_modules', '.next', 'out', '__pycache__', '.git', '.wrangler'].includes(entry.name)) await walk(file, allowed);
      } else if (entry.isFile() && allowed(file)) {
        result[path.relative(root, file).replaceAll('\\', '/')] = sha256(await fs.readFile(file));
      }
    }
  }
  const code = file => /\.(?:[cm]?[jt]sx?|json|jsonc|py|css)$/.test(file) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
  for (const folder of ['apps/classic-reader/app', 'apps/classic-reader/components', 'apps/classic-reader/lib', 'packages', 'tools']) {
    await walk(path.join(root, folder), code);
  }
  for (const file of ['package.json', 'apps/classic-reader/package.json', 'apps/classic-reader/package-lock.json',
    'apps/classic-reader/tsconfig.json', 'apps/classic-reader/postcss.config.mjs', 'apps/classic-reader/cloudflare-env.d.ts',
    'work/cloudflare/media-manifest.json', 'work/cloudflare/media-deployment.json']) {
    result[file] = sha256(await fs.readFile(path.join(root, file)));
  }
  return result;
}

export function hashFileMap(files) {
  return sha256(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([p, h]) => p + '\0' + h + '\n').join(''));
}

export function assertFileMapUnchanged(expected, actual, label) {
  if (!expected || Object.keys(expected).length !== Object.keys(actual).length || Object.entries(expected).some(([p, h]) => actual[p] !== h)) {
    throw new Error(label + ' changed; rebuild before publishing');
  }
}

/** Prevent modified or injected staging files from being uploaded after a build. */
export async function outputInventory(output) {
  const result = [];
  async function walk(folder) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Unexpected deploy output symlink: ' + file);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        const bytes = await fs.readFile(file);
        result.push({ path: path.relative(output, file).replaceAll('\\', '/'), bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  }
  await walk(output);
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

export async function assertOutputUnchanged(expected, output) {
  if (!Array.isArray(expected) || expected.some(row => !/^[a-f0-9]{64}$/.test(row.sha256 || ''))) throw new Error('Build receipt lacks output hashes; rebuild before publishing');
  const actual = await outputInventory(output);
  const normalized = [...expected].sort((a, b) => a.path.localeCompare(b.path));
  if (JSON.stringify(normalized) !== JSON.stringify(actual)) throw new Error('Build output changed; rebuild before publishing');
}
