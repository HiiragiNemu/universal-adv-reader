import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { buildNativeStoryGroups, nativeSectionsFromKanaPlan } from '../tools/lib/native-story-groups.mjs';
import { classicModules } from '../test-support/classic-module-loader.js';
import { repositoryRoot } from '../test-support/helpers.js';

const corpusRoot = process.env.ADV_CORPUS_REPOSITORY
  ?? path.join(repositoryRoot, '..', 'narcissu-kana-research');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const publicRoot = process.env.ADV_CLASSIC_PUBLIC_ROOT ?? path.join(repositoryRoot, 'apps/classic-reader/public');
const index = (await json(path.join(publicRoot, 'story_index.json'))).filter(s=>s.source_format!=='supplemental-text/v1');
const menuGroups = (await json(path.join(corpusRoot, 'config/narcissu-direct-title-evidence-v5.json'))).menuGroups;
const kanaChapterPlan = await json(path.join(repositoryRoot, 'test-support/fixtures/native/kana-chapter-plan.json'));
const options = { menuGroups, kanaChapterPlan };
const result = buildNativeStoryGroups(index, options);
const modules = classicModules();
const navigation = modules.load('lib/native-story-navigation.ts');
const indexParser = modules.load('lib/story-index.ts');
const find = id => result.stories.find(story => story.source_identity === id);

test('catalog regrouping preserves every original route, source path, title and non-navigation field', () => {
  assert.equal(result.stories.length, index.length);
  assert.deepEqual(result.stories.map(story => story.id), index.map(story => story.id));
  const changedFields = new Set(['folder', 'native_group_id', 'native_group_order', 'native_story_order',
    'nav_title_cn', 'nav_title_jp', 'native_sections']);
  for (const [offset, original] of index.entries()) {
    for (const key of Object.keys(original)) {
      if (!changedFields.has(key)) assert.deepEqual(result.stories[offset][key], original[key], original.id + ':' + key);
    }
  }
  assert.doesNotThrow(() => indexParser.parseStoryIndex(result.stories));
});

test('Narcissu 3rd native menu ownership produces four named works plus independent 1st, 2nd and Himeko', () => {
  for (const [canonical, title] of [
    ['narcissu-3rd/nara02', '死神的新娘'],
    ['narcissu-3rd/nard14', '-Ci- 向着卷云的高度'],
    ['narcissu-3rd/narb01', '弥赛亚'],
    ['narcissu-3rd/nar3_01', '小小的伊丽丝'],
    ['narcissu-3rd/nar1_01', 'Narcissu 1st'],
    ['narcissu-3rd/nar2_01', 'Narcissu 2nd'],
    ['narcissu-3rd/hime_ep', '姬子终章'],
  ]) assert.equal(find(canonical).folder, title, canonical);
  const ci = result.groups.find(group => group.id === 'n3-ciras');
  const expectedCi = menuGroups.find(menu => menu.groupId === 'n3-ciras').entries;
  assert.equal(ci.storyCount, expectedCi.length);
  assert.deepEqual(ci.storyIds, expectedCi.map(entry => find(entry.canonicalStoryId).id));
  const hasProduct = index.some(story => story.source_identity === 'narcissu-3rd/product');
  assert.equal(result.groups.filter(group => group.category === 'event_story').length, 7 + Number(hasProduct));
});

test('Narcissu 10th keeps 1st and 2nd distinct and places native prologues before afterwords', () => {
  assert.notEqual(find('narcissu-one-two/nar1_00').native_group_id,
    find('narcissu-one-two/nar2_01').native_group_id);
  for (const [before, after] of [
    ['narcissu-himeko/himeko_ep00', 'narcissu-himeko/himeko_atogaki'],
    ['narcissu-iris/nar3_00', 'narcissu-iris/atogaki'],
    ['narcissu-zero/nar4_00', 'narcissu-zero/4atogaki'],
    ['narcissu-sumire/narsumi00', 'narcissu-sumire/3narsumi01'],
  ]) assert.ok(navigation.compareNativeStories(find(before), find(after)) < 0, before);
});

test('KANA navigation follows native MAIN order, retains all 101 native ranges, and exposes hidden internal titles', () => {
  const kana = result.stories.filter(story => story.source_identity.startsWith('kana-okaeri/'))
    .sort(navigation.compareNativeStories);
  assert.deepEqual(kana.map(story => story.source_identity.split('/').at(-1).toUpperCase()),
    kanaChapterPlan.nativeMainFirstOccurrenceOrder);
  const plannedCount = kanaChapterPlan.scripts.reduce((sum, script) => sum + script.sections.length, 0);
  assert.equal(kana.reduce((sum, story) => sum + story.native_sections.length, 0), plannedCount);
  assert.equal(plannedCount, 101);
  const ev21 = find('kana-okaeri/ev21');
  const plan21 = kanaChapterPlan.scripts.find(script => script.scriptId === 'EV21');
  assert.deepEqual(navigation.nativeSectionLinks(ev21).map(section => section.title),
    plan21.sections.map(section => section.title['zh-CN']));
  assert.equal(ev21.native_sections.length, 7);
  assert.ok(navigation.nativeSectionLinks(ev21).some(section => section.title === '少年期，喝牛奶'));
  const ev482b = find('kana-okaeri/ev482b');
  assert.equal(ev482b.native_sections.length, 6);
  assert.equal(ev482b.native_sections[0].id, 'native-opening');
  assert.equal(ev482b.native_sections[0].native_title_event, false);
  assert.equal(ev482b.native_sections[1].id, 'native-title-794');
  assert.equal(ev482b.native_sections[1].native_title_event, true);
  assert.ok(find('kana-okaeri/ev41').native_story_order < find('kana-okaeri/ev40a').native_story_order);
  assert.ok(find('kana-okaeri/ev4a').native_story_order < find('kana-okaeri/ed1').native_story_order);
});

