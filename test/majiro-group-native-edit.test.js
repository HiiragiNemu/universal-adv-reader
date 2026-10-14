import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { parseLegacyVoiceRouteDocument } from '../apps/classic-reader/lib/legacy-vn-voice-routing.ts';
import { buildParallelNativeAlignment } from '../apps/classic-reader/lib/legacy-vn-correspondence.ts';
import { mergeNativeAlignedRows, seedNativeEditableLines } from '../apps/classic-reader/lib/legacy-vn-alignment.ts';
import { buildNativeEditRows, readNativeEditSource, createNativeTranslationPatch,
  importNativeTranslationPatch, applyNativeTranslationPatch } from '../apps/classic-reader/lib/native-translation-patch.ts';

const sha = value => createHash('sha256').update(value).digest('hex');
const storyId = 'narcissu-3rd/group-edit-fixture';
const nativeKey = (variant, eventId) => JSON.stringify([variant, 'main']) + '/' + eventId;

// This synthetic fixture tests the editor contract after an already evidenced
// N:M group. Source matching and full archive proofs have their own bridge tests.
async function fixture() {
  const header = { speaker: '', text: 'header', isHeader: true, headerSection: '1' };
  const cn = [header, { speaker: '海璃', text: '「第一句。' }, { speaker: '旁白', text: '第二句。」' }];
  const jp = [header, { speaker: '海璃', text: '「一行目。二行目。」' }];
  const ids = ['mjo-10', 'mjo-20'];
  const group = {
    schema: 'majiro-presentation-group/v1', id: 'buffer/cn', displayJoinMode: 'native-append',
    sourceEventIds: ids, visibleEventIdsByLocale: { 'zh-CN': ids, 'ja-JP': [] },
    firstVisibleEventIdByLocale: { 'zh-CN': ids[0], 'ja-JP': null },
    speaker: { 'zh-CN': '海璃', 'ja-JP': '' }, joinBeforeByEventId: { 'mjo-20': '\n' },
    allowFollowingVoiceCues: true,
  };
  const mediaId = 'asset/a-aaaaaaaaaaaaaaaa';
  const cue = digit => ({ cueId: 'cue-' + digit.repeat(16), kind: 'voice', mediaId,
    raw: { sourceKey: 'same-voice-occurring-again' } });
  const native = (eventId, locale, line, nextEventId, digit, position) => ({
    eventId, kind: 'line', text: { [locale]: line.text },
    ...(line.speaker === '旁白' ? {} : { speaker: { [locale]: line.speaker } }),
    nextEventId, cues: [cue(digit)],
    source: {
      engine: 'majiro', nativeUnit: {
        schema: 'majiro-display-unit/v1', codeOffset: parseInt(eventId.slice(4), 16),
        speakerRaw: line.speaker === '旁白' ? null : {
          method: 'native-name-slot', rawHex: '8a43979e', text: '海璃', decodedText: '海璃',
        },
        controls: [{ kind: 'pause', value: 'p' }],
        boundary: { command: 'p' },
      },
      ...(position === undefined ? {} : { presentationGroup: { ...group, position } }),
    },
  });
  const cnEvents = [native(ids[0], 'zh-CN', cn[1], ids[1], '1', 0),
    native(ids[1], 'zh-CN', cn[2], 'end-001', '2', 1), { eventId: 'end-001', kind: 'end' }];
  const jpEvents = [native('mjo-39', 'ja-JP', jp[1], 'end-001', '3'),
    { eventId: 'end-001', kind: 'end' }];
  const story = {
    schema: 'adv-story/v1', canonicalStoryId: storyId, provenance: { sourceCanonicalStoryId: storyId },
    variants: [
      { variantId: 'cn', locales: ['zh-CN'], sections: [{ sectionId: 'main', events: cnEvents }] },
      { variantId: 'jp', locales: ['ja-JP'], sections: [{ sectionId: 'main', events: jpEvents }] },
    ],
  };
  const rawRoute = {
    schema: 'classic-reader-story-routes/v1', canonicalStoryId: storyId,
    chineseVariantId: 'cn', japaneseVariantId: 'jp',
    voiceRouting: { schema: 'classic-reader-voice-routing/v1', defaultState: 'collapsed',
      expandedSlotMode: 'all-lines', unresolvedLineBehavior: 'visible' },
    media: [{ mediaId, role: 'voice', url: '/corpus/fixture/repeated.wav', mimeType: 'audio/wav' }],
    variantRoutes: story.variants.map(variant => {
      const locale = variant.locales[0];
      return { variantId: variant.variantId, readerLocales: [locale],
        textLineCounts: { [locale]: variant.sections[0].events.length - 1 },
        sections: [{ sectionId: 'main', events: variant.sections[0].events.map((event, index) => ({
          ...structuredClone(event), ...(event.kind === 'line' ? { textLineIndex: { [locale]: index } } : {}),
        })) }] };
    }),
  };
  const proof = {
    classification: 'lexical-with-punctuation-variation', completeNativeBuffers: true,
    existingAnchorsRetainOrder: true, uniqueInEachNativeChapterAndN10Binding: true,
    cnNativeBuffer: { eventIds: ids, joinBeforeByEventId: { 'mjo-10': '', 'mjo-20': '\n' } },
    jpNativeBuffer: { eventIds: ['mjo-39'], joinBeforeByEventId: { 'mjo-39': '' } },
  };
  const manifest = { schema: 'native-story-correspondence/v1', storyId,
    cnVariantId: 'cn', jpVariantId: 'jp', hashes: { route: '', cnText: '', jpText: '' },
    pairs: [], groupPairs: [{ cnEventIds: ids, jpEventIds: ['mjo-39'], proof }],
    cueAliases: [], unpaired: { cn: [], jp: [] } };
  const route = parseLegacyVoiceRouteDocument(rawRoute, storyId);
  const rows = buildParallelNativeAlignment(route, cn, jp, manifest);
  const binding = { route: sha(JSON.stringify(rawRoute)), cnText: sha(JSON.stringify(cn)),
    jpText: sha(JSON.stringify(jp)), adapter: sha('synthetic-group-edit-fixture'),
    normalizedStory: sha(JSON.stringify(story)) };
  const document = { schema: 'native-reader-edit-source/v1', storyId, binding, nativeSources: [],
    rows: buildNativeEditRows(story, rows) };
  const source = await readNativeEditSource(JSON.stringify(document), { storyId, binding });
  return { story, cn, jp, rows, source };
}

