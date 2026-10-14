import type { NativeAlignedRow } from './legacy-vn-alignment.ts';

/** Translation approval is independent of cross-version sentence alignment.
 * Original supplied translations are accepted by the site owner's policy;
 * only newly commissioned text remains pending. */
export type TranslationReviewRow = {
  state: 'reviewed' | 'pending';
  origin: 'existing-translation' | 'author-supplement';
  credit: string;
  sources?: Array<Record<string, unknown>>;
};
export type TranslationReview = {
  policy: 'original-reviewed-author-pending/v1';
  rows: Record<string, TranslationReviewRow>;
};
export function validateTranslationReview(value: unknown, validKeys: ReadonlySet<string>): asserts value is TranslationReview {
  const review = value as TranslationReview;
  if (!review || review.policy !== 'original-reviewed-author-pending/v1' || !review.rows || Array.isArray(review.rows)
    || typeof review.rows !== 'object') throw Error('译文校对来源格式错误');
  for (const [key, row] of Object.entries(review.rows)) {
    if (!validKeys.has(key) || !row || !['reviewed','pending'].includes(row.state)
      || !['existing-translation','author-supplement'].includes(row.origin)
      || typeof row.credit !== 'string' || !row.credit.trim() || row.credit.length > 120
      || row.origin === 'existing-translation' && row.state !== 'reviewed'
      || row.sources !== undefined && !Array.isArray(row.sources)) throw Error('译文校对来源与原生事件不一致');
  }
}
export function translationReviewForRow(row: Pick<NativeAlignedRow, 'nativeKeys'>, review?: TranslationReview): TranslationReviewRow {
  const records = (row.nativeKeys ?? []).map(key => review?.rows[key]).filter((r): r is TranslationReviewRow => Boolean(r));
  return records.find(r => r.state === 'pending') ?? records[0]
    ?? {state:'reviewed',origin:'existing-translation',credit:'原汉化组'};
}
export function mergeTranslationReview(parent: TranslationReview | undefined, next: TranslationReview | undefined): TranslationReview | undefined {
  if (!parent && !next) return undefined;
  return {policy:'original-reviewed-author-pending/v1',rows:{...parent?.rows,...next?.rows}};
}