test('same-title native entries remain separate and receive distinguishable navigation labels', () => {
  for (const pair of [['ev00', 'ev01'], ['ed4', 'ed4b'], ['ed5', 'ed5b'], ['ev48', 'ev482a'], ['ev482a', 'ev482b']]) {
    const left = find('kana-okaeri/' + pair[0]), right = find('kana-okaeri/' + pair[1]);
    assert.notEqual(left.id, right.id);
    assert.notEqual(left.nav_title_cn, right.nav_title_cn);
    assert.equal(left.title_cn, right.title_cn);
  }
  assert.notEqual(find('kana-okaeri/ed2').nav_title_cn, find('kana-okaeri/ed5').nav_title_cn);
  assert.deepEqual(buildNativeStoryGroups(result.stories, options).stories, result.stories);
});

test('unknown or conflicting native work ownership is rejected instead of guessed from a script prefix', () => {
  const source = find('narcissu-3rd/nard14');
  assert.throws(() => buildNativeStoryGroups([{ ...source,
    id: 'legacy-narcissu-3rd-unknown', source_identity: 'narcissu-3rd/unknown', title_evidence: {},
  }], options), /No verified native work group/u);
  assert.throws(() => buildNativeStoryGroups([{ ...source,
    title_evidence: { 'zh-CN': ['groupId=n3-bride'] },
  }], options), /disagrees with the title evidence/u);
  const plan = kanaChapterPlan.scripts.find(script => script.scriptId === 'EV21');
  assert.throws(() => nativeSectionsFromKanaPlan({ ...plan, sections: [plan.sections[0], plan.sections[0]] }),
    /Invalid or repeated native section/u);
});

test('public catalog validation rejects duplicate native anchors and invalid section targets', () => {
  const source = find('kana-okaeri/ev21');
  const sections = structuredClone(source.native_sections);
  sections[1].anchorId = sections[0].anchorId;
  assert.throws(() => indexParser.parseStoryIndex([{ ...source, native_sections: sections }]), /native_sections/u);
  assert.throws(() => indexParser.parseStoryIndex([{ ...source, native_group_order: -1 }]), /native_group_order/u);
  assert.throws(() => indexParser.parseStoryIndex([{ ...source,
    native_sections: [{ ...source.native_sections[0], target_event_id_jp: '../other-story' }],
  }]), /native_sections/u);
});


test('title-only search finds native internal titles and obeys the Japanese-language switch', () => {
  const { genericSearchTitle } = modules.load('lib/generic-search-catalog.ts');
  const story = find('kana-okaeri/ev21');
  assert.ok(genericSearchTitle(story, false).includes('少年期，喝牛奶'));
  assert.ok(!genericSearchTitle(story, false).includes('ミルクを飲む'));
  assert.ok(genericSearchTitle(story, true).includes('ミルクを飲む'));
});

test('Awaji SA short episode has its own bonus card, preserves its archive identity and does not imply Chinese text', async () => {
  const canonicalStoryId = 'narcissu-himeko/%E3%81%8A%E3%81%BE%E3%81%91';
  const source = await json(path.join(corpusRoot,
    'archive/derived/scripts/narcissu10-original-ja-JP/narci_himeko/scenario.arc.unpacked/おまけ.script.json'));
  const heading = source.textEvents[0];
  assert.equal(heading.codeOffset, 181);
  assert.equal(heading.text, '■ショートエピソード　＃０６２　淡路ＳＡ');
  const story = {
    id: 'legacy-narcissu-himeko-omake_062', category: 'main_story', folder: '姬子篇',
    title_cn: '', title_jp: heading.text, title: heading.text,
    source_identity: 'narcissu-himeko/omake_062', source_archive_identity: canonicalStoryId,
    has_cn: false, percent: 0, sections: ['omake_062 Section 1'],
  };
  const output = buildNativeStoryGroups([story], options);
  assert.equal(output.groups.length, 1);
  assert.equal(output.stories[0].native_group_id, 'n10-bonus');
  assert.equal(output.stories[0].folder, '附带短篇');
  assert.equal(output.stories[0].nav_title_cn, '短篇 #062 淡路 SA');
  assert.equal(output.stories[0].title_jp, heading.text);
  assert.equal(output.stories[0].title_cn, '');
  assert.equal(output.stories[0].has_cn, false);
  assert.equal(output.stories[0].source_archive_identity, canonicalStoryId);
  assert.equal(indexParser.parseStoryIndex(output.stories)[0].source_archive_identity, canonicalStoryId);
  assert.equal(output.stories[0].id, story.id);
  assert.equal(output.assignments[0].evidence.method, 'editorial-source-based');
  assert.equal(output.assignments[0].evidence.rawHex, heading.segments[0].rawHex);
  assert.notEqual(output.stories[0].native_group_id, find('narcissu-himeko/himeko_ep00').native_group_id);
  const aliased = { ...story, source_identity: undefined, canonicalStoryId,
    readerIdentity: 'narcissu-himeko/omake_062' };
  assert.equal(buildNativeStoryGroups([aliased], options).stories[0].folder, '附带短篇');
});
