import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(process.env.ADV_CORPUS_REPOSITORY ?? fileURLToPath(new URL('../../narcissu-kana-research/', import.meta.url)));
const kanaSourceCache = new Map();
function kanaInstructions(variant) {
  const filename = path.resolve(sourceRoot, variant.references.script);
  assert.ok(filename.startsWith(sourceRoot + path.sep), 'source reference stays in the archive repository');
  if (!kanaSourceCache.has(filename)) {
    const document = JSON.parse(fs.readFileSync(filename, 'utf8'));
    kanaSourceCache.set(filename, { document, byOffset: new Map(document.instructions.map(instruction => [instruction.offset, instruction])) });
  }
  return kanaSourceCache.get(filename);
}

export function requiresParallelNativeCorrespondence(source) {
  // IKURA's explicit paired route is a derived variant with separately retained
  // ISC/ISF source offsets. It is not an invented third archive member.
  if (source.gameId === 'kana-okaeri') return false;
  const preferred = source.variants.find(variant => variant.id === source.preferredVariantId) ?? source.variants[0];
  const select = locale => preferred.readerLocales?.includes(locale) ? preferred : source.variants.find(variant => variant.readerLocales?.includes(locale));
  const cn = select('zh-CN'), jp = select('ja-JP');
  return Boolean(cn && jp && cn.id !== jp.id);
}


/** Independent membership denominator: the effective source-selection snapshot,
 * never a generated progress report or a historical expected story count. */
export function readNativeCorpusExpectation(publicRoot) {
  const read = filename => JSON.parse(fs.readFileSync(path.join(publicRoot, filename), 'utf8'));
  const published = read('story_index.json');
  assert.equal(new Set(published.map(s=>s.id)).size,published.length,'all native and supplementary identities are unique');
  const index = published.filter(s=>s.source_format!=='supplemental-text/v1');
  const snapshot = read('data/legacy-vn/manifests/reader-adapter.json');
  const included = snapshot.stories.filter(story => story.resource?.reader?.decision === 'include');
  const identity = story => story.readerIdentity ?? story.canonicalStoryId;
  const expected = included.map(identity).sort();
  assert.equal(new Set(expected).size, expected.length, 'effective source identities are unique');
  assert.equal(new Set(index.map(story => story.id)).size, index.length, 'reader IDs are unique');
  assert.deepEqual(index.map(story => story.source_identity).sort(), expected, 'index covers each effective source once');
  return { index, snapshot, sources: new Map(included.map(story => [identity(story), story])) };
}

/** Selected route variants must be real locale-bearing variants of that exact
 * archived source; an editorial Chinese navigation title is not a CN variant. */
export function assertSelectedSourceVariants(story, route, sources) {
  const source = sources.get(story.source_identity);
  assert.ok(source, 'story belongs to the effective selection: ' + story.source_identity);
  assert.equal(route.canonicalStoryId, story.source_identity);
  assert.equal(route.sourceCanonicalStoryId ?? source.canonicalStoryId, source.canonicalStoryId);
  if (source.gameId === 'kana-okaeri') {
    const paired = 'paired/' + source.canonicalStoryId + '/zh-ja';
    assert.equal(route.japaneseVariantId, paired);
    assert.equal(route.chineseVariantId, paired);
    assert.deepEqual(route.variantRoutes.map(variant => variant.variantId), [paired]);
    assert.ok(story.has_cn && story.has_jp && story.path_cn && story.path_jp);
    for (const [locale, offsetKey] of [['zh-CN', 'zhOffset'], ['ja-JP', 'jaOffset']]) {
      const variant = source.variants.find(variant => variant.sourceLocale === locale && variant.readerLocales?.includes(locale));
      assert.ok(variant, 'paired IKURA route retains a real ' + locale + ' source');
      const native = kanaInstructions(variant);
      for (const event of route.variantRoutes[0].sections.flatMap(section => section.events)) {
        const offset = event.source?.[offsetKey];
        if (offset === undefined || offset === null) continue;
        const instruction = native.byOffset.get(offset);
        assert.ok(instruction, 'paired native event maps to an original instruction offset');
        if (event.source.opcode !== undefined) assert.equal(instruction.opcode, event.source.opcode);
        if (locale === 'ja-JP' && event.source.instructionIndex !== undefined) {
          assert.equal(native.document.instructions[event.source.instructionIndex]?.offset, offset, 'JP instruction ordinal and raw offset agree');
        }
      }
    }
    return;
  }
  const variants = new Map(source.variants.map(variant => [variant.id, variant]));
  const preferred = variants.get(source.preferredVariantId) ?? source.variants[0];
  const expectedSelected = new Set([route.japaneseVariantId, route.chineseVariantId].filter(Boolean));
  assert.deepEqual(new Set(route.variantRoutes.map(variant => variant.variantId)), expectedSelected);
  for (const [side, locale, property] of [['cn', 'zh-CN', 'chineseVariantId'], ['jp', 'ja-JP', 'japaneseVariantId']]) {
    const id = route[property];
    const selected = preferred?.readerLocales?.includes(locale) ? preferred : source.variants.find(variant => variant.readerLocales?.includes(locale));
    const available = Boolean(selected);
    assert.equal(id ?? null, selected?.id ?? null, story.source_identity + '/' + locale + ' preferred native variant');
    assert.equal(Boolean(id), available, story.source_identity + '/' + locale + ' availability');
    assert.equal(Boolean(story['path_' + side]), available, 'TXT availability follows real source locale');
    assert.equal(story['has_' + side], available || (side==='cn' && Boolean(story.reader_revision_cn))); 
    if (!id) continue;
    const variant = variants.get(id);
    assert.ok(variant, 'selected variant exists in effective source');
    assert.ok(variant.readerLocales.includes(locale), 'selected variant really contains ' + locale);
    const routed = route.variantRoutes.find(item => item.variantId === id);
    assert.ok(routed.readerLocales.includes(locale));
  }
}

