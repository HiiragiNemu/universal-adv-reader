// Visual metadata only: no text, translation or review flags are changed.
export type TranslationOrigin = 'human' | 'reviewed' | 'official' | 'unverified' | 'none' | 'mixed';
import {sourceRowTotals,type SourceRowProgress} from './source-progress-metrics.ts';
type Source = SourceRowProgress & { percent?: number; has_cn?: boolean; source_unverified?: boolean; human_verified?: boolean; official_tw?: boolean };
export function translationVisualState(story: Source) {
  const measured=sourceRowTotals([story]);
  if(measured){const origin:TranslationOrigin=measured.chinese===0?'none':measured.pending===0?'human':measured.reviewed===0?'unverified':'mixed';
    return {origin,percent:measured.coveragePercent,status:measured.chinese===0?'none':measured.chinese===measured.rows?'complete':'partial',
      humanEnd:measured.reviewedPercent,reviewedEnd:measured.reviewedPercent,officialEnd:measured.reviewedPercent,pendingEnd:measured.coveragePercent};}
  const raw = story.percent ?? (story.has_cn ? 100 : 0);
  const percent = Math.min(100, Math.max(0, Number.isFinite(raw) ? raw : 0));
  const origin: TranslationOrigin = story.official_tw ? 'official'
    : story.source_unverified ? (story.human_verified ? 'reviewed' : 'unverified')
    : story.has_cn ? 'human' : 'none';
  return { origin, percent, status: percent === 0 ? 'none' : percent === 100 ? 'complete' : 'partial' };
}
export function groupTranslationVisualState(stories: readonly Source[]) {
  const measured=sourceRowTotals(stories);
  if(measured){const origin:TranslationOrigin=measured.chinese===0?'none':measured.pending===0?'human':measured.reviewed===0?'unverified':'mixed';
    return {origin,percent:measured.coveragePercent,status:measured.chinese===0?'none':measured.chinese===measured.rows?'complete':'partial',humanEnd:measured.reviewedPercent,reviewedEnd:measured.reviewedPercent,officialEnd:measured.reviewedPercent,pendingEnd:measured.coveragePercent};}
  const states = stories.map(translationVisualState);
  const origins = new Set(states.filter(s => s.origin !== 'none').map(s => s.origin));
  const origin: TranslationOrigin = origins.size > 1 ? 'mixed' : [...origins][0] ?? 'none';
  const denominator = Math.max(1, states.length);
  const share = (origin: TranslationOrigin) => states.filter(s => s.origin === origin).reduce((v,s) => v + s.percent,0) / denominator;
  const human = share('human'), reviewed = share('reviewed'), official = share('official'), pending = share('unverified');
  const percent = Math.round(states.reduce((v,s) => v+s.percent,0)/denominator);
  return { origin, percent, status: percent === 0 ? 'none' : percent === 100 ? 'complete' : 'partial',
    humanEnd: human, reviewedEnd: human+reviewed, officialEnd: human+reviewed+official, pendingEnd: human+reviewed+official+pending };
}
export function translationVisualStyle(state: ReturnType<typeof translationVisualState> | ReturnType<typeof groupTranslationVisualState>) {
  return { '--cold-progress': `${state.percent}%`, ...('humanEnd' in state ? {
    '--cold-human-end': `${state.humanEnd}%`, '--cold-reviewed-end': `${state.reviewedEnd}%`,
    '--cold-official-end': `${state.officialEnd}%`, '--cold-pending-end': `${state.pendingEnd}%`,
  } : {}) };
}
