"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useId,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import Link from 'next/link';
import LoadingScreen from '@/components/LoadingScreen';
import IOSViewportHost from '@/components/IOSViewportHost';
import IOSHeaderSurface from '@/components/IOSHeaderSurface';
import { ReaderFilmSurface, ReaderTubeSurface } from '@/components/RetroDisplaySurface';
import '@/app/home-optical-refinements.css';
import {
  Search,
  Book,
  Layers,
  User,
  Calendar,
  Folder,
  FileText,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Sun,
  Moon,
  ScanLine,
  BookOpen,
  Leaf,
  Settings,
} from 'lucide-react';
import { isNightTheme, useGlobal } from '@/app/providers';
import { characterFolderColorFor } from '@/app/config/dictionary';
import { characterRomanizedNameFor } from '@/app/config/character-romaji.generated';
import { type Story } from '@/components/Sidebar';
import AboutModal from '@/components/AboutModal';
import LocalStoryPicker from '@/components/LocalStoryPicker';
import MadeInMagiusLogo from '@/components/MadeInMagiusLogo';
import SiteSettingsWindow from '@/components/SiteSettingsWindow';
import { normalizeSearchText } from '@/lib/search';
import { createSearchWorkerClient, type SearchWorkerClient } from '@/lib/search-worker-client';
import { GENERIC_CATEGORIES, isGenericCategory, genericCategory, genericSearchTitle } from '@/lib/generic-search-catalog';
import { loadStoryIndex } from '@/lib/story-index';
import { readGenericProgress, type GenericProgress } from '@/lib/generic-progress';
import {sourceRowTotals,sourcePercent} from '@/lib/source-progress-metrics';
import { storySectionDetails } from '@/lib/story-parser';
import { categoryOrder } from '@/lib/category-order';
import { genericStoryLabel } from '@/lib/generic-story-label';
import { compareNativeStories, nativeGroupOrder, nativeNavigationLabel, nativeSectionLinks } from '@/lib/native-story-navigation';
import { translationVisualState, groupTranslationVisualState, translationVisualStyle } from '@/lib/translation-visual-state';
import { groupSourceProgressForStories, groupSourceCompletionPercent, storySourceCompletionPercent } from '@/lib/group-source-progress';
import { readerNameChip } from '@/lib/reader-name-chip';
import { resolveOfficialSectionTitle } from '@/lib/official-tw-titles';
import {
  getSearchIndexSources,
  SEARCH_INDEX_SCOPE_CONFIG,
} from '@/lib/search-index-scope';
import {
  getMachineReviewPanelServerSnapshot,
  getMachineReviewPanelSnapshot,
  setMachineReviewPanelCollapsedPreference,
  subscribeMachineReviewPanel,
} from '@/lib/machine-review-panel';
import {
  HOME_SIDEBAR_WIDTH_DEFAULT,
  HOME_SIDEBAR_WIDTH_MAX,
  HOME_SIDEBAR_WIDTH_MIN,
  HOME_SIDEBAR_WIDTH_STEP,
  HOME_SIDEBAR_WIDTH_STORAGE_KEY,
  clampHomeSidebarWidth,
  parseStoredHomeSidebarWidth,
} from '@/lib/sidebar-width';

type SearchMode = 'all' | 'title' | 'content';
type MobileReviewPlacement = 'floating' | 'toolbar';
type MobileCategoryLayout = 'graph' | 'single-row';

type StoryGroup = {
  key: string;
  category: string;
  folderName: string;
  items: Story[];
  totalCn: number;
  matchSnippets?: Record<string, string>;
};

type CategoryConfig = {
  label: string;
  icon: ComponentType<{ size?: number }>;
};

type SearchWorkerMessage =
  | { type: 'status'; status: 'loading' | 'ready' | 'error' }
  | { type: 'progress'; loadedBytes: number; totalBytes: number }
  | { type: 'results'; sequence: number; matches: Array<[string, string]>; truncated: boolean }
  | { type: 'error'; sequence: number; message: string };

type ProofreadingStatus = GenericProgress;

const CATEGORY_CONFIG: Record<string, CategoryConfig> = {
  main_story: { label: 'Narcissu10周年', icon: Book },
  event_story: { label: 'Narcissu 3rd', icon: Calendar },
  character_story: { label: '加奈，欢迎回来！', icon: User },
  supplement_story: {label:'Narcissu 文本资料',icon:FileText},
  costume_story: { label: '服装', icon: Layers },
  login_story: { label: '登录', icon: FileText },
  mirror_story: { label: '镜层', icon: Folder },
  scene0_main: { label: 'S0主线', icon: Book },
  scene0_sub: { label: 'S0支线', icon: User },
  exedra_main: { label: '主线', icon: Book },
  exedra_sub: { label: '活动', icon: Layers },
  exedra_character: { label: '角色', icon: User },
  exedra_portrait: { label: '肖像', icon: User },
  exedra_reaction: { label: '语音', icon: FileText },
  exedra_namae: { label: 'Namae', icon: Folder },
  exedra_dungeon: { label: '过场动画字幕', icon: Layers },
  exedra_battle: { label: '战斗', icon: Folder },
  Unclassified: { label: '其他', icon: Folder },
};

const EXEDRA_CATEGORIES = [
  'exedra_main',
  'exedra_sub',
  'exedra_character',
  'exedra_portrait',
  'exedra_reaction',
  'exedra_namae',
  'exedra_dungeon',
  'exedra_battle',
] as const;
const EXEDRA_CATEGORY_SET = new Set<string>(EXEDRA_CATEGORIES);
const categoryNavVisible = (mobile: boolean): boolean => mobile === window.matchMedia(
  '(max-width: 767px), (max-height: 32rem) and (hover: none) and (pointer: coarse)',
).matches;

const DEFAULT_CATEGORY = 'main_story';
const NATURAL_COLLATOR = new Intl.Collator(['zh-CN', 'ja-JP'], {
  numeric: true,
  sensitivity: 'base',
});

const isExedraCategory = (category: string): boolean =>
  EXEDRA_CATEGORY_SET.has(category);

const isDayArchiveTheme = (theme: string): boolean =>
  theme === 'light' || theme === 'paper';

const MOBILE_REVIEW_PLACEMENT_STORAGE_KEY =
  'magi-reader-mobile-review-placement-v1';
const MOBILE_CATEGORY_LAYOUT_STORAGE_KEY =
  'magi-reader-mobile-category-layout-v1';

const pointInsideRect = (
  x: number,
  y: number,
  rect: DOMRect | undefined,
): boolean =>
  Boolean(
    rect
    && x >= rect.left
    && x <= rect.right
    && y >= rect.top
    && y <= rect.bottom,
  );

const getDisplayLabel = (story: Story) => nativeNavigationLabel(story, genericStoryLabel(story));

const storyProgress = (story: Story): number =>
  story.percent ?? (story.has_cn ? 100 : 0);

type TranslationProgressStatus = 'none' | 'partial' | 'complete';

type SourceVisualStatus =
  | 'exedra-official-tw'
  | 'exedra-human-cn'
  | 'magireco-source-unverified'
  | 'magireco-human-verified'
  | 'magireco-human-cn'
  | 'neutral';

type GroupSourceProgress = {
  humanPercent: number;
  verifiedPercent: number;
  translatedPercent: number;
};

type CategorySourceFilter =
  | 'all'
  | 'with-cn'
  | 'without-cn'
  | 'needs-review';

type CategorySourceFilterCounts = Record<CategorySourceFilter, number>;
type CategorySourceProgressMetric = {
  value: number;
  maximum: number;
  chapters: number;
  available: boolean;
};
type CategorySourceFilterProgress = Record<
  CategorySourceFilter,
  CategorySourceProgressMetric
>;
type CategorySourceConnections = ReadonlyMap<
  string,
  ReadonlySet<CategorySourceFilter>
>;

const MAX_CONNECTED_CATEGORIES = 3;
const CATEGORY_ANCHOR_INDEX_BY_SLOT = [1, 0, 2] as const;

const CATEGORY_SOURCE_FILTERS: ReadonlyArray<{
  value: CategorySourceFilter;
  label: string;
}> = [
  { value: 'all', label: '全部' },
  { value: 'with-cn', label: '有中文' },
  { value: 'without-cn', label: '无中文' },
  { value: 'needs-review', label: '补译待校对' },
];
const ALL_SOURCE_CONNECTION: ReadonlySet<CategorySourceFilter> = new Set(
  CATEGORY_SOURCE_FILTERS.map(option => option.value),
);
const createAllSourceConnection = (): Set<CategorySourceFilter> =>
  new Set(ALL_SOURCE_CONNECTION);
const hasAllSourceConnections = (
  filters: ReadonlySet<CategorySourceFilter>,
): boolean => CATEGORY_SOURCE_FILTERS.every(option => filters.has(option.value));

const emptyCategorySourceFilterCounts = (): CategorySourceFilterCounts => ({
  'all': 0,
  'with-cn': 0,
  'without-cn': 0,
  'needs-review': 0,
});

const emptyCategorySourceFilterProgress = (
  sourceStatusKnown: boolean,
): CategorySourceFilterProgress => ({
  'all': { value: 0, maximum: 0, chapters: 0, available: true },
  'with-cn': { value: 0, maximum: 0, chapters: 0, available: sourceStatusKnown },
  'without-cn': { value: 0, maximum: 0, chapters: 0, available: sourceStatusKnown },
  'needs-review': { value: 0, maximum: 0, chapters: 0, available: sourceStatusKnown },
});

const categorySourceProgressPercent = (
  metric: CategorySourceProgressMetric,
): number => metric.available && metric.maximum > 0
  ? sourcePercent(metric.value,metric.maximum)
  : 0;

const categorySourceFilterProgressForStories = (
  stories: readonly Story[], sourceStatusKnown: boolean,
): CategorySourceFilterProgress => {
  const totals=sourceRowTotals(stories);
  const progress=emptyCategorySourceFilterProgress(Boolean(totals)||sourceStatusKnown);
  if(!totals)return progress;
  const values={all:totals.reviewed,'with-cn':totals.chinese,'without-cn':totals.rows-totals.chinese,'needs-review':totals.pending};
  for(const filter of ['all','with-cn','without-cn','needs-review'] as const)progress[filter]={value:values[filter],maximum:totals.rows,chapters:stories.length,available:true};
  return progress;
};
const categorySourceProgressText = (filter:CategorySourceFilter,metric:CategorySourceProgressMetric,percent:number):string => {
  const label=filter==='all'?'已校对':CATEGORY_SOURCE_FILTERS.find(option=>option.value===filter)?.label??filter;
  if(!metric.available)return label+'数据尚未加载。';
  return `${label} ${percent}%，${metric.value}/${metric.maximum} 个阅读段落／选项；原汉化已校对，仅站长补译待校对。`;
};

const translationProgressStatus = (percent: number): TranslationProgressStatus =>
  percent === 0 ? 'none' : percent === 100 ? 'complete' : 'partial';

const storySourceVisualStatus = (story: Story): SourceVisualStatus => {
  if (isExedraCategory(story.category)) {
    if (story.official_tw) return 'exedra-official-tw';
    if (story.has_cn && storyProgress(story) === 100) return 'exedra-human-cn';
    return 'neutral';
  }
  if (story.source_unverified && !story.human_verified) {
    return 'magireco-source-unverified';
  }
  if (story.source_unverified && story.human_verified) {
    return 'magireco-human-verified';
  }
  if (story.has_cn && !story.source_unverified && storyProgress(story) === 100) {
    return 'magireco-human-cn';
  }
  return 'neutral';
};

const groupSourceVisualStatus = (stories: readonly Story[]): SourceVisualStatus => {
  const statuses = new Set(stories.map(storySourceVisualStatus));
  for (const status of [
    'magireco-source-unverified',
    'magireco-human-verified',
    'exedra-official-tw',
    'exedra-human-cn',
    'magireco-human-cn',
  ] as const) {
    if (statuses.has(status)) return status;
  }
  return 'neutral';
};



const storyMatchesCategorySourceFilter = (story: Story, filter: CategorySourceFilter): boolean => {
  if (filter === 'all') return true;
  if (filter === 'without-cn') return !story.has_cn;
  if (filter === 'needs-review') return (story.pending_review_rows??0)>0;
  return Boolean(story.has_cn);
};

const storyMatchesCategorySourceFilters = (
  story: Story,
  filters: ReadonlySet<CategorySourceFilter>,
): boolean => filters.has('all')
  || Array.from(filters).some(filter => storyMatchesCategorySourceFilter(story, filter));

