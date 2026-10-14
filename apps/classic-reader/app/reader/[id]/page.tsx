"use client";

import {
  Fragment,
  use,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import Link from 'next/link';
import LoadingScreen from '@/components/LoadingScreen';
import IOSViewportHost from '@/components/IOSViewportHost';
import IOSHeaderSurface from '@/components/IOSHeaderSurface';
import { ReaderFilmSurface, ReaderTubeSurface } from '@/components/RetroDisplaySurface';
import ReaderStyleScope from '@/components/ReaderStyleScope';
import ReaderFilmViewport, { type FilmRulerMark } from '@/components/ReaderFilmViewport';
import MaterialFrameLabel from '@/components/MaterialFrameLabel';
import { useSearchParams } from 'next/navigation';
import {
  BookOpen,
  Download,
  Leaf,
  Menu,
  Music2,
  Moon,
  ScanLine,
  Search,
  Settings,
  Sun,
} from 'lucide-react';

import AboutModal from '@/components/AboutModal';
import FloatingWindow from '@/components/FloatingWindow';
import DraggableReaderWidget from '@/components/DraggableReaderWidget';
import ReaderFontSettings from '@/components/ReaderFontSettings';
import { useCurvedFontRange } from '@/lib/use-curved-font-range';
import '@/app/reader/reader-stacked-alignment.css';
import '@/app/reader/native-stacked-alignment.css';
import TurnstileWidget from '@/components/TurnstileWidget';
import Sidebar, { type Story } from '@/components/Sidebar';
import StoryText, { LineBreakMarkerText } from '@/components/StoryText';
import { VoicePlayButton } from '@/components/voice/VoicePlayButton';
import { VoiceSequenceControls } from '@/components/voice/VoiceSequenceControls';
import {
  speakerColorFor,
  translateSpeakerName,
} from '@/app/config/dictionary';
import { isNightTheme, useGlobal } from '@/app/providers';
import { readLocalStoryPayload, readScenarioFile } from '@/lib/local-story';
import { normalizeSearchText } from '@/lib/search';
import {
  normalizeProofreadingText,
  sha256Text,
} from '@/lib/proofreading';
import { saveProofreadingReceipt } from '@/lib/proofreading-client';
import { voicePlaybackController } from '@/lib/audio/voice-player';
import { loadNativeCorrespondence, hashNativeText, buildParallelNativeAlignment, applyNativeCueAliases,
  unpairedNativeCorrespondence, type NativeCorrespondence } from '@/lib/legacy-vn-correspondence';
import {translationReviewForRow,type TranslationReviewRow} from '@/lib/translation-review';
import {nativeCoverage} from '@/lib/generic-progress';
import { buildSharedNativeAlignment, mergeNativeAlignedRows, mergeNativeVoiceSlots, mergeNativeVoiceCues,
  seedNativeEditableLines, applyNativeEditedLines, importNativeEditableLines, type NativeAlignedRow } from '@/lib/legacy-vn-alignment';
import {
  findStoryByRouteId,
  isOptionalStorySourceUnavailable,
  loadStoryIndex,
  readBoundedResponseBody,
  resolveDirectStorySources,
  verifyExedraStoryId,
  type NativeChapterRelation,
} from '@/lib/story-index';
import { triggerUtf8Download } from '@/lib/browser-download';
import { createNativeTranslationPatch, importNativeTranslationPatch } from '@/lib/native-translation-patch';
import NativeReviewSubmit from '@/components/NativeReviewSubmit';
import { loadCurrentNativeEditSource as loadNativeEditSource, projectNativeReaderRevisionRows,
  serializeNativeRevisionText, type CurrentNativeEditSource as LoadedNativeEditSource } from '@/lib/native-reader-revision';
import { initializeExedraFonts } from '@/lib/exedra-fonts';
import {
  bilingualLanguagePaneClass,
  bilingualStoryPairClass,
} from '@/lib/bilingual-layout';
import { resolveOfficialSectionTitle } from '@/lib/official-tw-titles';
import { initializeReaderFonts } from '@/lib/reader-fonts';
import { indexNativeEventRows, indexNativeSectionAnchors, isNativeSectionTitleRow,
  resolveNativeSourceAnchor, crossChapterRelationForRow, nativeChapterRelationHref, type NativeSectionDescriptor } from '@/lib/native-section-anchors';
import {
  isReaderRulerEnabled,
  READER_FONT_SIZE_MAX,
  READER_FONT_SIZE_MIN,
  READER_TEXT_WIDTH_MAX,
  READER_TEXT_WIDTH_MIN,
  READER_TEXT_WIDTH_STEP,
  getReaderDisplayPreferencesServerSnapshot,
  getReaderDisplayPreferencesSnapshot,
  parseReaderDisplayPreferences,
  subscribeReaderDisplayPreferences,
  updateReaderDisplayPreferences,
} from '@/lib/reader-display-preferences';
import {
  createEditedScenarioJsonDownload,
  createOriginalScenarioJsonDownload,
  triggerScenarioJsonDownload,
} from '@/lib/scenario-json-download';
import {
  applyScenarioJsonUploadToAggregate,
  buildScenarioJsonSourceOptions,
  mapAggregateEditsToScenarioJson,
} from '@/lib/scenario-json-selection';
import {
  alignStoryLines,
  makeSectionAnchorId,
  parseStoryContent,
  serializeStoryLine,
  type AlignedStoryLine,
  type StoryFormat,
  type StoryLine,
} from '@/lib/story-parser';
import {
  buildLegacyVoiceSlots,
  buildLegacyVoiceSequence,
  buildUnresolvedLegacyVoiceSlots,
  legacyVoiceRoutePath,
  parseLegacyVoiceRouteDocument,
  summarizeLegacyVoiceSlots,
  type LegacyVoiceCue,
  type LegacyVoiceRouteDocument,
  type LegacyVoiceSlot,
} from '@/lib/legacy-vn-voice-routing';

type ReaderMode = 'cn' | 'split' | 'jp';
type EditSeed = 'empty' | 'jp' | 'current';
type BilingualLayout = 'side-by-side' | 'stacked';
type JsonDownloadBusy = 'jp' | 'cn' | 'edited' | null;

type TextTotals = { cn: number; jp: number; cnSourceLines: number; jpSourceLines: number };
const emptyTextTotals = (): TextTotals => ({ cn: 0, jp: 0, cnSourceLines: 0, jpSourceLines: 0 });
function readableSourceText(text = '') {
  return text.replace(/<r\s*=[^>]*>([\s\S]*?)<\/r>/gi, '$1')
    .replace(/<\/?(?:color|size|red|blue|yellow|black)(?:[=\s][^>]*)?>/gi, '')
    .replace(/\[text(?:Red|Blue|Yellow|Black):([^\]]*)\]/gi, '$1');
}
function sourceTextTotals(row: AlignedStoryLine): TextTotals {
  const cn = readableSourceText(row.cn?.choiceLabel || row.cn?.text);
  const jp = readableSourceText(row.jp?.choiceLabel || row.jp?.text);
  return { cn: Array.from(cn.replace(/\s/g, '')).length, jp: Array.from(jp.replace(/\s/g, '')).length,
    cnSourceLines: cn.split('\n').filter(line => line.trim()).length,
    jpSourceLines: jp.split('\n').filter(line => line.trim()).length };
}
function SourceStatistics({ stats, label }: { stats: TextTotals; label: string }) {
  return <span className="magi-reader-source-statistics" data-statistics-scope={label}>
    <span>{label}</span><span>CN {stats.cn}</span><span>JP {stats.jp}</span><span>TOTAL {stats.cn + stats.jp}</span>
    <span title="源文件的非空文本行；下方 LINES 按当前字号和列宽测量实际折行">源行 CN {stats.cnSourceLines} / JP {stats.jpSourceLines}</span>
  </span>;
}

type MeasuredRow = { cn: number; jp: number; cnChars: number; jpChars: number };

// Measure text nodes, not element boxes: ruby annotations and the smaller ↵
// marker occupy the same printed line and must not create phantom LINES.
function measurePrintedText(element: HTMLElement | null) {
  const rects: { top: number; bottom: number }[] = [];
  let characters = 0;
  if (element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement?.closest('rt, rp, [aria-hidden="true"]')
          ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      characters += Array.from((node.textContent ?? '').replace(/\s/g, '')).length;
      range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width > 0.1 && rect.height > 0.1) rects.push({ top: rect.top, bottom: rect.bottom });
      }
    }
  }
  const lines: { top: number; bottom: number }[] = [];
  for (const rect of rects.sort((a, b) => a.top - b.top)) {
    const sameLine = lines.find(line => {
      const overlap = Math.min(line.bottom, rect.bottom) - Math.max(line.top, rect.top);
      return overlap > Math.min(line.bottom - line.top, rect.bottom - rect.top) * 0.5;
    });
    if (sameLine) {
      sameLine.top = Math.min(sameLine.top, rect.top);
      sameLine.bottom = Math.max(sameLine.bottom, rect.bottom);
    } else lines.push({ ...rect });
  }
  return { lines, characters };
}

type LoadedSource = {
  name: string;
  raw: string;
  format: StoryFormat;
};

type ProofreadingConfig = {
  submissions_enabled: boolean;
  turnstile_site_key: string;
  target_branch: string;
  source_revision: string;
  github_admin_auth: boolean;
  turnstile_test_mode: boolean;
};

const MAX_STORY_SOURCE_BYTES = 8 * 1024 * 1024;
// Native control/ruby provenance makes the largest verified route exceed 8 MiB.
const MAX_VOICE_ROUTE_BYTES = 16 * 1024 * 1024;
const BILINGUAL_LAYOUT_STORAGE_KEY = 'magi-reader-bilingual-layout-v1';
const UTILITY_WIDGET_POSITION_STORAGE_KEY =
  'magi-reader-utility-widget-position-v1';
const FONT_WIDGET_POSITION_STORAGE_KEY =
  'magi-reader-font-widget-position-v1';
const CLASSIC_STORY_ROWS_PER_PAGE = 200;
const FROST_STORY_ROWS_PER_PAGE = 120;
const PAGE_SWIPE_MIN_DISTANCE_PX = 64;
const FONT_RULER_TICKS = Array.from(
  { length: READER_FONT_SIZE_MAX - READER_FONT_SIZE_MIN + 1 },
  (_, offset) => {
    const value = READER_FONT_SIZE_MIN + offset;
    return {
      value,
      major:
        value === READER_FONT_SIZE_MIN ||
        value === READER_FONT_SIZE_MAX ||
        value % 2 === 0,
      positionPercent:
        ((value - READER_FONT_SIZE_MIN) /
          (READER_FONT_SIZE_MAX - READER_FONT_SIZE_MIN)) *
        100,
    };
  },
);

const isReaderPagingInteractionTarget = (
  target: EventTarget | null,
): boolean => {
  if (typeof Element === 'undefined' || !(target instanceof Element)) {
    return false;
  }
  return Boolean(
    target.closest(
      'input, textarea, select, button, a, [contenteditable="true"], [role="textbox"], [role="slider"]',
    ),
  );
};

const countLineBreaks = (text: string): number => {
  let count = 0;
  let cursor = 0;
  while (cursor < text.length) {
    const next = text.indexOf('\n', cursor);
    if (next < 0) break;
    count += 1;
    cursor = next + 1;
  }
  return count;
};

const THEME_STYLES: Record<string, string> = {
  light: 'bg-transparent text-gray-900',
  dark: 'bg-transparent text-gray-200',
  frost: 'bg-transparent text-gray-200',
  paper: 'bg-transparent text-[#4a4036]',
  green: 'bg-transparent text-[#003300]',
};

const HEADER_STYLES: Record<string, string> = {
  light: 'border-gray-200 bg-white/80 backdrop-blur-md',
  dark: 'border-gray-800 bg-[#0f172a]/80 backdrop-blur-md',
  paper: 'border-[#e6dfc5] bg-[#f0e6d2]/60 backdrop-blur-md',
  green: 'border-[#A8D8B9] bg-[#C7EDCC]/80 backdrop-blur-md',
};

const FORMAT_LABELS: Record<StoryFormat, string> = {
  'plain-text': 'TXT',
  'scene0-text': 'Scene0 TXT',
  'magireco-json': 'Magia Record JSON',
  'exedra-json': 'Magia Exedra JSON',
  'generic-json': '通用 JSON',
};

const filenameFromPath = (path: string, fallback: string): string => {
  try {
    const pathname = new URL(path, window.location.origin).pathname;
    return decodeURIComponent(pathname.split('/').filter(Boolean).at(-1) || fallback);
  } catch {
    return fallback;
  }
};

const sourceDownloadName = (id: string, language: 'cn' | 'jp', source: LoadedSource): string => {
  const extension = source.name.toLowerCase().endsWith('.json') ? 'json' : 'txt';
  return `${id}_${language}.${extension}`;
};

const translatedSpeaker = (speaker: string): string =>
  translateSpeakerName(speaker);

const seedEditableLines = (
  cnLines: StoryLine[],
  jpLines: StoryLine[],
  seed: EditSeed,
): StoryLine[] => {
  const rows = alignStoryLines(cnLines, jpLines);
  return rows.flatMap(({ cn, jp }) => {
    const basis = cn ?? jp;
    if (!basis) return [];

    const structural = Boolean(basis.isHeader || basis.isChoice);
    const text =
      structural
        ? basis.text
        : seed === 'jp'
          ? (jp ?? basis).text
          : seed === 'current' && cn
            ? cn.text
            : '';

    return [{
      ...basis,
      speaker: translatedSpeaker(
        cn?.speaker || (jp ?? basis).speaker || '旁白',
      ),
      text,
    }];
  });
};

const lineTextAlignClass = (line?: StoryLine): string => {
  if (line?.position === 'right') return 'text-right';
  if (line?.position === 'center') return 'text-center';
  return 'text-left';
};

const lineKindClass = (line?: StoryLine): string => {
  if (line?.kind === 'fnarration') return 'italic opacity-80';
  if (line?.kind === 'narration') return 'opacity-90';
  return '';
};

const speakerColor = (speaker: string): string | undefined =>
  speakerColorFor(speaker);

const activeLegacyVoiceSlot = (
  mode: ReaderMode,
  cnSlot: LegacyVoiceSlot | null | undefined,
  jpSlot: LegacyVoiceSlot | null | undefined,
): LegacyVoiceSlot | null => {
  if (mode === 'cn') return cnSlot ?? null;
  if (mode === 'jp') return jpSlot ?? null;
  return mergeNativeVoiceSlots(cnSlot, jpSlot);
};

const activeLegacyVoiceCues = (
  mode: ReaderMode,
  cnCues: LegacyVoiceCue[],
  jpCues: LegacyVoiceCue[],
): LegacyVoiceCue[] => {
  return mode === 'cn' ? cnCues : mode === 'jp' ? jpCues : mergeNativeVoiceCues(cnCues, jpCues);
};

const parseLoadedSource = (name: string, raw: string): {
  source: LoadedSource;
  lines: StoryLine[];
  eventLines: StoryLine[];
  title?: string;
  warnings: string[];
} => {
  const eventParsed = parseStoryContent(raw, {
    filename: name,
    mergeConsecutiveTextLines: false,
  });
  const displayParsed = parseStoryContent(raw, {
    filename: name,
    mergeConsecutiveTextLines: true,
  });
  return {
    source: { name, raw, format: eventParsed.format },
    lines: displayParsed.lines,
    eventLines: eventParsed.lines,
    title: displayParsed.title || eventParsed.title,
    warnings: [...new Set([
      ...eventParsed.warnings,
      ...displayParsed.warnings,
    ])],
  };
};