/** Reconstruct the physical TXT row identities directly from source-route
 * line indexes, choice labels/targets and section boundaries. No reader
 * alignment function participates in this expected projection. */
export function expectedNativeProjection(route, side, hasText) {
  const locale = side === 'cn' ? 'zh-CN' : 'ja-JP';
  const variantId = route[side === 'cn' ? 'chineseVariantId' : 'japaneseVariantId'];
  if (!variantId || !hasText) return [];
  const variant = route.variantRoutes.find(item => item.variantId === variantId);
  assert.ok(variant);
  const result = [];
  for (const [sectionIndex, section] of variant.sections.entries()) {
    const prefix = JSON.stringify([variantId, section.sectionId]);
    result.push({ key: prefix + '/header', kind: 'header', section: String(sectionIndex + 1) });
    for (const event of section.events) {
      if (event.kind === 'line' && event.textLineIndex?.[locale] !== undefined) {
        result.push({ key: prefix + '/' + event.eventId, kind: 'line', eventId: event.eventId, bodyIndex: event.textLineIndex[locale] });
      } else if (event.kind === 'choice') {
        for (const choice of event.choices ?? []) {
          const label = choice.label?.[locale]?.replace(/\r\n?/g, '\n').trim();
          if (label) result.push({ key: prefix + '/' + event.eventId + '/choice/' + choice.choiceId,
            kind: 'choice', eventId: event.eventId, choiceId: choice.choiceId, label,
            target: (choice.nextEventId || choice.choiceId).replace(/^group_?/i, '') });
        }
      }
    }
  }
  return result;
}

export function assertRawNativeRows(route, rows, cn, jp) {
  const expected = {
    cn: expectedNativeProjection(route, 'cn', cn.length > 0),
    jp: expectedNativeProjection(route, 'jp', jp.length > 0),
  };
  const sources = { cn, jp };
  const crossVersion = Boolean(route.chineseVariantId && route.chineseVariantId !== route.japaneseVariantId);
  for (const side of ['cn', 'jp']) {
    const lines = sources[side], projection = expected[side];
    assert.equal(projection.length, lines.length, side + ' native source/TXT rows');
    assert.deepEqual(rows.flatMap(row => row[side + 'Indices']), lines.map((_, i) => i), side + ' complete ordered row union');
    const bodyIndexes = projection.filter(unit => unit.kind === 'line').map(unit => unit.bodyIndex);
    assert.deepEqual(bodyIndexes, bodyIndexes.map((_, i) => i), side + ' contiguous native text indexes');
    for (const [index, unit] of projection.entries()) {
      const line = lines[index];
      assert.equal(Boolean(line.isHeader), unit.kind === 'header');
      assert.equal(Boolean(line.isChoice), unit.kind === 'choice');
      if (unit.kind === 'header') assert.equal(line.headerSection, unit.section);
      if (unit.kind === 'choice') {
        assert.equal(line.choiceTargetId, unit.target, side + '/' + unit.choiceId + ' native branch target');
        assert.equal(line.choiceLabel.trim(), unit.label, side + '/' + unit.choiceId + ' native label');
      }
    }
  }
  const keys = [];
  for (const row of rows) {
    const perSide = {};
    for (const side of ['cn', 'jp']) {
      const indices = row[side + 'Indices'];
      assert.ok(indices.length <= 1, 'editor input is one original physical event row per side');
      if (indices.length) {
        assert.equal(row[side], sources[side][indices[0]], 'exact original text/speaker/format object retained');
        perSide[side] = expected[side][indices[0]].key;
      } else assert.equal(row[side], undefined);
    }
    const key = crossVersion && perSide.cn && perSide.jp
      ? JSON.stringify([perSide.cn, perSide.jp]) : perSide.cn ?? perSide.jp;
    assert.ok(key);
    assert.deepEqual(row.nativeKeys, [key], 'stable native editor key reconstructed independently');
    keys.push(key);
  }
  assert.equal(new Set(keys).size, keys.length, 'native raw keys are unique');
  return expected;
}

