import type { NativeAlignedRow } from './legacy-vn-alignment.ts';
import { translationReviewForRow, type TranslationReview } from './translation-review.ts';
import { resolveSameStoryNativeCounterparts, nativeCounterpartForRow } from './native-section-anchors.ts';
import type { StoryIndexEntry } from './story-index.ts';

export const GENERIC_PROGRESS_WORKS = {
  main_story: 'Narcissu10周年', event_story: 'Narcissu 3rd',
  character_story: '加奈，欢迎回来！', supplement_story: 'Narcissu 文本资料',
} as const;
export type GenericProgressEntry = {
  id: string; identity: string; title: string; titleJp: string;
  category: keyof typeof GENERIC_PROGRESS_WORKS; work: string;
  variants: number; revision: string | null; supplemental?: boolean;
  nativeChapters?: number; nativeGroupId?: string;
  pendingCorrespondenceRows?: number; pendingCorrespondenceJapaneseRows?: number;
  relocatedJapaneseRows?: number; relocatedChineseRows?: number; missingChineseRows?: number;
  rows: number; chineseRows: number; nonemptyChineseRows: number; japaneseRows: number;
  unmatchedChineseRows: number; unmatchedJapaneseRows: number;
  reviewedRows: number; pendingReviewRows: number; reviewedPercent: number;
  coveragePercent: number; hasChinese: boolean; review: 'reviewed' | 'pending' | 'no-chinese';
};
export type GenericProgress = {
  schema: 'generic-reader-progress/v2'; policy: 'original-reviewed-author-pending/v1';
  sourceRevision: string; adapterSha256: string;
  archive: { games: number; stories: number; visible: number; excluded: number; variants: number; textEvents: number; chineseStories: number };
  total: number; nativeTotal: number; supplementalTotal: number; supplementalSources: number;
  nativeChapters?: number; nativeGroups?: number; withChinese: number; withoutChinese: number; needsReview: number;
  humanVerified: number; rows: number; chineseRows: number; reviewedRows: number; pendingReviewRows: number;
  coveragePercent: number; reviewedPercent: number; entries: GenericProgressEntry[];
  works: Array<{ category: GenericProgressEntry['category']; title: string; total: number; nativeChapters?: number; nativeGroups?: number; withChinese: number; withoutChinese: number; needsReview: number; humanVerified: number }>;
};
export const exactProgressPercent = (value: number, total: number): number =>
  total <= 0 ? 0 : value >= total ? 100 : Math.floor(Math.max(0,value) / total * 10000) / 100;

/** Same visible paragraph/choice denominator as the reader. Whitespace is not a
 * translation, and a correspondence investigation is not a proofreading task. */