export default function ReaderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const editRequestedByUrl = searchParams.get('edit') === '1';
  const isLocal = searchParams.get('local') === '1';
  const queryCnPath = searchParams.get('cn');
  const queryJpPath = searchParams.get('jp');
  const { theme, setTheme } = useGlobal();

  const [cnLines, setCnLines] = useState<StoryLine[]>([]);
  const [jpLines, setJpLines] = useState<StoryLine[]>([]);
  const [cnEventLines, setCnEventLines] = useState<StoryLine[]>([]);
  const [jpEventLines, setJpEventLines] = useState<StoryLine[]>([]);
  const [cnSource, setCnSource] = useState<LoadedSource | null>(null);
  const [jpSource, setJpSource] = useState<LoadedSource | null>(null);
  const [storyTitle, setStoryTitle] = useState('');
  const [loadError, setLoadError] = useState('');
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ReaderMode>('cn');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [lineHeight, setLineHeight] = useState(1.1);
  const [bilingualLayout, setBilingualLayout] =
    useState<BilingualLayout>('side-by-side');
  const readerDisplayPreferencesSnapshot = useSyncExternalStore(
    subscribeReaderDisplayPreferences,
    getReaderDisplayPreferencesSnapshot,
    getReaderDisplayPreferencesServerSnapshot,
  );
  const readerDisplayPreferences = useMemo(
    () =>
      parseReaderDisplayPreferences(readerDisplayPreferencesSnapshot),
    [readerDisplayPreferencesSnapshot],
  );
  const readingRulerEnabled = isReaderRulerEnabled(readerDisplayPreferences, theme);
  const fontSize = readerDisplayPreferences.fontSizePx;
  const fontControlOpen = readerDisplayPreferences.fontControlOpen;
  const fontRulerPositionPercent =
    ((fontSize - READER_FONT_SIZE_MIN) /
      (READER_FONT_SIZE_MAX - READER_FONT_SIZE_MIN)) *
    100;
  const [allStories, setAllStories] = useState<Story[]>([]);
  const [storyIndexReady, setStoryIndexReady] = useState(false);
  const [storyIndexError, setStoryIndexError] = useState('');
  const [storyIndexSha256, setStoryIndexSha256] = useState('');
  const [isEditMode, setIsEditMode] = useState(false);
  const [pendingEditStoryId, setPendingEditStoryId] = useState<string | null>(null);
  const consumedEditDeepLink = useRef('');
  const [proofreadingConfig, setProofreadingConfig] =
    useState<ProofreadingConfig | null>(null);
  const [proofreadingConfigLoading, setProofreadingConfigLoading] =
    useState(false);
  const [proofreadingNickname, setProofreadingNickname] = useState('');
  const [proofreadingNote, setProofreadingNote] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [submittingProofreading, setSubmittingProofreading] = useState(false);
  const [lastSubmissionId, setLastSubmissionId] = useState('');
  const [editedCnLines, setEditedCnLines] = useState<StoryLine[]>([]);
  const [nativeEditState, setNativeEditState] = useState<{ route: LegacyVoiceRouteDocument | null; cnRaw: string; jpRaw: string;
    source: LoadedNativeEditSource | null; error: string }>({ route: null, cnRaw: '', jpRaw: '', source: null, error: '' });
  const nativeEditSourceRef = useRef<LoadedNativeEditSource | null>(null);
  const [selectedJsonSourceKey, setSelectedJsonSourceKey] = useState('');
  const [jsonDownloadBusy, setJsonDownloadBusy] =
    useState<JsonDownloadBusy>(null);
  const jsonDownloadBusyRef = useRef<JsonDownloadBusy>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const [visiblePage, setVisiblePage] = useState(0);
  const [lineCounts, setLineCounts] = useState<Record<number, MeasuredRow>>({});
  const [pageTurnDirection, setPageTurnDirection] = useState<'next' | 'prev' | null>(null);
  const [pageTurnSequence, setPageTurnSequence] = useState(0);
  const pageTurnResetRef = useRef<number | null>(null);
  const [filmRulerMarks, setFilmRulerMarks] = useState<FilmRulerMark[]>([]);
  const readerDocumentRef = useRef<HTMLDivElement>(null);
  const fontRangeRef = useCurvedFontRange();
  const pageTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const [pendingRowScroll, setPendingRowScroll] = useState<{
    rowIndex: number;
    highlight: boolean;
  } | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [utilityPanelOpen, setUtilityPanelOpen] = useState(true);
  const [editMessage, setEditMessage] = useState('');
  const [voicePanelExpanded, setVoicePanelExpanded] = useState(false);
  const activeVoiceRow = useSyncExternalStore(voicePlaybackController.subscribe,
    () => voicePlaybackController.getSnapshot().sequence?.rowIndex ?? -1, () => -1);
  const [legacyVoiceRoute, setLegacyVoiceRoute] =
    useState<LegacyVoiceRouteDocument | null>(null);
  const [legacyVoiceRouteError, setLegacyVoiceRouteError] = useState('');
  const [legacyVoiceRouteLoading, setLegacyVoiceRouteLoading] = useState(false);
  const [nativeCorrespondenceState, setNativeCorrespondenceState] = useState<{
    route: LegacyVoiceRouteDocument | null; cnRaw: string; jpRaw: string;
    data: NativeCorrespondence | null; error: string; loading: boolean;
  }>({ route: null, cnRaw: '', jpRaw: '', data: null, error: '', loading: false });

  useEffect(() => {
    const stored = window.localStorage.getItem(BILINGUAL_LAYOUT_STORAGE_KEY);
    if (stored === 'side-by-side' || stored === 'stacked') {
      setBilingualLayout(stored);
    }
  }, []);

  const changeBilingualLayout = (layout: BilingualLayout) => {
    setBilingualLayout(layout);
    window.localStorage.setItem(BILINGUAL_LAYOUT_STORAGE_KEY, layout);
  };

  const openUtilityPanel = () => setUtilityPanelOpen(true);

  const closeUtilityPanel = () => setUtilityPanelOpen(false);

  const directSourceResolution = useMemo(() => {
    try {
      return {
        error: '',
        sources: resolveDirectStorySources(id, queryCnPath, queryJpPath),
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : '剧情链接中的文件路径无效。',
        sources: null,
      };
    }
  }, [id, queryCnPath, queryJpPath]);
  const deferStoryIndexUntilContent =
    isLocal || directSourceResolution.sources !== null;

  useEffect(() => {
    if (deferStoryIndexUntilContent && loading) {
      return;
    }
    const controller = new AbortController();
    loadStoryIndex(controller.signal)
      .then(({ stories, sha256 }) => {
        setAllStories(stories);
        setStoryIndexSha256(sha256);
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.error('剧情索引加载失败：', error);
        setStoryIndexError('剧情目录读取失败。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setStoryIndexReady(true);
      });
    return () => controller.abort();
  }, [deferStoryIndexUntilContent, loading]);

  useEffect(() => {
    if (!isEditMode || isLocal || id.startsWith('legacy-')) return;
    const controller = new AbortController();
    setProofreadingConfigLoading(true);
    setTurnstileToken('');
    void fetch('/api/proofreading/config', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json() as ProofreadingConfig & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || `HTTP ${response.status}`);
        }
        setProofreadingConfig(payload);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setProofreadingConfig(null);
        setEditMessage('无法读取投稿服务配置；仍可下载 TXT 备份。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setProofreadingConfigLoading(false);
      });
    return () => controller.abort();
  }, [isEditMode, isLocal]);

  const currentStory = useMemo(
    () => findStoryByRouteId(allStories, id),
    [allStories, id],
  );
  const currentLegacyVoiceRoutePath = currentStory?.source_identity && currentStory.source_format !== 'supplemental-text/v1'
    ? legacyVoiceRoutePath(currentStory.source_identity)
    : null;
  const isExedraStory =
    currentStory?.game === 'exedra' ||
    currentStory?.category.startsWith('exedra_') === true ||
    directSourceResolution.sources?.kind === 'exedra-trusted-runtime';
  const jsonSourceOptionsState = useMemo(() => {
    if (!currentStory) return { options: [], error: '' };
    try {
      return {
        options: buildScenarioJsonSourceOptions({
          story: currentStory,
          cnLines: cnEventLines,
          jpLines: jpEventLines,
        }),
        error: '',
      };
    } catch (error) {
      return {
        options: [],
        error:
          error instanceof Error
            ? error.message
            : '剧情 JSON 来源清单无法读取。',
      };
    }
  }, [cnEventLines, currentStory, jpEventLines]);
  const selectedJsonSource = useMemo(
    () =>
      jsonSourceOptionsState.options.find(
        option => option.key === selectedJsonSourceKey,
      ) ?? jsonSourceOptionsState.options[0],
    [jsonSourceOptionsState.options, selectedJsonSourceKey],
  );

  useEffect(() => {
    if (
      jsonSourceOptionsState.options.length === 0 ||
      jsonSourceOptionsState.options.some(
        option => option.key === selectedJsonSourceKey,
      )
    ) {
      return;
    }
    setSelectedJsonSourceKey(jsonSourceOptionsState.options[0].key);
  }, [jsonSourceOptionsState.options, selectedJsonSourceKey]);

  const sourceReady =
    isLocal ||
    Boolean(directSourceResolution.error) ||
    directSourceResolution.sources !== null ||
    storyIndexReady;
  const sourceError =
    directSourceResolution.error ||
    (
      !isLocal &&
      storyIndexReady
        ? directSourceResolution.sources === null
          ? storyIndexError ||
            (currentStory ? '' : '剧情编号不存在，或剧情目录尚未包含该文件。')
          : !storyIndexError && !currentStory
            ? '剧情编号不存在，或剧情目录尚未包含该文件。'
            : ''
        : ''
    );
  const useManifestSources =
    storyIndexReady &&
    currentStory !== undefined &&
    (
      directSourceResolution.sources?.kind === 'query' ||
      Boolean(currentStory.path_cn)
    );
  const sourcePathCn =
    useManifestSources
      ? currentStory.path_cn ?? ''
      : directSourceResolution.sources?.pathCn ?? currentStory?.path_cn ?? '';
  const sourcePathJp =
    useManifestSources
      ? currentStory.path_jp ?? ''
      : directSourceResolution.sources?.pathJp ?? currentStory?.path_jp ?? '';
  const sourceCnOptional =
    useManifestSources
      ? false
      : directSourceResolution.sources?.optionalCn ?? false;

  useEffect(() => {
    if (!sourceReady) return;

    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setLoadError('');
    setParseWarnings([]);
    setCnLines([]);
    setJpLines([]);
    setCnEventLines([]);
    setJpEventLines([]);
    setCnSource(null);
    setJpSource(null);
    setStoryTitle('');
    setEditedCnLines([]);
    setSelectedJsonSourceKey('');
    setJsonDownloadBusy(null);
    jsonDownloadBusyRef.current = null;
    setIsEditMode(false);
    setPendingEditStoryId(null);
    setEditMessage('');
    setLastSubmissionId('');
    setTurnstileToken('');
    setTurnstileResetKey((value) => value + 1);
    setSearchQuery('');
    setCurrentMatchIndex(-1);

    const fetchSource = async (
      path: string,
      fallbackName: string,
      optional = false,
    ): Promise<ReturnType<typeof parseLoadedSource> | null> => {
      if (!path) return null;
      const response = await fetch(path, { signal: controller.signal });
      if (!response.ok) {
        if (
          optional &&
          isOptionalStorySourceUnavailable(response.status)
        ) {
          return null;
        }
        throw new Error(`${fallbackName}读取失败（HTTP ${response.status}）`);
      }
      const declaredLength = Number(response.headers.get('content-length'));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_STORY_SOURCE_BYTES
      ) {
        await response.body?.cancel('剧情文件超过大小限制');
        throw new Error(`${fallbackName}超过 8 MB 大小限制。`);
      }
      const payload = await readBoundedResponseBody(
        response,
        MAX_STORY_SOURCE_BYTES,
        fallbackName,
      );
      let raw: string;
      try {
        raw = new TextDecoder('utf-8', { fatal: true }).decode(payload);
      } catch {
        throw new Error(`${fallbackName}不是有效的 UTF-8 文本。`);
      }
      return parseLoadedSource(filenameFromPath(path, fallbackName), raw);
    };

    const load = async () => {
      try {
        let parsedCn: ReturnType<typeof parseLoadedSource> | null = null;
        let parsedJp: ReturnType<typeof parseLoadedSource> | null = null;
        let localTitle = '';

        if (isLocal) {
          const payload = readLocalStoryPayload();
          if (!payload || (payload.id !== id && !(process.env.NEXT_PUBLIC_ADV_STATIC === '1' && id === 'local'))) {
            throw new Error('本地剧情已失效，请返回首页重新选择文件。');
          }
          localTitle = payload.title;
          if (payload.cn) parsedCn = parseLoadedSource(payload.cn.name, payload.cn.raw);
          if (payload.jp) parsedJp = parseLoadedSource(payload.jp.name, payload.jp.raw);
        } else {
          if (sourceError) throw new Error(sourceError);
          if (
            directSourceResolution.sources?.kind === 'exedra-trusted-runtime' &&
            !(await verifyExedraStoryId(id))
          ) {
            throw new Error('Exedra 剧情编号校验失败。');
          }
          [parsedCn, parsedJp] = await Promise.all([
            fetchSource(sourcePathCn, `${id}_cn.txt`, sourceCnOptional),
            fetchSource(sourcePathJp, `${id}_jp.txt`),
          ]);
        }

        if (!active) return;
        const nextCnEventLines = parsedCn?.eventLines ?? [];
        const nextJpEventLines = parsedJp?.eventLines ?? [];
        // Exedra uses exact JSON text-event alignment. Display the same event
        // sequence used by editing/JSON downloads instead of merging adjacent
        // speakers independently in each language.
        const nextCnLines = isExedraStory || currentStory?.source_format === 'supplemental-text/v1'
          ? nextCnEventLines
          : parsedCn?.lines ?? [];
        const nextJpLines = isExedraStory
          ? nextJpEventLines
          : parsedJp?.lines ?? [];
        if (nextCnLines.length === 0 && nextJpLines.length === 0) {
          throw new Error('文件中没有找到可显示的剧情文本。');
        }

        setCnLines(nextCnLines);
        setJpLines(nextJpLines);
        setCnEventLines(nextCnEventLines);
        setJpEventLines(nextJpEventLines);
        setCnSource(parsedCn?.source ?? null);
        setJpSource(parsedJp?.source ?? null);
        setParseWarnings([...(parsedCn?.warnings ?? []), ...(parsedJp?.warnings ?? [])]);
        setStoryTitle(localTitle || parsedCn?.title || parsedJp?.title || '');
        setMode(
          (nextCnLines.length > 0 || currentStory?.has_cn) && nextJpLines.length > 0
            ? 'split'
            : nextCnLines.length > 0
              ? 'cn'
              : 'jp',
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : '剧情加载失败。');
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    id,
    isLocal,
    directSourceResolution.sources?.kind,
    sourceCnOptional,
    sourceError,
    sourcePathCn,
    sourcePathJp,
    sourceReady,
    isExedraStory,
  ]);

  useEffect(() => {
    const sourceIdentity = currentStory?.source_identity ?? '';
    setVoicePanelExpanded(false);
    setLegacyVoiceRoute(null);
    setLegacyVoiceRouteError('');
    if (isLocal || !sourceIdentity || !currentLegacyVoiceRoutePath) {
      setLegacyVoiceRouteLoading(false);
      return;
    }

    const controller = new AbortController();
    setLegacyVoiceRouteLoading(true);
    void fetch(currentLegacyVoiceRoutePath, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(async response => {
        if (!response.ok) {
          throw new Error(`语音路由读取失败（HTTP ${response.status}）`);
        }
        const declaredLength = Number(response.headers.get('content-length'));
        if (
          Number.isFinite(declaredLength)
          && declaredLength > MAX_VOICE_ROUTE_BYTES
        ) {
          await response.body?.cancel('语音路由超过大小限制');
          throw new Error('语音路由超过 2 MB 大小限制');
        }
        const payload = await readBoundedResponseBody(
          response,
          MAX_VOICE_ROUTE_BYTES,
          '语音路由',
        );
        let raw: string;
        try {
          raw = new TextDecoder('utf-8', { fatal: true }).decode(payload);
        } catch {
          throw new Error('语音路由不是有效的 UTF-8 JSON');
        }
        let value: unknown;
        try {
          value = JSON.parse(raw) as unknown;
        } catch {
          throw new Error('语音路由 JSON 解析失败');
        }
        return { ...parseLegacyVoiceRouteDocument(value, sourceIdentity), documentSha256: await hashNativeText(raw) };
      })
      .then(route => {
        if (!controller.signal.aborted) setLegacyVoiceRoute(route);
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!controller.signal.aborted) {
          setLegacyVoiceRouteError(
            error instanceof Error ? error.message : '语音路由读取失败',
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLegacyVoiceRouteLoading(false);
      });
    return () => controller.abort();
  }, [
    currentLegacyVoiceRoutePath,
    currentStory?.source_identity,
    isLocal,
  ]);

  useEffect(() => {
    const route = legacyVoiceRoute, cnRaw = cnSource?.raw ?? '', jpRaw = jpSource?.raw ?? '';
    const binding = { route, cnRaw, jpRaw };
    if (!route || route.chineseVariantId === route.japaneseVariantId || !cnSource || !jpSource) {
      setNativeCorrespondenceState({ ...binding, data: null, error: '', loading: false }); return;
    }
    const controller = new AbortController();
    setNativeCorrespondenceState({ ...binding, data: null, error: '', loading: true });
    void loadNativeCorrespondence(route, cnRaw, jpRaw, controller.signal)
      .then(data => { if (!controller.signal.aborted) setNativeCorrespondenceState({ ...binding, data, error: '', loading: false }); })
      .catch(error => { if (!controller.signal.aborted) setNativeCorrespondenceState({ ...binding, data: null,
        error: error instanceof Error ? error.message : '原作跨版本对应读取失败', loading: false }); });
    return () => controller.abort();
  }, [legacyVoiceRoute, cnSource, jpSource]);
  const currentNativeCorrespondence = nativeCorrespondenceState.route === legacyVoiceRoute
    && nativeCorrespondenceState.cnRaw === cnSource?.raw && nativeCorrespondenceState.jpRaw === jpSource?.raw
    ? nativeCorrespondenceState.data : null;

  useEffect(() => {
    const route = legacyVoiceRoute, cnRaw = cnSource?.raw ?? '', jpRaw = jpSource?.raw ?? '';
    const binding = { route, cnRaw, jpRaw };
    if (!route || !jpSource) { setNativeEditState({ ...binding, source: null, error: '' }); return; }
    const controller = new AbortController();
    setNativeEditState({ ...binding, source: null, error: '' });
    void loadNativeEditSource(route, cnRaw, jpRaw, controller.signal)
      .then(source => { if (!controller.signal.aborted) setNativeEditState({ ...binding, source, error: '' }); })
      .catch(error => { if (!controller.signal.aborted) setNativeEditState({ ...binding, source: null,
        error: error instanceof Error ? error.message : '原生编辑来源加载失败' }); });
    return () => controller.abort();
  }, [legacyVoiceRoute, cnSource, jpSource]);
  const currentNativeEditSource = nativeEditState.route === legacyVoiceRoute
    && nativeEditState.cnRaw === (cnSource?.raw ?? '') && nativeEditState.jpRaw === (jpSource?.raw ?? '') ? nativeEditState.source : null;
  nativeEditSourceRef.current = currentNativeEditSource;
  const nativeEditRowsByKey = useMemo(() => new Map(currentNativeEditSource?.document.rows.map(row => [row.key, row]) ?? []), [currentNativeEditSource]);

  const displayedCnLines =
    isEditMode && editedCnLines.length > 0 ? editedCnLines : cnLines;
  const displayedJpLines =
    isEditMode && jpEventLines.length > 0 ? jpEventLines : jpLines;
  const legacyVoiceSlotState = useMemo(() => {
    const unresolved = {
      cn: buildUnresolvedLegacyVoiceSlots(cnEventLines),
      jp: buildUnresolvedLegacyVoiceSlots(jpEventLines),
    };
    if (!legacyVoiceRoute) return { ...unresolved, error: '' };
    try {
      return {
        cn: buildLegacyVoiceSlots(legacyVoiceRoute, 'zh-CN', cnEventLines),
        jp: buildLegacyVoiceSlots(legacyVoiceRoute, 'ja-JP', jpEventLines),
        error: '',
      };
    } catch (error) {
      return {
        ...unresolved,
        error: error instanceof Error ? error.message : '语音路由映射失败',
      };
    }
  }, [cnEventLines, jpEventLines, legacyVoiceRoute]);
  const nativeAlignmentState = useMemo(() => {
    if (!legacyVoiceRoute) return { rows: currentLegacyVoiceRoutePath ? [] : null, error: '' };
    if (cnEventLines.length === 0 && jpEventLines.length === 0) return { rows: [], error: '' };
    try {
      const shared = buildSharedNativeAlignment(legacyVoiceRoute, cnEventLines, jpEventLines);
      if (nativeEditState.error) throw Error(nativeEditState.error);
      if (shared !== null) return { rows: projectNativeReaderRevisionRows(shared, currentNativeEditSource), error: '' };
      if (!currentNativeCorrespondence && !nativeCorrespondenceState.error) return { rows: [], error: '' };
      const parallel = buildParallelNativeAlignment(legacyVoiceRoute, cnEventLines, jpEventLines,
        currentNativeCorrespondence ?? unpairedNativeCorrespondence(legacyVoiceRoute));
      return { rows: projectNativeReaderRevisionRows(parallel, currentNativeEditSource), error: nativeCorrespondenceState.error };
    }
    catch (error) { return { rows: [], error: error instanceof Error ? error.message : '原作事件对应失败' }; }
  }, [legacyVoiceRoute, cnEventLines, jpEventLines, currentNativeCorrespondence, nativeCorrespondenceState.error, currentLegacyVoiceRoutePath, currentNativeEditSource, nativeEditState.error]);
  const nativePresentationState = useMemo(() => {
    if (nativeAlignmentState.rows === null) return { rows: null, error: nativeAlignmentState.error };
    try {
      const rows = isEditMode ? (editedCnLines.length > 0
        ? applyNativeEditedLines(nativeAlignmentState.rows, editedCnLines) : nativeAlignmentState.rows)
        : mergeNativeAlignedRows(nativeAlignmentState.rows);
      return { rows: mode === 'split' || isEditMode ? rows : rows.filter(row => mode === 'cn' ? row.cn : row.jp), error: nativeAlignmentState.error };
    }
    catch (error) { return { rows: [], error: error instanceof Error ? error.message : '编辑事件对应失败' }; }
  }, [nativeAlignmentState, isEditMode, editedCnLines, mode]);
  const cnVoiceSlots = nativePresentationState.rows !== null
    ? nativePresentationState.rows.map(row => row.cnSlot) : isEditMode
    ? legacyVoiceSlotState.cn.eventSlots
    : legacyVoiceSlotState.cn.displaySlots;
  const jpVoiceSlots = nativePresentationState.rows !== null
    ? nativePresentationState.rows.map(row => row.jpSlot) : isEditMode
    ? legacyVoiceSlotState.jp.eventSlots
    : legacyVoiceSlotState.jp.displaySlots;
  const renderList = useMemo(
    () => nativePresentationState.rows ?? alignStoryLines(displayedCnLines, displayedJpLines),
    [nativePresentationState.rows, displayedCnLines, displayedJpLines],
  );
  const nativeEventRows = useMemo(() => indexNativeEventRows(renderList), [renderList]);
  const nativeSourceEventRows = useMemo(() => indexNativeEventRows(nativeAlignmentState.rows ?? []), [nativeAlignmentState.rows]);
  const nativeSectionAnchors = useMemo(
    () => indexNativeSectionAnchors(currentStory, nativePresentationState.rows ?? [],
      mode === 'split' ? undefined : mode === 'jp' ? 'ja-JP' : 'zh-CN'),
    [currentStory, nativePresentationState.rows, mode],
  );
  const activeVoiceSlots = useMemo(
    () => Array.from(
      { length: renderList.length },
      (_, index) => activeLegacyVoiceSlot(
        mode,
        cnVoiceSlots[index],
        jpVoiceSlots[index],
      ),
    ),
    [cnVoiceSlots, jpVoiceSlots, mode, renderList.length],
  );
  const legacyVoiceSummary = useMemo(
    () => summarizeLegacyVoiceSlots(activeVoiceSlots),
    [activeVoiceSlots],
  );
  const detachedLegacyVoiceCues = useMemo(
    () => activeLegacyVoiceCues(
      mode,
      applyNativeCueAliases(legacyVoiceSlotState.cn.detachedCues, 'cn', currentNativeCorrespondence),
      applyNativeCueAliases(legacyVoiceSlotState.jp.detachedCues, 'jp', currentNativeCorrespondence),
    ),
    [legacyVoiceSlotState.cn.detachedCues, legacyVoiceSlotState.jp.detachedCues, mode, currentNativeCorrespondence],
  );
  const effectiveLegacyVoiceError =
    legacyVoiceRouteError || legacyVoiceSlotState.error || nativePresentationState.error;
  const legacyVoiceSequence = useMemo(() => {
    if (!legacyVoiceRoute || effectiveLegacyVoiceError || nativePresentationState.rows?.length === 0) return [];
    return buildLegacyVoiceSequence(legacyVoiceRoute, mode === 'cn' ? 'zh-CN' : 'ja-JP',
      mode === 'cn' ? cnVoiceSlots : jpVoiceSlots);
  }, [legacyVoiceRoute, effectiveLegacyVoiceError, mode, cnVoiceSlots, jpVoiceSlots, nativePresentationState.rows]);
  const textStatistics = useMemo(() => {
    const total = emptyTextTotals();
    const sections = new Map<number, TextTotals>();
    const rows = new Map<number, TextTotals>();
    let section: TextTotals | undefined;
    renderList.forEach((row, index) => {
      if (row.cn?.isHeader || row.jp?.isHeader) {
        section = emptyTextTotals(); sections.set(index, section); return;
      }
      const stats = sourceTextTotals(row); rows.set(index, stats);
      for (const target of section ? [total, section] : [total]) {
        for (const key of Object.keys(stats) as (keyof TextTotals)[]) target[key] += stats[key];
      }
    });
    // Native sentence merging and language filters change presentation only.
    // Whole-story/section source totals always use the unmerged native rows.
    if (nativeAlignmentState.rows && !isEditMode) {
      Object.assign(total, emptyTextTotals());
      const fullSections = new Map<string | undefined, TextTotals>();
      let fullSection: TextTotals | undefined;
      for (const row of nativeAlignmentState.rows) {
        if (row.cn?.isHeader || row.jp?.isHeader) {
          fullSection = emptyTextTotals(); fullSections.set((row.cn ?? row.jp)?.headerId, fullSection); continue;
        }
        const stats = sourceTextTotals(row);
        for (const target of fullSection ? [total, fullSection] : [total]) {
          for (const key of Object.keys(stats) as (keyof TextTotals)[]) target[key] += stats[key];
        }
      }
      renderList.forEach((row, index) => {
        if (row.cn?.isHeader || row.jp?.isHeader) sections.set(index, fullSections.get((row.cn ?? row.jp)?.headerId) ?? emptyTextTotals());
      });
    }
    return { total, sections, rows };
  }, [renderList, nativeAlignmentState.rows, isEditMode]);
  const measuredPageLines = Object.values(lineCounts).reduce((sum, row) => ({ cn: sum.cn + row.cn, jp: sum.jp + row.jp }), { cn: 0, jp: 0 });
  const firstStoryHeaderIndex = useMemo(
    () => renderList.findIndex(row => row.cn?.isHeader || row.jp?.isHeader),
    [renderList],
  );
  const storyRowsPerPage = theme === 'frost'
    ? FROST_STORY_ROWS_PER_PAGE
    : CLASSIC_STORY_ROWS_PER_PAGE;
  const pageCount = Math.max(1, Math.ceil(renderList.length / storyRowsPerPage));
  const pageStart = visiblePage * storyRowsPerPage;
  const visibleRenderList = renderList.slice(
    pageStart,
    pageStart + storyRowsPerPage,
  );

  useEffect(() => {
    const readerDocument = readerDocumentRef.current;
    if (!readerDocument || loading || loadError) return;
    let request = 0;
    let disposed = false;
    const measure = () => {
      const docRect = readerDocument.getBoundingClientRect();
      const counts: Record<number, MeasuredRow> = {};
      const nextMarks: FilmRulerMark[] = [];
      const printedLines = { cn: 0, jp: 0 };
      for (const row of Array.from(readerDocument.querySelectorAll<HTMLElement>('[data-reader-row-index]'))) {
        const cn = measurePrintedText(row.querySelector('[data-reader-text-content="cn"]'));
        const jp = measurePrintedText(row.querySelector('[data-reader-text-content="jp"]'));
        const rowIndex = Number(row.dataset.readerRowIndex);
        counts[rowIndex] = { cn: cn.lines.length, jp: jp.lines.length, cnChars: cn.characters, jpChars: jp.characters };
        // Each language owns its printed-line sequence, including stacked panes.
        for (const language of ['cn', 'jp'] as const) {
          for (const line of (language === 'cn' ? cn : jp).lines) {
            const displayIndex = ++printedLines[language];
            nextMarks.push({ language, rowIndex, displayIndex,
              offsetPx: (line.top + line.bottom) / 2 - docRect.top,
              major: displayIndex === 1 || displayIndex % 5 === 0 });
          }
        }
      }
      setLineCounts(old => JSON.stringify(old) === JSON.stringify(counts) ? old : counts);
      setFilmRulerMarks(old => JSON.stringify(old) === JSON.stringify(nextMarks) ? old : nextMarks);
    };
    const schedule = () => { cancelAnimationFrame(request); request = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(readerDocument);
    readerDocument.querySelectorAll('[data-reader-text-cell]').forEach(cell => observer.observe(cell));
    document.fonts.ready.then(() => { if (!disposed) schedule(); });
    document.fonts.addEventListener('loadingdone', schedule);
    schedule();
    return () => { disposed = true; cancelAnimationFrame(request); observer.disconnect(); document.fonts.removeEventListener('loadingdone', schedule); };
  }, [bilingualLayout, fontSize, isEditMode, lineHeight, loadError, loading, mode,
    readerDisplayPreferences.showLineBreaks, readerDisplayPreferences.textWidthPx,
    theme, visiblePage, renderList, deferredSearchQuery]);
  const editedLineIndices = useMemo(
    () => new Map(editedCnLines.map((line, index) => [line, index])),
    [editedCnLines],
  );

  useEffect(() => {
    setVisiblePage(current => Math.min(current, pageCount - 1));
  }, [pageCount, storyRowsPerPage]);

  useEffect(() => {
    setVisiblePage(0);
    setPendingRowScroll(null);
  }, [id]);

  const revealRow = useCallback((rowIndex: number, highlight = false) => {
    if (rowIndex < 0) return;
    voicePlaybackController.stop();
    setVisiblePage(Math.floor(rowIndex / storyRowsPerPage));
    setPendingRowScroll({ rowIndex, highlight });
  }, [storyRowsPerPage]);

  useEffect(() => {
    const revealAnchor = () => {
      let anchor: string;
      try { anchor = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
      if (!anchor) return;
      const sourceTarget = resolveNativeSourceAnchor(anchor, nativeEventRows);
      const sourceIdentity = sourceTarget ?? resolveNativeSourceAnchor(anchor, nativeSourceEventRows);
      if (sourceIdentity) {
        if (mode !== sourceIdentity.mode) { setMode(sourceIdentity.mode); return; }
        if (sourceTarget) revealRow(sourceTarget.rowIndex, true);
        return;
      }
      const nativeRow = nativeSectionAnchors.byAnchor.get(anchor);
      const rowIndex = nativeRow ?? renderList.findIndex(row =>
        (row.cn?.isHeader && row.cn.headerId === anchor) || (row.jp?.isHeader && row.jp.headerId === anchor));
      if (rowIndex >= 0) revealRow(rowIndex);
    };
    revealAnchor();
    window.addEventListener('hashchange', revealAnchor);
    return () => window.removeEventListener('hashchange', revealAnchor);
  }, [id, mode, nativeEventRows, nativeSourceEventRows, nativeSectionAnchors, renderList, revealRow]);

  useEffect(() => {
    void initializeReaderFonts();
    if (isExedraStory) void initializeExedraFonts();
  }, [isExedraStory]);

  useEffect(() => {
    const stopForHiddenPage = () => {
      if (document.visibilityState === 'hidden') {
        voicePlaybackController.stop();
      }
    };
    window.addEventListener('pagehide', voicePlaybackController.stop);
    document.addEventListener('visibilitychange', stopForHiddenPage);
    return () => {
      window.removeEventListener('pagehide', voicePlaybackController.stop);
      document.removeEventListener('visibilitychange', stopForHiddenPage);
      voicePlaybackController.stop();
    };
  }, [id]);

  // Explicit navigation cancels through stop(); auto-follow below intentionally
  // changes pages without cancelling the run that requested the next subtitle.
  useEffect(() => {
    voicePlaybackController.stop();
    return voicePlaybackController.stop;
  }, [id, mode, isEditMode, storyRowsPerPage, legacyVoiceRoute]);
  const startLegacyVoiceSequence = () => {
    if (loading || legacyVoiceRouteLoading || effectiveLegacyVoiceError || legacyVoiceSequence.length === 0) return;
    setVoicePanelExpanded(true);
    void voicePlaybackController.playSequence(legacyVoiceSequence, entry => {
      if (entry.rowIndex === null) return;
      setVisiblePage(Math.floor(entry.rowIndex / storyRowsPerPage));
      setPendingRowScroll({ rowIndex: entry.rowIndex, highlight: false });
    });
  };

  const changeVisiblePage = useCallback((page: number) => {
    const nextPage = Math.min(pageCount - 1, Math.max(0, page));
    if (nextPage === visiblePage) return;
    voicePlaybackController.stop();
    if (pageTurnResetRef.current !== null) window.clearTimeout(pageTurnResetRef.current);
    setPageTurnDirection(nextPage > visiblePage ? 'next' : 'prev');
    setPageTurnSequence(value => value + 1);
    pageTurnResetRef.current = window.setTimeout(() => {
      pageTurnResetRef.current = null;
      setPageTurnDirection(null);
    }, 680);
    setVisiblePage(nextPage);
    setPendingRowScroll({
      rowIndex: nextPage * storyRowsPerPage,
      highlight: false,
    });
  }, [pageCount, storyRowsPerPage, visiblePage]);


  useEffect(() => {
    if (!pageTurnDirection || !isNightTheme(theme) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const doc = readerDocumentRef.current;
    if (!doc) return;
    const sign = pageTurnDirection === 'next' ? 1 : -1;
    // Frost advances a physical film frame behind fixed glass and scales.
    // Only compositor transforms/opacity move; no full-page blur or TV scan overlay.
    const travel = Math.min((doc.closest('main')?.clientHeight || 600) * .32, 180);
    const animation = doc.animate(theme === 'frost' ? [
      { transform: `translateY(${sign * travel}px)`, opacity: .12 },
      { offset: .16, transform: `translateY(${sign * travel * .48}px)`, opacity: .48 },
      { offset: .64, transform: `translateY(${sign * 3}px)`, opacity: .96 },
      { transform: 'none', opacity: 1 },
    ] : [
      { transform: `translateY(${sign * 34}px) skewX(-.45deg)`, opacity: .32, filter: 'blur(.65px)' },
      { offset: .24, transform: `translateY(${-sign * 8}px) skewX(.6deg)`, opacity: .8, filter: 'blur(.25px)' },
      { offset: .41, transform: `translateY(${sign * 3}px) translateX(-2px)`, opacity: .92, filter: 'blur(.1px)' },
      { offset: .6, transform: 'translateY(-1px) translateX(1px)', opacity: 1, filter: 'blur(.15px)' },
      { transform: 'none', opacity: 1, filter: 'none' },
    ], { duration: theme === 'frost' ? 380 : 620, easing: theme === 'frost' ? 'ease-out' : 'steps(2, end)' });
    return () => animation.cancel();
  }, [pageTurnSequence, pageTurnDirection, theme]);
  useEffect(() => () => {
    if (pageTurnResetRef.current !== null) window.clearTimeout(pageTurnResetRef.current);
  }, []);

  useEffect(() => {
    if (pageCount <= 1) return;

    const handlePageTurnKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        isReaderPagingInteractionTarget(event.target)
      ) {
        return;
      }
      if (event.key === 'ArrowLeft' && visiblePage > 0) {
        event.preventDefault();
        changeVisiblePage(visiblePage - 1);
      } else if (
        event.key === 'ArrowRight' &&
        visiblePage + 1 < pageCount
      ) {
        event.preventDefault();
        changeVisiblePage(visiblePage + 1);
      }
    };

    window.addEventListener('keydown', handlePageTurnKeyDown);
    return () => window.removeEventListener('keydown', handlePageTurnKeyDown);
  }, [changeVisiblePage, pageCount, visiblePage]);

  const handlePageTouchStart = useCallback(
    (event: React.TouchEvent<HTMLElement>) => {
      if (
        event.touches.length !== 1 ||
        isReaderPagingInteractionTarget(event.target)
      ) {
        pageTouchStartRef.current = null;
        return;
      }
      const touch = event.touches.item(0);
      pageTouchStartRef.current = touch
        ? { x: touch.clientX, y: touch.clientY }
        : null;
    },
    [],
  );

  const handlePageTouchEnd = useCallback(
    (event: React.TouchEvent<HTMLElement>) => {
      const start = pageTouchStartRef.current;
      pageTouchStartRef.current = null;
      const touch = event.changedTouches.item(0);
      if (!start || event.changedTouches.length !== 1 || !touch) return;

      const horizontalDistance = touch.clientX - start.x;
      const verticalDistance = touch.clientY - start.y;
      if (
        Math.abs(horizontalDistance) < PAGE_SWIPE_MIN_DISTANCE_PX ||
        Math.abs(horizontalDistance) <= Math.abs(verticalDistance) * 1.25
      ) {
        return;
      }
      if (horizontalDistance > 0 && visiblePage > 0) {
        changeVisiblePage(visiblePage - 1);
      } else if (
        horizontalDistance < 0 &&
        visiblePage + 1 < pageCount
      ) {
        changeVisiblePage(visiblePage + 1);
      }
    },
    [changeVisiblePage, pageCount, visiblePage],
  );

  useEffect(() => {
    if (!pendingRowScroll) return;
    const targetPage = Math.floor(
      pendingRowScroll.rowIndex / storyRowsPerPage,
    );
    if (targetPage !== visiblePage) return;

    const frame = window.requestAnimationFrame(() => {
      const pendingRow = renderList[pendingRowScroll.rowIndex];
      const header = pendingRow?.cn?.isHeader
        ? pendingRow.cn
        : pendingRow?.jp?.isHeader
          ? pendingRow.jp
          : undefined;
      const target = document.getElementById(
        nativeSectionAnchors.byRow.get(pendingRowScroll.rowIndex)?.[0]?.anchorId
          || header?.headerId || `line-${pendingRowScroll.rowIndex}`,
      );
      if (!target) {
        setPendingRowScroll(null);
        return;
      }
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (pendingRowScroll.highlight) {
        target.classList.add('ring-4', 'ring-amber-400');
        window.setTimeout(
          () => target.classList.remove('ring-4', 'ring-amber-400'),
          1500,
        );
      }
      setPendingRowScroll(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingRowScroll, renderList, storyRowsPerPage, visiblePage, nativeSectionAnchors]);

  const normalizedQuery = useMemo(
    () => normalizeSearchText(deferredSearchQuery),
    [deferredSearchQuery],
  );

  const findMatchedIndices = useCallback((query: string): number[] => {
    if (!query) return [];
    const matches: number[] = [];
    renderList.forEach((row, index) => {
      const header = row.cn?.isHeader ? row.cn : row.jp?.isHeader ? row.jp : undefined;
      const choice = row.cn?.isChoice ? row.cn : row.jp?.isChoice ? row.jp : undefined;
      const searchable = [
        row.cn?.speaker,
        row.cn?.text,
        row.jp?.speaker,
        row.jp?.text,
        header?.headerSection ? `第${header.headerSection}节 节${header.headerSection}` : '',
        header?.headerBranch ? `分支${header.headerBranch} 路线${header.headerBranch}` : '',
        choice?.choiceLabel ? `${choice.choiceLabel} 选项 分支` : '',
      ].filter(Boolean).join(' ');
      if (normalizeSearchText(searchable).includes(query)) matches.push(index);
    });
    return matches;
  }, [renderList]);
  const matchedIndices = useMemo(
    () => findMatchedIndices(normalizedQuery),
    [findMatchedIndices, normalizedQuery],
  );

  const jumpToNextMatch = useCallback(() => {
    const immediateQuery = normalizeSearchText(searchQuery);
    const currentMatches =
      immediateQuery === normalizedQuery
        ? matchedIndices
        : findMatchedIndices(immediateQuery);
    if (currentMatches.length === 0) return;
    const next = currentMatchIndex < 0
      ? 0
      : (currentMatchIndex + 1) % currentMatches.length;
    setCurrentMatchIndex(next);
    revealRow(currentMatches[next]);
  }, [
    currentMatchIndex,
    findMatchedIndices,
    matchedIndices,
    normalizedQuery,
    revealRow,
    searchQuery,
  ]);

  const changeSearch = (value: string) => {
    setSearchQuery(value);
    setCurrentMatchIndex(-1);
  };

  const initializeEditing = useCallback((seed: EditSeed) => {
    if (currentStory?.source_identity && !currentNativeEditSource) {
      setEditMessage(nativeEditState.error || '原生修订版本准备中，请稍后进入编辑'); return false;
    }
    if (currentStory?.source_identity && (!legacyVoiceRoute || nativeAlignmentState.error)) {
      setEditMessage(nativeAlignmentState.error || '原作事件索引准备中，请稍后进入编辑'); return false;
    }
    const next = nativeAlignmentState.rows !== null
      ? seedNativeEditableLines(nativeAlignmentState.rows, seed)
      : seedEditableLines(cnEventLines, jpEventLines, seed);
    if (next.length === 0) {
      setEditMessage('当前剧情没有可编辑的文本。');
      return false;
    }
    setEditedCnLines(next);
    setMode(jpEventLines.length > 0 ? 'split' : 'cn');
    setEditMessage('');
    return true;
  }, [currentStory?.source_identity, currentNativeEditSource, nativeEditState.error,
    legacyVoiceRoute, nativeAlignmentState, cnEventLines, jpEventLines]);

  const nativeEditingLoading = Boolean(currentStory?.source_identity) &&
    (!currentNativeEditSource || !legacyVoiceRoute || !nativeAlignmentState.rows?.length);
  const nativeEditingError = nativeEditState.error || nativeAlignmentState.error;
  useEffect(() => {
    if (!editRequestedByUrl) { consumedEditDeepLink.current = ''; return; }
    if (!storyIndexReady || loading || loadError || consumedEditDeepLink.current === id) return;
    consumedEditDeepLink.current = id;
    setPendingEditStoryId(id);
  }, [id, editRequestedByUrl, storyIndexReady, loading, loadError]);
  useEffect(() => {
    if (pendingEditStoryId !== id || isEditMode) return;
    if (nativeEditingError) {
      setPendingEditStoryId(null);
      setEditMessage(nativeEditingError);
      return;
    }
    if (nativeEditingLoading) return;
    if (initializeEditing('current')) setIsEditMode(true);
    setPendingEditStoryId(null);
  }, [id, pendingEditStoryId, isEditMode, nativeEditingLoading, nativeEditingError, initializeEditing]);

  const toggleEditMode = () => {
    if (pendingEditStoryId === id) {
      setPendingEditStoryId(null);
      setEditMessage('已取消打开编辑；原文未改变。');
      return;
    }
    if (isEditMode) {
      setIsEditMode(false);
      return;
    }
    if (nativeEditingLoading && !nativeEditingError) {
      setPendingEditStoryId(id);
      setEditMessage('正在准备原生编辑资料，完成后自动打开；再次点击可取消。');
      return;
    }
    if (editedCnLines.length === 0 && !initializeEditing('current')) return;
    setIsEditMode(true);
  };

  const downloadNativeRevisionText = () => {
    if (!currentNativeEditSource?.revision) return;
    triggerUtf8Download(serializeNativeRevisionText(currentNativeEditSource), id + '_revision.native.txt');
  };

  const downloadNativePatch = () => {
    try {
      if (!currentNativeEditSource) throw Error(nativeEditState.error || '原生编辑来源准备中');
      if (nativeAlignmentState.error) throw Error(nativeAlignmentState.error);
      const patch = createNativeTranslationPatch(currentNativeEditSource, editedCnLines);
      triggerUtf8Download(JSON.stringify(patch, null, 2) + '\n', id + '_native-translation.patch.json');
      setEditMessage(`已下载原生翻译补丁：${patch.changes.length} 个文本字段；原作指令、分支和媒体保持只读`);
    } catch (error) { setEditMessage(error instanceof Error ? error.message : '原生补丁生成失败'); }
  };

  const downloadTranslation = () => {
    if (currentLegacyVoiceRoutePath) { downloadNativePatch(); return; }
    const lines = editedCnLines.length > 0 ? editedCnLines : cnLines;
    if (lines.length === 0) {
      setEditMessage('当前没有可下载的中文内容。');
      return;
    }
    triggerUtf8Download(
      lines.map(serializeStoryLine).join('\n'),
      `${id}_translated.txt`,
    );
  };

  const fetchScenarioJson = async (
    language: 'jp' | 'cn',
    index: number,
  ): Promise<string> => {
    if (!currentStory || !selectedJsonSource) {
      throw new Error('当前剧情没有可用的 JSON 来源。');
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(
        `/api/story-json/${encodeURIComponent(currentStory.id)}/`
        + `${language}/${index}`,
        {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        await response.body?.cancel('剧情 JSON 请求失败');
        throw new Error(
          `来源 JSON 读取失败（HTTP ${response.status}）。`,
        );
      }
      const contentType = (
        response.headers.get('content-type') || ''
      ).split(';', 1)[0]?.trim().toLowerCase();
      if (contentType !== 'application/json') {
        await response.body?.cancel('剧情 JSON 类型异常');
        throw new Error('来源 JSON 返回了非 JSON 内容。');
      }
      const payload = await readBoundedResponseBody(
        response,
        MAX_STORY_SOURCE_BYTES,
        '来源 JSON',
      );
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(payload);
      } catch {
        throw new Error('来源 JSON 不是有效的 UTF-8 文本。');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('来源 JSON 读取超时。');
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const runJsonDownload = async (
    kind: Exclude<JsonDownloadBusy, null>,
    operation: () => Promise<string>,
  ) => {
    if (jsonDownloadBusyRef.current) return;
    jsonDownloadBusyRef.current = kind;
    setJsonDownloadBusy(kind);
    setEditMessage('');
    try {
      setEditMessage(await operation());
    } catch (error) {
      setEditMessage(
        error instanceof Error ? error.message : '剧情 JSON 下载失败。',
      );
    } finally {
      jsonDownloadBusyRef.current = null;
      setJsonDownloadBusy(null);
    }
  };

  const downloadOriginalJson = async (language: 'jp' | 'cn') => {
    const sourceIndex = selectedJsonSource?.[
      language === 'jp' ? 'jpIndex' : 'cnIndex'
    ];
    if (
      !selectedJsonSource ||
      sourceIndex === undefined ||
      !currentStory
    ) {
      setEditMessage(
        language === 'jp'
          ? '选中的 Section 没有日文原始 JSON。'
          : '选中的 Section 没有中文原始 JSON。',
      );
      return;
    }
    await runJsonDownload(language, async () => {
      const sourceJson = await fetchScenarioJson(language, sourceIndex);
      const download = createOriginalScenarioJsonDownload({
        sourceJson,
        sourceFilename: selectedJsonSource.filename,
        storyId:
          `${currentStory.id}_`
          + selectedJsonSource.filename.replace(/\.json$/iu, ''),
        language,
      });
      triggerScenarioJsonDownload(download);
      return `已生成 ${selectedJsonSource.filename} 的`
        + `${language === 'jp' ? '日文' : '中文'}原始 JSON。`;
    });
  };

  const downloadEditedJson = async () => {
    if (!selectedJsonSource || !currentStory) {
      setEditMessage('当前剧情没有可生成的 JSON 来源。');
      return;
    }
    if (editedCnLines.length === 0) {
      setEditMessage('请先初始化或上传中文编辑内容。');
      return;
    }
    const sourceLanguage: 'cn' | 'jp' | null =
      selectedJsonSource.cnIndex !== undefined
        ? 'cn'
        : selectedJsonSource.jpIndex !== undefined
          ? 'jp'
          : null;
    if (!sourceLanguage) {
      setEditMessage('选中的 Section 没有日文或中文结构 JSON。');
      return;
    }
    const sourceIndex =
      sourceLanguage === 'cn'
        ? selectedJsonSource.cnIndex
        : selectedJsonSource.jpIndex;
    if (sourceIndex === undefined) return;

    await runJsonDownload('edited', async () => {
      const sourceJson = await fetchScenarioJson(
        sourceLanguage,
        sourceIndex,
      );
      const generalVoice =
        currentStory.source_format === 'general_voice_json';
      let download;
      if (generalVoice) {
        download = createEditedScenarioJsonDownload({
          sourceJson,
          sourceFilename: selectedJsonSource.filename,
          storyId:
            `${currentStory.id}_`
            + selectedJsonSource.filename.replace(/\.json$/iu, ''),
          baselineLines: cnEventLines,
          editedLines: editedCnLines,
        });
      } else {
        const editingBaselineLines =
          cnEventLines.length > 0 ? cnEventLines : jpEventLines;
        const sourceBaselineLines =
          sourceLanguage === 'cn' ? cnEventLines : jpEventLines;
        if (
          editingBaselineLines.length === 0 ||
          sourceBaselineLines.length === 0
        ) {
          throw new Error('当前缺少可验证的逐事件 TXT 基准。');
        }
        const mapped = mapAggregateEditsToScenarioJson({
          sourceJson,
          sourceFilename: selectedJsonSource.filename,
          aggregateSourceBaselineLines: sourceBaselineLines,
          aggregateEditingBaselineLines: editingBaselineLines,
          aggregateEditedLines: editedCnLines,
        });
        download = createEditedScenarioJsonDownload({
          sourceJson,
          sourceFilename: selectedJsonSource.filename,
          storyId:
            `${currentStory.id}_`
            + selectedJsonSource.filename.replace(/\.json$/iu, ''),
          editedLines: mapped.editedLines,
        });
      }
      triggerScenarioJsonDownload(download);
      return sourceLanguage === 'cn'
        ? `已按中文结构生成可播放编辑 JSON；仅改动 ${download.changedTextFields} 个中文正文/角色名字段。`
        : `该 Section 没有中文 JSON；已明确使用日文 JSON 作为结构模板，`
          + `并用当前中文编辑行生成可播放 JSON。仅改动 `
          + `${download.changedTextFields} 个中文正文/角色名字段。`;
    });
  };

  const uploadTranslation = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const nativeSourceAtStart = currentNativeEditSource;
    try {
      const source = await readScenarioFile(file);
      if (currentLegacyVoiceRoutePath) {
        if (!nativeSourceAtStart || nativeEditSourceRef.current !== nativeSourceAtStart) throw Error('原生编辑来源准备中或剧情已切换');
        if (!nativeAlignmentState.rows || nativeAlignmentState.error) throw Error(nativeAlignmentState.error || '原作事件尚未就绪');
        const next = importNativeTranslationPatch(nativeSourceAtStart, JSON.parse(source.raw), nativeAlignmentState.rows);
        setEditedCnLines(next); setMode(jpEventLines.length > 0 ? 'split' : 'cn');
        setEditMessage('已按原生事件与源哈希导入翻译补丁；空字幕、空姓名与选项文本保留');
        return;
      }
      const parsed = parseStoryContent(source.raw, {
        filename: source.name,
        mergeConsecutiveTextLines: false,
      });
      if (parsed.lines.length === 0) throw new Error('文件中没有可编辑的剧情文本。');
      if (nativeAlignmentState.rows !== null) {
        if (nativeAlignmentState.error) throw Error(nativeAlignmentState.error);
        if (parsed.format !== 'plain-text') throw Error('原作 TXT 导入需要逐事件文本；原生结构补丁使用独立格式');
        const next = importNativeEditableLines(nativeAlignmentState.rows, parsed.lines);
        setEditedCnLines(next);
        setMode(jpEventLines.length > 0 ? 'split' : 'cn');
        setEditMessage('已按原作事件键载入逐事件 TXT；标题与分支目标保持不变');
        return;
      }
      if (
        !isLocal &&
        (parsed.format === 'magireco-json' ||
          parsed.format === 'exedra-json')
      ) {
        if (!selectedJsonSource || !currentStory) {
          throw new Error(
            '请先在“来源 JSON”中选择该文件对应的 Section。',
          );
        }
        const sourceLanguage: 'cn' | 'jp' | null =
          selectedJsonSource.cnIndex !== undefined
            ? 'cn'
            : selectedJsonSource.jpIndex !== undefined
              ? 'jp'
              : null;
        const sourceIndex =
          sourceLanguage === 'cn'
            ? selectedJsonSource.cnIndex
            : selectedJsonSource.jpIndex;
        if (!sourceLanguage || sourceIndex === undefined) {
          throw new Error('选中的 Section 没有结构 JSON。');
        }
        const sourceJson = await fetchScenarioJson(
          sourceLanguage,
          sourceIndex,
        );
        const editingBaselineLines =
          cnEventLines.length > 0 ? cnEventLines : jpEventLines;
        const next = applyScenarioJsonUploadToAggregate({
          sourceJson,
          uploadedJson: source.raw,
          sourceFilename: selectedJsonSource.filename,
          aggregateEditingBaselineLines: editingBaselineLines,
          aggregateCurrentEditedLines: editedCnLines,
        });
        setEditedCnLines(next);
        setMode(jpEventLines.length > 0 ? 'split' : 'cn');
        setEditMessage(
          `已从 ${file.name} 导入 ${selectedJsonSource.label} 的逐事件文本；`
          + '上传文件的动作、资源和其他播放字段不会直接写入。',
        );
        return;
      }
      const normalized = seedEditableLines(
        parsed.lines,
        jpEventLines,
        'current',
      );
      setEditedCnLines(normalized.length > 0 ? normalized : parsed.lines);
      setParseWarnings(previous => [...previous, ...parsed.warnings]);
      setEditMessage(`已载入 ${file.name}（${FORMAT_LABELS[parsed.format]}）。`);
    } catch (error) {
      setEditMessage(error instanceof Error ? error.message : '文件读取失败。');
    }
  };

  const handleTurnstileToken = useCallback((token: string) => {
    setTurnstileToken(token);
    if (token) setEditMessage('');
  }, []);

  const handleTurnstileError = useCallback((message: string) => {
    setTurnstileToken('');
    setEditMessage(message);
  }, []);

  const submitToCloud = async () => {
    if (currentLegacyVoiceRoutePath) { setEditMessage('通用工程尚未指定远端与投稿后端；请下载原生翻译补丁交付'); return; }
    if (!currentStory) {
      setEditMessage('剧情目录尚未确认当前编号，暂不能在线提交。');
      return;
    }
    if (editedCnLines.length === 0) {
      setEditMessage('请先初始化或上传翻译内容。');
      return;
    }
    if (!proofreadingConfig?.submissions_enabled) {
      setEditMessage('投稿服务尚未启用；请先下载当前进度作为备份。');
      return;
    }
    if (!storyIndexSha256 || !currentStory.source_identity) {
      setEditMessage('剧情版本信息尚未准备完成，请稍后重试。');
      return;
    }
    if (!turnstileToken) {
      setEditMessage('请先完成人机验证。');
      return;
    }

    const content = normalizeProofreadingText(
      editedCnLines.map(serializeStoryLine).join('\n'),
    );
    if (content.trim().length < 10) {
      setEditMessage('内容过短，请编辑后再提交。');
      return;
    }

    setSubmittingProofreading(true);
    setLastSubmissionId('');
    try {
      const [baseSha256, baseContentSha256] = await Promise.all([
        sha256Text(cnSource?.raw ?? ''),
        sha256Text(normalizeProofreadingText(
          cnLines.map(serializeStoryLine).join('\n'),
        )),
      ]);
      const response = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          story_id: currentStory.id,
          content,
          nickname: proofreadingNickname,
          note: proofreadingNote,
          base_sha256: baseSha256,
          base_content_sha256: baseContentSha256,
          catalog_sha256: storyIndexSha256,
          source_path_cn: currentStory.path_cn || '',
          source_path_jp: currentStory.path_jp || '',
          source_identity: currentStory.source_identity,
          turnstile_token: turnstileToken,
        }),
      });
      const responseText = await response.text();
      let data: {
        success?: boolean;
        id?: string;
        receipt?: string;
        status?: string;
        error?: string;
      } = {};
      try {
        data = JSON.parse(responseText) as typeof data;
      } catch {
        // Keep a generic error without exposing server internals.
      }
      if (!response.ok || !data.success || !data.id || !data.receipt) {
        throw new Error(data.error || `提交服务暂不可用（HTTP ${response.status}）`);
      }
      const nickname = proofreadingNickname.trim() || '匿名校对者';
      saveProofreadingReceipt({
        id: data.id,
        receipt: data.receipt,
        storyId: currentStory.id,
        nickname,
        submittedAt: new Date().toISOString(),
      });
      setLastSubmissionId(data.id);
      setEditMessage(`提交成功，审核编号：${data.id}`);
      setTurnstileToken('');
      setTurnstileResetKey((value) => value + 1);
    } catch (error) {
      setEditMessage(
        `${error instanceof Error ? error.message : '在线提交失败'}；已自动下载备份文件。`,
      );
      triggerUtf8Download(content, `${currentStory.id}_submit.txt`);
      setTurnstileToken('');
      setTurnstileResetKey((value) => value + 1);
    } finally {
      setSubmittingProofreading(false);
    }
  };

  const jumpToChoice = (rowIndex: number, choice: StoryLine) => {
    if (!choice.choiceTargetId) return;
    if (currentLegacyVoiceRoutePath) {
      const locale = renderList[rowIndex]?.jp === choice ? 'jp' : 'cn';
      const targetIndex = nativeEventRows[locale].get(choice.choiceTargetId);
      if (targetIndex !== undefined) {
        revealRow(targetIndex, true);
        return;
      }
      if (choice.choiceTargetId === 'end-001') {
        revealRow(renderList.length - 1, true);
        return;
      }
      // A same-looking offset in the other compiled language is not a target.
      return;
    }
    let source = choice.headerSourceId || '';
    let section = choice.headerSection || '';
    for (let index = rowIndex; index >= 0 && (!source || !section); index--) {
      const row = renderList[index];
      const header = row.cn?.isHeader ? row.cn : row.jp?.isHeader ? row.jp : undefined;
      source ||= header?.headerSourceId || '';
      section ||= header?.headerSection || '';
    }

    const exactId =
      source && section
        ? makeSectionAnchorId(source, section, choice.choiceTargetId)
        : '';
    let targetIndex = exactId
      ? renderList.findIndex(row => {
          const header = row.cn?.isHeader ? row.cn : row.jp?.isHeader ? row.jp : undefined;
          return header?.headerId === exactId;
        })
      : -1;
    if (targetIndex < 0) {
      const fallbackOffset = renderList.slice(rowIndex + 1).findIndex(row => {
        const header = row.cn?.isHeader ? row.cn : row.jp?.isHeader ? row.jp : undefined;
        return header?.headerBranch === choice.choiceTargetId;
      });
      if (fallbackOffset >= 0) targetIndex = rowIndex + 1 + fallbackOffset;
    }
    revealRow(targetIndex, true);
  };

  if (loading) return <LoadingScreen />;

  const currentTranslationReview=currentNativeEditSource?.revision?.translationReview;
  const readingCoverage=nativeAlignmentState.rows ? nativeCoverage(mergeNativeAlignedRows(nativeAlignmentState.rows),currentTranslationReview) : null;
  const hasChineseDisplay =
    cnLines.length > 0 || (readingCoverage?.hasChinese ?? false) || (isEditMode && editedCnLines.length > 0);
  const hasJapaneseDisplay = jpLines.length > 0;
  const modeAvailability: Record<ReaderMode, boolean> = {
    cn: hasChineseDisplay,
    split: hasChineseDisplay && hasJapaneseDisplay,
    jp: hasJapaneseDisplay,
  };
  const generalVoiceHasNoTrustedJapaneseColumn =
    currentStory?.category === 'general_voice' &&
    hasChineseDisplay &&
    !hasJapaneseDisplay &&
    !loadError;

  return (
    <IOSViewportHost><div
      id="magi-reader-display"
      data-reader-mode={isEditMode ? 'edit' : 'read'}
      data-reading-ruler={readingRulerEnabled ? 'on' : 'off'}
      data-mobile-sidebar-open={sidebarOpen ? 'true' : 'false'}
      className={`magi-reader-root ${isExedraStory ? 'magi-exedra-ui-scope' : ''} magi-reader-theme-${theme} ${theme === 'frost' ? 'magi-reader-theme-dark' : ''} flex h-screen h-[100dvh] overflow-hidden ${THEME_STYLES[theme]}`}
    >
      <ReaderStyleScope />
      {theme === 'frost' && <ReaderFilmSurface />}
      <ReaderTubeSurface theme={theme} />
      <div className="magi-scene-content">
      <Sidebar
        sourceLocale={mode === 'split' ? undefined : mode === 'jp' ? 'ja-JP' : 'zh-CN'}
        stories={allStories}
        currentId={currentStory?.id ?? id}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        className={sidebarOpen ? '' : 'hidden md:flex'}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <IOSHeaderSurface layer={36}>
        <div className="magi-reader-header-stack relative z-20 shrink-0">
        <header className={`magi-reader-header magi-reader-header-compact z-20 flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-2 py-1.5 ${HEADER_STYLES[theme]}`}>
          <div className="magi-reader-header-identity flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              aria-label="打开剧情目录"
              onClick={() => setSidebarOpen(true)}
              className="rounded p-2 -ml-2 hover:bg-black/5 md:hidden"
            >
              <Menu size={20} />
            </button>
            <div className="flex min-w-0 flex-col">
              <span
                lang={isExedraStory && mode === 'jp' ? 'ja' : undefined}
                className={`${isExedraStory && mode === 'jp' ? 'exedra-page ' : ''}truncate text-[10px] opacity-50 ${
                mode === 'jp' && hasJapaneseDisplay
                  ? 'reader-font-jp-title'
                  : 'reader-font-cn-title'
              }`}
              >
                {isLocal ? '本地文件' : currentStory?.folder || '剧情阅读器'}
                {storyTitle ? ` · ${storyTitle}` : ''}
              </span>
              <div className="magi-reader-header-meta flex min-w-0 flex-nowrap items-center gap-1 text-sm font-bold">
                <span className="magi-reader-story-id truncate font-mono text-emerald-600">{id}</span>
                {currentStory?.official_tw && (
                  <span
                    className="magi-reader-source-badge rounded-full border border-stone-400/35 bg-stone-200/35 px-2 py-0.5 text-[10px] font-medium tracking-wide text-stone-600 dark:border-stone-500/40 dark:bg-stone-700/35 dark:text-stone-300"
                    title="中文正文来自 Magia Exedra 台服官方文本，并已转换为简体中文"
                  >
                    {currentStory.official_tw_label || '台服'}
                  </span>
                )}
                {currentNativeEditSource?.revision && (
                  <button type="button" onClick={downloadNativeRevisionText}
                    title="下载当前中文修订（含原生事件键；空姓名和换行保留）"
                    className="magi-reader-source-download flex items-center gap-1 rounded px-1.5 py-0.5 opacity-50 transition hover:text-green-600 hover:opacity-100">
                    <Download size={14} /><span className="text-[10px]">修订 CN</span>
                  </button>
                )}
                {cnSource && (
                  <button
                    type="button"
                    title={`下载原始文件（${FORMAT_LABELS[cnSource.format]}）`}
                    onClick={() => triggerUtf8Download(
                      cnSource.raw,
                      sourceDownloadName(id, 'cn', cnSource),
                    )}
                    className="magi-reader-source-download flex items-center gap-1 rounded px-1.5 py-0.5 opacity-50 transition hover:text-green-600 hover:opacity-100"
                  >
                    <Download size={14} /><span className="text-[10px]">CN</span>
                  </button>
                )}
                {jpSource && (
                  <button
                    type="button"
                    title={`下载原始文件（${FORMAT_LABELS[jpSource.format]}）`}
                    onClick={() => triggerUtf8Download(
                      jpSource.raw,
                      sourceDownloadName(id, 'jp', jpSource),
                    )}
                    className="magi-reader-source-download flex items-center gap-1 rounded px-1.5 py-0.5 opacity-50 transition hover:text-blue-600 hover:opacity-100"
                  >
                    <Download size={14} /><span className="text-[10px]">JP</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="magi-reader-search-shell group relative mx-2 hidden min-w-48 max-w-sm flex-[0_1_20rem] lg:flex">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              aria-label="在当前剧情中搜索"
              placeholder="页内搜索"
              title="输入关键词后按 Enter 跳到下一处"
              value={searchQuery}
              onChange={event => changeSearch(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') jumpToNextMatch();
              }}
              className={`magi-reader-search-input h-9 w-full rounded-full border py-1.5 pl-9 pr-14 text-sm leading-5 outline-none transition ${
                isNightTheme(theme)
                  ? 'border-gray-700 bg-gray-800 text-gray-200 focus:border-blue-500'
                  : 'border-transparent bg-gray-100 focus:border-blue-400 focus:bg-white'
              }`}
            />
            {searchQuery && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-gray-400">
                {matchedIndices.length
                  ? `${currentMatchIndex >= 0 ? currentMatchIndex + 1 : 0}/${matchedIndices.length}`
                  : '0'}
              </span>
            )}
          </div>

          <div className="magi-reader-header-actions ml-auto flex shrink-0 items-center gap-1">
            <button
              type="button"
              data-voice-panel-toggle="true"
              aria-expanded={voicePanelExpanded}
              aria-pressed={voicePanelExpanded}
              aria-label={voicePanelExpanded ? '收起全部剧情语音' : '展开全部剧情语音'}
              title={
                effectiveLegacyVoiceError
                  ? effectiveLegacyVoiceError
                  : `可播放 ${legacyVoiceSummary.resolvedLines} / ${legacyVoiceSummary.totalLines} 行，共 ${legacyVoiceSummary.cueCount} 条行语音${detachedLegacyVoiceCues.length > 0 ? `，另有 ${detachedLegacyVoiceCues.length} 条无正文锚点语音` : ''}`
              }
              onClick={() => {
                setVoicePanelExpanded(expanded => {
                  if (expanded) voicePlaybackController.stop();
                  return !expanded;
                });
              }}
              className={`z-30 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                voicePanelExpanded
                  ? isNightTheme(theme)
                    ? 'bg-sky-700 text-white shadow-lg'
                    : 'bg-sky-600 text-white shadow-lg'
                  : isNightTheme(theme)
                    ? 'bg-white/10 text-gray-200 hover:bg-white/15'
                    : 'bg-sky-100 text-sky-800 hover:bg-sky-200'
              }`}
            >
              <Music2 size={14} />
              <span>语音</span>
              <span className="font-mono text-[10px] opacity-70">
                {legacyVoiceRouteLoading
                  ? '…'
                  : effectiveLegacyVoiceError
                    ? '!'
                    : `${legacyVoiceSummary.resolvedLines}/${legacyVoiceSummary.totalLines}`}
              </span>
            </button>
            <button
              type="button"
              aria-pressed={isEditMode}
              aria-busy={pendingEditStoryId === id}
              data-native-edit-state={pendingEditStoryId === id ? 'loading' : isEditMode ? 'editing' : 'reading'}
              onClick={toggleEditMode}
              className={`z-30 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                isEditMode
                  ? 'bg-emerald-600 text-white shadow-lg'
                  : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
              }`}
            >
              <Leaf size={14} />
              <span className="hidden sm:inline">{pendingEditStoryId === id ? '准备编辑…' : isEditMode ? '返回阅读' : '协助汉化'}</span>
            </button>
            <div className={`flex rounded p-0.5 text-[10px] font-bold ${isNightTheme(theme) ? 'bg-white/10' : 'bg-black/5'}`}>
              {(['cn', 'split', 'jp'] as const).map(nextMode => (
                <button
                  type="button"
                  key={nextMode}
                  disabled={!modeAvailability[nextMode]}
                  title={
                    modeAvailability[nextMode]
                      ? undefined
                      : nextMode === 'cn'
                        ? '当前没有可显示的中文文本'
                        : '当前没有可逐行证明的日文文本'
                  }
                  aria-label={
                    nextMode === 'cn'
                      ? '只显示中文'
                      : nextMode === 'jp'
                        ? '只显示日文'
                        : '显示中日双语'
                  }
                  aria-pressed={mode === nextMode}
                  onClick={() => {
                    if (modeAvailability[nextMode]) setMode(nextMode);
                  }}
                  className={`rounded px-2 py-1 ${
                    mode === nextMode
                      ? isNightTheme(theme) ? 'bg-gray-700 text-white' : 'bg-white shadow'
                      : 'opacity-40'
                  } ${
                    modeAvailability[nextMode]
                      ? ''
                      : 'cursor-not-allowed opacity-20'
                  }`}
                >
                  {nextMode === 'cn' ? '中' : nextMode === 'jp' ? '日' : '双'}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-label="打开阅读设置"
              onClick={() => setShowSettings(true)}
              className="rounded p-2 text-gray-500 hover:bg-black/5"
            >
              <Settings size={18} />
            </button>
          </div>
        </header>

        </div>
        </IOSHeaderSurface>

        {!loadError && (
          <DraggableReaderWidget
            storageKey={UTILITY_WIDGET_POSITION_STORAGE_KEY}
            defaultDock="top-right"
            ariaLabel="阅读导航悬浮工具"
            dragHandleLabel="拖动阅读导航悬浮工具"
            className={`magi-reader-utility-widget ${
              utilityPanelOpen ? 'is-expanded' : 'is-collapsed'
            }`}
          >
            {utilityPanelOpen ? (
              <section
                className="magi-reader-utility-panel magi-reader-utility-panel-floating"
                aria-label="阅读导航与分页"
              >
                <button
                  type="button"
                  aria-label="收起阅读导航"
                  title="收起为右上角悬浮按钮"
                  onClick={closeUtilityPanel}
                  className="magi-reader-utility-close"
                >
                  ×
                </button>
                <div className="magi-reader-utility-content">
                  <div className="magi-reader-utility-search lg:hidden">
                    <Search
                      size={16}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-45"
                    />
                    <input
                      type="search"
                      aria-label="在当前剧情中搜索"
                      placeholder="页内搜索"
                      title="输入关键词后按 Enter 跳到下一处"
                      value={searchQuery}
                      onChange={event => changeSearch(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === 'Enter') jumpToNextMatch();
                      }}
                      className="magi-reader-search-input h-9 w-full py-1.5 pl-9 pr-14 text-sm leading-5 outline-none"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={jumpToNextMatch}
                        className="magi-reader-search-next"
                      >
                        {matchedIndices.length
                          ? `${currentMatchIndex >= 0 ? currentMatchIndex + 1 : 0}/${matchedIndices.length} ↓`
                          : '0'}
                      </button>
                    )}
                  </div>
                  <div className="magi-reader-utility-actions">
                    <Link href="/" className="magi-reader-utility-button">
                      🏠 返回首页
                    </Link>
                    <button
                      type="button"
                      onClick={() => setAboutOpen(true)}
                      className="magi-reader-utility-button"
                    >
                      🔗 我的工具与动态
                    </button>
                    <div
                      className="magi-reader-utility-theme-switcher"
                      role="group"
                      aria-label="阅读主题"
                    >
                      {([
                        { key: 'light', icon: Sun, label: '亮色' },
                        { key: 'paper', icon: BookOpen, label: '护眼' },
                        { key: 'dark', icon: Moon, label: '暗黑' },
                        { key: 'frost', icon: ScanLine, label: '冷辉' },
                        { key: 'green', icon: Leaf, label: '绿色' },
                      ] as const).map(option => (
                        <button
                          type="button"
                          key={option.key}
                          data-theme-option={option.key}
                          aria-label={`切换为${option.label}主题`}
                          aria-pressed={theme === option.key}
                          title={option.label}
                          onClick={() => setTheme(option.key)}
                          className="magi-reader-theme-option"
                        >
                          <option.icon
                            size={15}
                            strokeWidth={theme === option.key ? 2.5 : 1.9}
                          />
                          <span className="sr-only">{option.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <span
                    aria-live="polite"
                    className="magi-reader-page-summary"
                  >
                    第 {visiblePage + 1} / {pageCount} 页 · 第 {pageStart + 1}–
                    {Math.min(
                      pageStart + visibleRenderList.length,
                      renderList.length,
                    )} 行，共 {renderList.length} 行
                  </span>
                </div>
              </section>
            ) : (
              <button
                type="button"
                aria-label="展开阅读导航"
                title="展开返回首页、工具与分页信息"
                onClick={openUtilityPanel}
                className="magi-reader-utility-fab"
              >
                <span aria-hidden="true">⌂</span>
                <span>导航</span>
              </button>
            )}
          </DraggableReaderWidget>
        )}

        <main
          className={`magi-reader-main z-10 flex-1 overflow-y-auto scroll-smooth p-2 md:p-6 ${
            pageCount > 1 ? 'magi-reader-main-paginated' : ''
          }`}
          onTouchStart={handlePageTouchStart}
          onTouchEnd={handlePageTouchEnd}
          onTouchCancel={() => {
            pageTouchStartRef.current = null;
          }}
          style={{
            fontSize: `${fontSize}px`,
            lineHeight,
          }}
        >
          {readingRulerEnabled && <ReaderFilmViewport readerRef={readerDocumentRef}
            marks={filmRulerMarks} theme={theme}
            direction={pageTurnDirection} sequence={pageTurnSequence} />}
          <div
            ref={readerDocumentRef}
            id="reader-document"
            className={`magi-reader-document mx-auto min-h-screen w-full min-w-0 rounded-lg pb-32 ${
            theme === 'paper' || theme === 'green'
              ? 'md:bg-white/40 md:px-12 md:py-8 md:shadow-sm md:backdrop-blur-[2px]'
              : ''
            }`}
            style={{ maxWidth: `${readerDisplayPreferences.textWidthPx}px` }}
          >
            {!loadError && <MaterialFrameLabel theme={theme} story={id} page={visiblePage} pages={pageCount}
              direction={pageTurnDirection} sequence={pageTurnSequence} />}
            {!loadError && <div className="magi-reader-document-statistics">
              <SourceStatistics stats={textStatistics.total} label="全文" />
              <span className="magi-reader-source-statistics" data-page-measured-lines="true">本页实排 LINES CN {measuredPageLines.cn} / JP {measuredPageLines.jp}</span>
            </div>}
            {loadError && (
              <div role="alert" className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
                <p className="font-bold">无法打开这段剧情</p>
                <p className="mt-1">{loadError}</p>
                <Link href="/" className="mt-3 inline-block underline">返回首页重新选择</Link>
              </div>
            )}

            {parseWarnings.length > 0 && !loadError && (
              <details className="mb-4 rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-900">
                <summary className="cursor-pointer font-bold">
                  已读取，但有 {parseWarnings.length} 条格式提示
                </summary>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {parseWarnings.slice(0, 20).map((warning, index) => (
                    <li key={`${warning}-${index}`}>{warning}</li>
                  ))}
                </ul>
              </details>
            )}

            {generalVoiceHasNoTrustedJapaneseColumn && (
              <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50/80 p-3 text-xs text-sky-900">
                这是魔法纪录语音资料。现有上游没有独立且完整、可逐行证明的日文字幕列，
                因此本站保留人工中文和语音编号，但不会伪造日文对照。Exedra 语音在存在
                可信中文时仍使用真实的中日对照。
              </div>
            )}

            {!isEditMode && !loadError && editMessage && (
              <p role="status" data-edit-startup-status="true" className="magi-proofreading-status mb-4 rounded-lg border p-3 text-sm">{editMessage}</p>
            )}
            {isEditMode && !loadError && (
              <section className="magi-proofreading-panel mb-4 p-3">
                <div className="magi-proofreading-toolbar">
                  <span className="magi-proofreading-kicker">初始化</span>
                  <button
                    type="button"
                    data-variant="secondary"
                    onClick={() => initializeEditing('empty')}
                    className="magi-proofreading-button"
                  >
                    仅填入译名
                  </button>
                  <button
                    type="button"
                    data-variant="secondary"
                    onClick={() => initializeEditing('jp')}
                    className="magi-proofreading-button"
                  >
                    填入日文原文
                  </button>
                  <label
                    data-variant="secondary"
                    className="magi-proofreading-button cursor-pointer"
                  >
                    {currentLegacyVoiceRoutePath ? '导入原生补丁 JSON' : '上传 JSON / TXT'}
                    <input
                      type="file"
                      accept={currentLegacyVoiceRoutePath ? '.json' : '.json,.txt'}
                      className="hidden"
                      onChange={uploadTranslation}
                    />
                  </label>
                  <button
                    type="button"
                    data-variant="primary"
                    onClick={downloadTranslation}
                    className="magi-proofreading-button"
                  >
                    {currentLegacyVoiceRoutePath ? '下载原生翻译补丁（JSON）' : '下载当前进度（UTF-8）'}
                  </button>
                  <label className="magi-proofreading-linebreak-toggle">
                    <input
                      type="checkbox"
                      checked={readerDisplayPreferences.showLineBreaks}
                      onChange={event =>
                        updateReaderDisplayPreferences({
                          showLineBreaks: event.target.checked,
                        })
                      }
                    />
                    <span>
                      <strong>显示换行符 <span aria-hidden="true">↵</span></strong>
                      <small>按 Enter 插入真实换行；TXT / JSON 下载会保留。</small>
                    </span>
                  </label>
                </div>

                {currentLegacyVoiceRoutePath ? <div data-native-edit-tools="true" className="magi-proofreading-json-tools mt-3">
                  <p className="magi-proofreading-help">原作事件键、版本与源哈希绑定。仅独立的原作姓名字段开放角色名编辑；IKURA 姓名包含在正文前缀中。音频 ID、时长、分支及指令只读。</p>
                  <p className="magi-proofreading-help">补丁可导回本页；本地版本化生产工具同步阅读投影、原生 TXT 和搜索索引，原游戏脚本保持原样。</p>
                  {!currentNativeEditSource && <p role={nativeEditState.error ? 'alert' : 'status'} className="magi-proofreading-alert">{nativeEditState.error || '正在核对原生编辑来源…'}</p>}
                </div> : (<>
                <div
                  data-scenario-json-tools="true"
                  className="magi-proofreading-json-tools mt-3"
                >
                  <div className="magi-proofreading-json-layout">
                    <label className="magi-proofreading-label">
                      来源 JSON（按 Section）
                      <select
                        aria-label="选择要下载或生成的来源 JSON"
                        value={selectedJsonSource?.key ?? ''}
                        onChange={event =>
                          setSelectedJsonSourceKey(event.target.value)
                        }
                        disabled={
                          jsonSourceOptionsState.options.length === 0 ||
                          jsonDownloadBusy !== null
                        }
                        className="magi-proofreading-select"
                      >
                        {jsonSourceOptionsState.options.length === 0 ? (
                          <option value="">当前剧情没有 JSON 来源清单</option>
                        ) : (
                          jsonSourceOptionsState.options.map(option => (
                            <option key={option.key} value={option.key}>
                              {option.label}
                            </option>
                          ))
                        )}
                      </select>
                    </label>

                    <div className="magi-proofreading-json-actions">
                      <button
                        type="button"
                        onClick={() => void downloadOriginalJson('jp')}
                        disabled={
                          jsonDownloadBusy !== null ||
                          selectedJsonSource?.jpIndex === undefined
                        }
                        data-variant="secondary" className="magi-proofreading-button magi-proofreading-json-button"
                      >
                        {jsonDownloadBusy === 'jp'
                          ? '读取日文 JSON…'
                          : '下载日文原始 JSON'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void downloadOriginalJson('cn')}
                        disabled={
                          jsonDownloadBusy !== null ||
                          selectedJsonSource?.cnIndex === undefined
                        }
                        data-variant="secondary" className="magi-proofreading-button magi-proofreading-json-button"
                      >
                        {jsonDownloadBusy === 'cn'
                          ? '读取中文 JSON…'
                          : '下载中文原始 JSON'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void downloadEditedJson()}
                        disabled={
                          jsonDownloadBusy !== null ||
                          !selectedJsonSource ||
                          (
                            selectedJsonSource.cnIndex === undefined &&
                            selectedJsonSource.jpIndex === undefined
                          ) ||
                          editedCnLines.length === 0
                        }
                        data-variant="primary" className="magi-proofreading-button magi-proofreading-json-button"
                      >
                        {jsonDownloadBusy === 'edited'
                          ? '校验并生成 JSON…'
                          : '下载本次编辑 JSON'}
                      </button>
                    </div>
                  </div>

                  {jsonSourceOptionsState.error ? (
                    <p className="magi-proofreading-alert mt-2">
                      {jsonSourceOptionsState.error}
                    </p>
                  ) : selectedJsonSource?.cnIndex === undefined &&
                    selectedJsonSource?.jpIndex !== undefined ? (
                      <p className="magi-proofreading-alert mt-2">
                        此 Section 没有中文源 JSON。生成编辑 JSON 时会明确使用日文
                        JSON 作为结构模板，只把当前中文逐事件写入允许的文本字段；
                        事件数量、动作、分支或位置不一致时会停止。
                      </p>
                    ) : (
                      <p className="magi-proofreading-help mt-2">
                        编辑 JSON 优先使用中文结构源；生成前会逐事件校验，且不会改动
                        动作、资源、分支、位置或其他播放字段。
                      </p>
                    )}
                </div>

                </>)}

                <div className="magi-proofreading-fields mt-3">
                  <label className="magi-proofreading-label">
                    昵称（可选）
                    <input
                      type="text"
                      maxLength={40}
                      value={proofreadingNickname}
                      onChange={(event) => setProofreadingNickname(event.target.value)}
                      placeholder="匿名校对者"
                      className="magi-proofreading-input"
                    />
                  </label>
                  <label className="magi-proofreading-label">
                    修改说明（可选）
                    <textarea
                      maxLength={1_000}
                      rows={2}
                      value={proofreadingNote}
                      onChange={(event) => setProofreadingNote(event.target.value)}
                      placeholder="例如：修正角色口吻、专有名词或错字"
                      className="magi-proofreading-input magi-proofreading-note"
                    />
                  </label>
                </div>

                <div className="magi-proofreading-submit-panel mt-3">
                  {currentLegacyVoiceRoutePath ? (
                    currentNativeEditSource ? <NativeReviewSubmit key={currentNativeEditSource.sha256} source={currentNativeEditSource} lines={editedCnLines} /> : <p className="magi-proofreading-help">正在核对原生补丁来源…</p>
                  ) : proofreadingConfigLoading ? (
                    <p className="magi-proofreading-help">正在连接投稿服务…</p>
                  ) : proofreadingConfig?.submissions_enabled && proofreadingConfig.turnstile_site_key ? (
                    <>
                      {proofreadingConfig.turnstile_test_mode && (
                        <p className="magi-proofreading-alert mb-2">
                          当前检查站使用 Cloudflare 测试验证密钥，仅用于功能验收；正式开放前必须换成真实 Turnstile 密钥。
                        </p>
                      )}
                      <TurnstileWidget
                        siteKey={proofreadingConfig.turnstile_site_key}
                        theme={theme}
                        resetKey={turnstileResetKey}
                        onToken={handleTurnstileToken}
                        onError={handleTurnstileError}
                      />
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="magi-proofreading-help">
                          投稿会记录当前剧情目录哈希和中文源文件哈希；源文本更新后，旧投稿不会被自动覆盖。
                        </p>
                        <button
                          type="button"
                          onClick={() => void submitToCloud()}
                          disabled={!turnstileToken || submittingProofreading}
                          data-variant="primary" className="magi-proofreading-button"
                        >
                          {submittingProofreading ? '正在提交…' : '提交审核'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="magi-proofreading-alert">
                      投稿服务尚未配置。你仍可下载 TXT，并将文件交给项目维护者。
                    </p>
                  )}
                </div>

                <p className="magi-proofreading-help mt-2">
                  {currentLegacyVoiceRoutePath ? '请定期下载原生翻译补丁备份；原始 CN / JP 文本仍可从页首下载。'
                    : '编辑模式保留逐事件行；请定期下载 TXT 备份。'}
                </p>
                {editMessage && (
                  <p role="status" className="magi-proofreading-status mt-2">
                    {editMessage}
                    {lastSubmissionId && (
                      <>
                        {' '}
                        <Link href="/proofreading/status" className="magi-proofreading-status-link font-bold underline">
                          查看审核状态
                        </Link>
                      </>
                    )}
                  </p>
                )}
              </section>
            )}

            {currentStory?.source_identity && <aside data-translation-review-summary="true" className="mb-3 rounded-lg border border-current/20 px-3 py-2 text-xs leading-relaxed">
              {readingCoverage?.pendingReviewRows || currentStory.pending_review_rows
                ? <>原译文已校对；站长补译 <strong>{readingCoverage?.pendingReviewRows ?? currentStory.pending_review_rows}</strong> 段待校对，已在正文逐段标出。</>
                : '原译文已校对。'}
            </aside>}
            {currentStory?.supplement_source && <aside data-supplement-source="true" className="mb-4 rounded-lg border border-current/20 px-3 py-2 text-xs leading-relaxed">
              <strong>{currentStory.supplement_source.title}</strong> · {currentStory.supplement_source.credit}
              <p className="mt-1">{currentStory.supplement_source.note}</p>
              <p>来源：{currentStory.supplement_source.filename}，第 {currentStory.supplement_source.start_line}–{currentStory.supplement_source.end_line} 行。</p>
              <a className="underline" href={currentStory.supplement_source.original_path} download={currentStory.supplement_source.filename}>原始文本</a>
            </aside>}
            {currentStory?.cross_chapter_relations?.length ? <details data-native-source-details="true" className="mb-3 text-xs opacity-70">
              <summary className="cursor-pointer">跨章原译文已在本页补显 · 查看版本来源</summary>
              {currentStory.cross_chapter_relations.filter((relation,index,list)=>list.findIndex(other=>other.message_cn===relation.message_cn)===index).map(relation=><NativeChapterRelationNotice key={relation.id} relation={relation} mode={mode}/>)}
            </details> : null}
            {nativeCorrespondenceState.loading && <p role="status" className="mb-4 text-xs opacity-60">正在载入原作事件对应…</p>}
            {nativePresentationState.error && <p role="alert" className="mb-4 text-sm text-red-600">{nativePresentationState.error}</p>}
            {voicePanelExpanded && !loadError && <div className="mb-4">
              <VoiceSequenceControls
                onStart={startLegacyVoiceSequence}
                count={legacyVoiceSequence.length}
                disabled={loading || legacyVoiceRouteLoading || Boolean(effectiveLegacyVoiceError)}
                sourceLabel={mode === 'cn' ? '中文版本原作事件' : mode === 'split' ? '双语模式：日文版本原作事件' : '日文版本原作事件'}
              />
            </div>}
            {voicePanelExpanded && detachedLegacyVoiceCues.length > 0 && !loadError && (
              <section
                data-voice-detached="true"
                className={`mb-4 rounded-xl border p-3 ${
                  isNightTheme(theme)
                    ? 'border-sky-800/70 bg-sky-950/30 text-sky-100'
                    : 'border-sky-200 bg-sky-50/70 text-sky-900'
                }`}
                aria-label="无正文锚点的原作语音"
              >
                <p className="mb-2 text-xs font-bold">
                  无正文锚点的原作语音 · {detachedLegacyVoiceCues.length}
                </p>
                <div className="flex flex-wrap gap-2">
                  {detachedLegacyVoiceCues.map((cue, cueIndex) => (
                    <VoicePlayButton
                      key={`${cue.cueId}:${cue.url}`}
                      cueId={cue.cueId}
                      sourceUrl={cue.url}
                      label={`播放独立语音 ${cueIndex + 1}`}
                      className="shrink-0 px-2"
                    />
                  ))}
                </div>
              </section>
            )}

            {!loadError && visibleRenderList.map((row, offset) => {
              const index = pageStart + offset;
              const nativeSections = nativeSectionAnchors.byRow.get(index) ?? [];
              const titleOnly = !isEditMode && nativeSections.some(section => isNativeSectionTitleRow(row, section))
                && !activeVoiceSlots[index]?.cues.length;
              return (
                <Fragment key={index}>
                {nativeSections.map(section => <NativeChapterHeading key={section.anchorId} section={section} mode={mode} />)}
                {!titleOnly && <StoryRow
                  counterpartRelation={crossChapterRelationForRow(currentStory, row)}
                  translationReview={'nativeKeys' in row ? translationReviewForRow(row as NativeAlignedRow,currentTranslationReview) : undefined}
                  row={row}
                  nativeScriptHeader={Boolean(currentStory?.native_sections && currentStory.native_sections.length > 1)}
                  index={index}
                  editIndex={row.cn ? (editedLineIndices.get(row.cn) ?? index) : index}
                  mode={mode}
                  bilingualLayout={bilingualLayout}
                  showLineBreaks={readerDisplayPreferences.showLineBreaks}
                  theme={theme}
                   isExedra={isExedraStory}
                   officialSectionTitles={currentStory?.source_identity
                     ? [mode === 'jp' ? currentStory.title_jp || currentStory.title || '' : currentStory.title_cn || currentStory.title || '']
                     : currentStory?.official_tw_section_titles}
                  voicePanelExpanded={voicePanelExpanded}
                  voiceRouteError={effectiveLegacyVoiceError}
                  voiceSlot={activeVoiceSlots[index]}
                  isFirstStoryHeader={index === firstStoryHeaderIndex}
                  isEditMode={isEditMode}
                  editedLines={editedCnLines}
                  setEditedLines={setEditedCnLines}
                  embeddedNativeSpeaker={legacyVoiceRoute?.canonicalStoryId.startsWith('kana-okaeri/') ?? false}
                  nativeReadOnlyReason={currentLegacyVoiceRoutePath ? nativeEditRowsByKey.get(nativePresentationState.rows?.[index]?.nativeKeys[0] ?? '')?.readOnlyReason : undefined}
                  nativeSpeakerEditable={currentLegacyVoiceRoutePath ? nativeEditRowsByKey.get(nativePresentationState.rows?.[index]?.nativeKeys[0] ?? '')?.allowed.includes('speaker') ?? false : undefined}
                  query={deferredSearchQuery}
                  lineCounts={lineCounts[index]}
                  textStats={textStatistics.rows.get(index)}
                  sectionStats={textStatistics.sections.get(index)}
                  normalizedQuery={normalizedQuery}
                  focused={activeVoiceRow === index || (currentMatchIndex >= 0 && matchedIndices[currentMatchIndex] === index)}
                  onChoice={jumpToChoice}
                />}
                </Fragment>
              );
            })}

          </div>
        </main>

        {pageCount > 1 && (
          <nav className="magi-reader-edge-pagination" aria-label="剧情快速翻页">
            {theme === 'frost' ? (
              <>
                <button
                  type="button"
                  aria-label="上一页"
                  aria-controls="reader-document"
                  aria-keyshortcuts="ArrowLeft"
                  title={visiblePage > 0 ? `上一页（${visiblePage} / ${pageCount}）` : '已经是第一页'}
                  className="magi-reader-page-turn magi-reader-page-turn-prev"
                  disabled={visiblePage === 0}
                  onClick={() => changeVisiblePage(visiblePage - 1)}
                >
                  <span aria-hidden="true" className="magi-reader-page-turn-triangle" />
                </button>
                <button
                  type="button"
                  aria-label="下一页"
                  aria-controls="reader-document"
                  aria-keyshortcuts="ArrowRight"
                  title={visiblePage + 1 < pageCount ? `下一页（${visiblePage + 2} / ${pageCount}）` : '已经是最后一页'}
                  className="magi-reader-page-turn magi-reader-page-turn-next"
                  disabled={visiblePage + 1 >= pageCount}
                  onClick={() => changeVisiblePage(visiblePage + 1)}
                >
                  <span aria-hidden="true" className="magi-reader-page-turn-triangle" />
                </button>
              </>
            ) : (
              <>
                {visiblePage > 0 && (
                  <button
                    type="button"
                    aria-label="上一页"
                    aria-controls="reader-document"
                    aria-keyshortcuts="ArrowLeft"
                    title={`上一页（${visiblePage} / ${pageCount}）`}
                    className="magi-reader-page-turn magi-reader-page-turn-prev"
                    onClick={() => changeVisiblePage(visiblePage - 1)}
                  >
                    <span aria-hidden="true" className="magi-reader-page-turn-triangle" />
                  </button>
                )}
                {visiblePage + 1 < pageCount && (
                  <button
                    type="button"
                    aria-label="下一页"
                    aria-controls="reader-document"
                    aria-keyshortcuts="ArrowRight"
                    title={`下一页（${visiblePage + 2} / ${pageCount}）`}
                    className="magi-reader-page-turn magi-reader-page-turn-next"
                    onClick={() => changeVisiblePage(visiblePage + 1)}
                  >
                    <span aria-hidden="true" className="magi-reader-page-turn-triangle" />
                  </button>
                )}
              </>
            )}
          </nav>
        )}

        <DraggableReaderWidget
          storageKey={FONT_WIDGET_POSITION_STORAGE_KEY}
          defaultDock="bottom-right"
          ariaLabel="快速字号悬浮工具"
          dragHandleLabel="拖动快速字号悬浮工具"
          className="magi-reader-font-widget"
        >
        <div
          className={`magi-reader-font-control magi-reader-font-control-${theme} ${
            fontControlOpen ? 'magi-reader-font-control-open' : 'magi-reader-font-control-closed'
          }`}
          role="group"
          aria-label="快速字号调节"
        >
          {fontControlOpen ? (
            <>
              <span className="magi-reader-font-control-small" aria-hidden="true">A</span>
              <div className="magi-reader-font-ruler" data-value={fontSize}>
                <span className="magi-reader-font-ruler-scale" aria-hidden="true">
                  {FONT_RULER_TICKS.map(tick => (
                    <span
                      key={tick.value}
                      className="magi-reader-font-ruler-tick"
                      data-major={tick.major ? 'true' : 'false'}
                      data-value={tick.value}
                      style={{ left: `${tick.positionPercent}%` }}
                    >
                      {tick.major && <span>{tick.value}</span>}
                    </span>
                  ))}
                  <span
                    className="magi-reader-font-ruler-current"
                    style={{ left: `${fontRulerPositionPercent}%` }}
                  />
                </span>
                <input
                  ref={fontRangeRef}
                  className="magi-reader-font-ruler-input"
                  type="range"
                  min={READER_FONT_SIZE_MIN}
                  max={READER_FONT_SIZE_MAX}
                  step="1"
                  value={fontSize}
                  aria-label="调整阅读字号"
                  aria-valuetext={`${fontSize} 像素`}
                  onChange={event =>
                    updateReaderDisplayPreferences({
                      fontSizePx: Number(event.target.value),
                    })
                  }
                />
              </div>
              <span className="magi-reader-font-control-large" aria-hidden="true">A</span>
              <output aria-live="polite">{fontSize}px</output>
              <button
                type="button"
                aria-label="收起字号调节"
                title="收起字号调节"
                onClick={() =>
                  updateReaderDisplayPreferences({ fontControlOpen: false })
                }
              >
                ×
              </button>
            </>
          ) : (
            <button
              type="button"
              aria-label="展开字号调节"
              title="展开字号调节"
              onClick={() =>
                updateReaderDisplayPreferences({ fontControlOpen: true })
              }
            >
              Aa
            </button>
          )}
        </div>
        </DraggableReaderWidget>

        <FloatingWindow
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
          theme={theme}
          title="阅读设置"
          titleId="reader-settings-title"
          systemLabel="SYS://READER.CONFIG"
          initialOffset={{ x: 38, y: 28 }}
          className="magi-settings-window"
          bodyClassName="p-5"
        >
              <div className="space-y-4 text-sm">
                <label className="block">
                  <span className="mb-1 block opacity-70">字号（{fontSize}px）</span>
                  <input
                    type="range"
                    min={READER_FONT_SIZE_MIN}
                    max={READER_FONT_SIZE_MAX}
                    step="1"
                    value={fontSize}
                    onChange={event =>
                      updateReaderDisplayPreferences({
                        fontSizePx: Number(event.target.value),
                      })
                    }
                    className="w-full"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block opacity-70">
                    正文横向宽度（{readerDisplayPreferences.textWidthPx}px）
                  </span>
                  <input
                    type="range"
                    min={READER_TEXT_WIDTH_MIN}
                    max={READER_TEXT_WIDTH_MAX}
                    step={READER_TEXT_WIDTH_STEP}
                    value={readerDisplayPreferences.textWidthPx}
                    aria-valuetext={`${readerDisplayPreferences.textWidthPx} 像素`}
                    onChange={event =>
                      updateReaderDisplayPreferences({
                        textWidthPx: Number(event.target.value),
                      })
                    }
                    className="w-full"
                  />
                  <span className="mt-1 block text-[11px] opacity-60">
                    同时作用于阅读和汉化输入；手机端自动限制为屏幕可用宽度。
                  </span>
                </label>
                <ReaderFontSettings theme={theme} isExedra={isExedraStory} />
                <div>
                  <p className="mb-2 opacity-70">中日对照排列</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      ['side-by-side', '左右排列'],
                      ['stacked', '上下排列'],
                    ] as const).map(([key, label]) => (
                      <button
                        type="button"
                        key={key}
                        aria-pressed={bilingualLayout === key}
                        onClick={() => changeBilingualLayout(key)}
                        className={`rounded border px-2 py-2 text-xs font-bold ${
                          bilingualLayout === key
                            ? 'border-blue-500 bg-blue-500/10 text-blue-600'
                            : 'border-current opacity-60'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] opacity-60">
                    手机端始终采用上下排列以避免挤压；此选项控制电脑端的左右或上下排列，
                    并同样适用于汉化输入框。
                  </p>
                </div>
                <label className="block">
                  <span className="mb-1 block opacity-70">行高（{lineHeight}）</span>
                  <input type="range" min="1.1" max="2" step="0.1" value={lineHeight} onChange={event => setLineHeight(Number(event.target.value))} className="w-full" />
                </label>
                <label className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
                  isNightTheme(theme)
                    ? 'border-gray-700 bg-white/5'
                    : 'border-gray-200 bg-black/[0.02]'
                }`}>
                  <span>
                    <span className="block font-bold">
                      显示换行符 <span aria-hidden="true" className="text-fuchsia-500">↵</span>
                    </span>
                    <span className="block text-[11px] opacity-60">
                      仅作视觉提示，不会写入翻译或下载文件。
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={readerDisplayPreferences.showLineBreaks}
                    onChange={event =>
                      updateReaderDisplayPreferences({
                        showLineBreaks: event.target.checked,
                      })
                    }
                    className="h-5 w-5 shrink-0 accent-fuchsia-600"
                  />
                </label>
              </div>
        </FloatingWindow>
      </div>

      <AboutModal isOpen={aboutOpen} onClose={() => setAboutOpen(false)} theme={theme} />
      </div>
    </div></IOSViewportHost>
  );
}

function NativeChapterHeading({ section, mode }: { section: NativeSectionDescriptor; mode: ReaderMode }) {
  const title = mode === 'jp' ? section.title_jp || section.title_cn : section.title_cn || section.title_jp;
  return <section id={section.anchorId} data-native-section-id={section.id}
    className="my-6 border-t border-current/25 pt-4 text-center" aria-label="原作章节">
    <h2 className="text-lg font-bold" lang={mode === 'jp' ? 'ja' : 'zh-Hans'}>{title}</h2>
    {mode === 'split' && section.title_jp && section.title_jp !== title
      && <p className="mt-1 text-sm opacity-65" lang="ja">{section.title_jp}</p>}
  </section>;
}

function NativeChapterRelationNotice({ relation, mode }: { relation: NativeChapterRelation; mode: ReaderMode }) {
  return <aside data-native-chapter-relation={relation.id} className="mb-4 rounded-lg border border-current/20 p-3 text-sm">
    <p lang={mode === 'jp' ? 'ja' : 'zh-Hans'}>{mode === 'jp' ? relation.message_jp : relation.message_cn}</p>
    <a className="mt-1 inline-block font-semibold underline underline-offset-4" href={nativeChapterRelationHref(relation)}>
      {relation.target_locale === 'zh-CN' ? '查看对应中文' : '查看对应日文'}
    </a>
  </aside>;
}

type StoryRowProps = {
  row: AlignedStoryLine;
  index: number;
  editIndex: number;
  mode: ReaderMode;
  bilingualLayout: BilingualLayout;
  showLineBreaks: boolean;
  theme: string;
  isExedra: boolean;
  officialSectionTitles?: string[];
  voicePanelExpanded: boolean;
  voiceRouteError: string;
  voiceSlot: LegacyVoiceSlot | null;
  isFirstStoryHeader: boolean;
  isEditMode: boolean;
  editedLines: StoryLine[];
  nativeSpeakerEditable?: boolean;
  embeddedNativeSpeaker?: boolean;
  nativeScriptHeader?: boolean;
  counterpartRelation?: NativeChapterRelation;
  translationReview?: TranslationReviewRow;
  nativeReadOnlyReason?: string;
  setEditedLines: React.Dispatch<React.SetStateAction<StoryLine[]>>;
  query: string;
  lineCounts?: MeasuredRow;
  textStats?: TextTotals;
  sectionStats?: TextTotals;
  normalizedQuery: string;
  focused: boolean;
  onChoice: (index: number, choice: StoryLine) => void;
};

function StoryRow({
  row,
  index,
  editIndex,
  mode,
  bilingualLayout,
  showLineBreaks,
  theme,
  isExedra,
  officialSectionTitles,
  voicePanelExpanded,
  voiceRouteError,
  voiceSlot,
  isFirstStoryHeader,
  isEditMode,
  editedLines,
  nativeSpeakerEditable,
  embeddedNativeSpeaker = false,
  nativeScriptHeader = false,
  counterpartRelation,
  translationReview,
  nativeReadOnlyReason,
  setEditedLines,
  query,
  lineCounts,
  textStats,
  sectionStats,
  normalizedQuery,
  focused,
  onChoice,
}: StoryRowProps) {
  const header = mode === 'jp'
    ? row.jp?.isHeader
      ? row.jp
      : row.cn?.isHeader
        ? row.cn
        : undefined
    : row.cn?.isHeader
      ? row.cn
      : row.jp?.isHeader
        ? row.jp
        : undefined;
  if (header) {
    const headerText = header.text.replace(/---/g, '').trim();
    const isBranch = Boolean(header.headerBranch);
    const displayedHeaderText = isBranch
      ? headerText
      : resolveOfficialSectionTitle(
          officialSectionTitles,
          header.headerSection,
          headerText,
        );
    return (
      <div
        id={header.headerId}
        lang={header === row.jp ? 'ja' : 'zh-Hans'}
        data-reader-row-index={index}
        data-native-event-keys={'nativeKeys' in row ? JSON.stringify(row.nativeKeys) : undefined}
        data-native-pairing={'pairing' in row ? String(row.pairing ?? 'same-variant') : undefined}
        data-reader-first-header={isFirstStoryHeader || undefined}
        className={`mb-4 text-center ${
          isFirstStoryHeader
            ? 'mt-0 pt-0'
            : 'mt-6 border-t-2 pt-4'
        } ${
          isExedra ? 'exedra-page ' : ''
        }${
          header === row.jp
            ? 'reader-font-jp-title'
            : 'reader-font-cn-title'
        } ${
          isBranch
            ? 'rounded-lg border-amber-400/50 bg-amber-50/30 py-3'
            : 'border-dashed border-current opacity-50'
        }`}
      >
        {sectionStats && <SourceStatistics stats={sectionStats} label={nativeSpeakerEditable !== undefined ? '本脚本' : '本节'} />}
        {isBranch ? (
          <div className="flex flex-col items-center gap-1">
            <span className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
              isNightTheme(theme)
                ? 'border-amber-700 bg-amber-900/40 text-amber-300'
                : 'border-amber-300 bg-amber-100 text-amber-800'
            }`}>
              🔀 {header.headerSection ? `第${header.headerSection}节 ` : ''}
              选项路线 {header.headerBranch}
            </span>
            {header.headerSourceId && (
              <span className="font-mono text-[10px] opacity-50">{header.headerSourceId}</span>
            )}
          </div>
        ) : (
          <span className="rounded-full border border-current px-3 py-1 font-mono text-xs opacity-70">
            {nativeScriptHeader ? '脚本概览' : displayedHeaderText}
          </span>
        )}
      </div>
    );
  }

  const choice = mode === 'jp'
    ? row.jp?.isChoice
      ? row.jp
      : row.cn?.isChoice
        ? row.cn
        : undefined
    : row.cn?.isChoice
      ? row.cn
      : row.jp?.isChoice
        ? row.jp
        : undefined;
  if (choice) {
    const editableChoice = editedLines[editIndex];
    return (
      <div
        id={`line-${index}`}
        data-reader-row-index={index}
        data-native-event-keys={'nativeKeys' in row ? JSON.stringify(row.nativeKeys) : undefined}
        data-native-pairing={'pairing' in row ? String(row.pairing ?? 'same-variant') : undefined}
        data-translation-review={translationReview?.state}
        className="magi-reader-choice-row my-3 flex flex-wrap items-center justify-center gap-2"
      >
        {textStats && <SourceStatistics stats={textStats} label="选项" />}
        {translationReview?.state==='pending' && mode!=='jp' && <span data-author-translation="pending" className="text-[10px] opacity-70">{translationReview.credit}补译 · 待校对</span>}
        {isEditMode ? (
          <label lang="zh-Hans" className="magi-translation-choice-shell reader-font-cn-title flex w-full max-w-xl items-center gap-2 p-2 text-xs font-bold">
            选项
            <input
              aria-label={`第 ${index + 1} 行选项文本`}
              className="magi-translation-choice-input reader-font-cn-title min-w-0 flex-1 px-2 py-1.5 font-normal outline-none"
              value={editableChoice?.choiceLabel || editableChoice?.text || ''}
              onChange={event => {
                const value = event.target.value;
                setEditedLines(previous => {
                  const next = [...previous];
                  const basis = next[editIndex] || choice;
                  next[editIndex] = { ...basis, choiceLabel: value, text: `【${value}】` };
                  return next;
                });
              }}
            />
          </label>
        ) : (
          <button
            type="button"
            lang={choice === row.jp ? 'ja' : 'zh-Hans'}
            onClick={() => onChoice(index, choice)}
            className={`${isExedra && choice === row.jp ? 'exedra-page ' : ''}${choice === row.jp ? 'reader-font-jp-title' : 'reader-font-cn-title'} cursor-pointer rounded-xl border-2 px-5 py-2.5 text-sm font-bold transition hover:scale-105 active:scale-95 ${
              isNightTheme(theme)
                ? 'border-amber-700 bg-gradient-to-r from-amber-900/60 to-orange-900/60 text-amber-200'
                : 'border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50 text-amber-800 shadow-sm'
            }`}
          >
            <span aria-hidden="true">▸ </span><span data-reader-text-content={choice === row.jp ? 'jp' : 'cn'}>{choice.choiceLabel || choice.text}</span>
            <span className="ml-2 text-[10px] opacity-50">↓ 点击跳转</span>
          </button>
        )}
      </div>
    );
  }

  // IKURA stores the literal name prefix inside the editable body. Suppress
  // that exact duplicate only in read display; source/edit/export remain intact.
  const displayedText = (line: StoryLine) => {
    if (!embeddedNativeSpeaker) return line.text;
    const prefix = line.text.match(/^([^：「\n]{1,24})：「/u);
    const normalized = (value: string) => value.replace(/\s/gu, '');
    return prefix && normalized(prefix[1]) === normalized(line.speaker)
      ? line.text.slice(prefix[0].length - 1) : line.text;
  };
  const cnSpeakerMatches =
    Boolean(normalizedQuery) &&
    normalizeSearchText(
      translatedSpeaker(row.cn?.speaker || ''),
    ).includes(normalizedQuery);
  const jpSpeakerMatches =
    Boolean(normalizedQuery) &&
    normalizeSearchText(row.jp?.speaker || '').includes(normalizedQuery);
  const audioCueId = row.cn?.audioCueId || row.jp?.audioCueId;
  const reviewedRow = row as Partial<NativeAlignedRow>;
  const renderBodyText = (language: 'cn' | 'jp') => {
    const line = row[language];
    if (!line) return null;
    const paragraphs = reviewedRow.reviewedParagraphs?.[language];
    if (!paragraphs) return <StoryText text={displayedText(line)} query={query} theme={theme} showLineBreaks={showLineBreaks} />;
    return paragraphs.map((paragraph, paragraphIndex) => <span key={paragraphIndex}
      data-native-paragraph={paragraphIndex} className={`block ${paragraphIndex ? 'mt-3' : ''}`}>
      {paragraphIndex > 0 && paragraph.speaker && paragraph.speaker !== line.speaker && !/^(旁白|ナレーション)$/u.test(paragraph.speaker)
        && <span className="mr-2 text-xs font-semibold">{language === 'cn' ? translatedSpeaker(paragraph.speaker) : paragraph.speaker}</span>}
      <StoryText text={displayedText(paragraph)} query={query} theme={theme} showLineBreaks={showLineBreaks} />
    </span>);
  };
  const legacyVoiceCues = voiceSlot?.cues ?? [];
  const renderVoiceControls = () => {
    if (!voicePanelExpanded) return null;
    const resolved = legacyVoiceCues.length > 0 || Boolean(audioCueId);
    return (
      <span
        data-voice-slot="true"
        data-voice-slot-status={resolved ? 'resolved' : 'unresolved'}
        className="inline-flex shrink-0 flex-col items-start gap-1"
      >
        {legacyVoiceCues.length > 0 ? legacyVoiceCues.map((cue, cueIndex) => (
          <span
            key={`${cue.cueId}:${cue.url}`}
            data-voice-cue-id={cue.cueId}
            data-voice-source-key={cue.sourceKey}
          >
            <VoicePlayButton
              cueId={cue.cueId}
              sourceUrl={cue.url}
              label={legacyVoiceCues.length > 1 ? `播放 ${cueIndex + 1}` : '播放'}
              className="shrink-0 px-2"
            />
          </span>
        )) : audioCueId ? (
          <VoicePlayButton
            cueId={audioCueId}
            label="播放"
            className="shrink-0 px-2"
          />
        ) : (
          <span
            className={`magi-reader-voice-unavailable min-h-11 rounded-lg border px-2 py-2 text-[10px] font-semibold opacity-55 ${
              isNightTheme(theme)
                ? 'border-white/15 bg-white/5 text-gray-300'
                : 'border-gray-300 bg-gray-50 text-gray-500'
            }`}
            aria-label={voiceRouteError ? '路由异常：' + voiceRouteError : '无对应语音'}
            title={voiceRouteError || '原作脚本没有为这一行提供语音提示'}
          >
            <span data-voice-unavailable-mark aria-hidden="true">—</span>
            <span data-voice-unavailable-label>{voiceRouteError ? '路由异常' : '无对应语音'}</span>
          </span>
        )}
      </span>
    );
  };
  const editedText = editedLines[editIndex]?.text || '';
  const editedLineBreakCount = showLineBreaks
    ? countLineBreaks(editedText)
    : 0;
  const lineBreakDescriptionId = `line-${index}-line-break-description`;

  return (
    <div
      id={`line-${index}`}
      data-reader-row-index={index}
        data-native-event-keys={'nativeKeys' in row ? JSON.stringify(row.nativeKeys) : undefined}
        data-native-pairing={'pairing' in row ? String(row.pairing ?? 'same-variant') : undefined}
      data-lines-cn={lineCounts?.cn}
      data-native-review={reviewedRow.reviewedPassage ? 'source-correspondence' : undefined}
      data-translation-review={translationReview?.state}
      title={translationReview?.state==='pending' ? `${translationReview.credit}补译 · 待校对` : undefined}
      data-lines-jp={lineCounts?.jp}
      className={`group relative flex transition-colors ${bilingualStoryPairClass(
        mode,
        bilingualLayout,
      )} ${
        focused
          ? isNightTheme(theme)
            ? 'bg-blue-900/30 ring-1 ring-blue-500/50'
            : 'bg-yellow-50 ring-1 ring-yellow-400/50'
          : 'hover:border-current hover:border-opacity-10'
      }`}
    >
      {lineCounts && <span className="magi-reader-row-metrics" aria-label={`中文 ${lineCounts.cnChars} 字，日文 ${lineCounts.jpChars} 字；中文 ${lineCounts.cn} 行，日文 ${lineCounts.jp} 行`}>
        <span>CN {textStats?.cn ?? lineCounts.cnChars}</span><span>JP {textStats?.jp ?? lineCounts.jpChars}</span>
        <span>TOTAL {textStats ? textStats.cn + textStats.jp : lineCounts.cnChars + lineCounts.jpChars}</span>
        <span>LINES <b data-line-count={lineCounts.cn}>{lineCounts.cn}</b> / <b data-line-count={lineCounts.jp}>{lineCounts.jp}</b></span>
      </span>}
      {mode !== 'jp' && (
        <div
          lang="zh-Hans"
          className={`reader-font-cn-body ${isExedra ? 'exedra-page ' : ''}flex min-w-0 gap-3 ${
            mode === 'split' && bilingualLayout === 'side-by-side'
              ? 'md:w-1/2'
              : 'w-full'
          }`}
        >
          {renderVoiceControls()}
          {isEditMode ? nativeReadOnlyReason === 'translation-on-native-group-members' ? (
            <p data-reader-text-cell="cn-native-group-note" className="flex-1 py-2 text-sm opacity-70">
              译文位于同一句段的中文事件，请修改对应中文行。
            </p>
          ) : (
            <>
              <input
                aria-label={`第 ${index + 1} 行角色名`}
                readOnly={nativeSpeakerEditable === false}
                title={nativeSpeakerEditable === false ? '原作没有独立的可写姓名字段；含姓名的 IKURA 正文可直接编辑' : undefined}
                className="magi-translation-speaker-input reader-font-cn-title w-20 flex-shrink-0 px-1 py-1 text-right font-bold leading-tight outline-none md:w-24"
                value={
                  editedLines[editIndex]?.speaker
                  ?? translatedSpeaker(
                    row.cn?.speaker || row.jp?.speaker || '旁白',
                  )
                }
                onChange={event => {
                  if (nativeSpeakerEditable === false) return;
                  const value = event.target.value;
                  setEditedLines(previous => {
                    const next = [...previous];
                    const basis = next[editIndex] || row.cn || row.jp || {
                      speaker: '旁白',
                      text: '',
                    };
                    next[editIndex] = { ...basis, speaker: value };
                    return next;
                  });
                }}
              />
              <div className="relative min-w-0 flex-1" data-reader-text-cell="cn-edit">
                <textarea
                  aria-label={`第 ${index + 1} 行翻译`}
                  aria-describedby={
                    editedLineBreakCount > 0
                      ? lineBreakDescriptionId
                      : undefined
                  }
                  className="magi-translation-textarea reader-font-cn-body relative z-0 block w-full p-2 font-sans outline-none transition"
                  value={editedText}
                  placeholder="在此输入翻译内容…"
                  onChange={event => {
                    const value = event.target.value;
                    setEditedLines(previous => {
                      const next = [...previous];
                      const basis = next[editIndex] || row.cn || row.jp || {
                        speaker: '旁白',
                        text: '',
                      };
                      next[editIndex] = { ...basis, text: value };
                      return next;
                    });
                  }}
                  onScroll={event => {
                    const overlay = event.currentTarget.nextElementSibling;
                    if (
                      overlay instanceof HTMLElement &&
                      overlay.dataset.lineBreakOverlay === 'true'
                    ) {
                      overlay.scrollTop = event.currentTarget.scrollTop;
                      overlay.scrollLeft = event.currentTarget.scrollLeft;
                    }
                  }}
                  rows={Math.max(1, editedText.split('\n').length)}
                />
                {editedLineBreakCount > 0 && (
                  <>
                    <div
                      aria-hidden="true"
                      data-line-break-overlay="true"
                      className="magi-translation-linebreak-overlay reader-font-cn-body pointer-events-none absolute inset-0 z-10 select-none overflow-hidden whitespace-pre-wrap break-words p-2 font-sans"
                    >
                      <LineBreakMarkerText text={editedText} markerOnly />
                    </div>
                    <span id={lineBreakDescriptionId} className="sr-only">
                      此输入框含 {editedLineBreakCount} 个手动换行符，视觉上以箭头标记。
                    </span>
                  </>
                )}
              </div>
            </>
          ) : row.cn ? (
            <>
              <SpeakerLabel line={row.cn} highlighted={cnSpeakerMatches} language="cn" native={nativeSpeakerEditable !== undefined} />
              <div data-reader-text-cell="cn" className={`min-w-0 flex-1 break-words whitespace-pre-wrap pt-0.5 ${lineTextAlignClass(row.cn)} ${lineKindClass(row.cn)}`}>
                {translationReview?.state==='pending' && <span data-author-translation="pending" className="magi-author-translation-badge mb-1 block text-[10px] font-semibold opacity-75">{translationReview.credit}补译 · 待校对</span>}
                <span data-reader-text-content="cn">
                {renderBodyText('cn')}
                </span>
              </div>
            </>
          ) : (
            <div data-reader-text-cell="cn-empty" className={`flex-1 border-b border-dashed border-black/5 py-1 text-xs ${counterpartRelation ? 'opacity-70' : 'italic opacity-20'}`}>
              {counterpartRelation ? <a data-native-counterpart-link={counterpartRelation.id} className="underline underline-offset-4" href={nativeChapterRelationHref(counterpartRelation)}>查看对应中文原文</a>
                : 'pairing' in row && row.pairing === 'unpaired-jp' ? '中日对应待核实' : '等待翻译…'}
            </div>
          )}
        </div>
      )}

      {mode !== 'cn' && (
        <div
          lang="ja"
          className={`reader-font-jp-body ${isExedra ? 'exedra-page ' : ''}flex min-w-0 gap-2 ${bilingualLanguagePaneClass(
            mode,
            bilingualLayout,
            'jp',
          )}`}
        >
          {mode === 'jp' && renderVoiceControls()}
          {row.jp ? (
            <>
              <SpeakerLabel line={row.jp} highlighted={jpSpeakerMatches} faded language="jp" native={nativeSpeakerEditable !== undefined} />
              <div data-reader-text-cell="jp" className={`exedra-jp-story-text min-w-0 flex-1 break-words whitespace-pre-wrap font-sans opacity-70 ${lineTextAlignClass(row.jp)} ${lineKindClass(row.jp)}`}>
                <span data-reader-text-content="jp">
                {renderBodyText('jp')}
                </span>
              </div>
            </>
          ) : (
            <div data-reader-text-cell="jp-empty" className={`flex-1 py-1 text-xs ${counterpartRelation ? 'opacity-70' : 'italic opacity-20'}`}>
              {counterpartRelation ? <a data-native-counterpart-link={counterpartRelation.id} className="underline underline-offset-4" href={nativeChapterRelationHref(counterpartRelation)}>查看对应日文原文</a> : '…'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SpeakerLabel({
  line,
  highlighted,
  faded = false,
  language,
  native = false,
}: {
  line: StoryLine;
  highlighted: boolean;
  faded?: boolean;
  language: 'cn' | 'jp';
  native?: boolean;
}) {
  const { nameColorsEnabled } = useGlobal();
  const unnamedDialogue = native && /^(旁白|ナレーション)$/u.test(line.speaker.trim()) && /^\s*[「『“]/u.test(line.text);
  const displayedSpeaker = unnamedDialogue ? '未署名' :
    language === 'cn'
      ? translateSpeakerName(line.speaker)
      : line.speaker;
  return (
    <div
      lang={language === 'jp' ? 'ja' : 'zh-Hans'}
      title={unnamedDialogue ? '原生脚本未提供姓名，不据对白或音频文件名推断角色' : undefined}
      className={`magi-reader-speaker-label ${language === 'cn' ? 'reader-font-cn-title' : 'reader-font-jp-title'} h-fit w-20 flex-shrink-0 break-words rounded px-1 pt-1 text-right font-bold leading-tight md:w-24 ${
        highlighted ? 'ring-2 ring-yellow-400' : faded ? 'opacity-50' : ''
      }`}
      style={{ color: nameColorsEnabled ? speakerColor(displayedSpeaker) : undefined }}
    >
      {displayedSpeaker}
    </div>
  );
}
