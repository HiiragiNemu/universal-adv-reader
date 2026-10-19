import type { NativeAlignedRow, PendingBilingualPassage, ReviewedBilingualPassage } from '../lib/legacy-vn-alignment';

type Review = PendingBilingualPassage | ReviewedBilingualPassage;
/** Correspondence feedback is not a translation patch or an approval. */
export function correspondenceReviewDraft(storyId: string, review: Review): string {
  if (storyId !== 'narcissu-3rd/nard01' || !/^[a-f0-9]{64}$/.test(review.evidenceSha256)
    || review.reviewer !== 'AI' || review.humanVerified !== false) throw Error('对应复核来源无效');
  return 'https://github.com/HiiragiNemu/universal-adv-reader/issues/new?' + new URLSearchParams({
    title: `[中日对应复核] ${storyId} / ${review.id}`,
    body: '请填写对应关系的核验结果与依据。正文原译文保持不变；提交反馈不等于批准或安装。\n\n'
      + JSON.stringify({storyId, ...review}, null, 2),
  });
}

export default function NativeCorrespondenceReview({storyId, row}: {storyId?: string; row: Partial<NativeAlignedRow>}) {
  const review = row.pendingReviewPassage ?? row.reviewedPassage;
  if (storyId !== 'narcissu-3rd/nard01' || !review) return null;
  const pending = review.schema === 'source-bound-bilingual-review-pending/v1';
  return <details data-correspondence-review={pending ? 'pending' : 'AI-source-review'}
    data-correspondence-id={review.id}
    className="mb-2 w-full min-w-0 basis-full break-words text-[11px] leading-relaxed opacity-80">
    <summary className="w-fit max-w-full cursor-pointer rounded border border-current px-2 py-1">
      {pending ? '对应待核验 · 原文独立保留' : 'AI 对应复核 · 待人审'}
    </summary>
    <p className="my-2">{review.note}</p>
    <p className="my-2">这里只复核中日对应关系，未修改原译文。人工核验与译文质量尚未确认。</p>
    <a className="inline-block min-h-11 py-2 underline" href={correspondenceReviewDraft(storyId, review)}
      target="_blank" rel="noopener noreferrer">提交对应核验反馈（GitHub 草稿）</a>
  </details>;
}
