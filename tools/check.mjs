import { spawnSync } from 'node:child_process';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  allStoryEvents,
  validateCatalog,
  validateMediaManifest,
  validateStoryDocument,
} from '../packages/contracts/src/index.js';
import { voiceRouteSummary, voiceSlotForEvent } from '../packages/core/src/reader-session.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(root, 'apps', 'web');

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'reports') continue;
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(item));
    else if (entry.isFile()) files.push(item);
  }
  return files;
};

const readJson = async (filename) => JSON.parse(await readFile(filename, 'utf8'));
const fromWebUrl = (value) => fileURLToPath(new URL(value, pathToFileURL(`${webRoot}${path.sep}`)));

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
let storyCount = 0;
let sectionCount = 0;
let eventCount = 0;
let lineCount = 0;
let voiceSlotCount = 0;
let mediaEntryCount = 0;

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

    const manifestBase = pathToFileURL(mediaFilename);
    for (const mediaEntry of media.entries) {
      const mediaUrl = new URL(mediaEntry.url, manifestBase);
      if (mediaUrl.protocol !== 'file:') throw new Error(`fixture media URL is not local: ${mediaEntry.url}`);
      const filename = fileURLToPath(mediaUrl);
      const header = await readFile(filename);
      if (mediaEntry.mimeType === 'audio/wav') {
        if (header.subarray(0, 4).toString('ascii') !== 'RIFF'
          || header.subarray(8, 12).toString('ascii') !== 'WAVE') {
          throw new Error(`invalid WAV fixture: ${path.relative(root, filename)}`);
        }
      }
      if (mediaEntry.mimeType === 'image/svg+xml'
        && !header.toString('utf8', 0, Math.min(header.length, 4096)).includes('<svg')) {
        throw new Error(`invalid SVG fixture: ${path.relative(root, filename)}`);
      }
    }

    storyCount += 1;
    sectionCount += story.variants.reduce((total, variant) => total + variant.sections.length, 0);
    eventCount += events.length;
    lineCount += lines.length;
    voiceSlotCount += slots.length;
    mediaEntryCount += media.entries.length;
  }
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
  storyCount,
  sectionCount,
  eventCount,
  lineCount,
  voiceSlotCount,
  allLineEventsHaveExpandableVoiceSlots: voiceSlotCount === lineCount,
  mediaEntryCount,
}, null, 2));
