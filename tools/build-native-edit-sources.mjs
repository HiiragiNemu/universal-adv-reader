import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { buildResearchCatalog, createResearchReaderAdapter } from '../packages/adapters/src/research-reader-v1.js';
import { parseStoryContent } from '../apps/classic-reader/lib/story-parser.ts';
import { parseLegacyVoiceRouteDocument } from '../apps/classic-reader/lib/legacy-vn-voice-routing.ts';
import { buildSharedNativeAlignment } from '../apps/classic-reader/lib/legacy-vn-alignment.ts';
import { buildParallelNativeAlignment } from '../apps/classic-reader/lib/legacy-vn-correspondence.ts';
import { buildNativeEditRows } from '../apps/classic-reader/lib/native-translation-patch.ts';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const publicRoot = path.join(root, 'apps/classic-reader/public');
const resource = 'D:/PROGETTO/narcissu-kana-research';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const within = (base, value) => {
  const candidate = path.resolve(base, value);
  if (!candidate.startsWith(path.resolve(base) + path.sep)) throw Error('Path outside declared root');
  return candidate;
};

export async function createNativeSourceContext(inputPublic = publicRoot) {
  const adapterBytes = await fs.readFile(path.join(inputPublic, 'data/legacy-vn/manifests/reader-adapter.json'));
  const manifest = JSON.parse(adapterBytes), catalog = buildResearchCatalog(manifest, { corpusBaseUrl: '/corpus/' });
  const sourcePath = url => {
    if (!url.startsWith('/corpus/')) throw Error('Only original local corpus sources are read');
    return within(resource, decodeURIComponent(url.slice('/corpus/'.length)));
  };
  const io = { fetchJson: async url => JSON.parse(await fs.readFile(sourcePath(url), 'utf8')),
    fetchBinary: async url => new Uint8Array(await fs.readFile(sourcePath(url))) };
  const adapter = createResearchReaderAdapter({ corpusBaseUrl: '/corpus/' });
  const references = new Map();
  const sourceReference = async relative => {
    if (!references.has(relative)) references.set(relative, fs.readFile(within(resource, relative)).then(bytes => ({ path: relative, sha256: hash(bytes) })));
    return references.get(relative);
  };
  return { manifest, catalog, adapterSha256: hash(adapterBytes), sourceReference,
    async story(identity) {
      for (const corpus of catalog.corpora) {
        const entry = corpus.stories.find(s => s.canonicalStoryId === identity);
        if (entry) return { story: await adapter.load({ corpus, storyEntry: entry, io }), entry };
      }
      throw Error('Story is not in the reviewed source catalog');
    } };
}

export async function buildNativeEditSource(context, indexEntry, inputPublic = publicRoot) {
  const identity = indexEntry.source_identity;
  const [routeBytes, cnBytes, jpBytes, loaded] = await Promise.all([
    fs.readFile(path.join(inputPublic, `data/legacy-vn/${identity}.routes.json`)),
    indexEntry.path_cn ? fs.readFile(path.join(inputPublic, indexEntry.path_cn)) : Buffer.from(''),
    fs.readFile(path.join(inputPublic, indexEntry.path_jp)), context.story(identity),
  ]);
  const route = parseLegacyVoiceRouteDocument(JSON.parse(routeBytes), identity);
  const cn = parseStoryContent(cnBytes.toString('utf8'), { mergeConsecutiveTextLines: false }).lines;
  const jp = parseStoryContent(jpBytes.toString('utf8'), { mergeConsecutiveTextLines: false }).lines;
  let rows = buildSharedNativeAlignment(route, cn, jp);
  if (rows === null) {
    const correspondence = JSON.parse(await fs.readFile(path.join(inputPublic, `data/legacy-vn/${identity}.alignment.json`)));
    if (correspondence.hashes.route !== hash(routeBytes) || correspondence.hashes.cnText !== hash(cnBytes) || correspondence.hashes.jpText !== hash(jpBytes)) throw Error('Cross-version correspondence changed');
    rows = buildParallelNativeAlignment(route, cn, jp, correspondence);
  }
  const paths = [...new Set(loaded.entry.sourceStory.variants.flatMap(v => Object.values(v.references).filter(v => typeof v === 'string' && v)))];
  if (loaded.entry.sourceGameId === 'kana-okaeri') paths.push(`manifests/generated/kana-route-diff/scripts/${loaded.entry.sourceStory.displayTitle.toUpperCase()}.json`);
  const nativeSources = await Promise.all(paths.sort().map(context.sourceReference));
  const document = { schema: 'native-reader-edit-source/v1', storyId: identity,
    binding: { route: hash(routeBytes), cnText: hash(cnBytes), jpText: hash(jpBytes), adapter: context.adapterSha256,
      normalizedStory: hash(JSON.stringify(loaded.story)) }, nativeSources, rows: buildNativeEditRows(loaded.story, rows) };
  return { document, story: loaded.story, rows, raw: JSON.stringify(document) + '\n' };
}

export async function buildNativeEditSources(outputPublic = publicRoot, inputPublic = outputPublic) {
  outputPublic = within(root, outputPublic); inputPublic = within(root, inputPublic);
  const context = await createNativeSourceContext(inputPublic), index = JSON.parse(await fs.readFile(path.join(inputPublic, 'story_index.json')));
  const expected = new Set(context.catalog.corpora.flatMap(corpus => corpus.stories.map(story => story.canonicalStoryId)));
  if (index.length !== expected.size || new Set(index.map(story => story.source_identity)).size !== expected.size
    || index.some(story => !expected.has(story.source_identity))) throw Error('Native edit sources must cover the complete reviewed catalog');
  const results = [];
  for (const entry of index) {
    const built = await buildNativeEditSource(context, entry, inputPublic);
    const target = within(outputPublic, `data/legacy-vn/${entry.source_identity}.edit-source.json`);
    await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, built.raw);
    results.push({ storyId: entry.source_identity, sha256: hash(built.raw), bytes: Buffer.byteLength(built.raw), rows: built.rows.length,
      editableText: built.document.rows.filter(r => r.allowed.includes('text')).length,
      editableSpeakers: built.document.rows.filter(r => r.allowed.includes('speaker')).length,
      editableChoices: built.document.rows.filter(r => r.allowed.includes('choiceLabel')).length,
      referencedOriginalFiles: built.document.nativeSources.length });
  }
  return { schema: 1, stories: results, counts: { stories: results.length, rows: results.reduce((n,r)=>n+r.rows,0),
    editableText: results.reduce((n,r)=>n+r.editableText,0), editableSpeakers: results.reduce((n,r)=>n+r.editableSpeakers,0),
    editableChoices: results.reduce((n,r)=>n+r.editableChoices,0), bytes: results.reduce((n,r)=>n+r.bytes,0) } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const option = key => { const i=process.argv.indexOf(key); return i < 0 ? undefined : process.argv[i+1]; };
  const report = await buildNativeEditSources(option('--output'));
  const reportPath = option('--report');
  if (reportPath) { const target=within(root,reportPath);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,JSON.stringify(report,null,2)); }
  console.log(JSON.stringify(report.counts));
}
