import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
export const sha256 = value => createHash('sha256').update(value).digest('hex');

export async function publicInputHashes(publicRoot) {
  const result = {};
  for (const entry of await fs.readdir(publicRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const filename = path.join(entry.parentPath, entry.name);
    result[path.relative(publicRoot, filename).replaceAll('\\', '/')] = sha256(await fs.readFile(filename));
  }
  return result;
}

/** The disk snapshot wraps the API payload with private validation bindings.
 * Validate every source binding, then publish the exact inner API contract. */
export async function projectPublicProgress(publicRoot) {
  const root = path.resolve(publicRoot);
  const snapshot = JSON.parse(await fs.readFile(path.join(root, 'generic-progress.json'), 'utf8'));
  if (!snapshot.progress || !snapshot.bindings || Object.keys(snapshot.bindings).length === 0) throw Error('Missing validated progress snapshot');
  for (const [relative, expected] of Object.entries(snapshot.bindings)) {
    const file = path.resolve(root, relative.replace(/^\//, ''));
    if (!file.startsWith(root + path.sep) || !/^[a-f0-9]{64}$/.test(expected)) throw Error('Invalid progress binding');
    if (sha256(await fs.readFile(file)) !== expected) throw Error('Stale progress binding: ' + relative);
  }
  return snapshot.progress;
}

/** Next.js issue #92339: Windows static export leaves path separators inside
 * RSC segment filenames. Add byte-identical flat aliases expected by the
 * client; do not patch node_modules, suppress prefetch, or remove originals. */
export async function addWindowsRscAliases(outputRoot) {
  const mappings = [];
  for (const entry of await fs.readdir(outputRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.txt')) continue;
    const filename = path.join(entry.parentPath, entry.name);
    const relative = path.relative(outputRoot, filename).replaceAll('\\', '/');
    const parts = relative.split('/');
    const pivot = parts.findIndex(p => p === '__next' || p.startsWith('__next.'));
    if (pivot < 0 || pivot === parts.length - 1) continue;
    const alias = [...parts.slice(0, pivot), parts.slice(pivot).join('.')].join('/');
    const destination = path.join(outputRoot, alias), bytes = await fs.readFile(filename);
    try {
      const existing = await fs.readFile(destination);
      if (!existing.equals(bytes)) throw Error('RSC export alias collision: ' + alias);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fs.writeFile(destination, bytes, { flag: 'wx' });
    }
    mappings.push({ source: relative, alias, sha256: sha256(bytes) });
  }
  return mappings;
}
