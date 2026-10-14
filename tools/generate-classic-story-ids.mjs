import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'apps/classic-reader/public');

export function classicStoryIds(index) {
  if (!Array.isArray(index) || index.length === 0 || index.length > 100_000) throw new TypeError('The reviewed Classic directory must contain a nonempty bounded source membership.');
  const seen = new Set();
  return index.map(entry => {
    const id = entry?.id;
    if (typeof id !== 'string' || !/^legacy-[A-Za-z0-9_.:-]+$/.test(id)) throw new TypeError('Classic ID must retain its exact generic legacy route identity.');
    const folded = id.toLowerCase();
    if (seen.has(folded)) throw new TypeError(`Duplicate Classic ID: ${id}`);
    seen.add(folded);
    return id;
  }).sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const ids = classicStoryIds(JSON.parse(await readFile(path.join(publicRoot, 'story_index.json'), 'utf8')));
  const target = path.join(publicRoot, 'data/story_ids.generated.json');
  const text = `${JSON.stringify(ids, null, 2)}\n`;
  if (process.argv.includes('--check')) {
    if (await readFile(target, 'utf8') !== text) throw Error('Generated Classic membership differs from the current public directory.');
  } else await writeFile(target, text, 'utf8');
  console.log(`CLASSIC_STORY_IDS=${ids.length}; source=local public story_index.json; mode=${process.argv.includes('--check') ? 'check' : 'generate'}`);
}
