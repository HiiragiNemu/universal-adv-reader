import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildResearchCatalog, createResearchReaderAdapter } from '../packages/adapters/src/research-reader-v1.js';
import { readEffectiveReaderManifests } from '../tools/lib/content-selection-corrections.mjs';
import { buildNativeEditRows, readNativeEditSource, createNativeTranslationPatch, applyNativeTranslationPatch } from '../apps/classic-reader/lib/native-translation-patch.ts';
import { seedNativeEditableLines } from '../apps/classic-reader/lib/legacy-vn-alignment.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resources = path.resolve(process.env.ADV_CORPUS_REPOSITORY ?? path.join(root, '../narcissu-kana-research'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourcePath = url => path.join(resources, ...decodeURIComponent(url.replace(/^\/corpus\//u, '')).split('/'));
const io = { fetchJson: async url => JSON.parse(await readFile(sourcePath(url), 'utf8')),
  fetchBinary: async url => new Uint8Array(await readFile(sourcePath(url))) };
const catalogPromise = readEffectiveReaderManifests(resources).then(({ readerManifest }) => buildResearchCatalog(readerManifest));
const adapter = createResearchReaderAdapter();

async function fixture(storyId, proofKind) {
  const catalog = await catalogPromise;
  const corpus = catalog.corpora.find(c => c.stories.some(e => e.canonicalStoryId === storyId));
  const entry = corpus.stories.find(e => e.canonicalStoryId === storyId);
  const story = await adapter.load({ corpus, storyEntry: entry, io });
  const variant = story.variants.find(v => v.sourceVariant.sourceLocale === 'zh-CN');
  const section = variant.sections.find(s => s.events.some(e => e.source?.nativeUnit?.speakerRaw?.delimiter === ''
    && (proofKind === 'bytes' ? e.source.nativeUnit.speakerRaw.proof === 'same-story-native-JP-name-bytes-before-dialogue-quote'
      : e.source.nativeUnit.speakerPrefixProof?.method === 'unique-native-voice-and-attested-JP-name-slot')));
  assert.ok(section, storyId + ': native-proved empty-delimiter source exists');
  const event = section.events.find(e => e.source?.nativeUnit?.speakerRaw?.delimiter === ''
    && (proofKind === 'bytes' ? e.source.nativeUnit.speakerRaw.proof === 'same-story-native-JP-name-bytes-before-dialogue-quote'
      : e.source.nativeUnit.speakerPrefixProof?.method === 'unique-native-voice-and-attested-JP-name-slot'));
  const nativeKey = `${JSON.stringify([variant.variantId, section.sectionId])}/${event.eventId}`;
  const rows = [{ nativeKeys: [nativeKey], cn: { text: event.text['zh-CN'], speaker: event.speaker['zh-CN'] },
    jp: null, cnIndices: [0], jpIndices: [], cnSlot: null, jpSlot: null }];
  const originalVariant = entry.sourceStory.variants.find(v => v.id === variant.variantId);
  const nativeSources = await Promise.all(['script', 'plainObject'].map(async kind => {
    const file = originalVariant.references[kind];
    return { path: file, sha256: sha(await readFile(path.join(resources, file))) };
  }));
  const binding = { route: sha(JSON.stringify({ variantId: variant.variantId, sectionId: section.sectionId, eventId: event.eventId })),
    cnText: sha(event.text['zh-CN']), jpText: sha(''), adapter: sha(JSON.stringify(entry.sourceStory)), normalizedStory: sha(JSON.stringify(story)) };
  const document = { schema: 'native-reader-edit-source/v1', storyId, binding, nativeSources, rows: buildNativeEditRows(story, rows) };
  const source = await readNativeEditSource(JSON.stringify(document), { storyId, binding });
  const target = value => value.variants.find(v => v.variantId === variant.variantId)
    .sections.find(s => s.sectionId === section.sectionId).events.find(e => e.eventId === event.eventId);
  return { story, event, rows, source, nativeKey, target, variant, section };
}

for (const [chapter, proofKind] of [['nara00', 'bytes'], ['nard04', 'bytes'], ['nar3_07', 'voice']]) {
  test(`Majiro ${chapter} empty-delimiter inline name supports separate body/name edits while preserving every native binding`, async () => {
    const f = await fixture('narcissu-3rd/' + chapter, proofKind), before = JSON.stringify(f.story);
    const raw = f.event.source.nativeUnit.speakerRaw;
    assert.equal(raw.method, 'native-inline-name-delimiter');
    assert.equal(raw.delimiter, '');
    assert.ok(raw.rawHex && raw.text);
    assert.match(f.event.text['zh-CN'], /^[「『]/u);
    assert.deepEqual(f.source.document.rows[0].allowed, ['text', 'speaker']);
    assert.equal(f.source.document.rows[0].speakerReason, 'embedded-in-text');
    assert.deepEqual(f.source.document.rows[0].target,
      { variantId: f.variant.variantId, sectionId: f.section.sectionId, eventId: f.event.eventId });
    assert.equal(f.source.document.rows[0].key, f.nativeKey);

    const bodyOnly = seedNativeEditableLines(f.rows, 'current');
    bodyOnly[0].text = '「只修改这句正文。」';
    const bodyPatch = createNativeTranslationPatch(f.source, bodyOnly);
    assert.deepEqual(bodyPatch.changes.map(e => e.field), ['text']);
    const bodyResult = await applyNativeTranslationPatch(f.source, JSON.parse(JSON.stringify(bodyPatch)), f.story);
    const expectedBody = structuredClone(f.story);
    f.target(expectedBody).text['zh-CN'] = bodyOnly[0].text;
    assert.deepEqual(bodyResult, expectedBody, 'body-only edit preserves all names, native controls, cues, branches and other language variants');

    const both = seedNativeEditableLines(f.rows, 'current');
    both[0].text = '「单独修正后的正文。」';
    both[0].speaker = '修正姓名';
    const patch = createNativeTranslationPatch(f.source, both);
    assert.deepEqual(patch.changes.map(e => e.field), ['text', 'speaker']);
    const result = await applyNativeTranslationPatch(f.source, JSON.parse(JSON.stringify(patch)), f.story);
    const expected = structuredClone(f.story);
    f.target(expected).text['zh-CN'] = both[0].text;
    f.target(expected).speaker['zh-CN'] = both[0].speaker;
    assert.deepEqual(result, expected, 'only the two requested Chinese display fields change');
    assert.deepEqual(f.target(result).source, f.event.source, 'raw inline operand and native proof are immutable');
    assert.deepEqual(f.target(result).source.nativeUnit.speakerRaw, raw);
    assert.equal(f.target(result).source.nativeUnit.speakerRaw.delimiter, '');
    assert.equal(JSON.stringify(f.story), before, 'source snapshot remains byte-for-byte JSON identical');

    const alteredSource = structuredClone(f.story);
    f.target(alteredSource).source.nativeUnit.speakerRaw.delimiter = '@';
    await assert.rejects(applyNativeTranslationPatch(f.source, patch, alteredSource), /原生结构源已变化/);
    const structuralPatch = structuredClone(patch);
    structuralPatch.changes[0].nextEventId = 'injected-target';
    await assert.rejects(applyNativeTranslationPatch(f.source, structuralPatch, f.story), /只接受显式文本字段/);
  });
}
