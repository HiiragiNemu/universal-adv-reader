import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { buildResearchCatalog, createResearchReaderAdapter } from '../packages/adapters/src/research-reader-v1.js';
import { parseMajiroInstructions } from '../packages/adapters/src/majiro-native-content.js';
import { readEffectiveReaderManifests } from '../tools/lib/content-selection-corrections.mjs';
import { classicModules } from '../test-support/classic-module-loader.js';
import { repositoryRoot } from '../test-support/helpers.js';

const resourceRoot = path.resolve(process.env.ADV_CORPUS_REPOSITORY ?? path.join(repositoryRoot, '..', 'narcissu-kana-research'));
const sourcePath = url => path.join(resourceRoot, ...decodeURIComponent(url.replace(/^\/corpus\//u, '')).split('/'));
const io = {
  fetchJson: async url => JSON.parse(await readFile(sourcePath(url), 'utf8')),
  fetchBinary: async url => new Uint8Array(await readFile(sourcePath(url))),
};
const catalogPromise = readEffectiveReaderManifests(resourceRoot).then(result => buildResearchCatalog(result.readerManifest));
const adapter = createResearchReaderAdapter();
const cache = new Map();
async function load(identity) {
  if (!cache.has(identity)) cache.set(identity, (async () => {
    const catalog = await catalogPromise;
    const corpus = catalog.corpora.find(c => c.stories.some(s => s.canonicalStoryId === identity));
    const entry = corpus.stories.find(s => s.canonicalStoryId === identity);
    return { entry, story: await adapter.load({ corpus, storyEntry: entry, io }) };
  })());
  return cache.get(identity);
}
const events = variant => variant.sections.flatMap(section => section.events);
const locale = (story, code) => story.variants.find(v => v.locales.includes(code));

test('Nara02 ruby bases join native fragments and retain reading/base byte bindings', async () => {
  const { story } = await load('narcissu-3rd/nara02');
  const jp = events(locale(story, 'ja-JP'));
  const repaired = jp.find(event => event.text?.['ja-JP'].includes('蒔絵です。蒔絵素子。'));
  assert.ok(repaired);
  assert.equal(repaired.text['ja-JP'].trim(), '「蒔絵です。蒔絵素子。\n　いい加減名前覚えてください」');
  assert.deepEqual(repaired.source.nativeUnit.ruby.map(part => [part.text, part.reading]), [['蒔絵', 'まきえ'], ['蒔絵', 'まきえ'], ['素子', 'もとこ']]);
  assert.ok(repaired.source.nativeUnit.ruby.every(part => part.baseRawHex && part.readingRawHex && part.callHex === '100801fd9831000000000200'));
  assert.equal(jp.some(event => event.text?.['ja-JP'].trim() === 'です。'), false);
});

test('mixed-encoding @ names and untranslated name slots become proven Chinese labels with raw bytes preserved', async () => {
  const nara = (await load('narcissu-3rd/nara03')).story;
  const cn = events(locale(nara, 'zh-CN'));
  const inline = cn.find(event => event.source?.nativeUnit?.speakerRaw?.method === 'native-inline-name-delimiter');
  assert.equal(inline.speaker['zh-CN'], '海璃');
  assert.equal(inline.source.nativeUnit.speakerRaw.rawHex, '8a43979e');
  assert.equal(inline.source.nativeUnit.speakerRaw.text, '奀棡');
  assert.equal(inline.source.nativeUnit.speakerRaw.decodedText, '海璃');
  assert.equal(inline.text['zh-CN'].includes('@'), false);
  const gbNames = cn.filter(event => event.source?.nativeUnit?.speakerRaw?.decodedText === '其他');
  assert.equal(gbNames.length, 7);
  assert.ok(gbNames.every(event => event.speaker['zh-CN'] === '其他' && event.source.nativeUnit.speakerRaw.rawHex === 'c6e4cbfb'));
  assert.equal(cn.some(event => event.text?.['zh-CN']?.includes('@')), false);
  const nard = (await load('narcissu-3rd/nard14')).story;
  const name = events(locale(nard, 'zh-CN')).find(event => event.source?.nativeUnit?.speakerRaw?.decodedText === 'チサト');
  assert.ok(name);
  assert.equal(name.speaker['zh-CN'], '千里');
  assert.ok(name.source.nativeUnit.speakerRaw.rawHex);
});

test('short narration survives as body in N3 and N10, and each N10 patch target binds exactly once', async () => {
  for (const identity of ['narcissu-3rd/nar1_03', 'narcissu-one-two/nar1_03']) {
    const { entry, story } = await load(identity);
    const preferred = story.variants.find(v => v.variantId === entry.preferredVariantId);
    const japanese = locale(story, 'ja-JP');
    const body = events(japanese).find(event => event.text?.['ja-JP'].includes('いつしかリアルを薄め、虚ろになってしまう。'));
    assert.ok(body, identity);
    assert.equal(body.source.nativeUnit.speakerRaw, null, identity);
    if (identity.startsWith('narcissu-one-two')) {
      const source = entry.sourceStory.variants.find(v => v.id === entry.preferredVariantId);
      const script = JSON.parse(await readFile(path.join(resourceRoot, source.references.script), 'utf8'));
      const expected = script.translation.entries.filter(item => item.target.kind === 'message').map(item => item.target.codeOffset).sort((a,b) => a-b);
      const actual = events(preferred).flatMap(event => event.source?.nativeUnit?.translationBindings ?? []).filter(item => item.field !== 'ruby').map(item => item.targetCodeOffset).sort((a,b) => a-b);
      assert.deepEqual(actual, expected);
      assert.ok(events(preferred).every(event => event.kind !== 'line' || typeof event.text['zh-CN'] === 'string'));
    }
  }
});

test('unmarked pasted speaker prefixes require unique native voice and Japanese name-slot evidence', async () => {
  const { story } = await load('narcissu-3rd/nar3_07');
  const cn = events(locale(story, 'zh-CN'));
  const repaired = cn.filter(event => event.source?.nativeUnit?.speakerPrefixProof);
  assert.equal(repaired.length, 29);
  assert.ok(repaired.every(event => event.speaker['zh-CN'] === '伊丽丝'));
  for (const event of repaired) {
    const unit = event.source.nativeUnit, proof = unit.speakerPrefixProof;
    assert.equal(proof.method, 'unique-native-voice-and-attested-JP-name-slot');
    assert.equal(proof.cn.sourceKey, proof.jp.sourceKey);
    assert.equal(proof.cn.callHex, proof.jp.callHex);
    assert.equal(proof.jp.nameText, 'イリス');
    assert.equal(unit.speakerRaw.delimiter, '');
    assert.ok(unit.textParts[0].rawText.startsWith('伊丽丝「'));
    assert.ok(event.text['zh-CN'].startsWith('「'));
  }
  assert.equal(cn.some(event => event.text?.['zh-CN']?.startsWith('伊丽丝「')), false);
});

test('native text operands are preserved exactly once across body, speaker and ruby units', async () => {
  for (const identity of ['narcissu-3rd/nara02', 'narcissu-3rd/nara03', 'narcissu-one-two/nar1_03']) {
    const { entry, story } = await load(identity);
    for (const variant of story.variants) {
      const source = entry.sourceStory.variants.find(v => v.id === variant.variantId);
      const instructions = parseMajiroInstructions(await readFile(path.join(resourceRoot, source.references.plainObject)));
      const expected = instructions.filter(i => i.opcode === 0x840).map(i => i.codeOffset);
      const native = new Set(expected);
      const actual = events(variant).flatMap(event => event.source?.nativeUnit?.codeOffsets ?? []).filter(offset => native.has(offset));
      assert.deepEqual(actual, expected, source.id);
      assert.equal(new Set(actual).size, actual.length, source.id);
    }
  }
});

test('native menu labels follow case return values and preserve the real branch destination', async () => {
  const { story } = await load('narcissu-3rd/nara03');
  for (const code of ['zh-CN', 'ja-JP']) {
    const all = events(locale(story, code));
    const choice = all.find(event => event.kind === 'choice');
    assert.equal(choice.choices.length, 3);
    assert.deepEqual(choice.choices.map(option => option.source.nativeCaseValue), [1,2,3]);
    assert.deepEqual(choice.choices.map(option => option.label[code].trim()), ['康子',code === 'zh-CN' ? '莳子' : '蒔子','智子']);
    assert.ok(choice.choices.every(option => all.some(event => event.eventId === option.nextEventId)));
    assert.ok(choice.source.nativeSelection.options.every((option, index, options) => index === 0 || option.codeOffset < options[index-1].codeOffset));
  }
});

test('product keeps the translated extra branches and native exit without inventing Japanese counterparts', async () => {
  const { story } = await load('narcissu-3rd/product');
  const cn = events(locale(story, 'zh-CN')), jp = events(locale(story, 'ja-JP'));
  const c = cn.find(event => event.kind === 'choice'), j = jp.find(event => event.kind === 'choice');
  assert.equal(c.choices.length, 5); assert.equal(j.choices.length, 3);
  assert.match(c.choices[0].label['zh-CN'], /汉化后记/);
  assert.match(c.choices[3].label['zh-CN'], /１９９３/);
  assert.equal(c.choices[4].nextEventId, 'end-001');
  assert.equal(j.choices[2].nextEventId, 'end-001');
  assert.equal(c.source.nativeSelection.caseEdges.at(-1).dispatchKind, 'default');
  assert.ok(cn.filter(event => event.kind === 'line').length > jp.filter(event => event.kind === 'line').length);
});

test('a Unicode archive identity gets one explicit safe reader alias and keeps source provenance', async () => {
  const { entry, story } = await load('narcissu-himeko/omake_062');
  assert.equal(entry.sourceCanonicalStoryId, 'narcissu-himeko/%E3%81%8A%E3%81%BE%E3%81%91');
  assert.equal(story.canonicalStoryId, 'narcissu-himeko/omake_062');
  assert.equal(story.provenance.sourceCanonicalStoryId, entry.sourceCanonicalStoryId);
  assert.equal(story.variants.some(variant => variant.locales.includes('zh-CN')), false);
  const jp = events(locale(story, 'ja-JP'));
  assert.ok(jp.some(event => event.text?.['ja-JP'].includes('淡路ＳＡ')));
});

const modules = classicModules();
const routing = modules.load('lib/legacy-vn-voice-routing.ts');
const alignment = modules.load('lib/legacy-vn-alignment.ts');
const correspondence = modules.load('lib/legacy-vn-correspondence.ts');
function parallelFixture() {
  const header = { speaker:'', text:'header', isHeader:true, headerSection:'1' };
  const variant = (id, code, ids) => {
    const group = { schema:'majiro-presentation-group/v1', id:'buffer/'+id, displayJoinMode:'native-append',
      sourceEventIds:ids, visibleEventIdsByLocale:{'zh-CN':code === 'zh-CN' ? ids : [],'ja-JP':code === 'ja-JP' ? ids : []},
      firstVisibleEventIdByLocale:{'zh-CN':code === 'zh-CN' ? ids[0] : null,'ja-JP':code === 'ja-JP' ? ids[0] : null},
      speaker:{'zh-CN':'','ja-JP':''}, joinBeforeByEventId:{[ids[1]]:'\n'}, allowFollowingVoiceCues:true };
    return {variantId:id,readerLocales:[code],textLineCounts:{[code]:2},
      sections:[{sectionId:'main',events:ids.map((eventId,index)=>({eventId,kind:'line',textLineIndex:{[code]:index},source:{presentationGroup:{...group,position:index}}}))}]};
  };
  const raw = {schema:'classic-reader-story-routes/v1',canonicalStoryId:'narcissu-3rd/fixture',
    chineseVariantId:'cn',japaneseVariantId:'jp',voiceRouting:{schema:'classic-reader-voice-routing/v1',defaultState:'collapsed',expandedSlotMode:'all-lines',unresolvedLineBehavior:'visible'},
    media:[],variantRoutes:[variant('cn','zh-CN',['mjo-10','mjo-20']),variant('jp','ja-JP',['mjo-39','mjo-88'])]};
  return {raw,route:routing.parseLegacyVoiceRouteDocument(raw,raw.canonicalStoryId),
    cn:[header,{speaker:'旁白',text:'第一句。'},{speaker:'旁白',text:'第二句。'}],
    jp:[header,{speaker:'旁白',text:'一行目。'},{speaker:'旁白',text:'二行目。'}],
    manifest:{schema:'native-story-correspondence/v1',storyId:raw.canonicalStoryId,cnVariantId:'cn',jpVariantId:'jp',
      hashes:{route:'',cnText:'',jpText:''},pairs:[{cnEventId:'mjo-10',jpEventId:'mjo-39'},{cnEventId:'mjo-20',jpEventId:'mjo-88'}],cueAliases:[],unpaired:{cn:[],jp:[]}}};
}
test('parallel Majiro append uses proved cross-variant event IDs and keeps editable rows separate', () => {
  const f = parallelFixture();
  const raw = correspondence.buildParallelNativeAlignment(f.route,f.cn,f.jp,f.manifest);
  assert.equal(raw.length,3);
  const compact = alignment.mergeNativeAlignedRows(raw);
  assert.equal(compact.length,2);
  assert.equal(compact[1].cn.text,'第一句。\n第二句。');
  assert.equal(compact[1].jp.text,'一行目。\n二行目。');
  assert.deepEqual(compact[1].cnSlot.eventIds,['mjo-10','mjo-20']);
  assert.deepEqual(compact[1].jpSlot.eventIds,['mjo-39','mjo-88']);
  assert.equal(alignment.seedNativeEditableLines(raw,'current').length,3);
  const wrong = {...f.manifest,pairs:[...f.manifest.pairs].reverse()};
  assert.throws(()=>correspondence.buildParallelNativeAlignment(f.route,f.cn,f.jp,wrong),/交叉/);
});

test('CP932 names and quotes inside GB bodies preserve exact inline bytes and real separate role slots', async () => {
  for(const [identity,expected] of [['nara00',13],['nard04',93]]) {
    const cn=events(locale((await load('narcissu-3rd/'+identity)).story,'zh-CN'));
    const fixed=cn.filter(event=>event.source?.nativeUnit?.speakerRaw?.proof==='same-story-native-JP-name-bytes-before-dialogue-quote');
    assert.equal(fixed.length,expected);
    for(const event of fixed) {
      const unit=event.source.nativeUnit,raw=unit.speakerRaw,part=unit.textParts[0];
      assert.equal(raw.delimiter,'');
      assert.equal(part.rawHex.slice(raw.rawHex.length,raw.rawHex.length+4),'8175');
      assert.equal(part.rawText,raw.text+part.text);
      assert.equal(event.text['zh-CN'].startsWith('「'),true);
      assert.ok(['英治','和昭','千里'].includes(event.speaker['zh-CN']));
    }
  }
  const doctors=events(locale((await load('narcissu-3rd/nard05')).story,'zh-CN'))
    .filter(event=>event.source?.nativeUnit?.speakerRaw?.rawHex==='88e38e74');
  assert.equal(doctors.length,8);
  assert.ok(doctors.every(event=>event.source.nativeUnit.speakerRaw.method==='native-name-slot'
    && event.source.nativeUnit.speakerRaw.text==='堛巘'
    && event.source.nativeUnit.speakerRaw.decodedText==='医師' && event.speaker['zh-CN']==='医生'));
});

test('N:M correspondence groups preserve every raw edit key and locale order without inventing individual pairs', () => {
  const f=parallelFixture(),jv=f.raw.variantRoutes[1];
  jv.sections[0].events=jv.sections[0].events.slice(0,1);
  delete jv.sections[0].events[0].source.presentationGroup;
  jv.textLineCounts['ja-JP']=1;
  const route=routing.parseLegacyVoiceRouteDocument(f.raw,f.raw.canonicalStoryId);
  const jp=f.jp.slice(0,2),group={
    cnEventIds:['mjo-10','mjo-20'],jpEventIds:['mjo-39'],
    proof:{classification:'lexical-with-punctuation-variation',completeNativeBuffers:true,
      existingAnchorsRetainOrder:true,uniqueInEachNativeChapterAndN10Binding:true,
      cnNativeBuffer:{eventIds:['mjo-10','mjo-20'],joinBeforeByEventId:{'mjo-10':'','mjo-20':'\n'}},
      jpNativeBuffer:{eventIds:['mjo-39'],joinBeforeByEventId:{'mjo-39':''}}},
  };
  const manifest={...f.manifest,pairs:[],groupPairs:[group],unpaired:{cn:[],jp:[]}};
  const raw=correspondence.buildParallelNativeAlignment(route,f.cn,jp,manifest);
  assert.equal(raw.length,4);
  assert.equal(raw.filter(row=>row.cn && row.jp).length,1);
  const merged=alignment.mergeNativeAlignedRows(raw);
  assert.equal(merged.length,2);
  assert.equal(merged[1].cn.text,'第一句。\n第二句。');
  assert.equal(merged[1].jp.text,'一行目。');
  assert.deepEqual(merged[1].nativeKeys,raw.slice(1).flatMap(row=>row.nativeKeys));
  assert.deepEqual(merged[1].cnIndices,[1,2]);assert.deepEqual(merged[1].jpIndices,[1]);
  assert.deepEqual(merged[1].cnSlot.eventIds,['mjo-10','mjo-20']);
  assert.deepEqual(merged[1].jpSlot.eventIds,['mjo-39']);
  assert.equal(alignment.seedNativeEditableLines(raw,'current').length,4);
  assert.throws(()=>correspondence.buildParallelNativeAlignment(route,f.cn,jp,{
    ...manifest,groupPairs:[{...group,cnEventIds:['mjo-20']}],
  }),/句段/);
  const changed=structuredClone(manifest);
  changed.groupPairs[0].proof.cnNativeBuffer.joinBeforeByEventId['mjo-20']=' ';
  assert.throws(()=>correspondence.buildParallelNativeAlignment(route,f.cn,jp,changed),/分隔符/);
});

test('Japanese-only sources use native event rows and zero Chinese voice slots without a correspondence file', () => {
  const f=parallelFixture(),raw={...f.raw,chineseVariantId:null,variantRoutes:[f.raw.variantRoutes[1]]};
  const route=routing.parseLegacyVoiceRouteDocument(raw,raw.canonicalStoryId);
  const rows=alignment.buildSharedNativeAlignment(route,[],f.jp);
  assert.equal(rows.length,3); assert.ok(rows.every(row=>row.cn === undefined && row.cnSlot === null));
  assert.equal(alignment.mergeNativeAlignedRows(rows).length,2);
  assert.deepEqual(routing.buildLegacyVoiceSlots(route,'zh-CN',[]).eventSlots,[]);
  assert.throws(()=>alignment.buildSharedNativeAlignment(route,f.cn,f.jp),/无中文版本/);
});