export function assertDisplayConservesRows(raw, displayed, cn, jp) {
  assert.deepEqual(displayed.flatMap(row => row.nativeKeys), raw.flatMap(row => row.nativeKeys), 'display merge conserves every raw edit key in order');
  for (const [side, lines] of [['cn', cn], ['jp', jp]]) {
    assert.deepEqual(displayed.flatMap(row => row[side + 'Indices']), lines.map((_, i) => i), side + ' display coverage');
    assert.deepEqual(displayed.flatMap(row => row[side + 'Slot']?.eventIds ?? []), raw.flatMap(row => row[side + 'Slot']?.eventIds ?? []), side + ' source event IDs remain individually addressable');
    assert.deepEqual(displayed.flatMap(row => row[side + 'Slot']?.cues ?? []), raw.flatMap(row => row[side + 'Slot']?.cues ?? []), side + ' cue order and multiplicity');
    for (const row of displayed) {
      const indices = row[side + 'Indices'];
      if (!indices.length) { assert.equal(row[side], undefined); continue; }
      const first = lines[indices[0]];
      assert.equal(row[side].speaker, first.speaker);
      if (row.reviewedParagraphs) {
        assert.equal(row.pairing, 'reviewed');
        assert.equal(row.reviewedPassage.schema, 'source-bound-bilingual-review/v1');
        assert.equal(row.reviewedPassage.humanVerified, false);
        assert.equal(row.reviewedPassage.translationQualityVerified, false);
        assert.equal(row.presentationGroup, undefined, 'semantic review is not a native append claim');
        const originals = new Map(raw.flatMap(item => item[side + 'Indices'].map(index => [index, item])));
        const expectedParagraphs = [];
        for (let position = 0; position < indices.length;) {
          const index = indices[position], original = originals.get(index), group = original.presentationGroup;
          const locale = side === 'cn' ? 'zh-CN' : 'ja-JP';
          const nativeIds = group?.visibleEventIdsByLocale[locale] ?? [];
          const members = indices.slice(position, position + nativeIds.length);
          const complete = group?.displayJoinMode === 'native-append' && nativeIds.length > 1
            && JSON.stringify(members.flatMap(i => originals.get(i)[side + 'Slot']?.eventIds ?? [])) === JSON.stringify(nativeIds);
          if (complete) {
            const text = members.map((i, at) => (at ? group.joinBeforeByEventId?.[originals.get(i)[side + 'Slot'].eventIds[0]] ?? '' : '') + lines[i].text).join('');
            expectedParagraphs.push({ ...lines[index], text }); position += members.length;
          } else { expectedParagraphs.push(lines[index]); position++; }
        }
        assert.deepEqual(row.reviewedParagraphs[side], expectedParagraphs, 'independent native paragraphs and source-only append controls survive N:M review');
        assert.equal(row[side].text, expectedParagraphs.map(line => line.text).join('\n\n'), 'synthetic separator is display/search only and not a native paragraph');
        continue;
      }
      if (indices.length === 1) { assert.deepEqual(row[side], first); continue; }
      assert.equal(row.presentationGroup?.displayJoinMode, 'native-append', 'only source-evidenced native buffers merge');
      const byIndex = new Map(raw.flatMap(item => item[side + 'Indices'].map(index => [index, item])));
      const text = indices.map((index, part) => {
        const source = byIndex.get(index);
        const eventId = source[side + 'Slot']?.eventIds[0] ?? source.nativeEventId ?? '';
        return (part ? row.presentationGroup.joinBeforeByEventId?.[eventId] ?? '' : '') + lines[index].text;
      }).join('');
      assert.equal(row[side].text, text, 'source native join separators are conserved');
      assert.ok(indices.every(index => !lines[index].isHeader && !lines[index].isChoice), 'choices and headings never merge into body');
    }
  }
}
