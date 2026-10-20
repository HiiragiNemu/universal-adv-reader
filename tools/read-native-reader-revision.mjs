import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createNativeSourceContext, buildNativeEditSource, publicRoot } from './build-native-edit-sources.mjs';
import { readNativeEditSource, withNativeCounterpartPolicy } from '../apps/classic-reader/lib/native-translation-patch.ts';
import { resolveSameStoryNativeCounterparts } from '../apps/classic-reader/lib/native-section-anchors.ts';
import { EMPTY_NATIVE_REVISIONS, parseNativeRevisionRegistry, readNativeReaderRevision, projectNativeReaderRevisionRows } from '../apps/classic-reader/lib/native-reader-revision.ts';
export const sha = value => createHash('sha256').update(value).digest('hex');
export async function readRevisionRegistry(inputPublic = publicRoot) {
  try { return parseNativeRevisionRegistry(await fs.readFile(path.join(inputPublic,'native-reader-revisions.json'),'utf8')); }
  catch(error) { if(error.code === 'ENOENT')return structuredClone(EMPTY_NATIVE_REVISIONS);throw error; }
}
export async function readPublicNativeRevision(entry, inputPublic = publicRoot, registry) {
  registry ??= await readRevisionRegistry(inputPublic);
  const record = registry.entries[entry.source_identity]; if(!record)return null;
  const rawBase = await fs.readFile(path.join(inputPublic,`data/legacy-vn/${entry.source_identity}.edit-source.json`),'utf8');
  const base = await readNativeEditSource(rawBase,{storyId:entry.source_identity,binding:{}});
  return readNativeReaderRevision(await fs.readFile(path.join(inputPublic,record.path),'utf8'),record,base);
}
export async function loadNativeRevisionContext(entry, inputPublic = publicRoot, context) {
  const built = await buildNativeEditSource(context ?? await createNativeSourceContext(),entry,inputPublic);
  const base = await readNativeEditSource(built.raw,built.document);
  const registry = await readRevisionRegistry(inputPublic), record = registry.entries[entry.source_identity];
  if(!record)return{base,source:withNativeCounterpartPolicy(base,resolveSameStoryNativeCounterparts(entry,built.rows)),story:built.story,rows:built.rows,registry,built};
  const source = await readNativeReaderRevision(await fs.readFile(path.join(inputPublic,record.path),'utf8'),record,base);
  const storyBytes = await fs.readFile(path.join(inputPublic,record.storyPath));
  if(sha(storyBytes)!==record.storySha256)throw Error('Versioned ADV bytes changed');
  const story=JSON.parse(storyBytes);
  if(sha(JSON.stringify(story))!==source.document.binding.normalizedStory)throw Error('Versioned ADV/source binding changed');
  const rows=projectNativeReaderRevisionRows(built.rows,source);
  return{base,source:withNativeCounterpartPolicy(source,resolveSameStoryNativeCounterparts(entry,rows)),story,rows,registry,built};
}