export function nativeCoverage(rows: NativeAlignedRow[], review?: TranslationReview,
  story?: Pick<StoryIndexEntry, 'id' | 'cross_chapter_relations'>) {
  const nonempty = (row: NativeAlignedRow, language: 'cn' | 'jp') => Boolean((row[language]?.choiceLabel ?? row[language]?.text ?? '').trim());
  const content = rows.filter(row => !(row.cn ?? row.jp)?.isHeader && (nonempty(row,'cn') || nonempty(row,'jp')));
  const chineseRows = content.filter(row => nonempty(row,'cn')).length;
  const pendingReviewRows = content.filter(row => nonempty(row,'cn') && translationReviewForRow(row,review).state==='pending').length;
  const reviewedRows = chineseRows - pendingReviewRows;
  const pendingCorrespondence = content.filter(row=>row.pendingReviewPassage);
  const counterparts = resolveSameStoryNativeCounterparts(story, rows);
  const unmatchedJapanese = content.filter(row=>nonempty(row,'jp')&&!nonempty(row,'cn'));
  const unmatchedChinese = content.filter(row=>nonempty(row,'cn')&&!nonempty(row,'jp'));
  const relocatedJapaneseRows = unmatchedJapanese.filter(row=>nativeCounterpartForRow(counterparts,row)).length;
  const relocatedChineseRows = unmatchedChinese.filter(row=>nativeCounterpartForRow(counterparts,row)).length;
  const missingChineseRows = unmatchedJapanese.filter(row=>!row.pendingReviewPassage&&!nativeCounterpartForRow(counterparts,row)).length;
  return { ...(pendingCorrespondence.length ? {pendingCorrespondenceRows:pendingCorrespondence.length, pendingCorrespondenceJapaneseRows:pendingCorrespondence.filter(row=>nonempty(row,'jp')&&!nonempty(row,'cn')).length} : {}), rows:content.length,chineseRows,nonemptyChineseRows:chineseRows,
    japaneseRows:content.filter(row=>nonempty(row,'jp')).length,
    unmatchedChineseRows:unmatchedChinese.length, unmatchedJapaneseRows:unmatchedJapanese.length,
    relocatedJapaneseRows, relocatedChineseRows, missingChineseRows,
    reviewedRows,pendingReviewRows,reviewedPercent:exactProgressPercent(reviewedRows,content.length),
    coveragePercent:exactProgressPercent(chineseRows,content.length),hasChinese:chineseRows>0,
    review:chineseRows===0?'no-chinese' as const:pendingReviewRows>0?'pending' as const:'reviewed' as const };
}
export function summarizeGenericProgress(entries: GenericProgressEntry[], source: Pick<GenericProgress,'archive'|'sourceRevision'|'adapterSha256'>): GenericProgress {
  const native=entries.filter(e=>!e.supplemental),supplements=entries.filter(e=>e.supplemental);
  if(!entries.length || native.length!==source.archive.visible || source.archive.stories!==source.archive.visible+source.archive.excluded
    || new Set(entries.map(e=>e.id)).size!==entries.length || new Set(entries.map(e=>e.identity)).size!==entries.length) throw Error('通用目录与原生归档/补充资料不一致');
  const sum=(key:'rows'|'chineseRows'|'reviewedRows'|'pendingReviewRows')=>entries.reduce((n,e)=>n+e[key],0);
  const rows=sum('rows'),chineseRows=sum('chineseRows'),reviewedRows=sum('reviewedRows'),pendingReviewRows=sum('pendingReviewRows');
  const works=Object.entries(GENERIC_PROGRESS_WORKS).map(([category,title])=>{
    const list=entries.filter(e=>e.category===category),withChinese=list.filter(e=>e.hasChinese).length;
    return {category:category as GenericProgressEntry['category'],title,total:list.length,nativeChapters:list.reduce((n,e)=>n+(e.nativeChapters??1),0),
      nativeGroups:new Set(list.map(e=>e.nativeGroupId).filter(Boolean)).size,withChinese,withoutChinese:list.length-withChinese,
      needsReview:list.filter(e=>e.pendingReviewRows>0).length,humanVerified:list.filter(e=>e.hasChinese&&e.pendingReviewRows===0).length};
  });
  if(works.reduce((n,w)=>n+w.total,0)!==entries.length)throw Error('未知作品分类');
  const withChinese=entries.filter(e=>e.hasChinese).length;
  return {schema:'generic-reader-progress/v2',policy:'original-reviewed-author-pending/v1',...source,total:entries.length,nativeTotal:native.length,
    supplementalTotal:supplements.length,supplementalSources:new Set(supplements.map(e=>e.nativeGroupId)).size,
    nativeChapters:native.reduce((n,e)=>n+(e.nativeChapters??1),0),nativeGroups:new Set(native.map(e=>e.nativeGroupId).filter(Boolean)).size,
    withChinese,withoutChinese:entries.length-withChinese,needsReview:entries.filter(e=>e.pendingReviewRows>0).length,
    humanVerified:entries.filter(e=>e.hasChinese&&e.pendingReviewRows===0).length,rows,chineseRows,reviewedRows,pendingReviewRows,
    coveragePercent:exactProgressPercent(chineseRows,rows),reviewedPercent:exactProgressPercent(reviewedRows,rows),entries,works};
}
export function readGenericProgress(value: unknown): GenericProgress {
  const p=value as GenericProgress;
  if(p?.schema!=='generic-reader-progress/v2'||p.policy!=='original-reviewed-author-pending/v1'||!Array.isArray(p.entries)||p.entries.length!==p.total
    ||new Set(p.entries.map(e=>e.id)).size!==p.total||p.withChinese+p.withoutChinese!==p.total
    ||p.nativeTotal+p.supplementalTotal!==p.total||p.archive.visible!==p.nativeTotal)throw Error('通用进度格式错误');
  for(const e of p.entries)if(!(e.category in GENERIC_PROGRESS_WORKS)||!Number.isSafeInteger(e.rows)||e.rows<0
    ||e.reviewedRows+e.pendingReviewRows!==e.chineseRows||e.chineseRows>e.rows||e.reviewedRows<0||e.pendingReviewRows<0)throw Error('译文校对分母不一致');
  for(const e of p.entries){
    const relocated=e.relocatedJapaneseRows??0, pending=e.pendingCorrespondenceJapaneseRows??0;
    const missing=e.missingChineseRows??e.unmatchedJapaneseRows-relocated-pending, relocatedCn=e.relocatedChineseRows??0;
    if([relocated,pending,missing,relocatedCn].some(n=>!Number.isSafeInteger(n)||n<0)
      ||relocated+pending+missing!==e.unmatchedJapaneseRows||relocatedCn>e.unmatchedChineseRows)throw Error('版本对应分解不一致');
  }
  if(p.needsReview!==p.entries.filter(e=>e.pendingReviewRows>0).length||p.reviewedRows+p.pendingReviewRows!==p.chineseRows)throw Error('译文校对合计不一致');
  return p;
}
