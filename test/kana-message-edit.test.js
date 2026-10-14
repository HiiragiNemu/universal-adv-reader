import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { buildNativeEditRows, readNativeEditSource, createNativeTranslationPatch, applyNativeTranslationPatch,
  composeIkuraMessageText, splitIkuraMessageText } from '../apps/classic-reader/lib/native-translation-patch.ts';
import { seedNativeEditableLines } from '../apps/classic-reader/lib/legacy-vn-alignment.ts';
import { parseNativeRevisionRegistry } from '../apps/classic-reader/lib/native-reader-revision.ts';
const hash = value => createHash('sha256').update(value).digest('hex');

async function fixture({ legacy = false } = {}) {
  const rawText = '　加　奈：『原文。』';
  const event = { eventId: 'ikura-20', kind: 'line', text: { 'zh-CN': legacy ? rawText : '『原文。』', 'ja-JP': '「原文。」' },
    speaker: { 'zh-CN': '加奈', 'ja-JP': '加奈' }, nextEventId: 'end',
    source: { engine: 'ikura', opcode: 0x2B, instructionIndex: 4, zhOffset: 36, jaOffset: 32,
      ...(!legacy ? { originalDisplayText: { 'zh-CN': rawText, 'ja-JP': '加奈：「原文。」' } } : {}) } };
  const story = { schema: 'adv-story/v1', provenance: { sourceCanonicalStoryId: 'kana-okaeri/fixture' },
    variants: [{ variantId: 'same', locales: ['zh-CN', 'ja-JP'], sections: [{ sectionId: 'main',
      events: [event, { eventId: 'end', kind: 'end' }] }] }] };
  const key = '["same","main"]/ikura-20';
  const rows = [{ nativeKeys: [key], cn: { speaker: '加奈', text: event.text['zh-CN'] },
    jp: { speaker: '加奈', text: event.text['ja-JP'] }, cnIndices: [0], jpIndices: [0], cnSlot: null, jpSlot: null }];
  const binding = { route: '0'.repeat(64), cnText: '1'.repeat(64), jpText: '2'.repeat(64), adapter: '3'.repeat(64), normalizedStory: hash(JSON.stringify(story)) };
  const document = { schema: 'native-reader-edit-source/v1', storyId: 'kana-okaeri/fixture', binding, nativeSources: [], rows: buildNativeEditRows(story, rows) };
  return { story, event, rows, source: await readNativeEditSource(JSON.stringify(document), document) };
}

test('KANA body and name edits preserve native operand formatting, original evidence, other locale and control graph', async () => {
  const f = await fixture(), before = JSON.stringify(f.story);
  assert.deepEqual(f.source.document.rows[0].allowed, ['text', 'speaker']);
  assert.equal(composeIkuraMessageText(f.event), '　加　奈：『原文。』');
  const bodyOnly = seedNativeEditableLines(f.rows, 'current'); bodyOnly[0].text = '『修改后的正文。』';
  const one = await applyNativeTranslationPatch(f.source, createNativeTranslationPatch(f.source, bodyOnly), f.story);
  assert.equal(one.variants[0].sections[0].events[0].speaker['zh-CN'], '加奈');
  assert.equal(composeIkuraMessageText(one.variants[0].sections[0].events[0]), '　加　奈：『修改后的正文。』');
  const both = seedNativeEditableLines(f.rows, 'current'); both[0].speaker = '新名字'; both[0].text = '『新的正文。』';
  const two = await applyNativeTranslationPatch(f.source, createNativeTranslationPatch(f.source, both), f.story);
  const changed = two.variants[0].sections[0].events[0];
  assert.equal(changed.text['zh-CN'], '『新的正文。』');
  assert.equal(changed.speaker['zh-CN'], '新名字');
  assert.equal(composeIkuraMessageText(changed), '　新名字：『新的正文。』');
  assert.deepEqual(changed.source, f.event.source);
  assert.equal(changed.text['ja-JP'], f.event.text['ja-JP']);
  assert.equal(changed.nextEventId, f.event.nextEventId);
  assert.equal(JSON.stringify(f.story), before);
  both[0].speaker = ''; both[0].text = '';
  const blank = await applyNativeTranslationPatch(f.source, createNativeTranslationPatch(f.source, both), f.story);
  assert.equal(composeIkuraMessageText(blank.variants[0].sections[0].events[0]), '');
});

test('KANA accepts a pasted embedded name once and retains old source compatibility for 『 dialogue', async () => {
  const f = await fixture(), lines = seedNativeEditableLines(f.rows, 'current');
  lines[0].text = '别的名字：『已修正。』';
  const output = await applyNativeTranslationPatch(f.source, createNativeTranslationPatch(f.source, lines), f.story);
  const event = output.variants[0].sections[0].events[0];
  assert.equal(event.text['zh-CN'], '『已修正。』');
  assert.equal(event.speaker['zh-CN'], '别的名字');
  assert.equal(splitIkuraMessageText(composeIkuraMessageText(event)).body, event.text['zh-CN']);
  const old = await fixture({ legacy: true }), oldLines = seedNativeEditableLines(old.rows, 'current');
  assert.deepEqual(old.source.document.rows[0].allowed, ['text']);
  oldLines[0].text = '旧版新名字：『兼容正文。』';
  const compatible = await applyNativeTranslationPatch(old.source, createNativeTranslationPatch(old.source, oldLines), old.story);
  assert.equal(compatible.variants[0].sections[0].events[0].speaker['zh-CN'], '旧版新名字');
  assert.equal(compatible.variants[0].sections[0].events[0].text['zh-CN'], oldLines[0].text);
});

test('native revision registry accepts the expanded catalog while keeping identities and content-addressed paths checked', () => {
  const revision = 'a'.repeat(64), entries = {};
  for (let i = 0; i < 230; i++) {
    const storyId = 'kana-okaeri/fixture_' + i, stem = '/native-reader-revisions/' + storyId + '/' + revision;
    entries[storyId] = { revision, path: stem + '.json', sha256: revision, storyPath: stem + '.adv.json',
      storySha256: revision, textPath: stem + '.native.txt', textSha256: revision };
  }
  assert.equal(Object.keys(parseNativeRevisionRegistry(JSON.stringify({ schema: 'native-reader-revisions/v1', entries })).entries).length, 230);
  entries['kana-okaeri/fixture_0'].path = '/other/file.json';
  assert.throws(() => parseNativeRevisionRegistry(JSON.stringify({ schema: 'native-reader-revisions/v1', entries })), /路径/);
});
