import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { classicStoryIds } from './generate-classic-story-ids.mjs';
import { readRevisionRegistry, readPublicNativeRevision } from './read-native-reader-revision.mjs';
import { nativeRevisionTextRows } from '../apps/classic-reader/lib/native-reader-revision.ts';
import { parseStoryContent } from '../apps/classic-reader/lib/story-parser.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'apps/classic-reader/public');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = value => {
  const result = path.resolve(value);
  if (!result.startsWith(root + path.sep)) throw Error('Search output must stay inside the generic checkout');
  return result;
};

export async function buildGenericSearchIndex(inputPublic = publicRoot, outputPublic = publicRoot, options = {}) {
  inputPublic = inside(inputPublic); outputPublic = inside(outputPublic);
  const indexBytes = await fs.readFile(path.join(inputPublic, 'story_index.json'));
  const stories = JSON.parse(indexBytes); classicStoryIds(stories);
  const works = { main_story: 0, event_story: 0, character_story: 0, supplement_story: 0 };
  const entries = [], sources = [];
  const revisions = await readRevisionRegistry(inputPublic);
  for (const story of stories) {
    if (!Object.hasOwn(works, story.category)) throw Error('Unexpected work category: ' + story.category);
    works[story.category]++;
    const revision = story.source_format==='supplemental-text/v1' ? null : options.overrides?.get(story.source_identity) ?? await readPublicNativeRevision(story,inputPublic,revisions);
    for (const language of ['cn', 'jp']) {
      if (language === 'cn' && revision) {
        sources.push({id:story.id,language,revision:revision.revision.revision,sourceSha256:revision.sha256});
        for (const line of nativeRevisionTextRows(revision)) {
          const text = line.choiceLabel ?? line.text;
          if (!line.target || !text.trim()) continue;
          entries.push({id:story.id,l:language,c:[line.speaker,text].filter(Boolean).join('：')});
        }
        continue;
      }
      const source = story[`path_${language}`];
      if (!source) continue;
      if (!/^\/data\/legacy-vn\/[A-Za-z0-9_./-]+\.txt$/.test(source) || source.includes('..')) throw Error('Unexpected text source');
      const bytes = await fs.readFile(path.join(inputPublic, source));
      sources.push({ id: story.id, language, path: source, bytes: bytes.length, sha256: sha(bytes) });
      const parsed = parseStoryContent(bytes.toString('utf8'), { mergeConsecutiveTextLines: false });
      for (const line of parsed.lines) {
        const text = line.choiceLabel || line.text;
        if (line.isHeader || !text.trim()) continue;
        entries.push({ id: story.id, l: language, c: [line.speaker, text].filter(Boolean).join('：') });
      }
    }
  }
  // Use the actual selected sources as the denominator, including future native chapters.
  // Membership uniqueness is checked by classicStoryIds above; materialization additionally
  // checks every selected source against the corpus selection manifest.
  if (Object.values(works).reduce((total, count) => total + count, 0) !== stories.length) throw Error('Search work membership differs from the current directory');
  const body = Buffer.from(JSON.stringify(entries)), digest = sha(body), chunkBytes = 1024 * 1024;
  const directory = path.join(outputPublic, 'search-chunks/generic', digest);
  await fs.mkdir(directory, { recursive: true });
  const chunks = [];
  for (let offset = 0, index = 0; offset < body.length; offset += chunkBytes, index++) {
    const bytes = body.subarray(offset, offset + chunkBytes);
    await fs.writeFile(path.join(directory, `${String(index).padStart(4, '0')}.part`), bytes);
    chunks.push({ bytes: bytes.length, sha256: sha(bytes) });
  }
  const manifest = { version: 2, sha256: digest, bytes: body.length, entries: entries.length,
    object_key: `search/generic/${digest}.json`, story_index_sha256: sha(indexBytes), chunk_bytes: chunkBytes, chunks,
    stories: stories.length, works, parser_sha256: sha(await fs.readFile(path.join(root, 'apps/classic-reader/lib/story-parser.ts'))), sources };
  await fs.writeFile(path.join(outputPublic, 'search_index_manifest.generic.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { stories: stories.length, works, entries: entries.length, bytes: body.length, chunks: chunks.length, sha256: digest, outputPublic };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const index = process.argv.indexOf('--output');
  console.log(JSON.stringify(await buildGenericSearchIndex(publicRoot, index < 0 ? publicRoot : process.argv[index + 1])));
}
