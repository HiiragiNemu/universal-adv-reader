"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { translationVisualState, groupTranslationVisualState, translationVisualStyle } from '@/lib/translation-visual-state';

import {
  Book,
  Calendar,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Layers,
  User,
  X,
} from 'lucide-react';

import { characterFolderColorFor } from '@/app/config/dictionary';
import { isNightTheme, useGlobal } from '@/app/providers';
import { categoryOrder } from '@/lib/category-order';
import { storySectionDetails } from '@/lib/story-parser';
import {
  resolveOfficialChapterTitle,
  resolveOfficialSectionTitle,
} from '@/lib/official-tw-titles';
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_STEP,
  SIDEBAR_WIDTH_STORAGE_KEY,
  clampSidebarWidth,
  parseStoredSidebarWidth,
} from '@/lib/sidebar-width';
import { useDialog } from '@/lib/use-dialog';
import { readerNameChip } from '@/lib/reader-name-chip';
import MadeInMagiusLogo from '@/components/MadeInMagiusLogo';
import { genericStoryLabel } from '@/lib/generic-story-label';
import { compareNativeStories, nativeGroupOrder, nativeNavigationLabel, nativeSectionLinks, type NativeStoryNavigation } from '@/lib/native-story-navigation';

const READER_SIDEBAR_COMPACT_DEFAULT = SIDEBAR_WIDTH_MIN;
const FROST_SIDEBAR_WIDTH_STORAGE_KEY = `${SIDEBAR_WIDTH_STORAGE_KEY}:frost`;
const SIDEBAR_WIDTH_SCOPE_RESTORE_KEY = 'magi-reader-sidebar-width-scope-v1';

const subscribeSectionAnchor = (notify: () => void) => {
  window.addEventListener('hashchange', notify);
  return () => window.removeEventListener('hashchange', notify);
};
const sectionAnchorSnapshot = () => {
  try { return decodeURIComponent(window.location.hash.slice(1)); }
  catch { return ''; }
};

import type {SourceRowProgress} from '../lib/source-progress-metrics';

export type Story = NativeStoryNavigation & SourceRowProgress & {
  id: string;
  category: string;
  folder: string;
  percent: number;
  has_cn: boolean;
  has_jp?: boolean;
  filename_cn?: string;
  filename_jp?: string;
  path_cn?: string;
  path_jp?: string;
  json_paths_cn?: string[];
  json_sources_jp?: string[];
  json_sources_cn?: string[];
  title?: string;
  title_cn?: string;
  title_jp?: string;
  sections?: string[];
  game?: string;
  source_format?: string;
  source_count?: number;
  source_identity?: string;
  source_unverified?: boolean;
  /** Deprecated compatibility field; use source_unverified for new code. */
  machine_translation?: boolean;
  human_verified?: boolean;
  official_tw?: boolean;
  official_tw_label?: string;
  official_tw_chapter_title?: string;
  official_tw_section_titles?: string[];
  section_display_titles?: Record<string, string>;
  official_tw_section_sources?: string[];
  legacy_ids?: string[];
};

type CategoryConfig = {
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
};

export const CATEGORY_CONFIG: Record<string, CategoryConfig> = {
  main_story: { label: 'Narcissu 10th Anniversary Anthology Project', icon: Book },
  event_story: { label: 'Narcissu 3rd', icon: Calendar },
  character_story: { label: 'KANA: Okaeri!!', icon: User },
  supplement_story: {label:'Narcissu 文本资料',icon:FileText},
  costume_story: { label: '服装剧情', icon: Layers },
  login_story: { label: '登录剧情', icon: FileText },
  mirror_story: { label: '镜层/其他', icon: Folder },
  scene0_main: { label: 'Scene0 主线', icon: Book },
  scene0_sub: { label: 'Scene0 支线', icon: User },
  exedra_main: { label: '主线', icon: Book },
  exedra_sub: { label: '活动', icon: Layers },
  exedra_character: { label: '角色', icon: User },
  exedra_portrait: { label: '肖像', icon: User },
  exedra_reaction: { label: '语音', icon: FileText },
  exedra_namae: { label: 'Namae', icon: Folder },
  exedra_dungeon: { label: '过场动画字幕', icon: Layers },
  exedra_battle: { label: '战斗', icon: Folder },
  Unclassified: { label: '未分类', icon: Folder },
};