test('N:M reference retains JP source, native key and repeated cues, but never seeds a duplicate Chinese translation', async () => {
  const f = await fixture();
  assert.equal(f.rows.length, 4);
  assert.deepEqual(f.rows.slice(1).flatMap(row => row.nativeKeys),
    [nativeKey('cn', 'mjo-10'), nativeKey('cn', 'mjo-20'), nativeKey('jp', 'mjo-39')]);
  assert.deepEqual(f.rows.slice(1).map(row => row.cn?.text), [f.cn[1].text, f.cn[2].text, undefined]);
  const reference = f.rows[3];
  assert.equal(reference.nativeGroupReference, true);
  assert.deepEqual(reference.jp, f.jp[1]);
  assert.deepEqual(reference.jpIndices, [1]);
  assert.equal(reference.cnSlot, null);
  const compact = mergeNativeAlignedRows(f.rows);
  assert.equal(compact.length, 2);
  assert.equal(compact[1].cn.text, f.cn[1].text + '\n' + f.cn[2].text);
  assert.equal(compact[1].jp.text, f.jp[1].text);
  assert.deepEqual(compact[1].nativeKeys, f.rows.slice(1).flatMap(row => row.nativeKeys));
  assert.deepEqual(compact[1].cnSlot.cues, f.rows.flatMap(row => row.cnSlot?.cues ?? []));
  assert.deepEqual(compact[1].jpSlot.cues, reference.jpSlot.cues);
  assert.equal(compact[1].cnSlot.cues.length, 2);
  assert.equal(compact[1].jpSlot.cues.length, 1);
  assert.equal(new Set([...compact[1].cnSlot.cues, ...compact[1].jpSlot.cues].map(cue => cue.url)).size, 1);
  for (const mode of ['current', 'jp', 'empty']) {
    const seeded = seedNativeEditableLines(f.rows, mode);
    assert.equal(seeded.length, 4, mode);
    assert.equal(seeded[3].text, '', mode + ': JP reference never becomes Chinese text');
    assert.equal(seeded[3].speaker, '', mode + ': JP reference never becomes a duplicate Chinese name');
    assert.deepEqual(seeded.map(line => line.nativeAlignmentKey), f.rows.flatMap(row => row.nativeKeys));
  }
  assert.deepEqual(f.source.document.rows[3].target, { variantId: 'jp', sectionId: 'main', eventId: 'mjo-39' });
  assert.deepEqual(f.source.document.rows[3].baseline, { text: '', speaker: '' });
  assert.deepEqual(f.source.document.rows[3].allowed, []);
  assert.equal(f.source.document.rows[3].readOnlyReason, 'translation-on-native-group-members');
  assert.deepEqual(f.source.document.rows[1].allowed, ['text', 'speaker']);
  assert.deepEqual(f.source.document.rows[2].allowed, ['text']);
});

