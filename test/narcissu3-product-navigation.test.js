import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createResearchReaderAdapter } from '../packages/adapters/src/research-reader-v1.js';
import { buildNarcissu3ProductNavigation } from '../tools/lib/narcissu3-product-navigation.mjs';
import { buildNativeStoryGroups } from '../tools/lib/native-story-groups.mjs';
import { repositoryRoot } from '../test-support/helpers.js';
import { classicModules } from '../test-support/classic-module-loader.js';

const root = process.env.ADV_CORPUS_REPOSITORY ?? path.join(repositoryRoot, '..', 'narcissu-kana-research');
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const manifest = await readJson(path.join(root, 'manifests/generated/reader-adapter.json'));
const sourceStory = manifest.stories.find(story => story.canonicalStoryId === 'narcissu-3rd/product');
const resourcePath = url => path.join(root, ...decodeURIComponent(url.replace(/^\/corpus\//u, '')).split('/'));
const document = await createResearchReaderAdapter().load({
  corpus: { corpusId: 'narcissu3' },
  storyEntry: { canonicalStoryId: sourceStory.canonicalStoryId, sourceStory },
  io: {
    fetchJson: async url => readJson(resourcePath(url)),
    fetchBinary: async url => new Uint8Array(await readFile(resourcePath(url))),
  },
});
const variants = document.variants.map(variant => ({
  sourceLocale: variant.locales[0], variantId: variant.variantId,
  events: variant.sections.flatMap(section => section.events),
}));
const navigation = buildNarcissu3ProductNavigation(variants);

test('N3 product native menu exposes the original afterwords and 1993 with every body event retained', () => {
  assert.deepEqual(navigation.counts, { nativeSections: 5, chineseSections: 5, japaneseSections: 3 });
  assert.deepEqual(navigation.nativeSections.map(section => section.id),
    ['native-product-opening', 'native-product-translation-afterword', 'native-product-about', 'native-product-other', 'native-product-1993']);
  for (const variant of navigation.variants) {
    assert.equal(variant.assignedEventCount, variant.bodyEventCount);
    assert.equal(variant.actions.length, 1);
    assert.equal(variant.actions[0].nextEventId, 'end-001');
  }
  const about = navigation.sectionEvidence.find(section => section.id === 'native-product-about');
  assert.equal(about.sources['zh-CN'].sourceInstructionStart, 2729);
  assert.equal(about.sources['ja-JP'].sourceInstructionStart, 536);
  assert.equal(about.sources['zh-CN'].labelRawHex, 'b9d8d3dacbaecfc9a3b3');
  assert.equal(about.sources['zh-CN'].menuCallHex, '0f08e8c27928000000000500');
});

test('Chinese-only native short story has only its real Chinese anchor and is omitted in Japanese-only navigation', () => {
  for (const id of ['native-product-1993', 'native-product-translation-afterword']) {
    const section = navigation.nativeSections.find(section => section.id === id);
    assert.deepEqual(section.available_locales, ['zh-CN']);
    assert.ok(section.target_event_id_cn);
    assert.equal(section.target_event_id_jp, undefined);
    assert.equal(section.title_jp, '');
  }
  const { nativeSectionLinks } = classicModules().load('lib/native-story-navigation.ts');
  assert.equal(nativeSectionLinks({ native_sections: navigation.nativeSections }, 'zh-CN').length, 5);
  assert.equal(nativeSectionLinks({ native_sections: navigation.nativeSections }, 'ja-JP').length, 3);
});

test('product navigation rejects changed native menu labels or unassigned source body events', () => {
  const broken = structuredClone(variants);
  const menu = broken.find(variant => variant.sourceLocale === 'zh-CN').events.find(event => event.kind === 'choice');
  menu.choices[0].label['zh-CN'] = 'invented';
  assert.throws(() => buildNarcissu3ProductNavigation(broken), /Unrecognized original product menu label/u);
  const extra = structuredClone(variants);
  extra[0].events.push({ eventId: 'mjo-unaccounted', kind: 'line', source: { nativeUnit: { codeOffset: 999999 } } });
  assert.throws(() => buildNarcissu3ProductNavigation(extra), /uncovered/u);
});

test('product uses an explicitly editorial navigation label in a separate afterword and short-story group', () => {
  const original = { id: 'legacy-narcissu-3rd-product', category: 'event_story',
    source_identity: 'narcissu-3rd/product', title_cn: 'product', title_jp: 'product',
    folder: 'Narcissu 3rd', native_sections: navigation.nativeSections };
  const result = buildNativeStoryGroups([original]);
  assert.equal(result.stories[0].native_group_id, 'n3-production');
  assert.equal(result.stories[0].folder, '后记与附加短篇');
  assert.equal(result.stories[0].title_cn, original.title_cn);
  assert.equal(result.stories[0].nav_title_cn, '制作后记与１９９３');
  assert.equal(result.assignments[0].evidence.method, 'editorial-source-based');
});
