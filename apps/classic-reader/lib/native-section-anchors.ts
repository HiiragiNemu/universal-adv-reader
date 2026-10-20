import type { StoryIndexEntry, NativeChapterRelation } from './story-index.ts';
import type { NativeAlignedRow } from './legacy-vn-alignment.ts';

export type NativeSectionDescriptor = {
  id: string;
  anchorId: string;
  title_cn: string;
  title_jp: string;
  ordinal: number;
  target_event_id_cn?: string;
  target_event_id_jp?: string;
  native_title_event?: boolean;
  available_locales?: Array<'zh-CN' | 'ja-JP'>;
};

export function indexNativeEventRows(rows: Array<Partial<NativeAlignedRow>>) {
  const cn = new Map<string, number>(), jp = new Map<string, number>();
  rows.forEach((row, index) => {
    for (const id of row.cnSlot?.eventIds ?? []) if (!cn.has(id)) cn.set(id, index);
    for (const id of row.jpSlot?.eventIds ?? []) if (!jp.has(id)) jp.set(id, index);
  });
  return { cn, jp };
}

/** Event identities, including their language, bind directory entries to pages.
 * The same byte offset in a different compiled version is never a shared key.
 */
export function indexNativeSectionAnchors(
  story: Pick<StoryIndexEntry, 'native_sections'> | undefined,
  rows: Array<Partial<NativeAlignedRow>>,
  sourceLocale?: 'zh-CN' | 'ja-JP',
): { byAnchor: Map<string, number>; byRow: Map<number, NativeSectionDescriptor[]> } {
  const byAnchor = new Map<string, number>();
  const byRow = new Map<number, NativeSectionDescriptor[]>();
  const { cn, jp } = indexNativeEventRows(rows);
  for (const section of story?.native_sections ?? []) {
    if (sourceLocale && section.available_locales && !section.available_locales.includes(sourceLocale)) continue;
    if (!/^native-[A-Za-z0-9_.:-]+$/.test(section.anchorId) || byAnchor.has(section.anchorId)) {
      throw Error('原作章节锚点无效或重复');
    }
    const cnIndex = section.target_event_id_cn ? cn.get(section.target_event_id_cn) : undefined;
    const jpIndex = section.target_event_id_jp ? jp.get(section.target_event_id_jp) : undefined;
    const index = sourceLocale === 'ja-JP' ? jpIndex ?? cnIndex : cnIndex ?? jpIndex;
    if (index === undefined) continue;
    byAnchor.set(section.anchorId, index);
    byRow.set(index, [...(byRow.get(index) ?? []), section]);
  }
  return { byAnchor, byRow };
}