test('N:M no-op patch is empty and CN member edits preserve the entire Japanese variant and all native controls', async () => {
  const f = await fixture(), before = structuredClone(f.story);
  const current = seedNativeEditableLines(f.rows, 'current');
  const empty = createNativeTranslationPatch(f.source, current);
  assert.deepEqual(empty.changes, []);
  assert.deepEqual(await applyNativeTranslationPatch(f.source, empty, f.story), before);
  assert.deepEqual(importNativeTranslationPatch(f.source, JSON.parse(JSON.stringify(empty)), f.rows), current);
  const edited = structuredClone(current);
  edited[1].text = '「修正后的第一句。';
  edited[1].speaker = '修正姓名';
  edited[2].text = '修正后的第二句。」';
  const patch = createNativeTranslationPatch(f.source, edited);
  assert.deepEqual(patch.changes.map(change => [change.key, change.field]), [
    [nativeKey('cn', 'mjo-10'), 'text'], [nativeKey('cn', 'mjo-10'), 'speaker'],
    [nativeKey('cn', 'mjo-20'), 'text'],
  ]);
  const result = await applyNativeTranslationPatch(f.source, JSON.parse(JSON.stringify(patch)), f.story);
  const expected = structuredClone(before);
  expected.variants[0].sections[0].events[0].text['zh-CN'] = edited[1].text;
  expected.variants[0].sections[0].events[0].speaker['zh-CN'] = edited[1].speaker;
  expected.variants[0].sections[0].events[1].text['zh-CN'] = edited[2].text;
  assert.deepEqual(result, expected, 'every source control, cue, raw name operand, boundary and JP field survives');
  assert.deepEqual(f.story, before, 'patch application never mutates the original source');
  assert.deepEqual(importNativeTranslationPatch(f.source, patch, f.rows), edited);
});

test('N:M JP reference rejects duplicate Chinese body/name through editor and serialized patch paths', async () => {
  const f = await fixture(), current = seedNativeEditableLines(f.rows, 'current');
  const empty = createNativeTranslationPatch(f.source, current);
  for (const [field, value] of [['text', f.cn[1].text + f.cn[2].text], ['speaker', '重复姓名']]) {
    const edited = structuredClone(current);
    edited[3][field] = value;
    assert.throws(() => createNativeTranslationPatch(f.source, edited), /只读/);
    const forged = { ...empty, changes: [{ key: nativeKey('jp', 'mjo-39'), field, before: '', after: value }] };
    await assert.rejects(applyNativeTranslationPatch(f.source, forged, f.story), /只读/);
    assert.throws(() => importNativeTranslationPatch(f.source, forged, f.rows), /只读/);
  }
  assert.throws(() => createNativeTranslationPatch(f.source, current.slice(0, 3)), /事件总数/);
  const wrongKey = structuredClone(current);
  wrongKey[3].nativeAlignmentKey = nativeKey('cn', 'mjo-10');
  assert.throws(() => createNativeTranslationPatch(f.source, wrongKey), /缺失或重复/);
  assert.equal(Object.hasOwn(f.story.variants[1].sections[0].events[0].text, 'zh-CN'), false);
});