function FolderCard({ group, theme }: { group: StoryGroup; theme: string }) {
  const { nameColorsEnabled } = useGlobal();
  const hasSearchMatches = Boolean(
    group.matchSnippets && Object.keys(group.matchSnippets).length > 0,
  );
  /* Folders and their nested Episode lists stay collapsed by default;
     search matches expand only the outer folder. */
  const [manuallyOpen, setManuallyOpen] = useState(hasSearchMatches);
  const [openStoryKeys, setOpenStoryKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const contentId = useId();
  const sourceUnverifiedPending = group.items.filter(
    story => story.source_unverified && !story.human_verified,
  ).length;
  const sourceUnverifiedVerified = group.items.filter(
    story => story.source_unverified && story.human_verified,
  ).length;
  const officialTwStories = group.items.filter(
    story => isExedraCategory(story.category) && story.official_tw,
  );
  const officialTwLabel =
    officialTwStories[0]?.official_tw_label?.trim() || '台服';
  const isOfficialTwGroup = officialTwStories.length > 0;
  const nativeSourceGroup = group.items.every(story => Boolean(story.source_identity));
  const chineseScriptCount = group.items.filter(story => story.has_cn).length;
  const isOpen = hasSearchMatches || manuallyOpen;
  const rowProgress=sourceRowTotals(group.items);
  const pendingParagraphCount=rowProgress?.pending??sourceUnverifiedPending;
  const avgPercent=rowProgress?.coveragePercent??Math.round(group.items.reduce((sum,story)=>sum+storyProgress(story),0)/group.items.length);
  const groupProgressStatus = translationProgressStatus(avgPercent);
  const coldGroupState = groupTranslationVisualState(group.items);
  const groupSourceStatus = groupSourceVisualStatus(group.items);
  const groupSourceProgress = groupSourceProgressForStories(group.items);
  const completionPercent = groupSourceCompletionPercent(group.items);
  const groupSourceProgressEnabled = !isExedraCategory(group.category)
    && groupSourceProgress.eligibleChapters > 0;

  const isDark = isNightTheme(theme);
  const isDayArchive = isDayArchiveTheme(theme);
  let headerClass = '';
  let progressClass = '';

  if (isDark) {
    headerClass =
      avgPercent === 0
        ? 'bg-gray-800 border-gray-700 text-gray-400'
        : 'bg-emerald-900/40 border-emerald-800 text-emerald-100';
    progressClass = 'text-emerald-400';
  } else if (isDayArchive) {
    if (avgPercent === 0) {
      headerClass = 'magi-home-light-folder-header magi-home-light-folder-header-empty';
    } else if (avgPercent === 100) {
      headerClass = 'magi-home-light-folder-header magi-home-light-folder-header-complete';
    } else {
      headerClass = 'magi-home-light-folder-header magi-home-light-folder-header-partial';
    }
    progressClass = 'magi-home-light-progress';
  } else {
    if (avgPercent === 0) {
      headerClass = 'bg-black/5 border-black/10 text-black/50';
    } else if (avgPercent === 100) {
      headerClass = 'bg-emerald-600 border-emerald-700 text-white';
    } else {
      headerClass = 'bg-emerald-100 border-emerald-300 text-emerald-900';
    }
    progressClass = avgPercent === 100 ? 'text-emerald-100' : 'text-emerald-700';
  }

  const baseDisplayTitle = group.folderName
    .replace(/^\d+ - /, '')
    .replace(/^Event_\d+/, 'Event');
  const romanizedTitle = characterRomanizedNameFor(group.category, group.folderName);
  const displayTitle = romanizedTitle
    ? `${baseDisplayTitle} / ${romanizedTitle}`
    : baseDisplayTitle;
  const folderId = group.folderName.match(/^(\d+)/)?.[1] || '';

  return (
    <div
      data-translation-status={groupProgressStatus}
      data-translation-origin={coldGroupState.origin}
      data-source-status={groupSourceStatus}
      data-source-progress={groupSourceProgressEnabled ? 'true' : 'false'}
      data-completion-percent={completionPercent}
      data-translation-coverage-percent={avgPercent}
      data-human-progress-percent={groupSourceProgress.humanPercent}
      data-verified-progress-percent={groupSourceProgress.verifiedPercent}
      style={{
        ...translationVisualStyle(coldGroupState),
        '--magi-folder-human-progress-end': `${groupSourceProgress.humanPercent}%`,
        '--magi-folder-translated-progress-end': `${avgPercent}%`,
      } as CSSProperties}
      className={`magi-folder-source-card break-inside-avoid mb-3 rounded-lg border shadow-sm transition-all ${
        isDark
          ? 'border-gray-700'
          : isDayArchive
            ? 'magi-home-light-folder-card'
            : 'border-black/10'
      } ${isOpen ? '' : 'magi-folder-card-collapsed'}`}
    >
      <button
        type="button"
        aria-controls={contentId}
        aria-expanded={isOpen}
        onClick={() => setManuallyOpen(open => !open)}
        className={`magi-card-heading-grid magi-folder-heading-flow w-full px-3 py-3 text-left transition-colors border-b ${
          isOpen ? 'border-inherit' : 'border-transparent'
        } ${headerClass}`}
      >
        <span className="magi-card-title-flow flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="mt-0.5 flex-shrink-0">
            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </span>
          {folderId && (
            <span className="magi-folder-id font-mono text-xs opacity-70 bg-black/10 px-1 rounded flex-shrink-0 mt-0.5">
              {folderId}
            </span>
          )}
          <span
            className="magi-folder-display-title min-w-0 break-words text-sm font-bold leading-tight"
            style={readerNameChip(characterFolderColorFor(group.category, baseDisplayTitle), nameColorsEnabled)}
          >
            {displayTitle}
          </span>
          <span className="magi-card-meta">
          {sourceUnverifiedPending > 0 && (
            <span className={`magi-home-status-badge magi-home-status-badge-unverified shrink-0 px-2 py-0.5 text-[10px] font-black ${
              isDayArchive
                ? ''
                : 'rounded-full bg-amber-500 text-white'
            }`}>
              补译待校 {pendingParagraphCount} 段
            </span>
          )}
          {sourceUnverifiedPending === 0 && sourceUnverifiedVerified > 0 && (
            <span className={`magi-home-status-badge magi-home-status-badge-verified shrink-0 px-2 py-0.5 text-[10px] font-black ${
              isDayArchive
                ? ''
                : 'rounded-full bg-emerald-500 text-white'
            }`}>
              已校 {sourceUnverifiedVerified}
            </span>
          )}
          {isOfficialTwGroup && (
            <span
              className="magi-official-tw-badge"
              title="台服官方中文"
              aria-label="台服官方中文"
            >
              {officialTwLabel}
            </span>
          )}
          {groupSourceStatus === 'exedra-human-cn' && (
            <span className="magi-source-status-badge magi-source-status-badge-exedra-human">
              人工中文
            </span>
          )}
          <span className={`magi-source-completion shrink-0 font-mono text-[10px] ${progressClass}`} title={`中文覆盖 ${avgPercent}% · 已校对 ${completionPercent}% · 仅新增补译待校对`}>
            {nativeSourceGroup ? (chineseScriptCount ? `中文 ${avgPercent}% · ${pendingParagraphCount ? `已校对 ${completionPercent}%` : '已校对'}` : '暂无中文') : `${completionPercent}%`}
          </span>
          </span>
        </span>
      </button>

      {isOpen && (
        <div
          id={contentId}
          className={`magi-home-folder-body p-2 ${
            isDark
              ? 'bg-gray-900'
              : isDayArchive
                ? 'magi-home-light-folder-body'
                : 'bg-white/50'
          }`}
        >
          <div className="magi-home-folder-tree">
            {[...group.items]
              .sort(compareNativeStories)
              .map((story, storyIndex) => {
                const label = getDisplayLabel(story);
                const nativeLinks = nativeSectionLinks(story);
                const episodeLinks = nativeLinks.length ? nativeLinks : Array.from(new Map(
                  (story.sections ?? []).map((section, sectionIndex) => {
                    const details = storySectionDetails(section);
                    const sectionNumber = section.match(/Section\s*(\d+)/i)?.[1]
                      || String(sectionIndex + 1);
                    const branchNumber = section.match(
                      /(?:Branch|分支|group)\s*_?\s*(\d+)/i,
                    )?.[1];
                    const officialTitle = isExedraCategory(story.category)
                      ? resolveOfficialSectionTitle(
                           story.official_tw_section_titles,
                           sectionIndex + 1,
                           '',
                           {
                             sourceName: details.sourceName,
                             displayTitles: story.section_display_titles,
                             sources: story.official_tw_section_sources,
                             branch: details.branch,
                           },
                         )
                      : '';
                    return [
                      details.anchorId,
                      {
                        ...details,
                        title:
                          officialTitle
                          || (story.source_identity && story.sections?.length === 1
                            ? label
                            : `Episode${sectionNumber}${branchNumber ? ` · 分支${branchNumber}` : ''}`),
                      },
                    ] as const;
                  }),
                ).values());
                const progress = storyProgress(story);
                const completionPercent = progress;
                const itemProgressStatus = translationProgressStatus(progress);
                const coldStoryState = translationVisualState(story);
                const sourceVisualStatus = storySourceVisualStatus(story);
                const snippet = group.matchSnippets?.[story.id];
                const sourceUnverifiedPendingStory =
                  story.source_unverified && !story.human_verified;
                const sourceMarkerClass = sourceUnverifiedPendingStory
                  ? isDayArchive
                    ? 'magi-home-light-story-unverified'
                    : ''
                  : story.source_unverified && story.human_verified && isDayArchive
                    ? 'magi-home-light-story-verified'
                    : '';
                const buttonClass = isDark
                  ? progress > 0
                    ? 'bg-emerald-900/30 border-emerald-700 text-emerald-400'
                    : 'bg-gray-800 border-gray-700 text-gray-500'
                  : isDayArchive
                    ? progress > 0
                      ? `magi-home-light-story-link ${sourceMarkerClass}`
                      : `magi-home-light-story-link magi-home-light-story-link-empty ${sourceMarkerClass}`
                    : progress > 0
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-white border-gray-200 text-gray-400';
                const storyHref = `/reader/${encodeURIComponent(story.id)}?cn=${encodeURIComponent(
                  story.path_cn || '',
                )}&jp=${encodeURIComponent(story.path_jp || '')}`;
                const storyKey = `${story.id}:${story.path_cn ?? ''}:${story.path_jp ?? ''}`;
                const storyContentId = `${contentId}-story-${storyIndex}`;
                const hasDuplicateHeading = Boolean(story.section_display_titles)
                  && label === baseDisplayTitle;
                const isStoryOpen = hasDuplicateHeading || openStoryKeys.has(storyKey);

                return (
                  <div
                    key={storyKey}
                    className="magi-home-story-tree-node"
                    data-tree-state={isStoryOpen ? 'open' : 'closed'}
                  >
                    <span className="magi-home-story-tree-junction" aria-hidden="true" />
                    <article
                      data-translation-status={itemProgressStatus}
                      data-translation-origin={coldStoryState.origin}
                      data-source-status={sourceVisualStatus}
                      data-progress-percent={completionPercent}
                      data-translation-coverage-percent={progress}
                      style={{
                        '--magi-story-progress': `${completionPercent}%`,
                        '--magi-folder-human-progress-end': `${!story.source_unverified && !story.official_tw ? progress : 0}%`,
                        '--magi-folder-translated-progress-end': `${progress}%`,
                        ...(theme === 'frost' ? translationVisualStyle(coldStoryState) : {}),
                      } as CSSProperties}
                      className={`magi-story-source-link max-w-full min-w-0 overflow-hidden rounded border transition-all ${buttonClass} ${
                        snippet ? 'w-full' : ''
                      }`}
                    >
                    {!hasDuplicateHeading && (
                    <div className="magi-home-story-heading-row relative z-10 flex min-w-0 items-stretch">
                      {episodeLinks.length > 0 && (
                        <button
                          type="button"
                          aria-controls={storyContentId}
                          aria-expanded={isStoryOpen}
                          aria-label={`${isStoryOpen ? '收起' : '展开'} ${label} Episode`}
                          onClick={() => {
                            setOpenStoryKeys(current => {
                              const next = new Set(current);
                              if (next.has(storyKey)) {
                                next.delete(storyKey);
                              } else {
                                next.add(storyKey);
                              }
                              return next;
                            });
                          }}
                          className="magi-home-story-toggle flex shrink-0 items-center justify-center px-2 transition-opacity hover:opacity-100"
                        >
                          {isStoryOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </button>
                      )}
                      <Link
                        href={storyHref}
                        title={`${label} · ${story.id}`}
                        data-source-identity={story.source_identity}
                        prefetch={false}
                        className="magi-home-story-primary-link block min-w-0 flex-1"
                      >
                        <div className="magi-card-heading-grid min-w-0 px-2 py-1.5">
                          <span className="magi-card-title-flow magi-home-story-tree-title break-words font-mono text-xs font-bold">
                            <span
                              className="magi-home-tree-folder-icon"
                              data-open={isStoryOpen ? 'true' : 'false'}
                              aria-hidden="true"
                            />
                            <span className="magi-home-story-tree-label">{story.source_identity ? label : `#${label}`}</span>
                          </span>
                          <span className="magi-card-meta">
                          {sourceUnverifiedPendingStory && (
                            <span className={`magi-home-status-badge magi-home-status-badge-unverified px-1.5 py-0.5 text-[9px] font-black ${
                              isDayArchive
                                ? ''
                                : 'rounded bg-amber-500 text-white'
                            }`}>
                              补译待校对
                            </span>
                          )}
                          {story.source_unverified && story.human_verified && (
                            <span className={`magi-home-status-badge magi-home-status-badge-verified px-1.5 py-0.5 text-[9px] font-black ${
                              isDayArchive
                                ? ''
                                : 'rounded bg-emerald-600 text-white'
                            }`}>
                              来源已核验
                            </span>
                          )}
                          {isExedraCategory(story.category) && story.official_tw && (
                            <span
                              className="magi-official-tw-badge"
                              title="台服官方中文"
                              aria-label="台服官方中文"
                            >
                              {story.official_tw_label?.trim() || '台服'}
                            </span>
                          )}
                          {sourceVisualStatus === 'exedra-human-cn' && (
                            <span className="magi-source-status-badge magi-source-status-badge-exedra-human">
                              人工中文
                            </span>
                          )}
                          {(story.source_identity || !isDayArchive || completionPercent < 100) && (
                            <span className="magi-home-story-progress text-[10px] opacity-60" title={story.source_identity ? (story.has_cn ? (story.human_verified ? '中文已人工校对' : '已有中文文件，译文待人工校对') : '当前只有日文正文') : `中文槽位覆盖 ${progress}% · 人工核对待完成`}>{story.source_identity ? (story.has_cn ? ((story.pending_review_rows??0)>0 ? `补译 ${story.pending_review_rows} 段待校对` : '中文已校对') : '仅日文') : `${completionPercent}%`}</span>
                          )}
                          </span>
                        </div>
                        {snippet && (
                          <div
                            className={`magi-home-search-snippet reader-font-cn-body px-2 py-1.5 text-xs font-serif border-t ${
                              isDark
                                ? 'border-white/10 text-gray-300'
                                : 'border-black/5 text-gray-600'
                            }`}
                          >
                            …{snippet}…
                          </div>
                        )}
                      </Link>
                    </div>
                    )}
                    {hasDuplicateHeading && snippet && (
                      <p className="magi-home-search-snippet reader-font-cn-body px-2 py-1.5 text-xs">…{snippet}…</p>
                    )}
                    {episodeLinks.length > 0 && isStoryOpen && (
                      <nav
                        id={storyContentId}
                        aria-label={`${label} Episode`}
                        className="magi-home-episode-list relative z-10 flex flex-wrap gap-1 border-t border-current/10 px-2 py-1 text-[10px] leading-relaxed"
                      >
                        {episodeLinks.map(episode => (
                          <Link
                            key={episode.anchorId}
                            href={`${storyHref}&section=${encodeURIComponent(episode.anchorId)}#${episode.anchorId}`}
                            prefetch={false}
                            data-section-anchor={episode.anchorId}
                            className="magi-home-episode-link rounded px-1.5 py-0.5 opacity-70 transition hover:opacity-100 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
                          >
                            <span className="magi-home-episode-branch" aria-hidden="true" />
                            <span className="magi-home-tree-episode-node" aria-hidden="true" />
                            <span className="magi-home-episode-label">{episode.title}</span>
                          </Link>
                        ))}
                      </nav>
                    )}
                    </article>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

function StableFolderColumns({
  groups,
  theme,
}: {
  groups: StoryGroup[];
  theme: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [columnCount, setColumnCount] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateColumnCount = () => {
      const width = container.clientWidth;
      const rootFontSize = Number.parseFloat(
        window.getComputedStyle(document.documentElement).fontSize,
      ) || 16;
      const minimumColumnWidth = 15 * rootFontSize;
      const gap = 0.58 * rootFontSize;
      const nextColumnCount = width <= 40 * rootFontSize
        ? 1
        : Math.max(
            1,
            Math.min(8, Math.floor((width + gap) / (minimumColumnWidth + gap))),
          );

      setColumnCount(current => current === nextColumnCount ? current : nextColumnCount);
    };

    updateColumnCount();
    const resizeObserver = new ResizeObserver(updateColumnCount);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  const columns = useMemo(() => {
    const nextColumns = Array.from(
      { length: Math.max(1, columnCount) },
      () => [] as StoryGroup[],
    );
    groups.forEach((group, index) => {
      nextColumns[index % nextColumns.length].push(group);
    });
    return nextColumns;
  }, [columnCount, groups]);

  return (
    <div
      ref={containerRef}
      className="magi-home-folder-columns"
      style={{
        '--magi-folder-column-count': columnCount,
      } as CSSProperties}
    >
      {columns.map((column, columnIndex) => (
        <div
          key={`stable-folder-column-${columnIndex}`}
          className="magi-home-folder-column"
        >
          {column.map(group => (
            <FolderCard key={group.key} group={group} theme={theme} />
          ))}
        </div>
      ))}
    </div>
  );
}

type CategoryNavProps = {
  categories: string[];
  activeCategory: string;
  selectedCategories: ReadonlySet<string>;
  sourceConnections: CategorySourceConnections;
  sourceFilterCounts: Record<string, CategorySourceFilterCounts>;
  sourceFilterProgress: Record<string, CategorySourceFilterProgress>;
  searchActive: boolean;
  theme: string;
  mobile?: boolean;
  mobileSourceRailOpen?: boolean;
  mobileLayout?: 'graph' | 'single-row';
  onSelect: (category: string) => void;
  onToggleCategory: (category: string) => void;
  onSelectSourceFilter: (filter: CategorySourceFilter) => void;
  onToggleSourceFilter: (
    category: string,
    filter: CategorySourceFilter,
  ) => void;
};

function CategoryNav({
  categories,
  activeCategory,
  selectedCategories,
  sourceConnections,
  sourceFilterCounts,
  sourceFilterProgress,
  searchActive,
  theme,
  mobile = false,
  mobileSourceRailOpen = true,
  mobileLayout = 'graph',
  onSelect,
  onToggleCategory,
  onSelectSourceFilter,
  onToggleSourceFilter,
}: CategoryNavProps) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(
    () => (!mobile && !searchActive ? activeCategory : null),
  );
  const navRef = useRef<HTMLElement | null>(null);
  const triggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const categorySelectRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const optionRefs = useRef<Array<HTMLElement | null>>([]);
  const anchorRefs = useRef<Array<Array<HTMLButtonElement | null>>>([]);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const mobileSvgRef = useRef<SVGSVGElement | null>(null);
  const overlayCategory = !mobile
    && !searchActive
    && expandedCategory === activeCategory
    ? expandedCategory
    : null;
  const [overlayLayout, setOverlayLayout] = useState({
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    menuLeft: 0,
    menuWidth: 0,
  });
  const [connectorGeometry, setConnectorGeometry] = useState<{
    overlayCategory: string | null;
    width: number;
    height: number;
    lines: Array<{
      category: string;
      optionIndex: number;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      anchorIndex: number;
      distance: number;
      slope: number;
    }>;
  }>({ overlayCategory: null, width: 0, height: 0, lines: [] });
  const [mobileConnectorGeometry, setMobileConnectorGeometry] = useState<{
    width: number;
    height: number;
    sourceLines: Array<{
      category: string;
      slotIndex: number;
      optionIndex: number;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }>;
  }>({ width: 0, height: 0, sourceLines: [] });

  const connectedCategoryOrder = useMemo(
    () => Array.from(selectedCategories).slice(0, MAX_CONNECTED_CATEGORIES),
    [selectedCategories],
  );

  const updateOverlayLayout = useCallback(() => {
    const nav = navRef.current;
    if (!nav || !overlayCategory || !categoryNavVisible(false)) return;

    const navRect = nav.getBoundingClientRect();
    const viewportWidth = nav.clientWidth;
    const viewportHeight = nav.clientHeight;
    if (viewportWidth <= 0 || viewportHeight <= 0) return;

    const widestTriggerRight = Array.from(triggerRefs.current.values()).reduce(
      (right, trigger) => Math.max(
        right,
        trigger.getBoundingClientRect().right - navRect.left,
      ),
      0,
    );
    const rightInset = 8;
    const connectorGap = 8;
    const minimumMenuWidth = Math.min(50, Math.max(1, viewportWidth - rightInset));
    const desiredMenuWidth = Math.min(56, Math.max(1, viewportWidth - rightInset * 2));
    const rightAlignedLeft = Math.max(
      0,
      viewportWidth - rightInset - desiredMenuWidth,
    );
    const blankAreaLeft = Math.max(0, widestTriggerRight + connectorGap);
    const latestMenuLeft = Math.min(
      Math.max(rightAlignedLeft, blankAreaLeft),
      Math.max(0, viewportWidth - rightInset - minimumMenuWidth),
    );
    const latestLayout = {
      top: nav.scrollTop,
      left: nav.scrollLeft,
      width: viewportWidth,
      height: viewportHeight,
      menuLeft: latestMenuLeft,
      menuWidth: Math.max(1, viewportWidth - rightInset - latestMenuLeft),
    };

    setOverlayLayout(current => (
      current.top === latestLayout.top
      && current.left === latestLayout.left
      && current.width === latestLayout.width
      && current.height === latestLayout.height
      && current.menuLeft === latestLayout.menuLeft
      && current.menuWidth === latestLayout.menuWidth
        ? current
        : latestLayout
    ));
  }, [overlayCategory]);

  const measureConnectorGeometry = useCallback(() => {
    const svg = svgRef.current;
    const anchors = CATEGORY_SOURCE_FILTERS.map((_, optionIndex) => (
      [0, 1, 2].map(anchorIndex => (
        anchorRefs.current[optionIndex]?.[anchorIndex] ?? null
      ))
    ));
    if (
      !svg
      || !categoryNavVisible(false)
      || connectedCategoryOrder.length === 0
      || connectedCategoryOrder.some(category => !categorySelectRefs.current.get(category))
      || anchors.some(optionAnchors => optionAnchors.some(anchor => !anchor))
    ) return;

    const svgRect = svg.getBoundingClientRect();
    if (svgRect.width <= 0 || svgRect.height <= 0) return;

    const latestGeometry = {
      overlayCategory,
      width: svgRect.width,
      height: svgRect.height,
      lines: connectedCategoryOrder.flatMap((category, categorySlot) => {
        const trigger = categorySelectRefs.current.get(category)!;
        const triggerRect = trigger.getBoundingClientRect();
        const x1 = triggerRect.left + triggerRect.width / 2 - svgRect.left;
        const y1 = triggerRect.top + triggerRect.height / 2 - svgRect.top;
        const anchorIndex = CATEGORY_ANCHOR_INDEX_BY_SLOT[categorySlot];
        return CATEGORY_SOURCE_FILTERS.map((_, optionIndex) => {
          const anchor = anchors[optionIndex][anchorIndex]!;
          const anchorRect = anchor.getBoundingClientRect();
          const x2 = anchorRect.left + anchorRect.width / 2 - svgRect.left;
          const y2 = anchorRect.top + anchorRect.height / 2 - svgRect.top;
          const dx = x2 - x1;
          const dy = y2 - y1;
          return {
            category,
            optionIndex,
            x1,
            y1,
            x2,
            y2,
            anchorIndex,
            distance: Math.hypot(dx, dy),
            slope: dy / (Math.abs(dx) < 0.001 ? 0.001 : dx),
          };
        });
      }),
    };

    setConnectorGeometry(current => {
      const unchanged = current.overlayCategory === latestGeometry.overlayCategory
        && current.width === latestGeometry.width
        && current.height === latestGeometry.height
        && current.lines.length === latestGeometry.lines.length
        && current.lines.every((line, index) => {
          const latestLine = latestGeometry.lines[index];
          return line.x1 === latestLine.x1
            && line.category === latestLine.category
            && line.optionIndex === latestLine.optionIndex
            && line.y1 === latestLine.y1
            && line.x2 === latestLine.x2
            && line.y2 === latestLine.y2
            && line.anchorIndex === latestLine.anchorIndex
            && line.distance === latestLine.distance
            && line.slope === latestLine.slope;
        });
      return unchanged ? current : latestGeometry;
    });
  }, [connectedCategoryOrder, overlayCategory]);

  useEffect(() => {
    if (!overlayCategory) return;

    const nav = navRef.current;
    if (!nav) return;
    let animationFrame = 0;
    const refreshGeometry = () => {
      updateOverlayLayout();
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(measureConnectorGeometry);
    };

    refreshGeometry();
    nav.addEventListener('scroll', refreshGeometry, { passive: true });
    window.addEventListener('resize', refreshGeometry);
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(refreshGeometry);
    if (resizeObserver) {
      resizeObserver.observe(nav);
      triggerRefs.current.forEach(trigger => resizeObserver.observe(trigger));
      categorySelectRefs.current.forEach(selector => resizeObserver.observe(selector));
      optionRefs.current.forEach((option) => {
        if (option) resizeObserver.observe(option);
      });
      anchorRefs.current.forEach((optionAnchors) => {
        optionAnchors.forEach((anchor) => {
          if (anchor) resizeObserver.observe(anchor);
        });
      });
    }

    return () => {
      window.cancelAnimationFrame(animationFrame);
      nav.removeEventListener('scroll', refreshGeometry);
      window.removeEventListener('resize', refreshGeometry);
      resizeObserver?.disconnect();
    };
  }, [
    categories,
    measureConnectorGeometry,
    overlayCategory,
    updateOverlayLayout,
  ]);

  useEffect(() => {
    if (!overlayCategory) return;
    const animationFrame = window.requestAnimationFrame(measureConnectorGeometry);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [measureConnectorGeometry, overlayCategory, overlayLayout]);

  const measureMobileConnectorGeometry = useCallback(() => {
    const nav = navRef.current;
    const svg = mobileSvgRef.current;
    if (
      !mobile
      || !categoryNavVisible(true)
      || !mobileSourceRailOpen
      || mobileLayout !== 'graph'
      || !nav
      || !svg
    ) return;

    // The auto-sized grid owns the canvas; its old absolute SVG must not
    // inflate scrollHeight. Read the grid once, then let React publish changes.
    // Do not hide/resize the SVG between layout reads: Safari rerasterizes the
    // complete optical surface for each write/read cycle.
    const width = nav.clientWidth;
    const height = nav.clientHeight;
    if (width <= 0 || height <= 0) return;

    const navRect = nav.getBoundingClientRect();
    const centerOf = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2 - navRect.left + nav.scrollLeft,
        y: rect.top + rect.height / 2 - navRect.top + nav.scrollTop,
      };
    };
    const sourceLines: Array<{
      category: string;
      slotIndex: number;
      optionIndex: number;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }> = [];

    connectedCategoryOrder.forEach((category, slotIndex) => {
      const categoryNode = categorySelectRefs.current.get(category);
      if (!categoryNode) return;
      const categoryPoint = centerOf(categoryNode);
      const anchorIndex = CATEGORY_ANCHOR_INDEX_BY_SLOT[slotIndex];

      CATEGORY_SOURCE_FILTERS.forEach((_, optionIndex) => {
        const anchor = anchorRefs.current[optionIndex]?.[anchorIndex];
        if (!anchor) return;
        const anchorPoint = centerOf(anchor);
        sourceLines.push({
          category,
          slotIndex,
          optionIndex,
          x1: categoryPoint.x,
          y1: categoryPoint.y,
          x2: anchorPoint.x,
          y2: anchorPoint.y,
        });
      });
    });

    setMobileConnectorGeometry(current => {
      const unchanged = current.width === width && current.height === height
        && current.sourceLines.length === sourceLines.length
        && current.sourceLines.every((line, index) => {
          const next = sourceLines[index];
          return line.category === next.category && line.slotIndex === next.slotIndex
            && line.optionIndex === next.optionIndex && line.x1 === next.x1
            && line.y1 === next.y1 && line.x2 === next.x2 && line.y2 === next.y2;
        });
      return unchanged ? current : { width, height, sourceLines };
    });
  }, [connectedCategoryOrder, mobile, mobileLayout, mobileSourceRailOpen]);

  useEffect(() => {
    if (!mobile || !mobileSourceRailOpen || mobileLayout !== 'graph') {
      queueMicrotask(() => {
        setMobileConnectorGeometry({
          width: 0,
          height: 0,
          sourceLines: [],
        });
      });
      return;
    }

    const nav = navRef.current;
    if (!nav) return;
    let animationFrame = 0;
    const refreshGeometry = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        measureMobileConnectorGeometry();
      });
    };

    refreshGeometry();
    nav.addEventListener('scroll', refreshGeometry, { passive: true });
    window.addEventListener('resize', refreshGeometry);
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(refreshGeometry);
    if (resizeObserver) {
      resizeObserver.observe(nav);
      categorySelectRefs.current.forEach(node => resizeObserver.observe(node));
      anchorRefs.current.forEach((optionAnchors) => {
        optionAnchors.forEach((anchor) => {
          if (anchor) resizeObserver.observe(anchor);
        });
      });
    }

    return () => {
      window.cancelAnimationFrame(animationFrame);
      nav.removeEventListener('scroll', refreshGeometry);
      window.removeEventListener('resize', refreshGeometry);
      resizeObserver?.disconnect();
    };
  }, [
    categories,
    measureMobileConnectorGeometry,
    mobile,
    mobileLayout,
    mobileSourceRailOpen,
    selectedCategories,
  ]);

  const overlayConfig = overlayCategory
    ? CATEGORY_CONFIG[overlayCategory] || { label: overlayCategory, icon: Folder }
    : null;
  const disabledBranchPalette = {
    background: 'var(--magi-category-disabled-surface, rgba(214, 218, 218, 0.9))',
    border: 'var(--magi-category-disabled-edge, rgba(104, 111, 112, 0.44))',
    text: 'var(--magi-category-disabled-text, rgba(72, 78, 80, 0.58))',
    line: 'var(--magi-category-disabled-line, rgba(96, 103, 104, 0.4))',
  };

  const sourceFilterStateFor = (option: {
    value: CategorySourceFilter;
    label: string;
  }) => {
    const enabled = connectedCategoryOrder.some(category => (
      sourceFilterCounts[category]?.[option.value] ?? 0
    ) > 0);
    const selected = connectedCategoryOrder.some(category => (
      sourceConnections.get(category)?.has(option.value) ?? false
    ));
    const progressMetric = connectedCategoryOrder.reduce<CategorySourceProgressMetric>(
      (combined, category) => {
        const categoryProgress = sourceFilterProgress[category]?.[option.value];
        if (!categoryProgress) return combined;
        return {
          value: combined.value + categoryProgress.value,
          maximum: combined.maximum + categoryProgress.maximum,
          chapters: combined.chapters + categoryProgress.chapters,
          available: combined.available && categoryProgress.available,
        };
      },
      { value: 0, maximum: 0, chapters: 0, available: true },
    );
    const progressPercent = option.value === 'needs-review'
      && progressMetric.available
      && progressMetric.maximum > 0
      ? 100 - categorySourceProgressPercent({
          ...progressMetric,
          value: progressMetric.maximum - progressMetric.value,
        })
      : categorySourceProgressPercent(progressMetric);
    const progressText = categorySourceProgressText(
      option.value,
      progressMetric,
      progressPercent,
    );
    const progressBasis = option.value === 'all' ? 'native-slot-percent-average' : 'native-story-share';

    return {
      enabled,
      selected,
      progressMetric,
      progressPercent,
      progressText,
      progressBasis,
    };
  };
  const mobileCategorySplit = Math.max(1, Math.ceil(categories.length / 2));
  const mobileCategoryRowSize = mobileLayout === 'single-row'
    ? Math.max(1, categories.length)
    : mobileCategorySplit;
  const mobileSourceInsertIndex = mobileLayout === 'single-row'
    ? categories.length
    : mobileCategorySplit;
  const mobileSourceSelectable = connectedCategoryOrder.length > 0;
  const mobileSourceFilterRow = mobile && mobileSourceRailOpen ? (
    <div
      id="mobile-category-source-rail"
      role="group"
      aria-label="当前分类译文状态"
      className="magi-home-mobile-source-filter-row"
      data-mobile-layout={mobileLayout}
    >
      {CATEGORY_SOURCE_FILTERS.map((option, optionIndex) => {
        const {
          enabled,
          selected,
          progressMetric,
          progressPercent,
          progressText,
          progressBasis,
        } = sourceFilterStateFor(option);
        return (
          <div
            key={option.value}
            ref={(node) => {
              optionRefs.current[optionIndex] = node;
            }}
            className="magi-home-category-filter magi-home-mobile-source-filter relative rounded text-left text-[11px] font-bold transition"
            data-category={activeCategory}
            data-filter={option.value}
            data-filter-index={optionIndex}
            data-enabled={mobileSourceSelectable ? 'true' : 'false'}
            data-source-available={enabled ? 'true' : 'false'}
            data-selected={selected ? 'true' : 'false'}
            data-progress-percent={progressPercent}
            data-progress-basis={progressBasis}
            data-progress-available={progressMetric.available ? 'true' : 'false'}
            style={{
              '--magi-category-filter-progress': `${progressPercent}%`,
            } as CSSProperties}
          >
            <button
              type="button"
              disabled={!mobileSourceSelectable}
              aria-label={`${option.label}单选`}
              aria-pressed={selected}
              title={progressText}
              onClick={() => onSelectSourceFilter(option.value)}
              className="magi-home-category-filter-hit absolute inset-0 z-[2] rounded-[inherit] border-0 bg-transparent p-0"
            />
            <output
              className="sr-only"
              role="progressbar"
              aria-label={`${option.label}进度`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressMetric.available && progressMetric.maximum > 0
                ? progressPercent
                : undefined}
              aria-valuetext={progressText}
            >
              {progressText}
            </output>
            {mobileLayout === 'graph' && (
              <span
                className="magi-home-category-filter-anchor-set magi-home-mobile-source-anchor-set pointer-events-none absolute inset-0"
                style={{
                  color: enabled
                    ? 'var(--magi-category-branch-line, currentColor)'
                    : disabledBranchPalette.line,
                  overflow: 'visible',
                }}
              >
                {[18, 50, 82].map((leftPercent, anchorIndex) => {
                  const categorySlot = CATEGORY_ANCHOR_INDEX_BY_SLOT.findIndex(
                    candidate => candidate === anchorIndex,
                  );
                  const anchorCategory = connectedCategoryOrder[categorySlot];
                  const anchorAvailable = Boolean(
                    anchorCategory
                    && (sourceFilterCounts[anchorCategory]?.[option.value] ?? 0) > 0,
                  );
                  const anchorSelected = Boolean(
                    anchorCategory
                    && sourceConnections.get(anchorCategory)?.has(option.value),
                  );
                  return (
                    <button
                      ref={(node) => {
                        const optionAnchors = anchorRefs.current[optionIndex]
                          ?? (anchorRefs.current[optionIndex] = []);
                        optionAnchors[anchorIndex] = node;
                      }}
                      key={leftPercent}
                      type="button"
                      disabled={!anchorCategory}
                      aria-label={anchorCategory
                        ? `${anchorSelected ? '取消' : '连接'}${CATEGORY_CONFIG[anchorCategory]?.label ?? anchorCategory}与${option.label}`
                        : `${option.label}空连接位`}
                      aria-pressed={anchorSelected}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (anchorCategory) {
                          onToggleSourceFilter(anchorCategory, option.value);
                        }
                      }}
                      onKeyDown={event => event.stopPropagation()}
                      className="magi-home-category-filter-anchor-dot magi-home-mobile-source-anchor-dot pointer-events-auto absolute grid place-items-center"
                      data-anchor-index={anchorIndex}
                      data-anchor-position={['left', 'middle', 'right'][anchorIndex]}
                      data-connected={anchorCategory ? 'true' : 'false'}
                      data-selected={anchorSelected ? 'true' : 'false'}
                      data-enabled={anchorAvailable ? 'true' : 'false'}
                      data-anchor-kind={anchorIndex === 1 ? 'connector' : 'selector'}
                      style={{ left: `${leftPercent}%` }}
                    >
                      <span aria-hidden="true" className="magi-home-category-filter-anchor-glyph" />
                    </button>
                  );
                })}
              </span>
            )}
            <span className="magi-home-mobile-source-filter-label">
              {option.label}
            </span>
          </div>
        );
      })}
    </div>
  ) : null;

  return (
    <nav
      ref={navRef}
      className={
        mobile
          ? 'magi-home-mobile-category-nav relative overflow-x-auto overflow-y-hidden p-2 gap-2 bg-inherit border-b border-black/5'
          : 'magi-home-category-nav relative flex-1 overflow-y-auto p-2 space-y-1'
      }
      data-mobile-layout={mobile ? mobileLayout : undefined}
      style={mobile
        ? {
            '--magi-category-columns': mobileCategoryRowSize,
            gridTemplateColumns: mobileLayout === 'single-row'
              ? `repeat(${mobileCategoryRowSize}, max-content)`
              : `repeat(${mobileCategoryRowSize}, minmax(0, 1fr))`,
          } as CSSProperties
        : undefined}
    >
      {categories.map((category, categoryIndex) => {
        const config = CATEGORY_CONFIG[category] || { label: category, icon: Folder };
        const Icon = config.icon;
        const isActive = activeCategory === category && !searchActive;
        const isSelected = selectedCategories.has(category);
        const isExpanded = !mobile
          && !searchActive
          && expandedCategory === category;
        const activeClass =
          isNightTheme(theme)
            ? 'bg-emerald-900/50 text-emerald-400 border-emerald-500'
            : isDayArchiveTheme(theme)
              ? 'magi-home-light-nav-active'
              : 'bg-emerald-50 text-emerald-700 border-emerald-500';

        return (
          <Fragment key={category}>
            {mobile
              && categoryIndex === mobileSourceInsertIndex
              && mobileSourceFilterRow}
            <div
              className="magi-home-category-node relative flex w-full items-start"
              data-category={category}
              data-active={isActive ? 'true' : 'false'}
              data-selected={isSelected ? 'true' : 'false'}
              data-expanded={isExpanded ? 'true' : 'false'}
            >
              <button
              ref={(node) => {
                if (node) {
                  triggerRefs.current.set(category, node);
                } else {
                  triggerRefs.current.delete(category);
                }
              }}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              aria-expanded={mobile ? undefined : isExpanded}
              aria-controls={mobile ? undefined : `category-filters-${category}`}
              onClick={() => {
                if (mobile) {
                  onSelect(category);
                  return;
                }
                setConnectorGeometry({
                  overlayCategory: null,
                  width: 0,
                  height: 0,
                  lines: [],
                });
                if (isActive) {
                  onSelect(category);
                  setExpandedCategory(current => current === category ? null : category);
                  return;
                }
                onSelect(category);
                setExpandedCategory(category);
              }}
              className={`magi-home-category-trigger relative z-10 inline-flex w-max max-w-full shrink-0 items-center gap-1.5 px-2 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap ${
                mobile ? 'border-b-2 rounded-none' : 'border-l-4'
              } ${
                isSelected
                  ? activeClass
                  : isDayArchiveTheme(theme)
                    ? 'magi-home-light-nav-item border-transparent'
                    : 'text-gray-500 hover:bg-black/5 border-transparent'
              }`}
              style={{ width: 'max-content', maxWidth: '100%', flex: '0 0 auto' }}
              data-selected={isSelected ? 'true' : 'false'}
            >
              <Icon size={16} />
              <span>{config.label}</span>
              {!mobile && (
                <ChevronDown
                  aria-hidden="true"
                  size={13}
                  className={`magi-home-category-disclosure ml-0.5 transition-transform ${
                    isExpanded ? 'rotate-180' : ''
                  }`}
                />
              )}
              </button>
              {(!mobile || (mobileSourceRailOpen && mobileLayout === 'graph')) && (
                <button
                ref={(node) => {
                  if (node) {
                    categorySelectRefs.current.set(category, node);
                  } else {
                    categorySelectRefs.current.delete(category);
                  }
                }}
                type="button"
                aria-label={`${isSelected ? '取消' : '加入'}${config.label}多选`}
                aria-pressed={isSelected}
                disabled={!isSelected && selectedCategories.size >= MAX_CONNECTED_CATEGORIES}
                title={!isSelected && selectedCategories.size >= MAX_CONNECTED_CATEGORIES
                  ? `最多同时连接 ${MAX_CONNECTED_CATEGORIES} 个分类`
                  : undefined}
                data-category={category}
                data-selected={isSelected ? 'true' : 'false'}
                className={mobile
                  ? `magi-home-category-select-box magi-home-mobile-category-select-box absolute z-20 inline-grid shrink-0 place-items-center border ${
                      categoryIndex < mobileCategorySplit
                        ? 'magi-home-mobile-category-select-box--below'
                        : 'magi-home-mobile-category-select-box--above'
                    }`
                  : 'magi-home-category-select-box relative z-20 ml-1 mt-2 inline-grid shrink-0 place-items-center border'}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleCategory(category);
                }}
              >
                <span aria-hidden="true" className="magi-home-category-select-square" />
                </button>
              )}
            </div>
          </Fragment>
        );
      })}
      {mobile
        && mobileSourceInsertIndex === categories.length
        && mobileSourceFilterRow}
      {mobile && mobileSourceRailOpen && mobileLayout === 'graph' && (
        <svg
          ref={mobileSvgRef}
          className="magi-home-mobile-connector-layer pointer-events-none absolute left-0 top-0 z-0 overflow-visible"
          width={mobileConnectorGeometry.width || 1}
          height={mobileConnectorGeometry.height || 1}
          viewBox={`0 0 ${mobileConnectorGeometry.width || 1} ${mobileConnectorGeometry.height || 1}`}
          preserveAspectRatio="none"
          role="group"
          aria-label="移动端分类与译文来源连接线"
        >
          {mobileConnectorGeometry.sourceLines.map((line) => {
            const filter = CATEGORY_SOURCE_FILTERS[line.optionIndex].value;
            const lineEnabled = (
              sourceFilterCounts[line.category]?.[filter] ?? 0
            ) > 0;
            const lineSelected = sourceConnections.get(line.category)?.has(filter) ?? false;
            const dx = line.x2 - line.x1;
            const dy = line.y2 - line.y1;
            const connectorLength = Math.max(1, Math.hypot(dx, dy));
            const normalX = -dy / connectorLength;
            const normalY = dx / connectorLength;
            const bendDirection = (line.optionIndex + line.slotIndex) % 2 === 0 ? 1 : -1;
            const bend = Math.min(9, Math.max(1.8, connectorLength * 0.045)) * bendDirection;
            const connectorPath = theme !== 'frost'
              ? `M ${line.x1.toFixed(2)} ${line.y1.toFixed(2)} L ${line.x2.toFixed(2)} ${line.y2.toFixed(2)}`
              : [
              `M ${line.x1.toFixed(2)} ${line.y1.toFixed(2)}`,
              `C ${(line.x1 + dx * 0.33 + normalX * bend).toFixed(2)} ${(line.y1 + dy * 0.33 + normalY * bend).toFixed(2)}`,
              `${(line.x1 + dx * 0.69 + normalX * bend * 0.68).toFixed(2)} ${(line.y1 + dy * 0.69 + normalY * bend * 0.68).toFixed(2)}`,
              `${line.x2.toFixed(2)} ${line.y2.toFixed(2)}`,
            ].join(' ');
            return (
              <g key={`source:${line.category}:${filter}`}>
                <path
                  className="magi-home-category-branch-line magi-home-mobile-source-line"
                  data-category={line.category}
                  data-filter-index={line.optionIndex}
                  data-slot-index={line.slotIndex}
                  data-connector-shape={theme === 'frost' ? 'curved' : 'straight'}
                  data-enabled={lineEnabled ? 'true' : 'false'}
                  data-selected={lineSelected ? 'true' : 'false'}
                  d={connectorPath}
                  fill="none"
                />
                {lineSelected && (
                  <path
                    className="magi-home-category-branch-line-hit"
                    aria-label={`取消${CATEGORY_CONFIG[line.category]?.label ?? line.category}与${CATEGORY_SOURCE_FILTERS[line.optionIndex].label}连接`}
                    role="button"
                    tabIndex={0}
                    d={connectorPath}
                    fill="none"
                    onClick={() => onToggleSourceFilter(line.category, filter)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onToggleSourceFilter(line.category, filter);
                      }
                    }}
                  />
                )}
              </g>
            );
          })}
        </svg>
      )}
      {overlayCategory && overlayConfig && (
        <div
          ref={overlayRef}
          className="magi-home-category-branch-overlay pointer-events-none absolute z-[80] overflow-visible"
          data-category={overlayCategory}
          data-overlay="true"
          data-overlay-placement="viewport-top"
          style={{
            top: overlayLayout.top,
            left: overlayLayout.left,
            width: overlayLayout.width,
            height: overlayLayout.height,
            margin: 0,
            pointerEvents: 'none',
            visibility: connectorGeometry.overlayCategory === overlayCategory
              && connectorGeometry.lines.length
                === connectedCategoryOrder.length * CATEGORY_SOURCE_FILTERS.length
              ? 'visible'
              : 'hidden',
          }}
        >
          <svg
            ref={svgRef}
            className="magi-home-category-overlay-lines pointer-events-none absolute inset-0 h-full w-full overflow-visible"
            viewBox={`0 0 ${connectorGeometry.width || overlayLayout.width || 1} ${
              connectorGeometry.height || overlayLayout.height || 1
            }`}
            preserveAspectRatio="none"
            role="group"
            aria-label="分类与译文来源连接线"
            style={{
              color: 'var(--magi-category-branch-line, rgba(57, 66, 68, 0.58))',
              overflow: 'visible',
              zIndex: 0,
            }}
          >
            {connectorGeometry.lines.map((line) => {
              const filter = CATEGORY_SOURCE_FILTERS[line.optionIndex].value;
              const lineEnabled = (
                sourceFilterCounts[line.category]?.[filter] ?? 0
              ) > 0;
              const lineSelected = sourceConnections.get(line.category)?.has(filter) ?? false;
              const dx = line.x2 - line.x1;
              const dy = line.y2 - line.y1;
              const connectorLength = Math.max(1, Math.hypot(dx, dy));
              const normalX = -dy / connectorLength;
              const normalY = dx / connectorLength;
              const bendDirection = (line.optionIndex + line.anchorIndex) % 2 === 0 ? 1 : -1;
              const bend = (
                theme === 'frost'
                  ? Math.min(42, Math.max(7, connectorLength * 0.145))
                  : Math.min(13, Math.max(2.5, connectorLength * 0.052))
              ) * bendDirection;
              const connectorPath = theme === 'frost'
                ? [
                    `M ${line.x1.toFixed(2)} ${line.y1.toFixed(2)}`,
                    `C ${(line.x1 + dx * 0.24 + normalX * bend).toFixed(2)} ${(line.y1 + dy * 0.24 + normalY * bend).toFixed(2)}`,
                    `${(line.x1 + dx * 0.72 - normalX * bend * 0.48).toFixed(2)} ${(line.y1 + dy * 0.72 - normalY * bend * 0.48).toFixed(2)}`,
                    `${line.x2.toFixed(2)} ${line.y2.toFixed(2)}`,
                  ].join(' ')
                : `M ${line.x1} ${line.y1} L ${line.x2} ${line.y2}`;
              return (
                <g key={`${line.category}:${filter}`}>
                  {theme === 'frost' && (
                    <>
                      <path
                        className="magi-home-category-branch-echo magi-home-category-branch-echo--bloom"
                        data-filter-index={line.optionIndex}
                        data-selected={lineSelected ? 'true' : 'false'}
                        d={connectorPath}
                        fill="none"
                      />
                      <path
                        aria-hidden="true"
                        className="magi-home-category-branch-echo magi-home-category-branch-echo--fringe-a"
                        data-filter-index={line.optionIndex}
                        data-selected={lineSelected ? 'true' : 'false'}
                        d={connectorPath}
                        fill="none"
                        transform={`translate(${line.optionIndex % 2 === 0 ? '-0.72 0.38' : '0.66 -0.44'})`}
                      />
                      <path
                        aria-hidden="true"
                        className="magi-home-category-branch-echo magi-home-category-branch-echo--fringe-b"
                        data-filter-index={line.optionIndex}
                        data-selected={lineSelected ? 'true' : 'false'}
                        d={connectorPath}
                        fill="none"
                        transform={`translate(${line.optionIndex % 2 === 0 ? '0.54 -0.63' : '-0.58 0.57'})`}
                      />
                    </>
                  )}
                  <path
                    className="magi-home-category-branch-line"
                    data-category={line.category}
                    data-filter-index={line.optionIndex}
                    data-connector-shape={theme === 'frost' ? 'curved' : 'straight'}
                    data-anchor-index={line.anchorIndex}
                    data-anchor-position={['top', 'middle', 'bottom'][line.anchorIndex]}
                    data-connector-distance={line.distance}
                    data-connector-slope={line.slope}
                    data-enabled={lineEnabled ? 'true' : 'false'}
                    data-selected={lineSelected ? 'true' : 'false'}
                    d={connectorPath}
                    fill="none"
                    style={{
                      animation: 'none',
                      opacity: 1,
                      stroke: lineEnabled
                        ? theme === 'frost'
                          ? `url(#magi-frost-source-line${lineSelected ? '-active' : ''}-${line.optionIndex})`
                          : lineSelected
                            ? 'var(--magi-category-branch-selected-line, var(--magi-category-branch-line, rgba(57, 66, 68, 0.92)))'
                            : 'var(--magi-category-branch-line, rgba(57, 66, 68, 0.78))'
                        : disabledBranchPalette.line,
                      strokeDasharray: 'none',
                      strokeDashoffset: 0,
                      strokeLinecap: 'round',
                      strokeWidth: 1.1,
                    }}
                  />
                  {lineEnabled && lineSelected && (
                    <path
                      className="magi-home-category-branch-line-hit"
                      aria-label={`取消${CATEGORY_CONFIG[line.category]?.label ?? line.category}与${CATEGORY_SOURCE_FILTERS[line.optionIndex].label}连接`}
                      role="button"
                      tabIndex={0}
                      d={connectorPath}
                      fill="none"
                      onClick={() => onToggleSourceFilter(line.category, filter)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onToggleSourceFilter(line.category, filter);
                        }
                      }}
                    />
                  )}
                </g>
              );
            })}
          </svg>
          <div
            id={`category-filters-${overlayCategory}`}
            role="group"
            aria-label={`${overlayConfig.label}译文状态`}
            className="magi-home-category-filter-overlay-menu pointer-events-auto absolute top-2 z-10 grid min-w-0 gap-1"
            data-category={overlayCategory}
            data-overlay="true"
            style={{
              left: overlayLayout.menuLeft,
              width: overlayLayout.menuWidth,
              maxWidth: `calc(100% - ${overlayLayout.menuLeft}px)`,
              top: 8,
              height: `calc(100% - 16px)`,
              gridAutoRows: 'max-content',
              alignContent: 'space-evenly',
              justifyItems: 'end',
              pointerEvents: 'auto',
            }}
          >
            {CATEGORY_SOURCE_FILTERS.map((option, optionIndex) => {
              const {
                enabled,
                selected,
                progressMetric,
                progressPercent,
                progressText,
                progressBasis,
              } = sourceFilterStateFor(option);
              return (
                <div
                  ref={(node) => {
                    optionRefs.current[optionIndex] = node;
                  }}
                  key={option.value}
                  className="magi-home-category-filter relative min-w-0 rounded px-2 py-1 text-left text-[11px] font-bold transition"
                  data-category={overlayCategory}
                  data-filter={option.value}
                  data-filter-index={optionIndex}
                  data-connector-shape={optionIndex === 0 ? 'straight' : 'diagonal'}
                  data-enabled={enabled ? 'true' : 'false'}
                  data-selected={selected ? 'true' : 'false'}
                  data-progress-percent={progressPercent}
                  data-progress-basis={progressBasis}
                  data-progress-available={progressMetric.available ? 'true' : 'false'}
                  style={{
                    '--magi-category-filter-progress': `${progressPercent}%`,
                    background: enabled ? undefined : disabledBranchPalette.background,
                    borderColor: enabled ? undefined : disabledBranchPalette.border,
                    color: enabled ? undefined : disabledBranchPalette.text,
                    gridTemplateColumns: 'minmax(0, 1fr)',
                    justifyItems: 'center',
                    minHeight: 'max-content',
                    height: 'max-content',
                    width: 'max-content',
                    minWidth: 30,
                    maxWidth: '100%',
                    alignSelf: 'start',
                    justifySelf: 'end',
                    opacity: 1,
                  } as CSSProperties}
                >
                  <button
                    type="button"
                    disabled={!enabled}
                    aria-label={`${option.label}单选`}
                    aria-pressed={selected}
                    onClick={() => onSelectSourceFilter(option.value)}
                    className="magi-home-category-filter-hit absolute inset-0 z-[2] rounded-[inherit] border-0 bg-transparent p-0"
                  />
                  <output
                    className="sr-only"
                    role="progressbar"
                    aria-label={`${option.label}进度`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progressMetric.available && progressMetric.maximum > 0
                      ? progressPercent
                      : undefined}
                    aria-valuetext={progressText}
                  >
                    {progressText}
                  </output>
                  <span
                    className="magi-home-category-filter-anchor-set pointer-events-none absolute inset-0"
                    style={{
                      color: enabled
                        ? 'var(--magi-category-branch-line, currentColor)'
                        : disabledBranchPalette.line,
                      overflow: 'visible',
                      textOverflow: 'clip',
                    }}
                  >
                    {[18, 50, 82].map((topPercent, anchorIndex) => {
                      const categorySlot = CATEGORY_ANCHOR_INDEX_BY_SLOT.findIndex(
                        candidate => candidate === anchorIndex,
                      );
                      const anchorCategory = connectedCategoryOrder[categorySlot];
                      const anchorEnabled = Boolean(
                        anchorCategory
                        && (sourceFilterCounts[anchorCategory]?.[option.value] ?? 0) > 0,
                      );
                      const anchorSelected = Boolean(
                        anchorCategory
                        && sourceConnections.get(anchorCategory)?.has(option.value),
                      );
                      return (
                        <button
                          ref={(node) => {
                            const optionAnchors = anchorRefs.current[optionIndex]
                              ?? (anchorRefs.current[optionIndex] = []);
                            optionAnchors[anchorIndex] = node;
                          }}
                          key={topPercent}
                          type="button"
                          disabled={!anchorEnabled}
                          aria-label={anchorCategory
                            ? `${anchorSelected ? '取消' : '连接'}${CATEGORY_CONFIG[anchorCategory]?.label ?? anchorCategory}与${option.label}`
                            : `${option.label}空连接位`}
                          aria-pressed={anchorSelected}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (anchorCategory) {
                              onToggleSourceFilter(anchorCategory, option.value);
                            }
                          }}
                          onKeyDown={event => event.stopPropagation()}
                          className="magi-home-category-filter-anchor-dot pointer-events-auto absolute grid place-items-center"
                          data-anchor-index={anchorIndex}
                          data-anchor-position={['top', 'middle', 'bottom'][anchorIndex]}
                          data-connected={anchorCategory ? 'true' : 'false'}
                          data-selected={anchorSelected ? 'true' : 'false'}
                          data-enabled={anchorEnabled ? 'true' : 'false'}
                          data-anchor-kind={anchorIndex === 1 ? 'connector' : 'selector'}
                          style={{
                            left: -1,
                            top: `${topPercent}%`,
                            width: 22,
                            height: 22,
                            overflow: 'visible',
                            transform: 'translate(-50%, -50%)',
                          }}
                        >
                          <span aria-hidden="true" className="magi-home-category-filter-anchor-glyph" />
                        </button>
                      );
                    })}
                  </span>
                  <span
                    className="magi-home-category-filter-label relative z-[1] min-w-0"
                    style={{
                      overflow: 'visible',
                      textOverflow: 'clip',
                      whiteSpace: 'normal',
                      writingMode: 'vertical-rl',
                      textOrientation: 'upright',
                      overflowWrap: 'normal',
                      justifySelf: 'center',
                      pointerEvents: 'none',
                    }}
                  >
                    {option.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </nav>
  );
}

function FrostHome() {
  const { theme, setTheme, lastCategory: storedCategory, setLastCategory } = useGlobal();
  const lastCategory = genericCategory(storedCategory);
  useEffect(() => { if (storedCategory !== lastCategory) setLastCategory(lastCategory); }, [storedCategory, lastCategory, setLastCategory]);
  const [stories, setStories] = useState<Story[]>([]);
  const [storyIndexSha256, setStoryIndexSha256] = useState('');
  const [loading, setLoading] = useState(true);
  const [storyError, setStoryError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [searchIndexBytes, setSearchIndexBytes] = useState(0);
  const [textMatches, setTextMatches] = useState<Record<string, string>>({});
  const [aboutOpen, setAboutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchJp, setSearchJp] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>('title');
  const [searchRetryAttempt, setSearchRetryAttempt] = useState(0);
  const latestSearchRef = useRef({ term: '', mode: 'title' as SearchMode, includeJapanese: false });
  const [proofreadingStatus, setProofreadingStatus] = useState<ProofreadingStatus | null>(null);
  const [progressError, setProgressError] = useState('');
  const [progressAttempt, setProgressAttempt] = useState(0);
  const [onlyNeedsReview, setOnlyNeedsReview] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    () => new Set([lastCategory]),
  );
  const [sourceConnections, setSourceConnections] = useState<
    Map<string, Set<CategorySourceFilter>>
  >(() => new Map([[lastCategory, createAllSourceConnection()]]));
  const machineReviewPanelCollapsed = useSyncExternalStore(
    subscribeMachineReviewPanel,
    getMachineReviewPanelSnapshot,
    getMachineReviewPanelServerSnapshot,
  );
  const machineReviewPanelContentId = useId();
  const workerRef = useRef<SearchWorkerClient | null>(null);
  const searchModeRef = useRef<SearchMode>('title');
  const [searchIndexStatus, setSearchIndexStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [searchIndexProgress, setSearchIndexProgress] = useState(0);
  useEffect(() => {
    if (searchIndexStatus !== 'ready') return;
    const timer = window.setTimeout(() => setSearchIndexStatus('idle'), 1600);
    return () => window.clearTimeout(timer);
  }, [searchIndexStatus]);
  const searchSequenceRef = useRef(0);
  const [homeSidebarWidth, setHomeSidebarWidth] = useState(
    HOME_SIDEBAR_WIDTH_DEFAULT,
  );
  const homeSidebarWidthRef = useRef(HOME_SIDEBAR_WIDTH_DEFAULT);
  const homeSidebarResizeCleanupRef = useRef<(() => void) | null>(null);
  const startupSourceDefaultAppliedRef = useRef(false);
  const [mobileReviewPlacement, setMobileReviewPlacement] =
    useState<MobileReviewPlacement>('floating');
  const [mobileCategoryLayout, setMobileCategoryLayout] =
    useState<MobileCategoryLayout>('graph');
  const [mobileSourceRailOpen, setMobileSourceRailOpen] = useState(true);
  const [reviewDragPosition, setReviewDragPosition] =
    useState<{ x: number; y: number } | null>(null);
  const reviewDragStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const reviewDraggingRef = useRef(false);
  const reviewSuppressClickRef = useRef(false);
  const homeToolbarRef = useRef<HTMLDivElement>(null);
  const homeHeadingRef = useRef<HTMLDivElement>(null);

  const compactSearchCharacters = Math.min(
    24,
    Math.max(
      9,
      Array.from(
        searchTerm ||
          (searchLoading ? '正在准备正文搜索' : '搜索标题或正文'),
      ).length + 2,
    ),
  );

  useEffect(() => {
    const restoreFrame = window.requestAnimationFrame(() => {
      let restoredWidth = HOME_SIDEBAR_WIDTH_DEFAULT;
      try {
        restoredWidth = parseStoredHomeSidebarWidth(
          window.localStorage.getItem(HOME_SIDEBAR_WIDTH_STORAGE_KEY),
        );
      } catch {
        // The default remains usable if storage is unavailable.
      }
      homeSidebarWidthRef.current = restoredWidth;
      setHomeSidebarWidth(restoredWidth);
    });
    return () => {
      window.cancelAnimationFrame(restoreFrame);
      homeSidebarResizeCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(
        MOBILE_REVIEW_PLACEMENT_STORAGE_KEY,
      );
      if (stored === 'toolbar' || stored === 'floating') {
        // This one-time client preference hydration intentionally runs after mount.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMobileReviewPlacement(stored);
      }
    } catch {
      // The floating placement remains the safe compact default.
    }
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(
        MOBILE_CATEGORY_LAYOUT_STORAGE_KEY,
      );
      if (stored === 'graph' || stored === 'single-row') {
        // Restore the user's compact navigation choice after hydration.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMobileCategoryLayout(stored);
      }
    } catch {
      // The double-row graph remains the default when storage is unavailable.
    }
  }, []);

  const commitHomeSidebarWidth = useCallback((value: number) => {
    const bounded = clampHomeSidebarWidth(value);
    homeSidebarWidthRef.current = bounded;
    setHomeSidebarWidth(bounded);
    try {
      window.localStorage.setItem(HOME_SIDEBAR_WIDTH_STORAGE_KEY, String(bounded));
    } catch {
      // Resizing remains available even when persistence is blocked.
    }
  }, []);

  const beginHomeSidebarResize = useCallback((
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    homeSidebarResizeCleanupRef.current?.();

    const startX = event.clientX;
    const startWidth = homeSidebarWidthRef.current;
    const onMove = (moveEvent: PointerEvent) => {
      const nextWidth = clampHomeSidebarWidth(
        startWidth + moveEvent.clientX - startX,
      );
      homeSidebarWidthRef.current = nextWidth;
      setHomeSidebarWidth(nextWidth);
    };
    const onEnd = () => {
      commitHomeSidebarWidth(homeSidebarWidthRef.current);
      homeSidebarResizeCleanupRef.current?.();
      homeSidebarResizeCleanupRef.current = null;
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      document.body.classList.remove('magi-sidebar-resizing');
    };

    homeSidebarResizeCleanupRef.current = cleanup;
    document.body.classList.add('magi-sidebar-resizing');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd, { once: true });
    window.addEventListener('pointercancel', onEnd, { once: true });
  }, [commitHomeSidebarWidth]);

  const commitMobileReviewPlacement = useCallback(
    (placement: MobileReviewPlacement) => {
      setMobileReviewPlacement(placement);
      try {
        window.localStorage.setItem(
          MOBILE_REVIEW_PLACEMENT_STORAGE_KEY,
          placement,
        );
      } catch {
        // Placement remains usable for the current visit.
      }
    },
    [],
  );

  const commitMobileCategoryLayout = useCallback(
    (layout: MobileCategoryLayout) => {
      setMobileCategoryLayout(layout);
      if (layout === 'single-row') {
        setSelectedCategories(new Set([lastCategory]));
        setSourceConnections(current => new Map([
          [
            lastCategory,
            new Set(current.get(lastCategory) ?? ALL_SOURCE_CONNECTION),
          ],
        ]));
      }
      try {
        window.localStorage.setItem(MOBILE_CATEGORY_LAYOUT_STORAGE_KEY, layout);
      } catch {
        // The selected layout remains active for the current visit.
      }
    },
    [lastCategory],
  );

  const beginReviewButtonDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      reviewDragStartRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      reviewDraggingRef.current = false;
      reviewSuppressClickRef.current = false;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [],
  );

  const moveReviewButtonDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const start = reviewDragStartRef.current;
      if (!start || start.pointerId !== event.pointerId) return;
      if (
        !reviewDraggingRef.current
        && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 8
      ) {
        return;
      }
      reviewDraggingRef.current = true;
      reviewSuppressClickRef.current = true;
      setReviewDragPosition({ x: event.clientX, y: event.clientY });
    },
    [],
  );

  const endReviewButtonDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const start = reviewDragStartRef.current;
      if (!start || start.pointerId !== event.pointerId) return;
      if (reviewDraggingRef.current) {
        const toolbarRect = homeToolbarRef.current?.getBoundingClientRect();
        const headingRect = homeHeadingRef.current?.getBoundingClientRect();
        if (pointInsideRect(event.clientX, event.clientY, toolbarRect)) {
          commitMobileReviewPlacement('toolbar');
        } else if (pointInsideRect(event.clientX, event.clientY, headingRect)) {
          commitMobileReviewPlacement('floating');
        }
      }
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // The browser may already have released capture.
      }
      reviewDragStartRef.current = null;
      reviewDraggingRef.current = false;
      setReviewDragPosition(null);
    },
    [commitMobileReviewPlacement],
  );

  const cancelReviewButtonDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      reviewDragStartRef.current = null;
      reviewDraggingRef.current = false;
      setReviewDragPosition(null);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // The browser may already have released capture.
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadStoryIndex(controller.signal)
      .then(({ stories: loadedStories, sha256 }) => {
        setStories(loadedStories);
        setStoryIndexSha256(sha256);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setStoryError('剧情目录加载失败，请检查网络后刷新页面。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/proofreading/machine-status', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async response => { if (!response.ok) throw Error('通用进度 HTTP ' + response.status); return readGenericProgress(await response.json()); })
      .then(status => {
        if (status) { setProofreadingStatus(status); setProgressError(''); }
      })
      .catch(error => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setProgressError(error instanceof Error ? error.message : '通用覆盖清单读取失败');
        }
      });
    return () => controller.abort();
  }, [progressAttempt]);

  const enrichedStories = useMemo(() => {
    const progress = new Map(proofreadingStatus?.entries.map(entry => [entry.id,entry]) ?? []);
    return stories.map(story => {
      const current = progress.get(story.id);
      if(!current)return story;
      return {...story,has_cn:current.hasChinese,percent:current.coveragePercent,
        progress_rows:current.rows,chinese_rows:current.chineseRows,reviewed_rows:current.reviewedRows,pending_review_rows:current.pendingReviewRows,
        source_unverified:current.pendingReviewRows>0,human_verified:current.hasChinese&&current.pendingReviewRows===0};
    });
  }, [proofreadingStatus, stories]);

  useEffect(() => {
    if (enrichedStories.length === 0) return;
    const categoriesForSystem = Array.from(
      new Set(
        enrichedStories
          .map((story) => story.category || 'Unclassified')
          .filter(isGenericCategory),
      ),
    );
    if (
      categoriesForSystem.length > 0 &&
      !categoriesForSystem.includes(lastCategory)
    ) {
      const fallback = categoriesForSystem.includes(DEFAULT_CATEGORY)
        ? DEFAULT_CATEGORY
        : categoriesForSystem.sort(
            (left, right) =>
              categoryOrder(left) - categoryOrder(right) ||
              NATURAL_COLLATOR.compare(left, right),
          )[0];
      queueMicrotask(() => {
        setLastCategory(fallback);
        setSelectedCategories(new Set([fallback]));
        setSourceConnections(new Map([[fallback, createAllSourceConnection()]]));
      });
    }
  }, [enrichedStories, lastCategory, setLastCategory]);

  useEffect(() => {
    if (startupSourceDefaultAppliedRef.current || enrichedStories.length === 0) {
      return;
    }
    const activeCategoryIsReady = enrichedStories.some(
      story => (story.category || 'Unclassified') === lastCategory,
    );
    if (!activeCategoryIsReady) return;
    startupSourceDefaultAppliedRef.current = true;
    queueMicrotask(() => {
      setSelectedCategories(new Set([lastCategory]));
      setSourceConnections(new Map([[lastCategory, createAllSourceConnection()]]));
    });
  }, [enrichedStories, lastCategory]);

  useEffect(() => {
    if (!storyIndexSha256) return;
    const controller = new AbortController();
    searchSequenceRef.current += 1;
    const worker = createSearchWorkerClient<SearchWorkerMessage>({
      onmessage: (event) => {
        if (workerRef.current !== worker || searchModeRef.current === 'title') return;
        const message = event.data;
        if (message.type === 'status') {
          setSearchIndexStatus(message.status);
          if (message.status === 'loading') setSearchIndexProgress(0);
          if (message.status === 'ready') setSearchIndexProgress(100);
        } else if (message.type === 'progress') {
          const total = Math.max(0, Number(message.totalBytes) || 0);
          const loaded = Math.max(0, Number(message.loadedBytes) || 0);
          setSearchIndexStatus('loading');
          setSearchIndexProgress(total > 0 ? Math.min(100, Math.round(loaded / total * 100)) : 0);
        } else if (message.type === 'results') {
          if (message.sequence !== searchSequenceRef.current) return;
          setTextMatches(Object.fromEntries(message.matches));
          setSearchTruncated(message.truncated);
          setSearchLoading(false);
          setSearchError('');
        } else if (message.type === 'error') {
          if (message.sequence !== searchSequenceRef.current) return;
          setTextMatches({});
          setSearchLoading(false);
          setSearchError('正文索引加载失败；标题搜索仍然可以使用。');
        }
      },
      onerror: () => {
        if (workerRef.current !== worker) return;
        setSearchIndexStatus('error');
        setSearchLoading(false);
        setSearchError('正文搜索组件未能启动；标题搜索仍然可以使用。');
      },
    });
    workerRef.current = worker;
    if (searchModeRef.current !== 'title') worker.postMessage({ type: 'prepare' });

    void getSearchIndexSources(controller.signal, storyIndexSha256, 'generic')
      .then((sources) => {
        if (controller.signal.aborted || workerRef.current !== worker) return;
        setSearchIndexBytes(sources[0]?.bytes ?? 0);
        setSearchError('');
        if (searchModeRef.current === 'title') setSearchIndexStatus('idle');
        worker.postMessage({ type: 'init', sources });
        const latest = latestSearchRef.current;
        if (latest.mode !== 'title') {
          worker.postMessage({ type: 'prepare' });
          if (normalizeSearchText(latest.term).length >= 2) {
            setSearchLoading(true);
            worker.postMessage({ type: 'search', sequence: ++searchSequenceRef.current,
              query: latest.term, includeJapanese: latest.includeJapanese });
          }
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (workerRef.current !== worker) return;
        setSearchIndexStatus('error');
        setSearchLoading(false);
        setTextMatches({});
        setSearchError('正文索引加载失败；可重试，标题搜索仍然可以使用。');
        worker.postMessage({ type: 'init', sources: [] });
      });

    return () => {
      searchSequenceRef.current += 1;
      controller.abort();
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, [storyIndexSha256, searchRetryAttempt]);

  const requestContentSearch = useCallback(
    (term: string, mode: SearchMode, includeJapanese: boolean) => {
      latestSearchRef.current = { term, mode, includeJapanese };
      const sequence = searchSequenceRef.current + 1;
      searchSequenceRef.current = sequence;
      const query = normalizeSearchText(term);
      const contentEnabled = mode === 'all' || mode === 'content';

      setTextMatches({});
      setSearchTruncated(false);
      setSearchError('');

      if (!contentEnabled) {
        setSearchLoading(false);
        setSearchIndexStatus('idle');
        workerRef.current?.postMessage({ type: 'cancel', sequence });
        return;
      }

      if (!workerRef.current) {
        setSearchLoading(false);
        setSearchError('正文索引尚未就绪；标题搜索仍然可以使用。');
        return;
      }
      if (query.length < 2) {
        setSearchLoading(false);
        workerRef.current.postMessage({ type: 'cancel', sequence, keepLoading: true });
        workerRef.current.postMessage({ type: 'prepare' });
        return;
      }
      setSearchLoading(true);
      workerRef.current.postMessage({
        type: 'search',
        sequence,
        query: term,
        includeJapanese,
      });
    },
    [],
  );

  const updateSearchTerm = (term: string) => {
    setSearchTerm(term);
    requestContentSearch(term, searchMode, searchJp);
  };

  const updateSearchMode = (mode: SearchMode) => {
    searchModeRef.current = mode;
    setSearchMode(mode);
    if (mode !== 'title') {
      setSearchIndexStatus('loading');
      setSearchIndexProgress(0);
    }
    requestContentSearch(searchTerm, mode, searchJp);
  };

  const updateSearchLanguage = (includeJapanese: boolean) => {
    setSearchJp(includeJapanese);
    requestContentSearch(searchTerm, searchMode, includeJapanese);
  };

  const normalizedQuery = normalizeSearchText(searchTerm);
  const categorySourceFilterCounts = useMemo(() => {
    const counts: Record<string, CategorySourceFilterCounts> = {};
    for (const story of enrichedStories) {
      const category = story.category || 'Unclassified';
      if (!isGenericCategory(category)) continue;
      const categoryCounts = counts[category]
        ?? (counts[category] = emptyCategorySourceFilterCounts());
      categoryCounts.all += 1;
      if (storyMatchesCategorySourceFilter(story, 'with-cn')) {
        categoryCounts['with-cn'] += 1;
      }
      if (storyMatchesCategorySourceFilter(story, 'without-cn')) {
        categoryCounts['without-cn'] += 1;
      } else if (storyMatchesCategorySourceFilter(story, 'needs-review')) {
        categoryCounts['needs-review'] += 1;
      }
    }
    return counts;
  }, [enrichedStories]);

  const categorySourceFilterProgress = useMemo(() => {
    const storiesByCategory = new Map<string, Story[]>();
    for (const story of enrichedStories) {
      const category = story.category || 'Unclassified';
      if (!isGenericCategory(category)) continue;
      const categoryStories = storiesByCategory.get(category) ?? [];
      categoryStories.push(story);
      storiesByCategory.set(category, categoryStories);
    }
    const progress: Record<string, CategorySourceFilterProgress> = {};
    const sourceStatusKnown = proofreadingStatus !== null || enrichedStories.every(s=>s.progress_rows!==undefined);
    for (const [category, categoryStories] of storiesByCategory) {
      progress[category] = categorySourceFilterProgressForStories(
        categoryStories,
        sourceStatusKnown,
      );
    }
    return progress;
  }, [enrichedStories, proofreadingStatus]);

  const { categories, displayedGroups } = useMemo(() => {
    const foundCategories = new Set<string>();
    const groups: Record<string, StoryGroup> = {};

    for (const story of enrichedStories) {
      const category = story.category || 'Unclassified';
      if (!isGenericCategory(category)) continue;
      foundCategories.add(category);
      if (onlyNeedsReview && (!story.source_unverified || story.human_verified)) {
        continue;
      }

      const titleText = genericSearchTitle(story, searchJp);
      const titleMatch =
        normalizedQuery.length > 0 &&
        normalizeSearchText(titleText).includes(normalizedQuery);
      const contentMatch = Boolean(textMatches[story.id]);

      let matches = normalizedQuery.length === 0;
      if (normalizedQuery) {
        if (searchMode === 'title') matches = titleMatch;
        else if (searchMode === 'content') matches = contentMatch;
        else matches = titleMatch || contentMatch;
      }

      const categorySelected = selectedCategories.size === 0
        ? category === lastCategory
        : selectedCategories.has(category);
      const shouldShow = categorySelected && matches;
      if (!shouldShow) continue;
      if (
        !storyMatchesCategorySourceFilters(
          story,
          sourceConnections.get(category) ?? ALL_SOURCE_CONNECTION,
        )
      ) {
        continue;
      }

      const key = `${category}\u0000${story.folder}`;
      if (!groups[key]) {
        groups[key] = {
          key,
          category,
          folderName: story.folder,
          items: [],
          totalCn: 0,
          matchSnippets: {},
        };
      }
      groups[key].items.push(story);
      if (story.has_cn) groups[key].totalCn += 1;
      if (contentMatch) groups[key].matchSnippets![story.id] = textMatches[story.id];
    }

    const sortedGroups = Object.values(groups).sort(
      (a, b) =>
        categoryOrder(a.category) - categoryOrder(b.category) ||
        nativeGroupOrder(a.items) - nativeGroupOrder(b.items) ||
        NATURAL_COLLATOR.compare(a.folderName, b.folderName),
    );

    return {
      categories: Array.from(foundCategories).sort(
        (a, b) =>
          categoryOrder(a) - categoryOrder(b) ||
          NATURAL_COLLATOR.compare(a, b),
      ),
      displayedGroups: sortedGroups,
    };
  }, [enrichedStories, lastCategory, normalizedQuery, searchMode, searchJp, textMatches, onlyNeedsReview, selectedCategories, sourceConnections]);

  const selectCategory = (category: string) => {
    setSelectedCategories(new Set([category]));
    setSourceConnections(new Map([[category, createAllSourceConnection()]]));
    setLastCategory(category);
    setOnlyNeedsReview(false);
    updateSearchTerm('');
  };

  const toggleCategory = (category: string) => {
    setOnlyNeedsReview(false);
    updateSearchTerm('');
    const next = new Set(
      selectedCategories.size > 0 ? selectedCategories : [lastCategory],
    );
    if (next.has(category)) {
      if (next.size === 1) return;
      next.delete(category);
      setSourceConnections(connections => {
        const updated = new Map(connections);
        updated.delete(category);
        return updated;
      });
      if (category === lastCategory) {
        setLastCategory(next.values().next().value ?? lastCategory);
      }
    } else {
      if (next.size >= MAX_CONNECTED_CATEGORIES) return;
      next.add(category);
      setSourceConnections(connections => {
        const updated = new Map(connections);
        updated.set(category, createAllSourceConnection());
        return updated;
      });
    }
    setSelectedCategories(next);
  };

  const selectCategorySourceFilter = (filter: CategorySourceFilter) => {
    const connectedCategories = selectedCategories.size > 0
      ? selectedCategories
      : new Set([lastCategory]);
    setSourceConnections(current => new Map(
      Array.from(connectedCategories, category => {
        if (filter !== 'all') {
          return [category, new Set<CategorySourceFilter>([filter])] as const;
        }
        const categoryFilters = current.get(category) ?? ALL_SOURCE_CONNECTION;
        return [
          category,
          hasAllSourceConnections(categoryFilters)
            ? new Set<CategorySourceFilter>()
            : createAllSourceConnection(),
        ] as const;
      }),
    ));
    setOnlyNeedsReview(false);
    updateSearchTerm('');
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        homeHeadingRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      });
    });
  };

  const toggleCategorySourceFilter = (
    category: string,
    filter: CategorySourceFilter,
  ) => {
    if (!selectedCategories.has(category)) return;
    setSourceConnections(current => {
      const next = new Map(current);
      const categoryFilters = new Set(
        current.get(category) ?? ALL_SOURCE_CONNECTION,
      );
      if (filter === 'all') {
        next.set(
          category,
          hasAllSourceConnections(categoryFilters)
            ? new Set<CategorySourceFilter>()
            : createAllSourceConnection(),
        );
        return next;
      }
      if (categoryFilters.has(filter)) categoryFilters.delete(filter);
      else categoryFilters.add(filter);
      const detailFilters = CATEGORY_SOURCE_FILTERS
        .map(option => option.value)
        .filter(option => option !== 'all');
      if (detailFilters.every(option => categoryFilters.has(option))) {
        categoryFilters.add('all');
      } else {
        categoryFilters.delete('all');
      }
      next.set(category, categoryFilters);
      return next;
    });
    setOnlyNeedsReview(false);
    updateSearchTerm('');
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        homeHeadingRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      });
    });
  };

  const selectedCategorySummary = useMemo(() => {
    const categoryKeys = selectedCategories.size > 0
      ? categories.filter(category => selectedCategories.has(category))
      : [lastCategory];
    const counts = emptyCategorySourceFilterCounts();
    for (const category of categoryKeys) {
      const categoryCounts = categorySourceFilterCounts[category];
      if (!categoryCounts) continue;
      counts.all += categoryCounts.all;
      counts['with-cn'] += categoryCounts['with-cn'];
      counts['without-cn'] += categoryCounts['without-cn'];
      counts['needs-review'] += categoryCounts['needs-review'];
    }
    return {
      label: categoryKeys
        .map(category => CATEGORY_CONFIG[category]?.label ?? category)
        .join(' + '),
      counts,
      nativeChapters: enrichedStories.filter(story => categoryKeys.includes(story.category))
        .reduce((total, story) => total + (story.native_sections?.length ?? story.sections?.length ?? 1), 0),
    };
  }, [categories, categorySourceFilterCounts, enrichedStories, lastCategory, selectedCategories]);

  const selectAllWorks = () => {
    setSelectedCategories(new Set(GENERIC_CATEGORIES));
    setSourceConnections(new Map(GENERIC_CATEGORIES.map(category => [category, createAllSourceConnection()])));
    setOnlyNeedsReview(false);
    updateSearchTerm('');
  };

  const indexedNativeChapterCount = enrichedStories.filter(story=>story.source_format!=='supplemental-text/v1').reduce((total, story) =>
    total + (story.native_sections?.length ?? story.sections?.length ?? 1), 0);

  const manualRemainingCount = proofreadingStatus?.needsReview ?? 0;

  const renderMobileReviewButton = (
    placement: MobileReviewPlacement,
  ) => (
    <button
      type="button"
      data-placement={placement}
      aria-controls={machineReviewPanelContentId}
      aria-expanded={!machineReviewPanelCollapsed}
      aria-label={`${machineReviewPanelCollapsed ? '打开' : '收起'}校验清单，仍需 ${manualRemainingCount} 个脚本`}
      title={
        placement === 'floating'
          ? '点击打开或收起；长按拖到顶部工具栏可吸附'
          : '点击打开或收起；长按拖到分类标题右侧可移回'
      }
      onPointerDown={beginReviewButtonDrag}
      onPointerMove={moveReviewButtonDrag}
      onPointerUp={endReviewButtonDrag}
      onPointerCancel={cancelReviewButtonDrag}
      onClick={event => {
        if (reviewSuppressClickRef.current) {
          event.preventDefault();
          reviewSuppressClickRef.current = false;
          return;
        }
        setMachineReviewPanelCollapsedPreference(
          !machineReviewPanelCollapsed,
        );
      }}
      style={
        reviewDragPosition
          ? {
              position: 'fixed',
              left: `${reviewDragPosition.x}px`,
              top: `${reviewDragPosition.y}px`,
              transform: 'translate(-50%, -50%)',
            }
          : undefined
      }
      className={`magi-home-mobile-review-button transition md:hidden focus-visible:outline-none ${
        reviewDragPosition ? 'is-dragging' : ''
      }`}
    >
      校验清单
    </button>
  );

  if (loading) return <LoadingScreen />;

  return (
    <IOSViewportHost><div
      id="magi-home-display"
      data-theme={isNightTheme(theme) ? 'dark' : theme}
      data-theme-variant={theme}
      className={`magi-home-shell magi-home-${theme}-root ${theme === 'frost' ? 'magi-home-dark-root' : ''} flex h-screen h-[100dvh] overflow-hidden`}
    >
      {theme === 'frost' && <ReaderFilmSurface />}
      <ReaderTubeSurface theme={theme} />
      {/* Both category layouts share paint servers outside the desktop-only overlay. */}
      <svg
        data-frost-source-paint-servers="shared"
        className="pointer-events-none absolute"
        width="0"
        height="0"
        aria-hidden="true"
        focusable="false"
      >
        <defs aria-hidden="true">
          {[
            ['#778c87', '#c7d7d1', '#e4eee9'],
            ['#858d78', '#c7cfb7', '#e6eadc'],
            ['#668c91', '#afd0cd', '#d9e9e5'],
            ['#747f96', '#b8c1d0', '#dfe4ec'],
          ].map(([start, middle, end], gradientIndex) => (
            <Fragment key={`source-gradient-${gradientIndex}`}>
              <linearGradient
                id={`magi-frost-source-line-${gradientIndex}`}
                x1="0%"
                y1="0%"
                x2="100%"
                y2="0%"
              >
                <stop offset="0%" stopColor={start} stopOpacity="0.34" />
                <stop offset="54%" stopColor={middle} stopOpacity="0.62" />
                <stop offset="100%" stopColor={end} stopOpacity="0.48" />
              </linearGradient>
              <linearGradient
                id={`magi-frost-source-line-active-${gradientIndex}`}
                x1="0%"
                y1="0%"
                x2="100%"
                y2="0%"
              >
                <stop offset="0%" stopColor={start} stopOpacity="0.62" />
                <stop offset="57%" stopColor={middle} stopOpacity="0.94" />
                <stop offset="100%" stopColor={end} stopOpacity="0.76" />
              </linearGradient>
            </Fragment>
          ))}
        </defs>
      </svg>
      <div className="magi-scene-content">
      <aside
        style={{
          '--magi-home-sidebar-width': `${homeSidebarWidth}px`,
        } as CSSProperties}
        className={`magi-home-sidebar relative z-20 hidden flex-shrink-0 flex-col border-r md:flex ${
          isNightTheme(theme)
            ? 'border-gray-800 bg-gray-900'
            : isDayArchiveTheme(theme)
              ? 'magi-home-light-sidebar'
              : 'border-black/5 bg-inherit'
        }`}
      >
        <div className="magi-brand-panel border-b border-inherit px-3 py-5">
          <div className="magi-brand-row">
            <h1 className="magi-reader-brand min-w-0">
              <MadeInMagiusLogo />
            </h1>
          </div>
        </div>
        <CategoryNav
          key={`desktop-${theme}`}
          categories={categories}
          activeCategory={lastCategory}
          selectedCategories={selectedCategories}
          sourceConnections={sourceConnections}
          sourceFilterCounts={categorySourceFilterCounts}
          sourceFilterProgress={categorySourceFilterProgress}
          searchActive={Boolean(normalizedQuery)}
          theme={theme}
          onSelect={selectCategory}
          onToggleCategory={toggleCategory}
          onSelectSourceFilter={selectCategorySourceFilter}
          onToggleSourceFilter={toggleCategorySourceFilter}
        />
        <button
          type="button"
          role="separator"
          aria-orientation="vertical"
          aria-label={`调整主目录宽度，当前 ${homeSidebarWidth} 像素`}
          aria-valuemin={HOME_SIDEBAR_WIDTH_MIN}
          aria-valuemax={HOME_SIDEBAR_WIDTH_MAX}
          aria-valuenow={homeSidebarWidth}
          title="拖动调整主目录宽度；双击恢复默认"
          onPointerDown={beginHomeSidebarResize}
          onDoubleClick={() => commitHomeSidebarWidth(HOME_SIDEBAR_WIDTH_DEFAULT)}
          onKeyDown={event => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              commitHomeSidebarWidth(homeSidebarWidth - HOME_SIDEBAR_WIDTH_STEP);
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              commitHomeSidebarWidth(homeSidebarWidth + HOME_SIDEBAR_WIDTH_STEP);
            } else if (event.key === 'Home') {
              event.preventDefault();
              commitHomeSidebarWidth(HOME_SIDEBAR_WIDTH_MIN);
            } else if (event.key === 'End') {
              event.preventDefault();
              commitHomeSidebarWidth(HOME_SIDEBAR_WIDTH_MAX);
            }
          }}
          className="magi-sidebar-resize-handle absolute inset-y-0 -right-1 z-30 hidden w-2 cursor-col-resize touch-none md:block"
        />
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-transparent">
        <IOSHeaderSurface layer={10}>
        <header
          className={`magi-home-toolbar-shell border-b p-3 backdrop-blur z-10 flex flex-col gap-3 ${
            isNightTheme(theme)
              ? 'border-gray-800 bg-gray-900/90'
              : isDayArchiveTheme(theme)
                ? 'magi-home-light-toolbar'
                : 'border-black/5 bg-white/60'
          }`}
        >
          <div
            ref={homeToolbarRef}
            className={`magi-home-toolbar-row flex flex-wrap items-start justify-between gap-2 md:items-center ${
              reviewDragPosition ? 'magi-home-review-drop-target' : ''
            }`}
          >
            <div className="magi-home-toolbar-controls relative flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <div
                className="magi-home-search-shell relative min-w-0"
                style={{
                  '--magi-home-search-width': `${compactSearchCharacters}em`,
                } as CSSProperties}
              >
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none opacity-50">
                  <Search size={16} />
                </div>
                <input
                  type="search"
                  aria-label="搜索剧情标题或正文"
                  placeholder={searchLoading ? '正在准备正文搜索…' : '搜索标题或正文…'}
                  className={`magi-home-search-input block h-10 w-full border rounded-lg py-2 pl-9 pr-3 text-sm leading-6 outline-none transition-all ${
                    isNightTheme(theme)
                      ? 'bg-gray-800 border-gray-700'
                      : isDayArchiveTheme(theme)
                        ? 'magi-home-light-control'
                        : 'bg-white/50 border-black/10'
                  }`}
                  value={searchTerm}
                  onChange={(event) => updateSearchTerm(event.target.value)}
                />
                {searchIndexStatus !== 'idle' && <div className="magi-home-search-index-status pointer-events-none"
                  role="status" aria-live="polite" data-index-status={searchIndexStatus}>
                  <span className="magi-home-search-index-label">{searchIndexStatus === 'loading'
                    ? `下载索引 ${searchIndexProgress}%` : searchIndexStatus === 'ready' ? '索引已就绪' : '索引下载失败'}</span>
                  {searchIndexStatus !== 'error' && <span className="magi-home-search-index-progress" aria-hidden="true"
                    style={{ '--magi-index-progress': `${searchIndexProgress}%` } as CSSProperties} />}
                </div>}
              </div>

              <div className={`flex shrink-0 items-center rounded-lg border p-0.5 ${
                isDayArchiveTheme(theme)
                  ? 'magi-home-light-control'
                  : 'border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800'
              }`}>
                {(
                  [
                    { id: 'all', label: '全部' },
                    { id: 'title', label: '标题' },
                    { id: 'content', label: '正文' },
                  ] as const
                ).map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    aria-pressed={searchMode === option.id}
                    onClick={() => updateSearchMode(option.id)}
                    className={`px-2 py-1.5 text-xs font-bold rounded-md transition-all ${
                      searchMode === option.id
                        ? isDayArchiveTheme(theme)
                          ? 'magi-home-light-button-active'
                          : 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-300 shadow-sm'
                        : isDayArchiveTheme(theme)
                          ? 'magi-home-light-segment'
                          : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <label
                className={`flex items-center gap-1 px-2 rounded cursor-pointer border ${
                  isDayArchiveTheme(theme)
                    ? searchJp
                      ? 'magi-home-light-button-active'
                      : 'magi-home-light-button opacity-70'
                    : searchJp
                      ? isNightTheme(theme)
                        ? 'bg-blue-900/30 border-blue-800 text-blue-400'
                        : 'bg-blue-50 border-blue-200 text-blue-700'
                      : 'border-transparent opacity-60'
                }`}
              >
                <input
                  type="checkbox"
                  checked={searchJp}
                  onChange={(event) => updateSearchLanguage(event.target.checked)}
                  className="accent-blue-500 w-3 h-3"
                />
                <span className="text-xs font-bold whitespace-nowrap">JP</span>
              </label>

              <LocalStoryPicker theme={theme} />
              <button
                type="button"
                aria-label="打开字体与站点设置"
                title="字体与站点设置"
                onClick={() => setSettingsOpen(true)}
                className={`inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border p-2 transition-all ${
                  isNightTheme(theme)
                    ? 'border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700'
                    : isDayArchiveTheme(theme)
                      ? 'magi-home-light-button'
                      : 'border-gray-200 bg-white/70 text-gray-700 hover:bg-white'
                }`}
              >
                <Settings aria-hidden="true" size={16} />
              </button>
              <button
                type="button"
                onClick={() => setAboutOpen(true)}
                className={`px-2.5 py-1 rounded cursor-pointer border text-xs font-bold whitespace-nowrap transition-all ${
                  isNightTheme(theme)
                    ? 'bg-emerald-900/30 border-emerald-800 text-emerald-400 hover:bg-emerald-800'
                    : isDayArchiveTheme(theme)
                      ? 'magi-home-light-button'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                关于
              </button>
              <Link href="/proofreading/status" data-generic-revisions-link className="magi-home-review-action rounded-lg border px-3 py-2 text-xs font-black">修订与投稿</Link>
              <button
                type="button" onClick={selectAllWorks}
                aria-pressed={GENERIC_CATEGORIES.every(category => selectedCategories.has(category))}
                aria-label="显示全部作品与文本资料"
                className={`magi-home-story-system-toggle flex items-center px-2.5 py-1 rounded cursor-pointer border text-xs font-bold whitespace-nowrap transition-all ${
                  isNightTheme(theme) ? 'border-blue-800 bg-blue-900/30 text-blue-300 hover:bg-blue-800'
                    : isDayArchiveTheme(theme) ? 'magi-home-light-button'
                    : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                }`}
              >全部作品</button>
              <button
                type="button"
                aria-expanded={mobileSourceRailOpen}
                aria-controls="mobile-category-source-rail"
                aria-label={mobileSourceRailOpen ? '关闭来源栏' : '显示来源栏'}
                title={mobileSourceRailOpen ? '关闭来源栏' : '显示来源栏'}
                onClick={() => setMobileSourceRailOpen(open => !open)}
                className={`magi-home-mobile-source-toggle min-w-8 items-center justify-center rounded border px-2 py-1 text-xs font-bold whitespace-nowrap transition-all ${
                  mobileSourceRailOpen
                    ? isNightTheme(theme)
                      ? 'border-emerald-500 bg-emerald-900/45 text-emerald-300'
                      : isDayArchiveTheme(theme)
                        ? 'magi-home-light-button-active'
                        : 'border-emerald-500 bg-emerald-100 text-emerald-800'
                    : isNightTheme(theme)
                      ? 'border-gray-700 bg-gray-800 text-gray-300'
                      : isDayArchiveTheme(theme)
                        ? 'magi-home-light-button'
                        : 'border-gray-300 bg-white/70 text-gray-700'
                }`}
              >
                <Layers aria-hidden="true" size={14} />
              </button>
              {proofreadingStatus
                && mobileReviewPlacement === 'toolbar'
                && renderMobileReviewButton('toolbar')}
            </div>

            <div
              className={`magi-home-theme-switcher flex gap-1 p-1 rounded-full self-end md:self-auto ${
                isNightTheme(theme)
                  ? 'bg-black/20'
                  : isDayArchiveTheme(theme)
                    ? 'magi-home-light-control'
                    : 'bg-black/5'
              }`}
            >
              {(
                [
                  { key: 'light', icon: Sun, label: '明亮' },
                  { key: 'paper', icon: BookOpen, label: '纸张' },
                  { key: 'green', icon: Leaf, label: '护眼' },
                  { key: 'dark', icon: Moon, label: '深色' },
                  { key: 'frost', icon: ScanLine, label: '冷辉' },
                ] as const
              ).map((option) => (
                <button
                  type="button"
                  key={option.key}
                  data-theme-option={option.key}
                  title={option.label}
                  aria-label={`${option.label}主题`}
                  aria-pressed={theme === option.key}
                  onClick={() => setTheme(option.key)}
                  className={`p-2 rounded-full ${
                    theme === option.key
                      ? isDayArchiveTheme(theme)
                        ? 'magi-home-light-theme-active'
                        : 'bg-white shadow text-black'
                      : isDayArchiveTheme(theme)
                        ? 'magi-home-light-segment opacity-55'
                        : 'opacity-40'
                  }`}
                >
                  <option.icon size={14} />
                </button>
              ))}
            </div>
          </div>

          {searchMode !== 'title' && searchIndexBytes > 0 && (
            <p className="text-[11px] opacity-65">
              当前范围：{SEARCH_INDEX_SCOPE_CONFIG.generic.label}。正文搜索会在首次使用时按需加载约{' '}
              {(searchIndexBytes / (1024 * 1024)).toFixed(1)} MiB 索引。
              不会加载另一范围的正文对象；内存较小的设备请使用“标题”模式。
            </p>
          )}

          <div className="magi-home-mobile-category-shell md:hidden -mx-3">
            <CategoryNav
              categories={categories}
              activeCategory={lastCategory}
              selectedCategories={selectedCategories}
              sourceConnections={sourceConnections}
              sourceFilterCounts={categorySourceFilterCounts}
              sourceFilterProgress={categorySourceFilterProgress}
              searchActive={Boolean(normalizedQuery)}
              theme={theme}
              mobile
              mobileSourceRailOpen={mobileSourceRailOpen}
              mobileLayout={mobileCategoryLayout}
              onSelect={selectCategory}
              onToggleCategory={toggleCategory}
              onSelectSourceFilter={selectCategorySourceFilter}
              onToggleSourceFilter={toggleCategorySourceFilter}
            />
          </div>
        </header>
        </IOSHeaderSurface>

        <div className="magi-home-catalog flex-1 overflow-y-auto p-3 md:p-6 scroll-smooth">
          <div className="max-w-7xl mx-auto">
            {progressError && <div role="status" className="magi-home-review-panel mb-3 rounded-lg border p-3 text-sm">{progressError}；保留已加载目录和上次进度。<button type="button" onClick={() => setProgressAttempt(value => value + 1)} className="ml-3 font-bold underline">重试进度</button></div>}
            {proofreadingStatus && (
              <section
                id={machineReviewPanelContentId}
                hidden={machineReviewPanelCollapsed}
                className="magi-home-review-panel mb-5 rounded-2xl border p-4"
              >
                <div>
                  <div className="magi-home-review-panel-layout flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="magi-home-review-intro">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-black">Narcissu／加奈 中文覆盖总览</h2>
                        <span className="magi-home-review-live-badge rounded-full px-2 py-0.5 text-[10px] font-black">
                          动态
                        </span>
                      </div>
                      <p className="magi-home-review-summary mt-1 text-sm opacity-80">
                        游戏：{proofreadingStatus.nativeTotal} 个脚本、{indexedNativeChapterCount} 个原生章节／片段。文本资料：{proofreadingStatus.supplementalSources} 个来源版本、{proofreadingStatus.supplementalTotal} 个篇目。

                      </p>
                      <p className="magi-home-review-scope mt-1 text-[11px] leading-relaxed opacity-65">
                        中文 {proofreadingStatus.chineseRows}/{proofreadingStatus.rows} 段；已校对 {proofreadingStatus.reviewedRows} 段，站长补译待校对 {proofreadingStatus.pendingReviewRows} 段（涉及 {proofreadingStatus.needsReview} 篇）。原汉化及提供的中文文本均按已校对计；补译单独标记。

                      </p>
                    </div>
                    <div className="magi-home-review-toolbar flex flex-wrap items-center gap-3">
                      <div className="magi-home-review-meter min-w-48 grow md:grow-0">
                        <div className="mb-1 flex justify-between text-[10px] font-bold opacity-70">
                          <span>中文阅读覆盖</span>
                          <span>
                            {proofreadingStatus.total > 0
                              ? proofreadingStatus.coveragePercent
                              : 0}%
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-black/10">
                          <div
                            className="magi-home-review-progress h-full rounded-full transition-all"
                            style={{
                              width: `${proofreadingStatus.total > 0
                                ? proofreadingStatus.coveragePercent
                                : 0}%`,
                            }}
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-pressed={onlyNeedsReview}
                        onClick={() => {
                          setOnlyNeedsReview(value => !value);
                        }}
                        className={`magi-home-review-action rounded-lg border px-3 py-2 text-xs font-black transition ${
                          onlyNeedsReview ? 'is-active' : ''
                        }`}
                      >
                        {onlyNeedsReview ? '显示当前分类全部剧情' : '只看补译待校对剧情'}
                      </button>
                      <Link
                        href="/review/machine-translations"
                        className="magi-home-review-action is-primary rounded-lg border px-3 py-2 text-xs font-black transition"
                      >
                        查看翻译与校对清单
                      </Link>
                      <div className="magi-home-review-tail-actions">
                        <Link
                          href="/review/submissions"
                          className="magi-home-review-action is-secondary rounded-lg border px-3 py-2 text-xs font-black transition"
                        >
                          投稿审核
                        </Link>
                        <button
                          type="button"
                          aria-controls={machineReviewPanelContentId}
                          aria-expanded={!machineReviewPanelCollapsed}
                          aria-label="收起补译待校对人工校验清单"
                          title="收起校验清单"
                          onClick={() => setMachineReviewPanelCollapsedPreference(true)}
                          className="magi-home-review-action flex min-h-9 items-center gap-1 rounded-lg border px-3 py-2 text-xs font-black transition focus-visible:outline-none"
                        >
                          <ChevronUp aria-hidden="true" size={15} />
                          收起
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}
            {storyError && (
              <div
                role="alert"
                className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {storyError}
              </div>
            )}
            {searchError && (
              <div
                role="status"
                className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"
              >
                {searchError}
                <button type="button" data-retry-search="true"
                  className="ml-3 rounded border border-current px-3 py-1 font-bold"
                  onClick={() => {
                    setSearchError('');
                    setSearchIndexStatus('loading');
                    setSearchRetryAttempt(value => value + 1);
                  }}>重试正文搜索</button>
              </div>
            )}
            {normalizedQuery.length === 1 &&
              (searchMode === 'all' || searchMode === 'content') && (
                <div className="mb-4 text-xs opacity-60">
                  正文搜索会在输入至少 2 个有效字符后开始；标题结果已显示。
                </div>
              )}
            {searchTruncated && (
              <div className="mb-4 text-xs opacity-60">
                正文匹配较多，当前只显示前 500 个结果。请继续输入以缩小范围。
              </div>
            )}

            <div
              ref={homeHeadingRef}
              data-category-summary={!normalizedQuery ? 'true' : 'false'}
              className={`magi-home-section-heading-row ${
                reviewDragPosition ? 'magi-home-review-drop-target' : ''
              }`}
            >
              <div className="magi-home-section-heading-main min-w-0">
                <h2 className={`px-1 text-xl font-bold opacity-80 ${
                  isDayArchiveTheme(theme)
                    ? 'magi-home-light-section-title'
                    : ''
                }`}>
                  {normalizedQuery
                    ? `搜索结果：“${searchTerm}” ${searchJp ? '（含日文）' : ''}`
                    : selectedCategorySummary.label}
                </h2>
                {!normalizedQuery && (
                  <div
                    className="magi-home-section-statistics"
                    aria-label={`脚本 ${selectedCategorySummary.counts.all}，原生章节 ${selectedCategorySummary.nativeChapters}，有中文 ${selectedCategorySummary.counts['with-cn']}，补译待校对 ${selectedCategorySummary.counts['needs-review']}，无中文 ${selectedCategorySummary.counts['without-cn']}`}
                  >
                    <span data-stat="total">脚本 {selectedCategorySummary.counts.all}</span>
                    <span data-stat="native-chapters">原生章节 {selectedCategorySummary.nativeChapters}</span>
                    <span data-stat="human">有中文 {selectedCategorySummary.counts['with-cn']}</span>
                    <span data-stat="pending">待校 {selectedCategorySummary.counts['needs-review']}</span>
                    <span data-stat="verified">无中文 {selectedCategorySummary.counts['without-cn']}</span>
                  </div>
                )}
              </div>
              {proofreadingStatus
                && mobileReviewPlacement === 'floating'
                && renderMobileReviewButton('floating')}
              {proofreadingStatus && (
                <button
                  type="button"
                  aria-controls={machineReviewPanelContentId}
                  aria-expanded={!machineReviewPanelCollapsed}
                  aria-label={`${machineReviewPanelCollapsed ? '打开' : '收起'}校验清单，仍需 ${manualRemainingCount} 个脚本`}
                  title={`仍需人工校验 ${manualRemainingCount} 个脚本`}
                  onClick={() => setMachineReviewPanelCollapsedPreference(!machineReviewPanelCollapsed)}
                  className="magi-home-review-trigger magi-home-heading-review-trigger hidden shrink-0 items-center rounded-md border font-black transition focus-visible:outline-none md:inline-flex"
                >
                  校验清单
                </button>
              )}
            </div>

            <StableFolderColumns groups={displayedGroups} theme={theme} />
            {displayedGroups.length === 0 && !storyError && (
              <div className="text-center opacity-50 mt-10">没有找到相关剧情</div>
            )}
            <div className="h-20" />
          </div>
        </div>
      </main>
      <SiteSettingsWindow
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        setTheme={setTheme}
        isExedra={false}
        mobileCategoryLayout={mobileCategoryLayout}
        setMobileCategoryLayout={commitMobileCategoryLayout}
      />
      <AboutModal
        isOpen={aboutOpen}
        onClose={() => setAboutOpen(false)}
        theme={theme}
      />
      </div>
    </div></IOSViewportHost>
  );
}

export default function Home() {

  return <FrostHome />;
}
