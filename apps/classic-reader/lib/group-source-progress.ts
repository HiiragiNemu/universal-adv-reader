/**
 * Folder/character source coverage is measured in real chapters.
 *
 * A chapter contributes at most one full chapter (100 percentage points) to
 * the denominator. Official Traditional Chinese and Exedra rows are excluded
 * from this fan-source metric. A human row is a non-official row without the
 * source-unverified flag; a reviewed row is source-unverified + human_verified.
 * Pending source rows contribute no translated numerator. Partial translation
 * contributes its clamped chapter percentage. Percentages are rounded to the
 * nearest tenth using Math.round(value * 10) / 10.
 */

import {sourceRowTotals,type SourceRowProgress} from './source-progress-metrics.ts';

export type GroupSourceProgressStory = SourceRowProgress & {
  category?: string;
  percent?: number;
  has_cn?: boolean;
  source_unverified?: boolean;
  human_verified?: boolean;
  official_tw?: boolean;
};

export type GroupSourceProgress = {
  eligibleChapters: number;
  excludedOfficialChapters: number;
  excludedExedraChapters: number;
  humanChapters: number;
  verifiedChapters: number;
  pendingChapters: number;
  humanPercent: number;
  verifiedPercent: number;
  translatedPercent: number;
};

const EXEDRA_CATEGORY_PREFIX = 'exedra';

const isExedraStory = (story: GroupSourceProgressStory): boolean =>
  story.category?.toLowerCase().startsWith(EXEDRA_CATEGORY_PREFIX) ?? false;

const chapterPercent = (story: GroupSourceProgressStory): number => {
  const raw = story.percent ?? (story.has_cn ? 100 : 0);
  return Math.min(100, Math.max(0, Number.isFinite(raw) ? raw : 0));
};

const roundedPercent = (value: number, denominator: number): number =>
  denominator > 0 ? Math.round((value / denominator) * 1000) / 10 : 0;

/** Displayed completion, not merely presence of translated text. */
export const storySourceCompletionPercent = (story: GroupSourceProgressStory): number =>
  sourceRowTotals([story])?.reviewedPercent ?? (!isExedraStory(story) && !story.official_tw
    && story.source_unverified && !story.human_verified
    ? 0 : chapterPercent(story));

export const groupSourceCompletionPercent = (
  stories: readonly GroupSourceProgressStory[],
): number => {
  const progress = groupSourceProgressForStories(stories);
  if (progress.eligibleChapters > 0) return progress.translatedPercent;
  return roundedPercent(
    stories.reduce((sum, story) => sum + chapterPercent(story), 0),
    stories.length * 100,
  );
};

export const groupSourceProgressForStories = (
  stories: readonly GroupSourceProgressStory[],
): GroupSourceProgress => {
  const measured=sourceRowTotals(stories);
  if(measured)return {eligibleChapters:stories.length,excludedOfficialChapters:0,excludedExedraChapters:0,
    humanChapters:stories.filter(s=>(s.reviewed_rows??0)>0).length,verifiedChapters:0,pendingChapters:stories.filter(s=>(s.pending_review_rows??0)>0).length,
    humanPercent:measured.reviewedPercent,verifiedPercent:0,translatedPercent:measured.reviewedPercent};
  let eligibleChapters = 0;
  let excludedOfficialChapters = 0;
  let excludedExedraChapters = 0;
  let humanChapters = 0;
  let verifiedChapters = 0;
  let pendingChapters = 0;
  let humanValue = 0;
  let verifiedValue = 0;

  for (const story of stories) {
    if (isExedraStory(story)) {
      excludedExedraChapters += 1;
      continue;
    }
    if (story.official_tw) {
      excludedOfficialChapters += 1;
      continue;
    }

    eligibleChapters += 1;
    const percent = chapterPercent(story);
    if (story.source_unverified) {
      if (story.human_verified) {
        verifiedChapters += 1;
        verifiedValue += percent;
      } else {
        pendingChapters += 1;
      }
      continue;
    }

    humanChapters += 1;
    humanValue += percent;
  }

  const denominator = eligibleChapters * 100;
  return {
    eligibleChapters,
    excludedOfficialChapters,
    excludedExedraChapters,
    humanChapters,
    verifiedChapters,
    pendingChapters,
    humanPercent: roundedPercent(humanValue, denominator),
    verifiedPercent: roundedPercent(verifiedValue, denominator),
    translatedPercent: roundedPercent(humanValue + verifiedValue, denominator),
  };
};
