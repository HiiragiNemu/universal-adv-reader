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

export function nativeChapterRelationHref(relation: NativeChapterRelation): string {
  return `/reader/${relation.target_story_id}#${sourceEventAnchor(relation.target_locale, relation.target_event_id)}`;
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