export function isNativeSectionTitleRow(
  row: Partial<NativeAlignedRow>,
  section: NativeSectionDescriptor,
): boolean {
  if (!section.native_title_event || row.cn?.isChoice || row.jp?.isChoice) return false;
  const normalize = (text?: string) => {
    const value = (text ?? '').normalize('NFKC').replace(/^[#■◆◇□\s]+/u, '').trim();
    return section.id.startsWith('native-product-') ? value.replace(/\(.+\)$/u, '') : value;
  };
  return (!row.cn || normalize(row.cn.text) === normalize(section.title_cn))
    && (!row.jp || normalize(row.jp.text) === normalize(section.title_jp));
}


export function sourceEventAnchor(locale: 'zh-CN' | 'ja-JP', eventId: string): string {
  if (!/^[A-Za-z0-9_.:-]+$/.test(eventId)) throw Error('原作事件锚点无效');
  return `source-${locale === 'zh-CN' ? 'cn' : 'jp'}-${eventId}`;
}

export function resolveNativeSourceAnchor(
  anchor: string,
  rows: ReturnType<typeof indexNativeEventRows>,
): { rowIndex: number; mode: 'cn' | 'jp' } | undefined {
  const match = /^source-(cn|jp)-([A-Za-z0-9_.:-]+)$/.exec(anchor);
  if (!match) return undefined;
  const mode = match[1] as 'cn' | 'jp';
  const rowIndex = rows[mode].get(match[2]);
  return rowIndex === undefined ? undefined : { rowIndex, mode };
}

export function nativeChapterRelationHref(relation: NativeChapterRelation, currentStoryId?: string): string {
  const anchor = `#${sourceEventAnchor(relation.target_locale, relation.target_event_id)}`;
  // Same-document navigation retains edit/query state and unsaved local changes.
  return relation.target_story_id === currentStoryId ? anchor : `/reader/${relation.target_story_id}${anchor}`;
}

export type NativeCounterpartContext = {
  byKey: Map<string, NativeChapterRelation>;
  readonlyTranslationKeys: Set<string>;
  requiredTranslationKeys: Set<string>;
};

/** Resolve location hints against the unfiltered, unedited native source rows.
 * This does not pair or copy text. A real local translation remains stronger
 * than a location hint, and a derived CN slot cannot establish original CN.
 */
export function resolveSameStoryNativeCounterparts(
  story: Pick<StoryIndexEntry, 'id' | 'cross_chapter_relations'> | undefined,
  rows: NativeAlignedRow[],
): NativeCounterpartContext {
  const result: NativeCounterpartContext = {
    byKey: new Map(), readonlyTranslationKeys: new Set(), requiredTranslationKeys: new Set(),
  };
  if (!story?.id || !story.cross_chapter_relations?.length) return result;
  type Language = 'cn' | 'jp';
  const nonempty = (row: NativeAlignedRow, language: Language) =>
    Boolean((row[language]?.choiceLabel ?? row[language]?.text ?? '').trim());
  const keyCounts = new Map<string, number>();
  for (const row of rows) for (const key of row.nativeKeys) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  const validKeys = (row: NativeAlignedRow) => row.nativeKeys.length > 0
    && row.nativeKeys.every(key => typeof key === 'string' && key.length > 0 && keyCounts.get(key) === 1);
  const nativeIds = (row: NativeAlignedRow, language: Language): string[] => {
    const indices = language === 'cn' ? row.cnIndices : row.jpIndices;
    const ids = (language === 'cn' ? row.cnSlot : row.jpSlot)?.eventIds ?? [];
    if (!validKeys(row) || !nonempty(row, language) || row[language]?.isHeader || row[language]?.isChoice
      || !indices.length || indices.some(index => !Number.isSafeInteger(index) || index < 0)
      || new Set(indices).size !== indices.length || !ids.length
      || ids.some(id => typeof id !== 'string' || !id.length) || new Set(ids).size !== ids.length) return [];
    return ids;
  };
  const events: Record<Language, Map<string, NativeAlignedRow[]>> = {cn:new Map(), jp:new Map()};
  for (const language of ['cn', 'jp'] as const) for (const row of rows) {
    for (const id of nativeIds(row, language)) {
      events[language].set(id, [...(events[language].get(id) ?? []), row]);
    }
  }
  const relationIdCounts = new Map<string, number>();
  for (const relation of story.cross_chapter_relations) {
    relationIdCounts.set(relation.id, (relationIdCounts.get(relation.id) ?? 0) + 1);
  }
  const candidates: Array<{
    relation: NativeChapterRelation; keys: string[]; targetKeys: string[]; sourceLanguage: Language;
  }> = [];
  for (const relation of story.cross_chapter_relations) {
    if (relation.target_story_id !== story.id || relationIdCounts.get(relation.id) !== 1
      || !['zh-CN', 'ja-JP'].includes(relation.source_locale)
      || !['zh-CN', 'ja-JP'].includes(relation.target_locale)
      || relation.source_locale === relation.target_locale || !relation.source_event_ids.length
      || new Set(relation.source_event_ids).size !== relation.source_event_ids.length) continue;
    const sourceLanguage: Language = relation.source_locale === 'zh-CN' ? 'cn' : 'jp';
    const targetLanguage: Language = sourceLanguage === 'cn' ? 'jp' : 'cn';
    const targetMatches = events[targetLanguage].get(relation.target_event_id);
    if (targetMatches?.length !== 1) continue;
    const target = targetMatches[0], sources = new Set<NativeAlignedRow>();
    let complete = true;
    for (const id of relation.source_event_ids) {
      const matches = events[sourceLanguage].get(id);
      if (matches?.length !== 1) { complete = false; break; }
      sources.add(matches[0]);
    }
    // One matching member must never classify the rest of a merged paragraph.
    const sourceIds = new Set(relation.source_event_ids);
    if (!complete || [...sources].some(row => nativeIds(row, sourceLanguage).some(id => !sourceIds.has(id)))) continue;
    const unpaired = [...sources].filter(row => !nonempty(row, targetLanguage));
    if (!unpaired.length) continue;
    if (target.pendingReviewPassage || [...sources].some(row => row.pendingReviewPassage)) {
      throw Error('原文定位与待核实对应记录冲突 (pending): ' + relation.id);
    }
    candidates.push({relation, sourceLanguage, keys:unpaired.flatMap(row => row.nativeKeys), targetKeys:target.nativeKeys});
  }
  // Reject every overlapping candidate, not just the last relation encountered.
  // Otherwise relation order would decide which original translation is locked.
  const claims = new Map<string, number>();
  for (const candidate of candidates) for (const key of candidate.keys) claims.set(key, (claims.get(key) ?? 0) + 1);
  for (const candidate of candidates) {
    if (candidate.keys.some(key => claims.get(key) !== 1)) continue;
    for (const key of candidate.keys) result.byKey.set(key, candidate.relation);
    if (candidate.sourceLanguage === 'jp') {
      for (const key of candidate.keys) result.readonlyTranslationKeys.add(key);
      for (const key of candidate.targetKeys) result.requiredTranslationKeys.add(key);
    }
  }
  return result;
}

/** Native keys survive CN-only filtering and the editor's empty CN projection.
 * Every member of a merged row must resolve to the same source relation.
 */
export function nativeCounterpartForRow(
  context: NativeCounterpartContext | null | undefined,
  row: Partial<NativeAlignedRow>,
): NativeChapterRelation | undefined {
  const keys = row.nativeKeys ?? [];
  if (!context || !keys.length || new Set(keys).size !== keys.length) return undefined;
  const relation = context.byKey.get(keys[0]);
  return relation && keys.every(key => context.byKey.get(key) === relation) ? relation : undefined;
}

/** Locate a known counterpart without copying it into another source chapter. */
export function crossChapterRelationForRow(
  story: Pick<StoryIndexEntry, 'cross_chapter_relations'> | undefined,
  row: Partial<NativeAlignedRow>,
): NativeChapterRelation | undefined {
  return story?.cross_chapter_relations?.find(relation => {
    const sourceIsCn = relation.source_locale === 'zh-CN';
    if (sourceIsCn ? !row.cn || row.jp : !row.jp || row.cn) return false;
    const ids = (sourceIsCn ? row.cnSlot : row.jpSlot)?.eventIds ?? [];
    return ids.some(id => relation.source_event_ids.includes(id));
  });
}
