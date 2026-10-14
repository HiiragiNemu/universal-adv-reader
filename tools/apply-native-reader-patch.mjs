import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { publicRoot } from './build-native-edit-sources.mjs';
import { loadNativeRevisionContext } from './read-native-reader-revision.mjs';
import { applyNativeTranslationPatch } from '../apps/classic-reader/lib/native-translation-patch.ts';
import { validateStoryDocument } from '../packages/contracts/src/index.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Produces a new generic ADV document. Does not rewrite native binaries,
 * resources, current public sources, or an existing derivative. */
export async function applyNativeReaderPatch(patchPath, outputPath) {
  const output = path.resolve(outputPath);
  if (!output.startsWith(root + path.sep) || output.startsWith(publicRoot + path.sep)) throw Error('Derivative output must stay in a separate generic-project file');
  const patch = JSON.parse(await fs.readFile(patchPath, 'utf8'));
  const index = JSON.parse(await fs.readFile(path.join(publicRoot, 'story_index.json')));
  const entry = index.find(e => e.source_identity === patch.storyId); if (!entry) throw Error('Patch story is not a public native story');
  const current = await loadNativeRevisionContext(entry);
  const modified = await applyNativeTranslationPatch(current.source, patch, current.story);
  validateStoryDocument(modified);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(modified, null, 2) + '\n', { flag: 'wx' });
  const reopened = JSON.parse(await fs.readFile(output, 'utf8')); validateStoryDocument(reopened);
  return { schema: reopened.schema, storyId: patch.storyId, changes: patch.changes.length, output, originalFilesWritten: 0 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const arg = key => { const i=process.argv.indexOf(key);if(i<0 || !process.argv[i+1])throw Error('Missing '+key);return process.argv[i+1]; };
  console.log(JSON.stringify(await applyNativeReaderPatch(arg('--patch'),arg('--output'))));
}
