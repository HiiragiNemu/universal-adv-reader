import { spawnSync } from 'node:child_process';
import { access, open, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  allStoryEvents,
  validateCatalog,
  validateMediaManifest,
  validateStoryDocument,
} from '../packages/contracts/src/index.js';
import { buildResearchCatalog } from '../packages/adapters/src/research-reader-v1.js';
import { readEffectiveReaderManifests } from './lib/content-selection-corrections.mjs';
import { voiceRouteSummary, voiceSlotForEvent } from '../packages/core/src/reader-session.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(root, 'apps', 'web');
const corpusRoot = path.resolve(
  process.env.ADV_CORPUS_REPOSITORY
    ?? path.resolve(root, '..', 'narcissu-kana-research'),
);

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    // Third-party packages and build caches are verified by their own build, not source syntax checks.
    if (['.git','reports','node_modules','.next','.open-next','.wrangler','.pages-deploy','coverage','__pycache__'].includes(entry.name)) continue;
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(item));
    else if (entry.isFile()) files.push(item);
  }
  return files;
};

const readJson = async (filename) => JSON.parse(await readFile(filename, 'utf8'));
const fromWebUrl = (value) => fileURLToPath(new URL(value, pathToFileURL(`${webRoot}${path.sep}`)));
const fromMediaUrl = (value, manifestFilename) => {
  if (value.startsWith('/corpus/')) {
    const candidate = path.resolve(corpusRoot, value.slice('/corpus/'.length));
    const prefix = `${corpusRoot}${path.sep}`;
    if (candidate !== corpusRoot && !candidate.startsWith(prefix)) {
      throw new Error(`corpus media escapes its mount: ${value}`);
    }
    return candidate;
  }
  const url = new URL(value, pathToFileURL(manifestFilename));
  if (url.protocol !== 'file:') throw new Error(`fixture media URL is not local: ${value}`);
  return fileURLToPath(url);
};
const readPrefix = async (filename, length = 4096) => {
  const handle = await open(filename, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

const files = await walk(root);
const javascriptFiles = files.filter((filename) => ['.js', '.mjs'].includes(path.extname(filename)));
for (const filename of javascriptFiles) {
  const check = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8' });
  if (check.status !== 0) {
    process.stderr.write(check.stderr || check.stdout);
    throw new Error(`syntax check failed: ${path.relative(root, filename)}`);
  }
}

const jsonFiles = files.filter((filename) => path.extname(filename) === '.json');
for (const filename of jsonFiles) await readJson(filename);

const catalog = validateCatalog(await readJson(path.join(webRoot, 'data', 'catalog.json')));
let fixtureStoryCount = 0;
let sectionCount = 0;
let eventCount = 0;
let lineCount = 0;
let voiceSlotCount = 0;
let mediaEntryCount = 0;
const verifiedMediaFiles = new Set();

for (const corpus of catalog.corpora) {
  for (const entry of corpus.stories) {
    const storyFilename = fromWebUrl(entry.source);
    const mediaFilename = fromWebUrl(entry.mediaManifest);
    await access(storyFilename);
    await access(mediaFilename);
    const story = validateStoryDocument(await readJson(storyFilename));
    const media = validateMediaManifest(await readJson(mediaFilename));
    if (story.canonicalStoryId !== entry.canonicalStoryId) {
      throw new Error(`catalog/story ID mismatch for ${entry.canonicalStoryId}`);
    }
    if (story.corpusId !== corpus.corpusId || story.adapterId !== corpus.adapterId) {
      throw new Error(`catalog/story adapter boundary mismatch for ${entry.canonicalStoryId}`);
    }
    if (!story.variants.some((variant) => variant.variantId === entry.preferredVariantId)) {
      throw new Error(`preferred variant does not resolve for ${entry.canonicalStoryId}`);
    }

    const summary = voiceRouteSummary(story);
    const events = allStoryEvents(story);
    const lines = events.filter((event) => event.kind === 'line');
    const slots = lines.map(voiceSlotForEvent);
    if (!summary.expandableForAllStories || slots.some((slot) => !slot?.visibleWhenExpanded)) {
      throw new Error(`all-story voice expansion invariant failed for ${entry.canonicalStoryId}`);
    }

    for (const mediaEntry of media.entries) {
      const filename = fromMediaUrl(mediaEntry.url, mediaFilename);
      if (verifiedMediaFiles.has(filename)) continue;
      await access(filename);
      const header = await readPrefix(filename);
      if (mediaEntry.mimeType === 'audio/wav') {
        if (header.subarray(0, 4).toString('ascii') !== 'RIFF'
          || header.subarray(8, 12).toString('ascii') !== 'WAVE') {
          throw new Error(`invalid WAV fixture: ${path.relative(root, filename)}`);
        }
      }
      if (mediaEntry.mimeType === 'audio/ogg'
        && header.subarray(0, 4).toString('ascii') !== 'OggS') {
        throw new Error(`invalid Ogg fixture: ${path.relative(root, filename)}`);
      }
      if (mediaEntry.mimeType === 'image/png'
        && !header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        throw new Error(`invalid PNG fixture: ${path.relative(root, filename)}`);
      }
      if (mediaEntry.mimeType === 'image/svg+xml'
        && !header.toString('utf8', 0, Math.min(header.length, 4096)).includes('<svg')) {
        throw new Error(`invalid SVG fixture: ${path.relative(root, filename)}`);
      }
      verifiedMediaFiles.add(filename);
    }

    fixtureStoryCount += 1;
    sectionCount += story.variants.reduce((total, variant) => total + variant.sections.length, 0);
    eventCount += events.length;
    lineCount += lines.length;
    voiceSlotCount += slots.length;
    mediaEntryCount += media.entries.length;
  }
}

const readerManifestFilename = path.join(
  corpusRoot,
  'manifests',
  'generated',
  'reader-adapter.json',
);
await access(readerManifestFilename);
const archivedManifest = await readJson(readerManifestFilename);
const { readerManifest } = await readEffectiveReaderManifests(corpusRoot);
const deployedCatalog = buildResearchCatalog(readerManifest, { corpusBaseUrl: '/corpus/' });
const deployedCorpusCounts = Object.fromEntries(
  deployedCatalog.corpora.map((corpus) => [corpus.corpusId, corpus.stories.length]),
);
const deployedStoryCount = deployedCatalog.corpora.reduce(
  (total, corpus) => total + corpus.stories.length,
  0,
);
const sourceVariants = archivedManifest.stories.flatMap(story => story.variants);
const archivedTextEvents = sourceVariants.reduce((n,variant) => n + variant.textEventCount,0);
const selected = readerManifest.stories.filter(story => story.resource.reader.decision === 'include');
const sourceIdentity = story => story.readerIdentity ?? story.canonicalStoryId;
const catalogIds = new Set(deployedCatalog.corpora.flatMap(corpus => corpus.stories.map(story => story.canonicalStoryId)));
const expectedCorpusCounts = {
  narcissu10: selected.filter(story => !['narcissu-3rd','kana-okaeri'].includes(story.gameId)).length,
  narcissu3: selected.filter(story => story.gameId === 'narcissu-3rd').length,
  kana: selected.filter(story => story.gameId === 'kana-okaeri').length,
};
if (archivedManifest.stories.length !== archivedManifest.counts.stories
  || new Set(archivedManifest.stories.map(story => story.canonicalStoryId)).size !== archivedManifest.stories.length
  || new Set(sourceVariants.map(variant => variant.id)).size !== sourceVariants.length
  || sourceVariants.length !== archivedManifest.counts.variants
  || archivedTextEvents !== archivedManifest.counts.textEvents
  || JSON.stringify(deployedCorpusCounts) !== JSON.stringify(expectedCorpusCounts)
  || selected.length === 0 || deployedStoryCount !== selected.length || catalogIds.size !== selected.length
  || selected.some(story => !catalogIds.has(sourceIdentity(story)))
  || deployedCatalog.sourceCounts?.variants !== sourceVariants.length
  || deployedCatalog.sourceCounts?.textEvents !== archivedTextEvents
  || readerManifest.validation?.failureCount !== 0) {
  throw new Error('reviewed catalog membership or independent archive totals differ');
}


const appManifest = await readJson(path.join(webRoot, '.well-known', 'adv-app.json'));
if (appManifest.schema !== 'adv-app-manifest/v1'
  || appManifest.protocol?.name !== 'adv-app-bridge'
  || appManifest.protocol?.version !== 1) {
  throw new Error('ADV app manifest protocol declaration is invalid');
}
if (appManifest.voiceControls?.availableForAllStories !== true
  || appManifest.voiceControls?.defaultState !== 'collapsed'
  || appManifest.voiceControls?.expandedDefaultSlotMode !== 'all'
  || appManifest.voiceControls?.unresolvedCueBehavior !== 'visible') {
  throw new Error('ADV app manifest does not expose all-story voice controls');
}

console.log(JSON.stringify({
  status: 'PASS',
  javascriptFiles: javascriptFiles.length,
  jsonFiles: jsonFiles.length,
  fixtureStoryCount,
  deployedStoryCount,
  archivedStoryCount: archivedManifest.stories.length,
  deployedCorpusCounts,
  deployedVariantCount: deployedCatalog.sourceCounts.variants,
  deployedTextEventCount: deployedCatalog.sourceCounts.textEvents,
  sectionCount,
  eventCount,
  lineCount,
  voiceSlotCount,
  allLineEventsHaveExpandableVoiceSlots: voiceSlotCount === lineCount,
  mediaEntryCount,
  verifiedMediaFiles: verifiedMediaFiles.size,
}, null, 2));
