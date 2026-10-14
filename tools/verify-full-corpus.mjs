import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildResearchCatalog,
  createResearchReaderAdapter,
} from '../packages/adapters/src/research-reader-v1.js';
import { allStoryEvents } from '../packages/contracts/src/index.js';
import { readEffectiveReaderManifests } from './lib/content-selection-corrections.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpusRoot = path.resolve(
  process.env.ADV_CORPUS_REPOSITORY
    ?? path.resolve(root, '..', 'narcissu-kana-research'),
);

const localResourcePath = (url) => {
  if (!url.startsWith('/corpus/')) throw new TypeError(`unexpected corpus URL: ${url}`);
  const candidate = path.resolve(
    corpusRoot,
    ...decodeURIComponent(url.slice('/corpus/'.length)).split('/'),
  );
  const prefix = `${corpusRoot}${path.sep}`;
  if (candidate !== corpusRoot && !candidate.startsWith(prefix)) {
    throw new TypeError(`corpus URL escapes its mount: ${url}`);
  }
  return candidate;
};

const io = {
  fetchJson: async (url) => JSON.parse(await readFile(localResourcePath(url), 'utf8')),
  fetchBinary: async (url) => new Uint8Array(await readFile(localResourcePath(url))),
};

const { readerManifest, selectionManifest } = await readEffectiveReaderManifests(corpusRoot);
const chineseManifest = JSON.parse(await readFile(
  path.join(corpusRoot, 'manifests', 'generated', 'chinese-content.json'),
  'utf8',
));
const catalog = buildResearchCatalog(readerManifest, { corpusBaseUrl: '/corpus/' });
const adapter = createResearchReaderAdapter({ corpusBaseUrl: '/corpus/' });
const totals = {
  stories: 0,
  variants: 0,
  sections: 0,
  events: 0,
  lines: 0,
  choices: 0,
  choiceOptions: 0,
  mediaEntries: 0,
  cues: { voice: 0, bgm: 0, sfx: 0, image: 0, video: 0 },
};
const corpora = {};
const failures = [];
const chineseRecords = Array.isArray(chineseManifest.records)
  ? chineseManifest.records : [];
const chineseStoryCount = new Set(
  chineseRecords.map((record) => record.canonicalStoryId),
).size;
const sumireChineseRecord = chineseRecords.find((record) => (
  record.canonicalStoryId === 'narcissu-sumire/ep'
  && record.variantId === 'mjo/curated-zh-cn/narcissu-sumire/ep'
));
const sumireReaderStory = readerManifest.stories.find(
  (story) => story.canonicalStoryId === 'narcissu-sumire/ep',
);
const sumireReaderVariant = sumireReaderStory?.variants.find(
  (variant) => variant.id === 'mjo/curated-zh-cn/narcissu-sumire/ep',
);
if (chineseManifest.result !== 'PASS'
  || chineseManifest.validation?.failureCount !== 0
  || chineseManifest.counts?.records !== chineseRecords.length
  || chineseManifest.counts?.stories !== chineseStoryCount
  || chineseManifest.counts?.records < 263
  || chineseManifest.counts?.stories < 263
  || chineseManifest.counts?.majiroTranslationSources < 117
  || chineseManifest.counts?.majiroTranslationLines < 48182
  || chineseManifest.counts?.majiroCompiledChineseScripts !== 86
  || chineseManifest.counts?.majiroCompiledChineseTextEvents !== 39245
  || chineseManifest.counts?.kanaChineseScripts !== 60
  || chineseManifest.counts?.kanaChineseTextEvents !== 16402) {
  failures.push({
    corpusId: 'source',
    canonicalStoryId: null,
    sourceCanonicalStoryId: null,
    error: 'Chinese content manifest is incomplete',
  });
}
if (!sumireChineseRecord
  || sumireChineseRecord.locale !== 'zh-CN'
  || sumireChineseRecord.alignment !== 'exact-bytecode-order'
  || sumireChineseRecord.lineCount !== 160
  || sumireChineseRecord.mappedTargetCount !== 160
  || sumireChineseRecord.scriptPath
    !== 'archive/derived/scripts/curated/zh-CN/narcissu-sumire/ep.script.json'
  || sumireReaderStory?.preferredVariantId
    !== 'mjo/curated-zh-cn/narcissu-sumire/ep'
  || sumireReaderVariant?.translation?.locale !== 'zh-CN'
  || sumireReaderVariant?.translation?.lineCount !== 160) {
  failures.push({
    corpusId: 'source',
    canonicalStoryId: 'narcissu-sumire/ep',
    sourceCanonicalStoryId: 'narcissu-sumire/ep',
    error: 'Curated Sumire ep Chinese mapping is incomplete',
  });
}
if (selectionManifest.result !== 'PASS'
  || selectionManifest.counts?.archived !== readerManifest.stories.length
  || selectionManifest.counts?.included !== readerManifest.stories.filter(story => story.resource.reader.decision === 'include').length
  || selectionManifest.counts?.excluded !== readerManifest.stories.filter(story => story.resource.reader.decision === 'exclude').length) {
  failures.push({
    corpusId: 'source',
    canonicalStoryId: null,
    sourceCanonicalStoryId: null,
    error: 'Reader selection manifest is incomplete',
  });
}

