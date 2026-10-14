import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  buildResearchCatalog,
  createResearchReaderAdapter,
} from '../packages/adapters/src/research-reader-v1.js';
import { allStoryEvents } from '../packages/contracts/src/index.js';
import { repositoryRoot } from '../test-support/helpers.js';

const resourceRoot = path.resolve(process.env.ADV_CORPUS_REPOSITORY ?? path.join(repositoryRoot, '..', 'narcissu-kana-research'));

const loadReaderManifest = async () => JSON.parse(await readFile(
  path.join(resourceRoot, 'manifests', 'generated', 'reader-adapter.json'),
  'utf8',
));

const localResourcePath = (url) => path.join(
  resourceRoot,
  ...decodeURIComponent(url.replace(/^\/corpus\//u, '')).split('/'),
);

const io = {
  fetchJson: async (url) => JSON.parse(await readFile(localResourcePath(url), 'utf8')),
  fetchBinary: async (url) => new Uint8Array(await readFile(localResourcePath(url))),
};

test('reviewed research selection publishes 200 real stories across three works', async () => {
  const manifest = await loadReaderManifest();
  const catalog = buildResearchCatalog(manifest);

  assert.deepEqual(
    catalog.corpora.map((corpus) => [corpus.corpusId, corpus.stories.length]),
    [['narcissu10', 67], ['narcissu3', 81], ['kana', 52]],
  );
  const storyIds = new Set(catalog.corpora.flatMap((corpus) =>
    corpus.stories.map((story) => story.canonicalStoryId)));
  assert.equal(storyIds.size, 200);
  assert.equal(catalog.sourceCounts.stories, 518);
  assert.equal(catalog.sourceCounts.readerVisibleStories, 200);
  assert.equal(catalog.sourceCounts.readerExcludedStories, 318);
  assert.equal(catalog.sourceCounts.variants, 1207);
  assert.equal(catalog.sourceCounts.textEvents, 499330);
  for (const storyId of [
    'narcissu-himeko/himeko_ep00',
    'narcissu-iris/nar3_00',
    'narcissu-one-two/nar1_00',
    'narcissu-sumire/3narsumi01',
    'narcissu-sumire/ep',
    'narcissu-zero/nar4_01',
    'narcissu-zero/nar4_ep',
    'narcissu-3rd/nar3_01',
    'kana-okaeri/ev31',
  ]) assert.equal(storyIds.has(storyId), true, `expected real story ${storyId}`);
  for (const storyId of [
    'narcissu-himeko/%E3%82%AA%E3%83%AA%E3%82%B8%E3%83%8A%E3%83%AB2',
    'narcissu-himeko/start',
    'narcissu-himeko/boss',
    'narcissu-himeko/config',
    'narcissu-iris/novel',
    'narcissu-sumire/narsumi01',
    'narcissu-sumire/%40%E3%81%82%E3%81%8B%E3%82%8A1',
    'narcissu-zero/4novel',
    'kana-okaeri/staff_c',
    'kana-okaeri/omake',
  ]) assert.equal(storyIds.has(storyId), false, `expected excluded script ${storyId}`);
  const himeko = catalog.corpora.find((corpus) => corpus.corpusId === 'narcissu10');
  assert.equal(
    himeko.stories.find((story) =>
      story.sourceCanonicalStoryId === 'narcissu-himeko/himeko_ep00').folderId,
    'narcissu-himeko',
  );
  assert.equal(himeko.stories.find((story) =>
    story.sourceCanonicalStoryId === 'narcissu-iris/nar3_00').folderId, 'narcissu-iris');
});

test('Narcissu full-corpus adapter preserves all Himeko EP00 variants and media routes', async () => {
  const catalog = buildResearchCatalog(await loadReaderManifest());
  const corpus = catalog.corpora.find((item) => item.corpusId === 'narcissu10');
  const storyEntry = corpus.stories.find((item) =>
    item.sourceCanonicalStoryId === 'narcissu-himeko/himeko_ep00');
  const story = await createResearchReaderAdapter().load({ corpus, storyEntry, io });

  assert.equal(story.canonicalStoryId, 'narcissu-himeko/himeko_ep00');
  assert.equal(story.variants.length, 4);
  assert.deepEqual(
    story.variants.map((variant) => variant.variantId),
    storyEntry.sourceStory.variants.map((variant) => variant.id),
  );
  assert.equal(story.variants.some((variant) =>
    variant.variantId === storyEntry.preferredVariantId
      && variant.locales.includes('zh-CN')
      && variant.locales.includes('ja-JP')), true);
  assert.equal(story.embeddedMedia.entries.length, 52);
  assert.equal(story.embeddedMedia.entries.filter((entry) => entry.role === 'voice').length, 22);
  assert.equal(story.embeddedMedia.entries.filter((entry) => entry.role === 'image').length, 18);
  assert.equal(story.embeddedMedia.entries.every((entry) =>
    entry.url.startsWith('/corpus/archive/')), true);
  assert.equal(
    allStoryEvents(story).filter((event) => event.kind === 'line')
      .every((event) => /^mjo-[0-9a-f]+$/u.test(event.eventId)),
    true,
  );
});

test('KANA full-corpus adapter restores bilingual text, choices, and voice routes', async () => {
  const catalog = buildResearchCatalog(await loadReaderManifest());
  const corpus = catalog.corpora.find((item) => item.corpusId === 'kana');
  const storyEntry = corpus.stories.find((item) =>
    item.sourceCanonicalStoryId === 'kana-okaeri/ev31');
  const story = await createResearchReaderAdapter().load({ corpus, storyEntry, io });
  const preferred = story.variants.find((variant) =>
    variant.variantId === storyEntry.preferredVariantId);
  const events = allStoryEvents({ ...story, variants: [preferred] });

  assert.equal(story.canonicalStoryId, 'kana-okaeri/ev31');
  assert.equal(preferred.variantId, 'paired/kana-okaeri/ev31/zh-ja');
  assert.deepEqual(preferred.locales, ['zh-CN', 'ja-JP']);
  assert.equal(preferred.sections[0].events.length, 991);
  assert.equal(events.filter((event) => event.kind === 'choice').length, 6);
  assert.deepEqual(
    events.filter((event) => event.kind === 'choice').map((event) => event.choices.length),
    [3, 2, 3, 3, 3, 3],
  );
  assert.equal(story.embeddedMedia.entries.filter((entry) => entry.role === 'voice').length, 252);
  assert.equal(
    events.filter((event) => event.kind !== 'end')
      .every((event) => /^ikura-[0-9a-f]+$/u.test(event.eventId)),
    true,
  );
  assert.equal(
    events.filter((event) => event.kind === 'choice')
      .flatMap((event) => event.choices)
      .every((choice) => /^arm-[0-9a-f]+$/u.test(choice.choiceId)),
    true,
  );
});

test('Narcissu 3rd consumes its complete playback media roots', async () => {
  const catalog = buildResearchCatalog(await loadReaderManifest());
  const corpus = catalog.corpora.find((item) => item.corpusId === 'narcissu3');
  const storyEntry = corpus.stories.find((item) =>
    item.sourceCanonicalStoryId === 'narcissu-3rd/nar3_01');
  const story = await createResearchReaderAdapter().load({ corpus, storyEntry, io });

  assert.equal(story.embeddedMedia.entries.length, 147);
  assert.equal(story.embeddedMedia.entries.some((entry) => entry.role === 'voice'), true);
  assert.equal(story.embeddedMedia.entries.some((entry) => entry.role === 'image'), true);
  assert.equal(story.embeddedMedia.entries.every((entry) =>
    entry.url.startsWith('/corpus/archive/raw/narcissu3/')
      || entry.url.startsWith('/corpus/archive/derived/images/narcissu3/')), true);
});

test('Narcissu 3rd nard12 publishes the compiled Chinese overlay without mojibake', async () => {
  const catalog = buildResearchCatalog(await loadReaderManifest());
  const corpus = catalog.corpora.find((item) => item.corpusId === 'narcissu3');
  const storyEntry = corpus.stories.find((item) =>
    item.sourceCanonicalStoryId === 'narcissu-3rd/nard12');
  const story = await createResearchReaderAdapter().load({ corpus, storyEntry, io });
  const chinese = story.variants.find((variant) => variant.locales.includes('zh-CN'));
  const events = allStoryEvents({ ...story, variants: [chinese] })
    .filter((event) => event.kind === 'line');
  const text = events.map((event) => event.text['zh-CN'] ?? '').join('');

  assert.equal(storyEntry.preferredVariantId, 'mjo/narcissu3/update.arc.unpacked/nard12');
  assert.equal(chinese.variantId, storyEntry.preferredVariantId);
  assert.equal(events[0].text['zh-CN'].trim(), '——我被哥哥带到天台上。');
  assert.equal(events[4].speaker['zh-CN'], '和昭');
  assert.equal(events[4].text['zh-CN'].trim(), '「……稍微冷静下来了吗？」');
  assert.equal(/[\uFF61-\uFF9F\uE000-\uF8FF]/u.test(text), false);
});

test('excluded system scripts keep their sequential Chinese archive records', async () => {
  const manifest = await loadReaderManifest();
  const catalog = buildResearchCatalog(manifest);
  const sourceStory = manifest.stories.find((item) =>
    item.canonicalStoryId === 'narcissu-himeko/start');
  const sourceVariant = sourceStory.variants.find((variant) =>
    variant.translation?.alignment === 'sequential-unmapped');
  const script = JSON.parse(await readFile(path.join(resourceRoot, sourceVariant.references.script), 'utf8'));

  assert.equal(sourceStory.resource.reader.decision, 'exclude');
  assert.equal(sourceStory.resource.reader.reasonCode, 'runtime-system');
  assert.equal(catalog.corpora.flatMap((item) => item.stories).some((item) =>
    item.sourceCanonicalStoryId === sourceStory.canonicalStoryId), false);
  assert.equal(sourceVariant.translation.lineCount > 0, true);
  assert.equal(script.translation.entries.length, sourceVariant.translation.lineCount);
  assert.equal(script.translation.entries.every((entry) =>
    typeof entry.displayText === 'string'), true);
});