const EXEDRA_CATEGORIES = new Set([
  'exedra_main',
  'exedra_sub',
  'exedra_character',
  'exedra_portrait',
  'exedra_reaction',
  'exedra_namae',
  'exedra_dungeon',
  'exedra_battle',
]);
const NATURAL_COLLATOR = new Intl.Collator(['zh-CN', 'ja-JP'], {
  numeric: true,
  sensitivity: 'base',
});

type SidebarProps = {
  stories: Story[];
  currentId?: string;
  isOpen: boolean;
  onClose: () => void;
  className?: string;
  sourceLocale?: 'zh-CN' | 'ja-JP';
};

const storyPercent = (story: Story): number => {
  const value = story.percent ?? (story.has_cn ? 100 : 0);
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
};

const displayLabel = (story: Story) => nativeNavigationLabel(story, genericStoryLabel(story));

const displayFolder = (category: string, folder: string): string => {
  if (category === 'character_story' || category === 'costume_story') return folder;
  return folder.replace(/^\d+ - /, '').replace(/^Event_\d+/, 'Event');
};


export default function Sidebar({
  stories,
  currentId,
  isOpen,
  onClose,
  className = '',
  sourceLocale,
}: SidebarProps) {
  const router = useRouter();
  useEffect(() => {
    // The mobile brand lives in a closed drawer, so Link's viewport prefetch
    // normally starts only when the user opens it. Prepare the return route
    // while reading instead; no story/index download is initiated here.
    router.prefetch('/');
  }, [router]);
  const { theme, lastCategory, setLastCategory, nameColorsEnabled } = useGlobal();
  const activeSectionAnchor = useSyncExternalStore(subscribeSectionAnchor, sectionAnchorSnapshot, () => '');
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, boolean>>({});
  const [folderOverrides, setFolderOverrides] = useState<Record<string, boolean>>({});
  const [storySectionOverrides, setStorySectionOverrides] = useState<Record<string, boolean>>({});
  const readerSidebarDefaultWidth = theme === 'frost'
    ? READER_SIDEBAR_COMPACT_DEFAULT
    : SIDEBAR_WIDTH_DEFAULT;
  const sidebarWidthStorageKey = theme === 'frost'
    ? FROST_SIDEBAR_WIDTH_STORAGE_KEY
    : SIDEBAR_WIDTH_STORAGE_KEY;
  const [sidebarWidth, setSidebarWidth] = useState(readerSidebarDefaultWidth);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const sidebarRef = useDialog<HTMLElement>(isOpen, onClose);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const current = scrollContainerRef.current?.querySelector<HTMLElement>(
      '.magi-reader-sidebar-section-item[aria-current="location"]',
    );
    const tree = current?.closest<HTMLElement>('.magi-reader-sidebar-section-tree');
    if (!current || !tree) return;
    const measure = () => {
      const item = current.getBoundingClientRect();
      const parent = tree.getBoundingClientRect();
      tree.style.setProperty('--magi-section-path-end', `${item.top - parent.top + item.height / 2}px`);
      tree.dataset.activePath = 'true';
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(tree);
    return () => {
      observer.disconnect();
      tree.style.removeProperty('--magi-section-path-end');
      delete tree.dataset.activePath;
    };
  }, [activeSectionAnchor, currentId, stories, storySectionOverrides, theme]);

  useEffect(() => {
    if (!isOpen) setStorySectionOverrides({});
  }, [isOpen]);

  useEffect(() => {
    try {
      const rawWidth = window.localStorage.getItem(sidebarWidthStorageKey);
      const storedWidth = parseStoredSidebarWidth(rawWidth);
      const scopeAlreadyRestored = window.localStorage.getItem(
        SIDEBAR_WIDTH_SCOPE_RESTORE_KEY,
      ) === '1';
      const restorePollutedClassicDefault = theme !== 'frost'
        && !scopeAlreadyRestored
        && storedWidth === READER_SIDEBAR_COMPACT_DEFAULT;
      const nextWidth = rawWidth === null || restorePollutedClassicDefault
        ? readerSidebarDefaultWidth
        : storedWidth;
      setSidebarWidth(nextWidth);
      if (theme === 'frost' && (nextWidth !== storedWidth || rawWidth === null)) {
        window.localStorage.setItem(sidebarWidthStorageKey, String(nextWidth));
      }
      if (theme !== 'frost' && !scopeAlreadyRestored) {
        if (restorePollutedClassicDefault) {
          window.localStorage.setItem(sidebarWidthStorageKey, String(nextWidth));
        }
        window.localStorage.setItem(SIDEBAR_WIDTH_SCOPE_RESTORE_KEY, '1');
      }
    } catch {
      setSidebarWidth(readerSidebarDefaultWidth);
    }
    return () => resizeCleanupRef.current?.();
  }, [readerSidebarDefaultWidth, sidebarWidthStorageKey, theme]);

  const commitSidebarWidth = useCallback((value: number) => {
    const bounded = clampSidebarWidth(value);
    setSidebarWidth(bounded);
    try {
      window.localStorage.setItem(sidebarWidthStorageKey, String(bounded));
    } catch {
      // Storage may be unavailable in private browsing; resizing still works.
    }
  }, [sidebarWidthStorageKey]);

  const beginResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    resizeCleanupRef.current?.();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const onMove = (moveEvent: PointerEvent) => {
      setSidebarWidth(clampSidebarWidth(startWidth + moveEvent.clientX - startX));
    };
    const onEnd = (endEvent: PointerEvent) => {
      const finalWidth = clampSidebarWidth(startWidth + endEvent.clientX - startX);
      commitSidebarWidth(finalWidth);
      resizeCleanupRef.current?.();
      resizeCleanupRef.current = null;
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      document.body.classList.remove('magi-sidebar-resizing');
    };
    resizeCleanupRef.current = cleanup;
    document.body.classList.add('magi-sidebar-resizing');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd, { once: true });
    window.addEventListener('pointercancel', onEnd, { once: true });
  }, [commitSidebarWidth, sidebarWidth]);

  const currentStory = useMemo(
    () => stories.find(story => story.id === currentId),
    [currentId, stories],
  );
  const showExedra =
    currentStory
      ? currentStory.game === 'exedra' || currentStory.category.startsWith('exedra_')
      : lastCategory.startsWith('exedra_');

  const groupedData = useMemo(() => {
    const result: Record<string, Record<string, Story[]>> = {};
    for (const story of stories) {
      const category = story.category || 'Unclassified';
      const storyIsExedra =
        story.game === 'exedra' || category.startsWith('exedra_');
      if (storyIsExedra !== showExedra) continue;
      if (showExedra && !EXEDRA_CATEGORIES.has(category)) continue;
      const folder = story.folder || '未分类';
      result[category] ??= {};
      result[category][folder] ??= [];
      result[category][folder].push(story);
    }
    return result;
  }, [showExedra, stories]);

  useEffect(() => {
    if (!currentId || !currentStory) return;

    const category = currentStory.category || 'Unclassified';
    const folder = currentStory.folder || '未分类';
    const folderKey = `${category}\u0000${folder}`;
    setCategoryOverrides(previous =>
      previous[category] === true
        ? previous
        : { ...previous, [category]: true },
    );
    setFolderOverrides(previous =>
      previous[folderKey] === true
        ? previous
        : { ...previous, [folderKey]: true },
    );

    const timer = window.setTimeout(() => {
      const container = scrollContainerRef.current;
      const target = document.getElementById(`nav-item-${currentId}`);
      if (!container || !target || !container.contains(target)) return;

      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const targetTop =
        container.scrollTop
        + targetRect.top
        - containerRect.top
        - (container.clientHeight - targetRect.height) / 2;
      container.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth',
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [currentId, currentStory, isOpen, stories.length]);

  const themeClass =
    isNightTheme(theme)
      ? 'bg-gray-900/70 glass-morphism border-gray-700 text-gray-300'
      : theme === 'paper'
        ? 'bg-[#f0e6d2]/60 glass-morphism border-[#dcd6b6] text-[#5c4b37]'
        : theme === 'green'
          ? 'bg-[#d8e6d1] border-[#b8cbb0] text-[#1b4d1b]'
          : 'bg-[#ded6c3]/65 glass-morphism border-[#9d927e]/35 text-[#5d564b] shadow-[10px_0_28px_rgba(77,68,52,0.08)]';
  const hoverClass =
    theme === 'green'
      ? 'hover:bg-[#b0e2bd]'
      : isNightTheme(theme)
        ? 'hover:bg-gray-800'
        : theme === 'paper'
          ? 'hover:bg-black/5'
          : 'hover:bg-[#81745e]/10';

  return (
    <>
      {isOpen && (
        <button
          type="button"
          aria-label="关闭剧情目录"
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        ref={sidebarRef}
        role={isOpen ? 'dialog' : undefined}
        aria-modal={isOpen || undefined}
        aria-label="剧情目录"
        tabIndex={-1}
        style={{ '--magi-sidebar-width': `${sidebarWidth}px` } as CSSProperties}
        className={`magi-reader-sidebar fixed inset-y-0 left-0 z-50 flex flex-col overflow-hidden border-r transition-transform duration-300 md:relative md:translate-x-0 ${
          isOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        } ${themeClass} ${className}`}
      >
        <div className="magi-brand-panel magi-reader-brand-row flex shrink-0 items-center justify-center border-b bg-inherit p-4">
          <Link
            href="/"
            className={`magi-reader-brand text-xl font-black ${
              theme === 'light' || theme === 'paper'
                ? 'magi-reader-brand-day-archive'
                : 'bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent'
            }`}
          >
            <MadeInMagiusLogo compact className="magi-reader-brand-logo" />
          </Link>
          <button
            type="button"
            aria-label="关闭剧情目录"
            onClick={onClose}
            className={`rounded-full p-2 hover:bg-black/10 active:scale-95 md:hidden ${
              isNightTheme(theme) ? 'text-white' : 'text-gray-800'
            }`}
          >
            <X size={24} />
          </button>
        </div>

        <div
          ref={scrollContainerRef}
          data-sidebar-scroll-container="true"
          className="scrollbar-thin flex-1 overflow-y-auto p-2"
        >
          {Object.keys(groupedData)
            .sort(
              (a, b) =>
                categoryOrder(a) - categoryOrder(b) ||
                NATURAL_COLLATOR.compare(a, b),
            )
            .map(category => {
            const config = CATEGORY_CONFIG[category] || { label: category, icon: Folder };
            const Icon = config.icon;
            const defaultOpen =
              category === currentStory?.category ||
              (!currentStory && category === lastCategory);
            const categoryOpen = categoryOverrides[category] ?? defaultOpen;

            return (
              <section key={category} className="mb-1">
                <button
                  type="button"
                  aria-expanded={categoryOpen}
                  onClick={() => {
                    setLastCategory(category);
                    setCategoryOverrides(previous => ({
                      ...previous,
                      [category]: !(previous[category] ?? defaultOpen),
                    }));
                  }}
                  className={`magi-reader-sidebar-category-button flex w-full items-center gap-2 rounded-md px-2 py-3 text-sm font-bold transition-colors ${
                    categoryOpen ? 'bg-black/10' : 'opacity-70'
                  } ${hoverClass}`}
                >
                  {categoryOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <Icon size={18} className="shrink-0" />
                  <span className="whitespace-nowrap">{config.label}</span>
                </button>

                {categoryOpen && (
                  <div className="magi-reader-sidebar-folder-tree mt-1 space-y-1">
                    {Object.keys(groupedData[category])
                      .sort((a, b) =>
                        nativeGroupOrder(groupedData[category][a]) - nativeGroupOrder(groupedData[category][b])
                        || NATURAL_COLLATOR.compare(a, b))
                      .map(folder => {
                        const folderKey = `${category}\u0000${folder}`;
                        const defaultFolderOpen =
                          category === currentStory?.category &&
                          folder === currentStory.folder;
                        const folderOpen =
                          folderOverrides[folderKey] ?? defaultFolderOpen;
                        const items = [...groupedData[category][folder]].sort(compareNativeStories);
                        const average = items.length
                          ? Math.round(
                              items.reduce(
                                (sum, story) => sum + storyPercent(story),
                                0,
                              ) / items.length,
                            )
                          : 0;
                        const coldFolderState = groupTranslationVisualState(items);
                        const folderLabel = items.some(story => story.section_display_titles)
                          ? displayFolder(category, folder)
                          : resolveOfficialChapterTitle(items, displayFolder(category, folder));
                        const folderClass =
                          average === 100
                            ? isNightTheme(theme)
                              ? 'text-emerald-400'
                              : 'font-bold text-emerald-700'
                            : average > 0
                              ? 'text-emerald-600'
                              : 'text-gray-500';

                        return (
                          <div
                            key={folder}
                            className={`magi-reader-sidebar-folder-node ${folderOpen ? '' : 'magi-sidebar-folder-collapsed'}`}
                          >
                          <button
                            type="button"
                            aria-expanded={folderOpen}
                            onClick={() => setFolderOverrides(previous => ({
                              ...previous,
                              [folderKey]: !(previous[folderKey] ?? defaultFolderOpen),
                            }))}
                            data-translation-origin={coldFolderState.origin}
                            data-translation-status={coldFolderState.status}
                            data-progress-percent={coldFolderState.percent}
                            style={translationVisualStyle(coldFolderState) as CSSProperties}
                            className={`magi-reader-sidebar-folder-button grid w-full min-w-0 items-center rounded px-2 py-2 text-left text-xs transition-colors ${hoverClass}`}
                          >
                            <ChevronRight
                              aria-hidden="true"
                              size={13}
                              className={`magi-reader-sidebar-folder-disclosure shrink-0 ${folderOpen ? 'rotate-90' : ''}`}
                            />
                            <Folder aria-hidden="true" size={13} className="magi-reader-sidebar-folder-icon shrink-0" />
                            <span
                              className={`magi-reader-sidebar-folder-label min-w-0 truncate leading-tight ${folderClass}`}
                              title={folderLabel}
                              style={readerNameChip(characterFolderColorFor(category, folderLabel), nameColorsEnabled)}
                            >
                              {folderLabel}
                            </span>
                            <span className="shrink-0 rounded bg-black/5 px-1 text-[10px] opacity-50">
                              {items.some(story => story.native_sections?.length)
                                ? `${items.reduce((total, story) => total + (story.native_sections?.length ? nativeSectionLinks(story, sourceLocale).length : 1), 0)} 节`
                                : items.length}
                            </span>
                          </button>

                          {folderOpen && (
                            <div className="magi-reader-sidebar-story-tree mt-0.5 space-y-0.5">
                              {items.map(story => {
                                const active = story.id === currentId;
                                const percent = storyPercent(story);
                                const coldStoryState = translationVisualState(story);
                                const label = displayLabel(story);
                                const nativeLinks = nativeSectionLinks(story, sourceLocale);
                                const sectionLinks = nativeLinks.length ? nativeLinks : (story.sections ?? []).map((section, sectionIndex) => {
                                  const details = storySectionDetails(section);
                                  return {
                                    anchorId: details.anchorId,
                                    title: resolveOfficialSectionTitle(
                                      story.official_tw_section_titles,
                                      sectionIndex + 1,
                                      story.source_identity && story.sections?.length === 1 ? label : details.label,
                                      {
                                        sourceName: details.sourceName,
                                        displayTitles: story.section_display_titles,
                                        sources: story.official_tw_section_sources,
                                        branch: details.branch,
                                      },
                                    ),
                                  };
                                });
                                const hasSections = sectionLinks.length > 0;
                                const selectedSectionAnchor = sectionLinks.find(section =>
                                  section.anchorId === activeSectionAnchor,
                                )?.anchorId ?? sectionLinks[0]?.anchorId;
                                const defaultSectionsOpen = active;
                                const sectionsOpen = storySectionOverrides[story.id]
                                  ?? defaultSectionsOpen;
                                const storyHref = `/reader/${encodeURIComponent(story.id)}?cn=${encodeURIComponent(story.path_cn || '')}&jp=${encodeURIComponent(story.path_jp || '')}`;
                                const inactiveClass =
                                  percent > 0
                                    ? isNightTheme(theme)
                                      ? 'border-emerald-500/50 bg-emerald-900/30 text-emerald-400 hover:bg-emerald-900/40'
                                      : theme === 'light'
                                        ? 'border-[#93866f]/40 bg-[#d8cfbd]/60 text-[#514a3f] hover:bg-[#cec3ae]/75'
                                        : theme === 'green'
                                          ? 'border-[#6a9368] bg-[#b7d0ae] text-[#234f38] hover:bg-[#acc9a2]'
                                          : 'border-emerald-500/50 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                    : isNightTheme(theme)
                                      ? 'border-gray-700 bg-gray-800 text-gray-500 hover:bg-gray-700'
                                      : theme === 'light'
                                        ? 'border-[#a79b84]/30 bg-[#ece6d9]/45 text-[#756d60] hover:bg-[#ddd4c3]/65'
                                        : theme === 'green'
                                          ? 'border-[#99b08d] bg-[#c3d2b8] text-[#58745b] hover:bg-[#b7cba9]'
                                          : 'border-gray-200 bg-white text-gray-400 hover:bg-gray-50';
                                const activeClass =
                                  theme === 'green'
                                    ? 'border-[#1B5E20] bg-[#2E7D32] text-white'
                                    : isNightTheme(theme)
                                      ? 'border-blue-500 bg-blue-900/30 text-blue-300'
                                      : theme === 'light'
                                        ? 'border-[#81745e] bg-[#c9bea9]/75 text-[#403a32]'
                                        : 'border-blue-500 bg-blue-50 text-blue-700';

                                return (
                                  <div key={story.id} className="magi-reader-story-entry mb-1">
                                    <div className="magi-reader-story-row min-w-0 items-stretch gap-1">
                                    {hasSections && (
                                      <button
                                        type="button"
                                        aria-label={`${sectionsOpen ? '收起' : '展开'}${label} Episodes`}
                                        aria-controls={`nav-sections-${story.id}`}
                                        aria-expanded={sectionsOpen}
                                        title={sectionsOpen ? '收起 Episodes' : '展开 Episodes'}
                                        onClick={() => setStorySectionOverrides(previous => ({
                                          ...previous,
                                          [story.id]: !(previous[story.id] ?? defaultSectionsOpen),
                                        }))}
                                        className="magi-reader-story-expand-button grid shrink-0 place-items-center border text-current transition"
                                      >
                                        <ChevronRight
                                          aria-hidden="true"
                                          size={13}
                                          className={sectionsOpen ? 'rotate-90' : ''}
                                        />
                                      </button>
                                    )}
                                    {!hasSections && (
                                      <span className="magi-reader-story-leaf-marker" aria-hidden="true">
                                        <span className="magi-reader-story-leaf-dot" />
                                      </span>
                                    )}
                                    <Link
                                      id={`nav-item-${story.id}`}
                                      data-translation-origin={coldStoryState.origin}
                                      data-translation-status={coldStoryState.status}
                                      data-progress-percent={coldStoryState.percent}
                                      style={translationVisualStyle(coldStoryState) as CSSProperties}
                                      href={storyHref}
                                      data-source-identity={story.source_identity}
                                      prefetch={false}
                                      onClick={onClose}
                                      title={`${label} · ${story.id}`}
                                      aria-current={active ? 'page' : undefined}
                                      className={`magi-reader-story-link grid min-w-0 rounded-sm border-l-2 px-2 py-1.5 font-mono text-xs transition-all ${
                                        active ? activeClass : inactiveClass
                                      }`}
                                    >
                                      {hasSections ? (
                                        <Folder aria-hidden="true" size={12} className="magi-reader-story-file-icon" />
                                      ) : (
                                        <FileText aria-hidden="true" size={12} className="magi-reader-story-file-icon" />
                                      )}
                                      <span className="magi-reader-story-label">{label}</span>
                                      {(story.official_tw || (percent < 100 && !active)) && (
                                        <span className="magi-reader-story-meta">
                                          {story.official_tw && (
                                            <span className="magi-reader-source-badge inline-flex rounded-full border border-[#81745e]/35 bg-[#f0eadf]/60 px-1.5 py-0.5 font-sans text-[9px] font-bold text-[#655d50]">
                                              {story.official_tw_label || '台服'}
                                            </span>
                                          )}
                                          {percent < 100 && !active && (
                                            <span className="inline-block text-[9px] opacity-60">{story.source_identity ? (story.has_cn ? '有中文 · 待校对' : '仅日文') : `${percent}%`}</span>
                                          )}
                                        </span>
                                      )}
                                    </Link>
                                    </div>

                                    {sectionsOpen && sectionLinks.length > 0 && (
                                      <nav
                                        id={`nav-sections-${story.id}`}
                                        aria-label={`${label} Episodes`}
                                        className="magi-reader-story-sections magi-reader-sidebar-section-tree mt-1 space-y-0.5"
                                      >
                                        {sectionLinks.map(details => {
                                          const sectionLabel = details.title;
                                          return (
                                            <Link
                                              key={details.anchorId}
                                              href={`${storyHref}#${details.anchorId}`}
                                              prefetch={false}
                                              title={sectionLabel}
                                              data-section-anchor={details.anchorId}
                                              aria-current={active && selectedSectionAnchor === details.anchorId ? 'location' : undefined}
                                              onClick={event => {
                                                if (!active) {
                                                  onClose();
                                                  return;
                                                }
                                                event.preventDefault();
                                                onClose();
                                                // All story systems use the page-aware reveal handler.
                                                // A target on another page has no DOM node to scroll yet.
                                                if (sectionAnchorSnapshot() === details.anchorId) {
                                                  window.dispatchEvent(new HashChangeEvent('hashchange'));
                                                } else {
                                                  window.location.hash = details.anchorId;
                                                }
                                              }}
                                              className={`magi-reader-sidebar-section-item grid w-full min-w-0 px-2 py-1 text-left text-[10px] transition ${
                                                isNightTheme(theme)
                                                  ? 'text-gray-400 hover:bg-white/10 hover:text-white'
                                                  : 'text-gray-600 hover:bg-black/5 hover:text-black'
                                              }`}
                                            >
                                              <FileText
                                                aria-hidden="true"
                                                size={11}
                                                className="magi-reader-sidebar-section-icon"
                                              />
                                              <span className="magi-reader-sidebar-section-label">{sectionLabel}</span>
                                            </Link>
                                          );
                                        })}
                                      </nav>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          </div>
                        );
                      })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
        <button
          type="button"
          role="separator"
          aria-orientation="vertical"
          aria-label={`调整剧情目录宽度，当前 ${sidebarWidth} 像素`}
          aria-valuemin={240}
          aria-valuemax={560}
          aria-valuenow={sidebarWidth}
          title="拖动调整目录宽度；双击恢复默认"
          onPointerDown={beginResize}
          onDoubleClick={() => commitSidebarWidth(readerSidebarDefaultWidth)}
          onKeyDown={event => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              commitSidebarWidth(sidebarWidth - SIDEBAR_WIDTH_STEP);
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              commitSidebarWidth(sidebarWidth + SIDEBAR_WIDTH_STEP);
            } else if (event.key === 'Home') {
              event.preventDefault();
              commitSidebarWidth(SIDEBAR_WIDTH_MIN);
            } else if (event.key === 'End') {
              event.preventDefault();
              commitSidebarWidth(SIDEBAR_WIDTH_MAX);
            }
          }}
          className="magi-sidebar-resize-handle absolute inset-y-0 right-0 hidden w-2 cursor-col-resize touch-none md:block"
        />
      </aside>
    </>
  );
}