for (const corpus of catalog.corpora) {
  const corpusTotals = { stories: 0, variants: 0, events: 0, mediaEntries: 0 };
  corpora[corpus.corpusId] = corpusTotals;
  for (const storyEntry of corpus.stories) {
    try {
      const story = await adapter.load({ corpus, storyEntry, io });
      const events = allStoryEvents(story);
      const expectedVariants = storyEntry.sourceGameId === 'kana-okaeri'
        ? 3
        : storyEntry.sourceStory.variants.length;
      if (story.variants.length !== expectedVariants) {
        throw new Error(`expected ${expectedVariants} variants, received ${story.variants.length}`);
      }
      if (storyEntry.sourceGameId === 'narcissu-3rd'
        && !story.variants.some((variant) => variant.locales.includes('zh-CN'))) {
        throw new Error('selected Narcissu 3rd chapter has no Chinese variant');
      }
      totals.stories += 1;
      totals.variants += story.variants.length;
      totals.sections += story.variants.reduce((sum, variant) => sum + variant.sections.length, 0);
      totals.events += events.length;
      totals.lines += events.filter((event) => event.kind === 'line').length;
      totals.choices += events.filter((event) => event.kind === 'choice').length;
      totals.choiceOptions += events
        .filter((event) => event.kind === 'choice')
        .reduce((sum, event) => sum + event.choices.length, 0);
      totals.mediaEntries += story.embeddedMedia.entries.length;
      for (const event of events) {
        for (const cue of event.cues ?? []) {
          if (Object.hasOwn(totals.cues, cue.kind)) totals.cues[cue.kind] += 1;
        }
      }
      corpusTotals.stories += 1;
      corpusTotals.variants += story.variants.length;
      corpusTotals.events += events.length;
      corpusTotals.mediaEntries += story.embeddedMedia.entries.length;
    } catch (error) {
      failures.push({
        corpusId: corpus.corpusId,
        canonicalStoryId: storyEntry.canonicalStoryId,
        sourceCanonicalStoryId: storyEntry.sourceCanonicalStoryId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

const report = {
  schema: 'adv-full-corpus-verification/v1',
  status: failures.length === 0
    && totals.stories === selectionManifest.counts?.included ? 'PASS' : 'FAIL',
  source: {
    manifest: path.relative(root, path.join(
      corpusRoot,
      'manifests',
      'generated',
      'reader-adapter.json',
    )).replaceAll('\\', '/'),
    bridgeRevision: readerManifest.bridgeRevision,
    declaredStories: readerManifest.counts.stories,
    declaredVisibleStories: readerManifest.counts.readerVisibleStories,
    declaredExcludedStories: readerManifest.counts.readerExcludedStories,
    declaredVariants: readerManifest.counts.variants,
    declaredTextEvents: readerManifest.counts.textEvents,
    resourceClassification: readerManifest.resourceClassification,
    readerSelectionManifest: path.relative(root, path.join(
      corpusRoot,
      'manifests',
      'generated',
      'reader-selection.json',
    )).replaceAll('\\', '/'),
    readerSelectionRevision: selectionManifest.revision,
    readerSelectionCounts: selectionManifest.counts,
    chineseContentManifest: path.relative(root, path.join(
      corpusRoot,
      'manifests',
      'generated',
      'chinese-content.json',
    )).replaceAll('\\', '/'),
    chineseContentRevision: chineseManifest.revision,
    chineseContentCounts: chineseManifest.counts,
  },
  corpora,
  totals,
  failureCount: failures.length,
  failures,
};

const reportArg = process.argv.find((value) => value.startsWith('--report='));
if (reportArg) {
  const filename = path.resolve(root, reportArg.slice('--report='.length));
  await writeFile(filename, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'PASS') process.exitCode = 1;
