import {
  localizedText,
  validateCatalog,
  validateMediaManifest,
} from '../../packages/contracts/src/index.js';
import { AdapterRegistry } from '../../packages/core/src/adapter-registry.js';
import {
  ReaderRouteError,
  ReaderSession,
  voiceSlotForEvent,
} from '../../packages/core/src/reader-session.js';
import {
  MediaResolverRegistry,
  createManifestMediaResolver,
} from '../../packages/core/src/media-resolver-registry.js';
import { AudioController } from '../../packages/core/src/audio-controller.js';
import {
  loadReaderPreferences,
  saveReaderPreferences,
} from '../../packages/core/src/preferences.js';
import {
  BRIDGE_REVISION,
  buildStoryDeepLink,
  canSynchronizeExactEvent,
  parseStoryDeepLink,
} from '../../packages/bridge/src/deep-link.js';
import { attachBridgeProvider } from '../../packages/bridge/src/provider.js';
import { createAdvIrAdapter } from '../../packages/adapters/src/adv-ir-v1.js';
import { createMajiroProductionAdapter } from '../../packages/adapters/src/majiro-production-v1.js';
import { createIkuraProductionAdapter } from '../../packages/adapters/src/ikura-production-v1.js';
import {
  buildResearchCatalog,
  createResearchReaderAdapter,
} from '../../packages/adapters/src/research-reader-v1.js';

const ALLOWED_CORPORA = new Set(['narcissu10', 'narcissu3', 'kana']);
const PAGE_SIZE = 200;
const THEME_KEY = 'universal_adv_reader_classic_theme';
const DISPLAY_KEY = 'universal_adv_reader_display_mode';
const THEMES = Object.freeze([
  { id: 'light', label: '亮色', symbol: '☼' },
  { id: 'paper', label: '纸张', symbol: '▣' },
  { id: 'green', label: '护眼', symbol: '♨' },
  { id: 'dark', label: '暗黑', symbol: '◐' },
  { id: 'frost', label: '冷辉', symbol: '✣' },
]);

const isNightTheme = (value) => value === 'dark' || value === 'frost';
const isDayArchiveTheme = (value) => value === 'light' || value === 'paper';

const HOME_SIDEBAR_BASE = 'magi-home-sidebar relative z-20 hidden flex-shrink-0 flex-col border-r md:flex';
const HOME_TOOLBAR_BASE = 'magi-home-toolbar-shell border-b p-3 backdrop-blur z-10 flex flex-col gap-3';
const HOME_SEARCH_BASE = 'magi-home-search-input block h-10 w-full border rounded-lg py-2 pl-9 pr-3 text-sm leading-6 outline-none transition-all';
const HOME_SEARCH_MODE_BASE = 'flex shrink-0 items-center rounded-lg border p-0.5';
const HOME_SEARCH_MODE_BUTTON_BASE = 'px-2 py-1.5 text-xs font-bold rounded-md transition-all';
const HOME_JP_BASE = 'flex items-center gap-1 px-2 rounded cursor-pointer border';
const HOME_LOCAL_STORY_BASE = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-bold whitespace-nowrap transition-all disabled:cursor-wait disabled:opacity-60';
const HOME_SETTINGS_BASE = 'inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border p-2 transition-all';
const HOME_ABOUT_BASE = 'px-2.5 py-1 rounded cursor-pointer border text-xs font-bold whitespace-nowrap transition-all';
const HOME_STATUS_BASE = 'magi-home-story-system-toggle flex items-center px-2.5 py-1 rounded cursor-pointer border text-xs font-bold whitespace-nowrap transition-all';
const HOME_MOBILE_SOURCE_BASE = 'magi-home-mobile-source-toggle min-w-8 items-center justify-center rounded border px-2 py-1 text-xs font-bold whitespace-nowrap transition-all';
const HOME_THEME_SWITCHER_BASE = 'magi-home-theme-switcher flex gap-1 p-1 rounded-full self-end md:self-auto';
const READER_ROOT_BASE = 'magi-reader-root flex h-screen h-[100dvh] overflow-hidden bg-transparent';
const READER_HEADER_BASE = 'magi-reader-header magi-reader-header-compact z-20 flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-2 py-1.5';
const READER_SIDEBAR_BASE = 'magi-reader-sidebar fixed inset-y-0 left-0 z-50 flex flex-col overflow-hidden border-r transition-transform duration-300 md:relative md:translate-x-0';
const READER_SEARCH_BASE = 'magi-reader-search-input h-9 w-full rounded-full border py-1.5 pl-9 pr-14 text-sm leading-5 outline-none transition';

const byId = (id) => document.getElementById(id);
const findButton = (root, label) => [...root.querySelectorAll('button')]
  .find((button) => button.textContent.trim() === label) ?? null;

const homeView = byId('home-view');
const readerView = byId('reader-view');
const homeControls = homeView.querySelector('.magi-home-toolbar-controls');
const readerHeader = readerView.querySelector('.magi-reader-header');
const readerActions = readerHeader.querySelector('.magi-reader-header-actions');
const readerIdentity = readerHeader.querySelector('.magi-reader-header-identity');
const readerDownloads = [...readerHeader.querySelectorAll('.magi-reader-source-download')];
const readerLanguageButtons = [...readerActions.querySelectorAll('div > button')]
  .filter((button) => ['中', '双', '日'].includes(button.textContent.trim()));

const hiddenVariant = document.createElement('select');
hiddenVariant.id = 'reader-variant';
hiddenVariant.hidden = true;
readerView.append(hiddenVariant);

const readerScrim = document.createElement('button');
readerScrim.type = 'button';
readerScrim.hidden = true;
readerScrim.className = 'fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden';
readerScrim.setAttribute('aria-label', '关闭剧情目录');
readerView.prepend(readerScrim);

const utilityFab = document.createElement('button');
utilityFab.type = 'button';
utilityFab.hidden = true;
utilityFab.className = 'magi-reader-utility-fab';
utilityFab.innerHTML = '<span aria-hidden="true">⌂</span><span>导航</span>';

const fontWidgetFab = document.createElement('button');
fontWidgetFab.type = 'button';
fontWidgetFab.hidden = true;
fontWidgetFab.className = 'magi-reader-font-control magi-reader-font-control-frost magi-reader-font-control-closed';
fontWidgetFab.textContent = 'A';

const ui = {
  background: byId('magi-background'),
  texture: document.querySelector('.magi-texture'),
  siteScope: document.querySelector('.magi-site-font-scope'),
  homeView,
  homeSidebar: homeView.querySelector('.magi-home-sidebar'),
  homeToolbar: homeView.querySelector('.magi-home-toolbar-shell'),
  homeCategoryNavs: [...homeView.querySelectorAll('.magi-home-category-nav, .magi-home-mobile-category-nav')],
  homeSearch: homeView.querySelector('.magi-home-search-input'),
  homeSearchModeShell: homeView.querySelector('.magi-home-search-shell + div'),
  homeSearchModeButtons: ['全部', '标题', '正文'].map((label) => findButton(homeControls, label)).filter(Boolean),
  homeHeading: byId('home-heading'),
  homeStatistics: byId('home-statistics'),
  homeFolderColumns: byId('home-folder-columns'),
  homeCatalog: homeView.querySelector('.magi-home-catalog'),
  homeStatus: homeView.querySelector('.magi-home-story-system-toggle'),
  homeThemeSwitcher: homeView.querySelector('.magi-home-theme-switcher'),
  homeMobileMenu: homeView.querySelector('.magi-home-mobile-source-toggle'),
  homeMobileCategories: homeView.querySelector('.magi-home-mobile-category-shell'),
  homeSettings: homeView.querySelector('[aria-label="打开字体与站点设置"]'),
  homeAbout: findButton(homeControls, '关于'),
  homeJpToggle: homeControls.querySelector('input[type="checkbox"]'),
  homeJpLabel: homeControls.querySelector('input[type="checkbox"]')?.closest('label'),
  openLocalStory: findButton(homeControls, '打开本地剧情'),
  localStoryInput: homeControls.querySelector('input[type="file"]'),
  readerView,
  readerHeader,
  readerSidebar: readerView.querySelector('.magi-reader-sidebar'),
  readerBrand: readerView.querySelector('.magi-reader-brand'),
  readerSidebarClose: readerView.querySelector('.magi-reader-brand-row button[aria-label="关闭剧情目录"]'),
  readerScrim,
  readerCatalogTree: readerView.querySelector('[data-sidebar-scroll-container="true"]'),
  readerMobileMenu: readerIdentity.querySelector('button[aria-label="打开剧情目录"]'),
  readerStoryTitle: readerIdentity.querySelector('.magi-reader-story-id'),
  readerSectionTitle: readerIdentity.querySelector('div > span'),
  readerVariant: hiddenVariant,
  readerSearches: [...readerView.querySelectorAll('.magi-reader-search-input')],
  readerSearch: readerHeader.querySelector('.magi-reader-search-input'),
  readerLanguageShell: readerLanguageButtons[0]?.parentElement,
  readerMain: readerView.querySelector('.magi-reader-main'),
  readerDocument: byId('reader-document'),
  readerFilmCalibration: readerView.querySelector('.magi-reader-film-calibration'),
  readerThemeSwitcher: readerView.querySelector('.magi-reader-utility-theme-switcher'),
  readerSettings: readerActions.querySelector('button[aria-label="打开阅读设置"]'),
  voiceToggle: readerActions.querySelector('button'),
  downloadPrimary: readerDownloads[0],
  downloadSecondary: readerDownloads[1],
  previousPage: readerView.querySelector('.magi-reader-page-turn-prev'),
  nextPage: readerView.querySelector('.magi-reader-page-turn-next'),
  pageSummary: readerView.querySelector('.magi-reader-page-summary'),
  utilityWidget: readerView.querySelector('.magi-reader-utility-widget'),
  utilityClose: readerView.querySelector('.magi-reader-utility-close'),
  utilityFab,
  returnHome: readerView.querySelector('.magi-reader-utility-actions a'),
  readerAbout: readerView.querySelector('.magi-reader-utility-actions > button'),
  fontWidget: readerView.querySelector('.magi-reader-font-widget'),
  fontWidgetClose: readerView.querySelector('.magi-reader-font-control > button'),
  fontWidgetFab,
  fontSize: readerView.querySelector('.magi-reader-font-ruler-input'),
  fontOutput: readerView.querySelector('.magi-reader-font-control output'),
  dialog: byId('classic-dialog'),
  dialogClose: byId('dialog-close'),
  dialogMinimize: byId('dialog-minimize'),
  dialogTitle: byId('classic-dialog-title'),
  dialogSystemLabel: byId('dialog-system-label'),
  dialogContent: byId('dialog-content'),
  dialogFooter: byId('dialog-footer'),
  toast: byId('toast'),
};

ui.utilityWidget.after(utilityFab);
ui.fontWidget.after(fontWidgetFab);
for (const [index, button] of readerLanguageButtons.entries()) {
  button.disabled = false;
  button.dataset.displayMode = ['cn', 'parallel', 'jp'][index];
  button.removeAttribute('title');
}
ui.voiceToggle.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-music" aria-hidden="true"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg><span class="hidden sm:inline">语音</span>';

const adapterRegistry = new AdapterRegistry();
adapterRegistry.register(createAdvIrAdapter());
adapterRegistry.register(createMajiroProductionAdapter());
adapterRegistry.register(createIkuraProductionAdapter());
adapterRegistry.register(createResearchReaderAdapter({ corpusBaseUrl: '/corpus/' }));

const mediaRegistry = new MediaResolverRegistry();
const audioController = new AudioController();

let catalog = null;
let activeCorpus = null;
let activeStoryEntry = null;
let activeStory = null;
let activeSession = null;
let activeResolverUnregister = null;
let sessionUnsubscribe = null;
let bridgeProvider = null;
let compatibilityState = null;
let renderGeneration = 0;
let currentPage = 0;
let searchCursor = -1;
let selectedCorpusId = 'narcissu10';
let selectedSourceMode = 'all';
let expandedHomeStoryId = null;
let theme = readStoredValue(THEME_KEY, THEMES.map((item) => item.id), 'frost');
let displayMode = readStoredValue(DISPLAY_KEY, ['cn', 'parallel', 'jp'], 'parallel');
let preferences = saveReaderPreferences({
  ...loadReaderPreferences(),
  voicePanelExpanded: true,
});
let toastTimer = null;
let resolutionCache = new Map();
const storyCache = new Map();
const mediaCache = new Map();
const homeOpenFolders = new Set();
const readerExpandedStories = new Set();
const readerExpandedCorpora = new Set();
const readerExpandedFolders = new Set();
const authorityTemplates = {
  category: null,
  folderCard: null,
  readerRow: null,
};
const mobileCategoryPrototype = ui.homeMobileCategories
  ?.querySelector('.magi-home-category-node')
  ?.cloneNode(true) ?? null;

function readStoredValue(key, allowed, fallback) {
  try {
    const value = localStorage.getItem(key);
    return allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

const createElement = (tag, options = {}) => {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  if (options.type) element.type = options.type;
  if (options.title) element.title = options.title;
  return element;
};

const replaceChildren = (parent, children) => parent.replaceChildren(...children);

const fetchJson = async (source) => {
  const response = await fetch(source, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${source}`);
  return response.json();
};

const fetchBinary = async (source) => {
  const response = await fetch(source, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${source}`);
  return new Uint8Array(await response.arrayBuffer());
};

const fetchText = async (source) => {
  const response = await fetch(source, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${source}`);
  return response.text();
};

const markupTemplate = (markup) => {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  return template;
};

const cloneAuthorityNode = (template) => template?.content.firstElementChild?.cloneNode(true) ?? null;

const loadAuthorityTemplates = async () => {
  const [category, folderCard, readerRow] = await Promise.all([
    fetchText('./classic/authority/home-category-template.html'),
    fetchText('./classic/authority/folder-card-template.html'),
    fetchText('./classic/authority/reader-row-template.html'),
  ]);
  authorityTemplates.category = markupTemplate(category);
  authorityTemplates.folderCard = markupTemplate(folderCard);
  authorityTemplates.readerRow = markupTemplate(readerRow);
};

const showToast = (text) => {
  ui.toast.textContent = text;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 2400);
};

const setStatus = (text) => {
  if (!ui.homeStatus) return;
  ui.homeStatus.textContent = text;
  ui.homeStatus.title = text;
  ui.homeStatus.setAttribute('aria-label', text);
};

const corpusIconMarkup = (corpusId) => {
  const common = 'xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  if (corpusId === 'all') return `<svg ${common} class="lucide lucide-menu"><path d="M4 5h16"></path><path d="M4 12h16"></path><path d="M4 19h16"></path></svg>`;
  if (corpusId === 'narcissu10') return `<svg ${common} class="lucide lucide-book-open"><path d="M12 7v14"></path><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"></path></svg>`;
  if (corpusId === 'narcissu3') return `<svg ${common} class="lucide lucide-layers"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"></path><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"></path><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"></path></svg>`;
  return `<svg ${common} class="lucide lucide-notebook-text"><path d="M2 6h4"></path><path d="M2 10h4"></path><path d="M2 14h4"></path><path d="M2 18h4"></path><rect width="16" height="20" x="4" y="2" rx="2"></rect><path d="M9.5 8h5"></path><path d="M9.5 12H16"></path><path d="M9.5 16H14"></path></svg>`;
};

const applyHomeThemeClasses = () => {
  const night = isNightTheme(theme);
  const dayArchive = isDayArchiveTheme(theme);
  ui.homeSidebar.className = `${HOME_SIDEBAR_BASE} ${
    night
      ? 'border-gray-800 bg-gray-900'
      : dayArchive ? 'magi-home-light-sidebar' : 'border-black/5 bg-inherit'
  }`;
  ui.homeToolbar.className = `${HOME_TOOLBAR_BASE} ${
    night
      ? 'border-gray-800 bg-gray-900/90'
      : dayArchive ? 'magi-home-light-toolbar' : 'border-black/5 bg-white/60'
  }`;
  ui.homeSearch.className = `${HOME_SEARCH_BASE} ${
    night
      ? 'bg-gray-800 border-gray-700'
      : dayArchive ? 'magi-home-light-control' : 'bg-white/50 border-black/10'
  }`;
  ui.homeSearchModeShell.className = `${HOME_SEARCH_MODE_BASE} ${
    dayArchive
      ? 'magi-home-light-control'
      : 'border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800'
  }`;
  for (const button of ui.homeSearchModeButtons) {
    const active = button.getAttribute('aria-pressed') === 'true';
    button.className = `${HOME_SEARCH_MODE_BUTTON_BASE} ${
      active
        ? dayArchive
          ? 'magi-home-light-button-active'
          : 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-300 shadow-sm'
        : dayArchive
          ? 'magi-home-light-segment'
          : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
    }`;
  }
  const jpActive = Boolean(ui.homeJpToggle.checked);
  ui.homeJpLabel.className = `${HOME_JP_BASE} ${
    dayArchive
      ? jpActive ? 'magi-home-light-button-active' : 'magi-home-light-button opacity-70'
      : jpActive
        ? night ? 'bg-blue-900/30 border-blue-800 text-blue-400' : 'bg-blue-50 border-blue-200 text-blue-700'
        : 'border-transparent opacity-60'
  }`;
  ui.openLocalStory.className = `${HOME_LOCAL_STORY_BASE} ${
    night
      ? 'bg-blue-900/30 border-blue-800 text-blue-300 hover:bg-blue-900/50'
      : dayArchive ? 'magi-home-light-button' : 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
  }`;
  ui.homeSettings.className = `${HOME_SETTINGS_BASE} ${
    night
      ? 'border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700'
      : dayArchive ? 'magi-home-light-button' : 'border-gray-200 bg-white/70 text-gray-700 hover:bg-white'
  }`;
  ui.homeAbout.className = `${HOME_ABOUT_BASE} ${
    night
      ? 'bg-emerald-900/30 border-emerald-800 text-emerald-400 hover:bg-emerald-800'
      : dayArchive ? 'magi-home-light-button' : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
  }`;
  ui.homeStatus.className = `${HOME_STATUS_BASE} ${
    night
      ? 'border-blue-800 bg-blue-900/30 text-blue-300 hover:bg-blue-800'
      : dayArchive ? 'magi-home-light-button' : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
  }`;
  const mobileSourceOpen = ui.homeMobileMenu.getAttribute('aria-expanded') === 'true';
  ui.homeMobileMenu.className = `${HOME_MOBILE_SOURCE_BASE} ${
    mobileSourceOpen
      ? night
        ? 'border-emerald-500 bg-emerald-900/45 text-emerald-300'
        : dayArchive ? 'magi-home-light-button-active' : 'border-emerald-500 bg-emerald-100 text-emerald-800'
      : night
        ? 'border-gray-700 bg-gray-800 text-gray-300'
        : dayArchive ? 'magi-home-light-button' : 'border-gray-300 bg-white/70 text-gray-700'
  }`;
  ui.homeThemeSwitcher.className = `${HOME_THEME_SWITCHER_BASE} ${
    night ? 'bg-black/20' : dayArchive ? 'magi-home-light-control' : 'bg-black/5'
  }`;
};

const applyReaderThemeClasses = () => {
  const night = isNightTheme(theme);
  const mobileOpen = ui.readerView.dataset.mobileSidebarOpen === 'true';
  const sidebarThemeClass = night
    ? 'bg-gray-900/70 glass-morphism border-gray-700 text-gray-300'
    : theme === 'paper'
      ? 'bg-[#f0e6d2]/60 glass-morphism border-[#dcd6b6] text-[#5c4b37]'
      : theme === 'green'
        ? 'bg-[#d8e6d1]/60 glass-morphism border-[#b8cbb0] text-[#1b4d1b]'
        : 'bg-[#ded6c3]/65 glass-morphism border-[#9d927e]/35 text-[#5d564b] shadow-[10px_0_28px_rgba(77,68,52,0.08)]';
  ui.readerSidebar.className = `${READER_SIDEBAR_BASE} ${
    mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full hidden md:flex'
  } ${sidebarThemeClass}`;
  ui.readerBrand.className = `magi-reader-brand text-xl font-black ${
    theme === 'light' || theme === 'paper'
      ? 'magi-reader-brand-day-archive'
      : 'bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent'
  }`;
  if (ui.readerSidebarClose) {
    ui.readerSidebarClose.className = `rounded-full p-2 hover:bg-black/10 active:scale-95 md:hidden ${night ? 'text-white' : 'text-gray-800'}`;
  }
  const headerThemeClass = theme === 'light'
    ? 'border-gray-200 bg-white/80 backdrop-blur-md'
    : theme === 'dark'
      ? 'border-gray-800 bg-[#0f172a]/80 backdrop-blur-md'
      : theme === 'paper'
        ? 'border-[#e6dfc5] bg-[#f0e6d2]/60 backdrop-blur-md'
        : theme === 'green'
          ? 'border-[#A8D8B9] bg-[#C7EDCC]/80 backdrop-blur-md'
          : '';
  ui.readerHeader.className = `${READER_HEADER_BASE}${headerThemeClass ? ` ${headerThemeClass}` : ''}`;
  for (const search of ui.readerSearches) {
    if (search.closest('.magi-reader-header')) {
      search.className = `${READER_SEARCH_BASE} ${
        night
          ? 'border-gray-700 bg-gray-800 text-gray-200 focus:border-blue-500'
          : 'border-transparent bg-gray-100 focus:border-blue-400 focus:bg-white'
      }`;
    }
  }
  ui.readerLanguageShell.className = `flex rounded p-0.5 text-[10px] font-bold ${night ? 'bg-white/10' : 'bg-black/5'}`;
};

const applyFloatingWindowTheme = () => {
  if (!ui.dialog || ui.dialog.hidden) return;
  const surfaceTheme = isNightTheme(theme) ? 'dark' : theme;
  const windowClass = ui.dialog.dataset.windowKind === 'settings'
    ? 'magi-site-settings-window'
    : 'magi-about-window';
  ui.dialog.className = `magi-floating-window magi-floating-window-${surfaceTheme} ${windowClass}`;
  ui.dialog.dataset.theme = surfaceTheme;
};

const applyTheme = (nextTheme, persist = true) => {
  theme = THEMES.some((item) => item.id === nextTheme) ? nextTheme : 'frost';
  if (persist) {
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* localStorage may be unavailable */ }
  }
  const night = isNightTheme(theme);
  ui.background.dataset.bgTheme = night ? 'dark' : theme;
  ui.homeView.dataset.theme = night ? 'dark' : theme;
  ui.homeView.dataset.themeVariant = theme;
  ui.homeView.className = `magi-home-shell magi-home-${theme}-root ${theme === 'frost' ? 'magi-home-dark-root ' : ''}flex h-screen h-[100dvh] overflow-hidden`;
  ui.readerView.dataset.theme = night ? 'dark' : theme;
  ui.readerView.dataset.themeVariant = theme;
  const readerTextClass = theme === 'light'
    ? 'text-gray-900'
    : theme === 'paper'
      ? 'text-[#4a4036]'
      : theme === 'green' ? 'text-[#003300]' : 'text-gray-200';
  ui.readerView.className = `${READER_ROOT_BASE.replace('magi-reader-root ', `magi-reader-root magi-reader-theme-${theme} ${theme === 'frost' ? 'magi-reader-theme-dark ' : ''}`)} ${readerTextClass}`;
  if (ui.texture) {
    ui.texture.classList.toggle('magi-texture-dark', night);
    ui.texture.classList.toggle('magi-texture-light', !night);
  }
  const fontControl = ui.fontWidget?.querySelector('.magi-reader-font-control');
  if (fontControl) {
    for (const item of THEMES) fontControl.classList.remove(`magi-reader-font-control-${item.id}`);
    fontControl.classList.add(`magi-reader-font-control-${theme}`, 'magi-reader-font-control-open');
  }
  for (const item of THEMES) ui.fontWidgetFab.classList.remove(`magi-reader-font-control-${item.id}`);
  ui.fontWidgetFab.classList.add(`magi-reader-font-control-${theme}`);
  applyHomeThemeClasses();
  applyReaderThemeClasses();
  renderThemeSwitchers();
  updateDisplayButtons();
  applyFloatingWindowTheme();
  if (catalog) {
    renderHome();
    renderReaderTree();
    if (activeSession && !ui.readerView.hidden) void renderSession(activeSession.snapshot(), false);
  }
};

const renderThemeSwitchers = () => {
  const dayArchive = isDayArchiveTheme(theme);
  for (const switcher of [ui.homeThemeSwitcher, ui.readerThemeSwitcher]) {
    if (!switcher) continue;
    for (const button of switcher.querySelectorAll('[data-theme-option]')) {
      const active = button.dataset.themeOption === theme;
      button.setAttribute('aria-pressed', String(active));
      if (switcher === ui.homeThemeSwitcher) {
        button.className = `p-2 rounded-full ${
          active
            ? dayArchive ? 'magi-home-light-theme-active' : 'bg-white shadow text-black'
            : dayArchive ? 'magi-home-light-segment opacity-55' : 'opacity-40'
        }`;
      } else {
        button.className = 'magi-reader-theme-option';
      }
      button.onclick = () => applyTheme(button.dataset.themeOption);
    }
  }
};

const allStoryRecords = () => catalog.corpora.flatMap((corpus) =>
  corpus.stories.map((storyEntry) => ({ corpus, storyEntry })),
);

const findStoryRecord = (canonicalStoryId) =>
  allStoryRecords().find(({ storyEntry }) => storyEntry.canonicalStoryId === canonicalStoryId) ?? null;

const firstStoryRecord = () => allStoryRecords()[0] ?? null;

const folderGroupsForCorpus = (corpus) => {
  const groups = new Map();
  for (const story of corpus.stories) {
    const folderId = story.folderId ?? 'stories';
    if (!groups.has(folderId)) groups.set(folderId, {
      folderId,
      title: story.folderTitle ?? '剧情',
      stories: [],
    });
    groups.get(folderId).stories.push(story);
  }
  return [...groups.values()];
};

const currentLocalePair = () => {
  const locales = activeSession?.variant.locales ?? ['zh-CN', 'ja-JP'];
  const cn = locales.find((locale) => /^zh(?:-|$)/iu.test(locale)) ?? locales[0];
  const jp = locales.find((locale) => /^ja(?:-|$)/iu.test(locale))
    ?? locales.find((locale) => locale !== cn)
    ?? cn;
  return { cn, jp, single: locales.length < 2 };
};

const cnText = (record) => {
  const { cn, jp } = currentLocalePair();
  return localizedText(record, cn, [jp]);
};

const jpText = (record) => {
  const { cn, jp } = currentLocalePair();
  return localizedText(record, jp, [cn]);
};

const loadStoryDocument = async (corpus, storyEntry) => {
  const cached = storyCache.get(storyEntry.canonicalStoryId);
  if (cached) return cached;
  const story = await adapterRegistry.loadStory(corpus, storyEntry, { fetchJson, fetchBinary });
  storyCache.set(storyEntry.canonicalStoryId, story);
  return story;
};

const loadMediaManifest = async (storyEntry, story) => {
  const cached = mediaCache.get(storyEntry.canonicalStoryId);
  if (cached) return cached;
  const manifest = story.embeddedMedia
    ? validateMediaManifest(story.embeddedMedia)
    : validateMediaManifest(await fetchJson(storyEntry.mediaManifest));
  mediaCache.set(storyEntry.canonicalStoryId, manifest);
  return manifest;
};

const HOME_SOURCE_MODES = Object.freeze([
  Object.freeze({ id: 'all', title: '全部' }),
  Object.freeze({ id: 'text', title: '文本' }),
  Object.freeze({ id: 'image', title: '图像' }),
  Object.freeze({ id: 'audio', title: '语音' }),
]);

const homeFolderRecords = () => catalog.corpora.flatMap((corpus) =>
  folderGroupsForCorpus(corpus).map((folder) => ({
    id: `${corpus.corpusId}:${folder.folderId}`,
    corpus,
    folder,
  })),
);

const storyMatchesSourceMode = (storyEntry, mode = selectedSourceMode) => {
  if (mode === 'all') return true;
  return (storyEntry.sourceStory?.variants ?? []).some((variant) => {
    const locales = new Set([
      variant.sourceLocale,
      ...(variant.readerLocales ?? []),
    ].filter(Boolean));
    if (mode === 'zh') return locales.has('zh-CN');
    if (mode === 'ja') return locales.has('ja-JP');
    return locales.has('en');
  });
};

const HOME_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'narcissu10', title: 'Narcissu 10th Anniversary Anthology Project', corpusId: 'narcissu10' }),
  Object.freeze({ id: 'narcissu3', title: 'Narcissu 3rd', corpusId: 'narcissu3' }),
  Object.freeze({ id: 'kana', title: 'KANA: Okaeri!!', corpusId: 'kana' }),
]);

const HOME_CATEGORY_ANCHORS = Object.freeze([1, 0, 2]);
const connectedCorpusIds = new Set(HOME_CATEGORIES.map((category) => category.id));

const createSourceFilterNode = (mode, modeIndex, connectedCategories) => {
  const filter = createElement('div', {
    className: 'magi-home-category-filter relative min-w-0 rounded px-2 py-1 text-left text-[11px] font-bold transition',
  });
  filter.dataset.filter = mode.id;
  filter.dataset.filterIndex = String(modeIndex);
  filter.dataset.connectorShape = modeIndex === 0 ? 'straight' : 'diagonal';
  filter.dataset.enabled = 'true';
  filter.dataset.selected = 'true';
  filter.dataset.progressPercent = '100';
  filter.dataset.progressBasis = 'asset-coverage';
  filter.dataset.progressAvailable = 'true';
  Object.assign(filter.style, {
    '--magi-category-filter-progress': '100%',
    gridTemplateColumns: 'minmax(0, 1fr)',
    justifyItems: 'center',
    minHeight: 'max-content',
    height: 'max-content',
    width: 'max-content',
    minWidth: '30px',
    maxWidth: '100%',
    alignSelf: 'start',
    justifySelf: 'end',
    opacity: '1',
  });

  const hit = createElement('button', {
    type: 'button',
    className: 'magi-home-category-filter-hit absolute inset-0 z-[2] rounded-[inherit] border-0 bg-transparent p-0',
  });
  hit.setAttribute('aria-label', `${mode.title}单选`);
  hit.setAttribute('aria-pressed', 'true');
  hit.onclick = () => {
    selectedSourceMode = mode.id;
    renderHomeCatalog();
  };
  filter.append(hit);

  const progress = createElement('output', { className: 'sr-only', text: `${mode.title}覆盖 100%` });
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-label', `${mode.title}进度`);
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  progress.setAttribute('aria-valuenow', '100');
  filter.append(progress);

  const anchors = createElement('span', {
    className: 'magi-home-category-filter-anchor-set pointer-events-none absolute inset-0',
  });
  Object.assign(anchors.style, {
    color: 'var(--magi-category-branch-line, currentColor)',
    overflow: 'visible',
    textOverflow: 'clip',
  });
  [18, 50, 82].forEach((topPercent, anchorIndex) => {
    const slot = HOME_CATEGORY_ANCHORS.findIndex((candidate) => candidate === anchorIndex);
    const category = connectedCategories[slot];
    const anchor = createElement('button', {
      type: 'button',
      className: 'magi-home-category-filter-anchor-dot pointer-events-auto absolute grid place-items-center',
    });
    anchor.dataset.anchorIndex = String(anchorIndex);
    anchor.dataset.anchorPosition = ['top', 'middle', 'bottom'][anchorIndex];
    anchor.dataset.connected = category ? 'true' : 'false';
    anchor.dataset.selected = category ? 'true' : 'false';
    anchor.dataset.enabled = category ? 'true' : 'false';
    anchor.dataset.anchorKind = anchorIndex === 1 ? 'connector' : 'selector';
    anchor.setAttribute('aria-label', category
      ? `${HOME_CATEGORIES.find((item) => item.id === category)?.title ?? category}与${mode.title}`
      : `${mode.title}空连接位`);
    anchor.setAttribute('aria-pressed', category ? 'true' : 'false');
    anchor.disabled = !category;
    Object.assign(anchor.style, {
      left: '-1px',
      top: `${topPercent}%`,
      width: '22px',
      height: '22px',
      overflow: 'visible',
      transform: 'translate(-50%, -50%)',
    });
    anchor.append(createElement('span', { className: 'magi-home-category-filter-anchor-glyph' }));
    anchors.append(anchor);
  });
  filter.append(anchors);

  const label = createElement('span', {
    className: 'magi-home-category-filter-label relative z-[1] min-w-0',
    text: mode.title,
  });
  Object.assign(label.style, {
    overflow: 'visible',
    textOverflow: 'clip',
    whiteSpace: 'normal',
    writingMode: 'vertical-rl',
    textOrientation: 'upright',
    overflowWrap: 'normal',
    justifySelf: 'center',
    pointerEvents: 'none',
  });
  filter.append(label);
  return filter;
};

const renderHomeCategorySourceGraph = (nav) => {
  if (!nav || nav.classList.contains('magi-home-mobile-category-nav')) return;
  const connectedCategories = [...connectedCorpusIds].slice(0, 3);
  if (connectedCategories.length === 0) return;

  const overlay = createElement('div', {
    className: 'magi-home-category-branch-overlay pointer-events-none absolute z-[80] overflow-visible',
  });
  overlay.dataset.category = selectedCorpusId;
  overlay.dataset.overlay = 'true';
  overlay.dataset.overlayPlacement = 'viewport-top';
  const width = nav.clientWidth || 256;
  const height = nav.clientHeight || 640;
  const menuWidth = Math.min(56, Math.max(30, width - 16));
  const menuLeft = Math.max(0, width - 8 - menuWidth);
  Object.assign(overlay.style, {
    top: `${nav.scrollTop}px`,
    left: `${nav.scrollLeft}px`,
    width: `${width}px`,
    height: `${height}px`,
    margin: '0px',
    pointerEvents: 'none',
    visibility: 'visible',
  });

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'magi-home-category-overlay-lines pointer-events-none absolute inset-0 h-full w-full overflow-visible');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', '作品与资源类型连接线');
  Object.assign(svg.style, {
    color: 'var(--magi-category-branch-line, rgba(57, 66, 68, 0.58))',
    overflow: 'visible',
    zIndex: '0',
  });
  svg.innerHTML = `<defs aria-hidden="true">${[
    ['#778c87', '#c7d7d1', '#e4eee9'],
    ['#858d78', '#c7cfb7', '#e6eadc'],
    ['#668c91', '#afd0cd', '#d9e9e5'],
    ['#747f96', '#b8c1d0', '#dfe4ec'],
  ].map(([start, middle, end], index) => `
    <linearGradient id="magi-frost-source-line-${index}" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${start}" stop-opacity="0.34" />
      <stop offset="54%" stop-color="${middle}" stop-opacity="0.62" />
      <stop offset="100%" stop-color="${end}" stop-opacity="0.48" />
    </linearGradient>
    <linearGradient id="magi-frost-source-line-active-${index}" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${start}" stop-opacity="0.62" />
      <stop offset="57%" stop-color="${middle}" stop-opacity="0.94" />
      <stop offset="100%" stop-color="${end}" stop-opacity="0.76" />
    </linearGradient>`).join('')}</defs>`;
  overlay.append(svg);

  const menu = createElement('div', {
    className: 'magi-home-category-filter-overlay-menu pointer-events-auto absolute top-2 z-10 grid min-w-0 gap-1',
  });
  menu.id = `category-filters-${selectedCorpusId}`;
  menu.setAttribute('role', 'group');
  menu.setAttribute('aria-label', '当前作品资源类型');
  menu.dataset.category = selectedCorpusId;
  menu.dataset.overlay = 'true';
  Object.assign(menu.style, {
    left: `${menuLeft}px`,
    width: `${menuWidth}px`,
    maxWidth: `calc(100% - ${menuLeft}px)`,
    top: '8px',
    height: 'calc(100% - 16px)',
    gridAutoRows: 'max-content',
    alignContent: 'space-evenly',
    justifyItems: 'end',
    pointerEvents: 'auto',
  });
  HOME_SOURCE_MODES.forEach((mode, modeIndex) => {
    const node = createSourceFilterNode(mode, modeIndex, connectedCategories);
    node.dataset.category = selectedCorpusId;
    menu.append(node);
  });
  overlay.append(menu);
  nav.append(overlay);

  requestAnimationFrame(() => {
    const overlayRect = overlay.getBoundingClientRect();
    const selectors = new Map([...nav.querySelectorAll('.magi-home-category-select-box')]
      .map((selector) => [selector.dataset.category, selector]));
    const filters = [...menu.querySelectorAll('.magi-home-category-filter')];
    connectedCategories.forEach((category, categorySlot) => {
      const selector = selectors.get(category);
      if (!selector) return;
      const start = selector.getBoundingClientRect();
      const anchorIndex = HOME_CATEGORY_ANCHORS[categorySlot];
      filters.forEach((filter, modeIndex) => {
        const anchor = filter.querySelector(`[data-anchor-index="${anchorIndex}"]`);
        if (!anchor) return;
        const end = anchor.getBoundingClientRect();
        const x1 = start.left + start.width / 2 - overlayRect.left;
        const y1 = start.top + start.height / 2 - overlayRect.top;
        const x2 = end.left + end.width / 2 - overlayRect.left;
        const y2 = end.top + end.height / 2 - overlayRect.top;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.max(1, Math.hypot(dx, dy));
        const normalX = -dy / length;
        const normalY = dx / length;
        const direction = (modeIndex + anchorIndex) % 2 === 0 ? 1 : -1;
        const bend = Math.min(42, Math.max(7, length * 0.145)) * direction;
        const pathData = [
          `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
          `C ${(x1 + dx * 0.24 + normalX * bend).toFixed(2)} ${(y1 + dy * 0.24 + normalY * bend).toFixed(2)}`,
          `${(x1 + dx * 0.72 - normalX * bend * 0.48).toFixed(2)} ${(y1 + dy * 0.72 - normalY * bend * 0.48).toFixed(2)}`,
          `${x2.toFixed(2)} ${y2.toFixed(2)}`,
        ].join(' ');
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        if (theme === 'frost') {
          for (const suffix of ['bloom', 'fringe-a', 'fringe-b']) {
            const echo = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            echo.setAttribute('class', `magi-home-category-branch-echo magi-home-category-branch-echo--${suffix}`);
            echo.dataset.filterIndex = String(modeIndex);
            echo.dataset.selected = 'true';
            echo.setAttribute('d', pathData);
            echo.setAttribute('fill', 'none');
            group.append(echo);
          }
        }
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        line.setAttribute('class', 'magi-home-category-branch-line');
        line.dataset.category = category;
        line.dataset.filterIndex = String(modeIndex);
        line.dataset.connectorShape = 'curved';
        line.dataset.anchorIndex = String(anchorIndex);
        line.dataset.anchorPosition = ['top', 'middle', 'bottom'][anchorIndex];
        line.dataset.enabled = 'true';
        line.dataset.selected = 'true';
        line.setAttribute('d', pathData);
        line.setAttribute('fill', 'none');
        Object.assign(line.style, {
          animation: 'none',
          opacity: '1',
          stroke: theme === 'frost'
            ? `url(#magi-frost-source-line-active-${modeIndex})`
            : 'var(--magi-category-branch-selected-line, var(--magi-category-branch-line, rgba(57, 66, 68, 0.92)))',
          strokeDasharray: 'none',
          strokeDashoffset: '0',
          strokeLinecap: 'round',
          strokeWidth: '1.1px',
        });
        group.append(line);
        svg.append(group);
      });
    });
  });
};

const setCategoryTriggerState = (trigger, selected, mobile, expanded = false) => {
  const activeClass = isNightTheme(theme)
    ? 'bg-emerald-900/50 text-emerald-400 border-emerald-500'
    : isDayArchiveTheme(theme)
      ? 'magi-home-light-nav-active'
      : 'bg-emerald-50 text-emerald-700 border-emerald-500';
  const inactiveClass = isDayArchiveTheme(theme)
    ? 'magi-home-light-nav-item border-transparent'
    : 'text-gray-500 hover:bg-black/5 border-transparent';
  trigger.className = `magi-home-category-trigger relative z-10 inline-flex w-max max-w-full shrink-0 items-center gap-1.5 px-2 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap ${
    mobile ? 'border-b-2 rounded-none' : 'border-l-4'
  } ${selected ? activeClass : inactiveClass}`;
  trigger.dataset.selected = String(selected);
  trigger.toggleAttribute('aria-current', selected);
  if (!mobile) trigger.setAttribute('aria-expanded', String(expanded));
};

function renderHomeCategories() {
  for (const nav of ui.homeCategoryNavs) {
    const mobile = nav.classList.contains('magi-home-mobile-category-nav');
    const nodes = HOME_CATEGORIES.map((category, index) => {
      const node = (mobile && mobileCategoryPrototype
        ? mobileCategoryPrototype.cloneNode(true)
        : cloneAuthorityNode(authorityTemplates.category));
      if (!node) throw new Error('Classic 分类模板缺失');
      const active = selectedCorpusId === category.id;
      const selected = connectedCorpusIds.has(category.id);
      node.dataset.category = category.id;
      node.dataset.active = String(active);
      node.dataset.selected = String(selected);
      node.dataset.expanded = String(active);
      const trigger = node.querySelector('.magi-home-category-trigger');
      const label = trigger.querySelector(':scope > span');
      const sourceIcon = trigger.querySelector(':scope > svg');
      const iconShell = document.createElement('span');
      iconShell.innerHTML = corpusIconMarkup(category.corpusId);
      const icon = iconShell.firstElementChild;
      if (sourceIcon && icon) sourceIcon.replaceWith(icon);
      if (label) label.textContent = category.title;
      trigger.style.width = 'max-content';
      trigger.style.maxWidth = '100%';
      trigger.style.flex = '0 0 auto';
      setCategoryTriggerState(trigger, active, mobile, active);
      trigger.setAttribute('aria-label', `显示${category.title}`);
      trigger.onclick = () => {
        selectedCorpusId = category.id;
        renderHome();
        if (mobile) closeHomeSidebar();
      };
      const select = node.querySelector('.magi-home-category-select-box');
      if (select) {
        select.dataset.category = category.id;
        select.dataset.selected = String(selected);
        select.setAttribute('aria-label', `${selected ? '取消' : '连接'}${category.title}`);
        select.setAttribute('aria-pressed', String(selected));
        select.disabled = !selected && connectedCorpusIds.size >= 3;
        select.onclick = (event) => {
          event.stopPropagation();
          if (selected) {
            connectedCorpusIds.delete(category.id);
          } else if (connectedCorpusIds.size < 3) {
            connectedCorpusIds.add(category.id);
          }
          renderHomeCategories();
          if (mobile) closeHomeSidebar();
        };
        if (mobile) {
          select.classList.remove(
            'magi-home-mobile-category-select-box--above',
            'magi-home-mobile-category-select-box--below',
          );
          select.classList.add(index < 2
            ? 'magi-home-mobile-category-select-box--below'
            : 'magi-home-mobile-category-select-box--above');
        }
      }
      return node;
    });
    nav.style.gridTemplateColumns = mobile ? 'repeat(4, minmax(0, 1fr))' : '';
    replaceChildren(nav, nodes);
    renderHomeCategorySourceGraph(nav);
  }
}

const storyMatchesHomeQuery = (corpus, storyEntry, query) => !query
  || `${corpus.title} ${storyEntry.title} ${storyEntry.folderTitle ?? ''} ${storyEntry.sourceCanonicalStoryId ?? ''}`
    .toLocaleLowerCase().includes(query);

function renderHomeCatalog() {
  if (!catalog) return;
  const query = ui.homeSearch.value.trim().toLocaleLowerCase();
  const records = allStoryRecords()
    .filter(({ corpus, storyEntry }) => selectedCorpusId === 'all' || corpus.corpusId === selectedCorpusId)
    .filter(({ corpus, storyEntry }) => storyMatchesHomeQuery(corpus, storyEntry, query));

  const cards = records.map(({ corpus, storyEntry }) => {
    const card = cloneAuthorityNode(authorityTemplates.folderCard);
    if (!card) throw new Error('Classic 作品卡模板缺失');
    const button = card.querySelector('.magi-card-heading-grid');
    const title = card.querySelector('.magi-folder-display-title');
    const percent = card.querySelector('.magi-card-meta span');
    const night = isNightTheme(theme);
    const dayArchive = isDayArchiveTheme(theme);
    const cardThemeClass = night
      ? 'border-gray-700'
      : dayArchive ? 'magi-home-light-folder-card' : 'border-black/10';
    const headerClass = night
      ? 'bg-emerald-900/40 border-emerald-800 text-emerald-100'
      : dayArchive
        ? 'magi-home-light-folder-header magi-home-light-folder-header-complete'
        : 'bg-emerald-600 border-emerald-700 text-white';
    const progressClass = night
      ? 'text-emerald-400'
      : dayArchive ? 'magi-home-light-progress' : 'text-emerald-100';
    card.dataset.corpus = corpus.corpusId;
    card.dataset.storyId = storyEntry.canonicalStoryId;
    card.className = `magi-folder-source-card break-inside-avoid mb-3 rounded-lg border shadow-sm transition-all ${cardThemeClass} magi-folder-card-collapsed`;
    button.className = `magi-card-heading-grid magi-folder-heading-flow w-full px-3 py-3 text-left transition-colors border-b border-transparent ${headerClass}`;
    if (title) title.textContent = storyEntry.title;
    if (percent) {
      percent.className = `shrink-0 font-mono text-[10px] ${progressClass}`;
      percent.textContent = '100%';
    }
    button.setAttribute('aria-label', `打开 ${corpus.title} · ${storyEntry.title}`);
    button.title = `${corpus.title} · ${storyEntry.folderTitle ?? '剧情'} · ${storyEntry.title}`;
    button.onclick = () => void openStory(corpus, storyEntry, {
      canonicalStoryId: storyEntry.canonicalStoryId,
      variantId: storyEntry.preferredVariantId,
    });
    return card;
  });

  const columnCount = window.matchMedia('(min-width: 1280px)').matches
    ? 3
    : window.matchMedia('(min-width: 768px)').matches ? 2 : 1;
  ui.homeFolderColumns.style.setProperty('--magi-folder-column-count', String(columnCount));
  const columns = Array.from({ length: columnCount }, () =>
    createElement('div', { className: 'magi-home-folder-column' }));
  cards.forEach((card, index) => columns[index % columnCount].append(card));
  if (cards.length === 0) {
    columns[0].append(createElement('p', {
      className: 'text-center opacity-50 mt-10',
      text: '没有匹配的剧情。',
    }));
  }
  replaceChildren(ui.homeFolderColumns, columns);

  const total = allStoryRecords().length;
  const variantTotal = records.reduce((sum, record) =>
    sum + (record.storyEntry.sourceStory?.variants?.length ?? 0), 0);
  ui.homeHeading.textContent = HOME_CATEGORIES.find((item) => item.id === selectedCorpusId)?.title ?? '全部作品';
  const stats = {
    total: `总数 ${total}`,
    human: `当前 ${records.length}`,
    pending: `版本 ${variantTotal}`,
    verified: '正文 / 分支 / 语音',
  };
  for (const [key, value] of Object.entries(stats)) {
    const node = ui.homeStatistics.querySelector(`[data-stat="${key}"]`);
    if (node) node.textContent = value;
  }
}

function renderHome() {
  renderHomeCategories();
  renderHomeCatalog();
}

const closeHomeSidebar = () => {
  if (!ui.homeMobileCategories) return;
  ui.homeMobileCategories.classList.add('hidden');
  ui.homeMobileMenu?.setAttribute('aria-expanded', 'false');
};
const closeReaderSidebar = () => {
  ui.readerView.dataset.mobileSidebarOpen = 'false';
  ui.readerSidebar.classList.add('-translate-x-full', 'hidden');
  ui.readerSidebar.classList.remove('translate-x-0', 'shadow-2xl');
  ui.readerSidebar.classList.add('md:flex');
  ui.readerScrim.hidden = true;
};

function showHome({ syncUrl = true } = {}) {
  audioController.stop();
  if (!ui.dialog.hidden) closeFloatingWindow();
  ui.readerView.hidden = true;
  ui.homeView.hidden = false;
  closeReaderSidebar();
  if (syncUrl) window.history.replaceState(null, '', `${window.location.pathname}`);
  renderHome();
}

function showReader() {
  if (!ui.dialog.hidden) closeFloatingWindow();
  ui.homeView.hidden = true;
  ui.readerView.hidden = false;
  closeHomeSidebar();
}

const iconNode = (markup) => {
  const shell = document.createElement('span');
  shell.innerHTML = markup;
  return shell.firstElementChild;
};

const chevronMarkup = (size = 13, rotate = false) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-right${rotate ? ' rotate-90' : ''}" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>`;
const folderMarkup = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-folder magi-reader-sidebar-folder-icon shrink-0" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path></svg>';
const fileMarkup = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-text magi-reader-story-file-icon" aria-hidden="true"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" x2="8" y1="13" y2="13"></line><line x1="16" x2="8" y1="17" y2="17"></line></svg>';

const readerSidebarHoverClass = () => theme === 'green'
  ? 'hover:bg-[#b0e2bd]'
  : isNightTheme(theme)
    ? 'hover:bg-gray-800'
    : theme === 'paper' ? 'hover:bg-black/5' : 'hover:bg-[#81745e]/10';

const readerStoryClass = (active) => {
  if (active) {
    return theme === 'green'
      ? 'border-[#1B5E20] bg-[#2E7D32] text-white'
      : isNightTheme(theme)
        ? 'border-blue-500 bg-blue-900/30 text-blue-300'
        : theme === 'light'
          ? 'border-[#81745e] bg-[#c9bea9]/75 text-[#403a32]'
          : 'border-blue-500 bg-blue-50 text-blue-700';
  }
  return isNightTheme(theme)
    ? 'border-emerald-500/50 bg-emerald-900/30 text-emerald-400 hover:bg-emerald-900/40'
    : theme === 'light'
      ? 'border-[#93866f]/40 bg-[#d8cfbd]/60 text-[#514a3f] hover:bg-[#cec3ae]/75'
      : 'border-emerald-500/50 bg-emerald-50 text-emerald-700 hover:bg-emerald-100';
};

const renderFolderNode = (corpus, folder) => {
  const folderKey = `${corpus.corpusId}:${folder.folderId}`;
  const activeFolder = activeCorpus?.corpusId === corpus.corpusId
    && activeStoryEntry?.folderId === folder.folderId;
  const open = activeFolder || readerExpandedFolders.has(folderKey);
  const folderNode = createElement('div', {
    className: `magi-reader-sidebar-folder-node${open ? '' : ' magi-sidebar-folder-collapsed'}`,
  });
  folderNode.dataset.treeItem = 'folder';
  const folderButton = createElement('button', {
    className: `magi-reader-sidebar-folder-button grid w-full min-w-0 items-center rounded px-2 py-2 text-left text-xs transition-colors ${readerSidebarHoverClass()}`,
    type: 'button',
  });
  folderButton.dataset.treeFocus = 'true';
  const disclosureIcon = iconNode(chevronMarkup(13, open));
  disclosureIcon.classList.add('magi-reader-sidebar-folder-disclosure', 'shrink-0');
  const label = createElement('span', {
    className: `magi-reader-sidebar-folder-label min-w-0 truncate leading-tight ${isNightTheme(theme) ? 'text-emerald-400' : 'font-bold text-emerald-700'}`,
    text: folder.title,
    title: folder.title,
  });
  const count = createElement('span', {
    className: 'shrink-0 rounded bg-black/5 px-1 text-[10px] opacity-50',
    text: String(folder.stories.length),
  });
  folderButton.append(disclosureIcon, iconNode(folderMarkup), label, count);
  folderButton.setAttribute('aria-expanded', String(open));
  folderButton.onclick = () => {
    if (readerExpandedFolders.has(folderKey)) readerExpandedFolders.delete(folderKey);
    else readerExpandedFolders.add(folderKey);
    renderReaderTree();
  };
  folderNode.append(folderButton);

  if (open) {
    const storyTree = createElement('div', { className: 'magi-reader-sidebar-story-tree mt-0.5 space-y-0.5' });
    for (const storyEntry of folder.stories) {
      const isActive = activeStoryEntry?.canonicalStoryId === storyEntry.canonicalStoryId;
      const expanded = isActive || readerExpandedStories.has(storyEntry.canonicalStoryId);
      const storyNode = createElement('div', { className: 'magi-reader-story-entry mb-1' });
      storyNode.dataset.treeItem = 'story';
      const row = createElement('div', { className: 'magi-reader-story-row min-w-0 items-stretch gap-1' });
      const disclosure = createElement('button', {
        className: 'magi-reader-story-expand-button grid shrink-0 place-items-center border text-current transition',
        type: 'button',
      });
      disclosure.append(iconNode(chevronMarkup(13, expanded)));
      disclosure.setAttribute('aria-label', `${expanded ? '收起' : '展开'}${storyEntry.title} Episodes`);
      disclosure.setAttribute('aria-expanded', String(expanded));
      disclosure.onclick = async () => {
        if (readerExpandedStories.has(storyEntry.canonicalStoryId)) readerExpandedStories.delete(storyEntry.canonicalStoryId);
        else readerExpandedStories.add(storyEntry.canonicalStoryId);
        if (!storyCache.has(storyEntry.canonicalStoryId)) {
          try { await loadStoryDocument(corpus, storyEntry); } catch (error) { showToast(String(error)); }
        }
        renderReaderTree();
      };
      const storyButton = createElement('button', {
        className: `magi-reader-story-link grid min-w-0 rounded-sm border-l-2 px-2 py-1.5 font-mono text-xs transition-all ${readerStoryClass(isActive)}`,
        type: 'button',
        title: storyEntry.title,
      });
      storyButton.dataset.treeFocus = 'true';
      if (isActive) storyButton.setAttribute('aria-current', 'page');
      storyButton.append(
        iconNode(fileMarkup),
        createElement('span', { className: 'magi-reader-story-label', text: storyEntry.title }),
      );
      storyButton.onclick = () => void openStory(corpus, storyEntry, {
        canonicalStoryId: storyEntry.canonicalStoryId,
        variantId: storyEntry.preferredVariantId,
      });
      row.append(disclosure, storyButton);
      storyNode.append(row);

      if (expanded) {
        const sections = createElement('nav', {
          className: 'magi-reader-story-sections magi-reader-sidebar-section-tree mt-1 space-y-0.5',
        });
        sections.setAttribute('aria-label', `${storyEntry.title} Episodes`);
        const cached = storyCache.get(storyEntry.canonicalStoryId);
        if (!cached) {
          sections.append(createElement('span', {
            className: 'grid w-full min-w-0 px-2 py-1 text-[10px] text-gray-400',
            text: '读取章节…',
          }));
          void loadStoryDocument(corpus, storyEntry).then(renderReaderTree).catch(() => {});
        } else {
          const variant = isActive && activeSession
            ? activeSession.variant
            : cached.variants.find((item) => item.variantId === storyEntry.preferredVariantId) ?? cached.variants[0];
          for (const section of variant.sections) {
            const activeSection = Boolean(isActive && activeSession?.section.sectionId === section.sectionId);
            const sectionLabel = localizedText(section.title, 'zh-CN', ['ja-JP']) || section.sectionId;
            const button = createElement('button', {
              className: `magi-reader-sidebar-section-item grid w-full min-w-0 px-2 py-1 text-left text-[10px] transition ${
                isNightTheme(theme)
                  ? 'text-gray-400 hover:bg-white/10 hover:text-white'
                  : 'text-gray-600 hover:bg-black/5 hover:text-black'
              }`,
              type: 'button',
              title: sectionLabel,
            });
            button.dataset.treeItem = 'episode';
            button.dataset.treeFocus = 'true';
            if (activeSection) button.setAttribute('aria-current', 'location');
            button.append(
              iconNode(fileMarkup).cloneNode(true),
              createElement('span', { className: 'magi-reader-sidebar-section-label', text: sectionLabel }),
            );
            button.onclick = () => {
              if (isActive && activeSession) {
                activeSession.open({
                  canonicalStoryId: activeStory.canonicalStoryId,
                  variantId: variant.variantId,
                  sectionId: section.sectionId,
                });
                closeReaderSidebar();
              } else {
                void openStory(corpus, storyEntry, {
                  canonicalStoryId: storyEntry.canonicalStoryId,
                  variantId: variant.variantId,
                  sectionId: section.sectionId,
                });
              }
            };
            sections.append(button);
          }
        }
        storyNode.append(sections);
      }
      storyTree.append(storyNode);
    }
    folderNode.append(storyTree);
  }
  return folderNode;
};

function bindReaderTreeKeyboard() {
  const focusable = [...ui.readerCatalogTree.querySelectorAll('[data-tree-focus="true"]')];
  if (focusable.length === 0) return;
  const selected = focusable.find((item) => item.getAttribute('aria-current') === 'page') ?? focusable[0];
  for (const item of focusable) item.tabIndex = item === selected ? 0 : -1;
  ui.readerCatalogTree.onkeydown = (event) => {
    const current = event.target.closest('[data-tree-focus="true"]');
    if (!current) return;
    const items = [...ui.readerCatalogTree.querySelectorAll('[data-tree-focus="true"]')];
    const index = items.indexOf(current);
    let next = null;
    if (event.key === 'ArrowDown') next = items[Math.min(items.length - 1, index + 1)];
    if (event.key === 'ArrowUp') next = items[Math.max(0, index - 1)];
    if (event.key === 'Home') next = items[0];
    if (event.key === 'End') next = items.at(-1);
    if (event.key === 'ArrowRight' && current.getAttribute('aria-expanded') === 'false') current.click();
    if (event.key === 'ArrowLeft' && current.getAttribute('aria-expanded') === 'true') current.click();
    if (!next && !['ArrowRight', 'ArrowLeft'].includes(event.key)) return;
    event.preventDefault();
    if (next) {
      for (const item of items) item.tabIndex = item === next ? 0 : -1;
      next.focus();
    }
  };
}

function renderReaderTree() {
  if (!catalog) return;
  const nodes = catalog.corpora.map((corpus) => {
    const active = activeCorpus?.corpusId === corpus.corpusId;
    const open = active || readerExpandedCorpora.has(corpus.corpusId);
    const node = createElement('section', { className: 'mb-1' });
    node.dataset.treeItem = 'category';
    const button = createElement('button', {
      className: `magi-reader-sidebar-category-button flex w-full items-center gap-2 rounded-md px-2 py-3 text-sm font-bold transition-colors ${open ? 'bg-black/10' : 'opacity-70'} ${readerSidebarHoverClass()}`,
      type: 'button',
    });
    button.dataset.treeFocus = 'true';
    button.append(
      iconNode(chevronMarkup(14, open)),
      iconNode(corpusIconMarkup(corpus.corpusId)),
      createElement('span', { className: 'min-w-0 truncate whitespace-nowrap', text: corpus.title, title: corpus.title }),
      createElement('span', { className: 'ml-auto shrink-0 rounded bg-black/5 px-1 text-[10px] opacity-50', text: String(corpus.stories.length) }),
    );
    button.setAttribute('aria-expanded', String(open));
    button.onclick = () => {
      if (readerExpandedCorpora.has(corpus.corpusId)) readerExpandedCorpora.delete(corpus.corpusId);
      else readerExpandedCorpora.add(corpus.corpusId);
      renderReaderTree();
    };
    node.append(button);
    if (open) {
      const children = createElement('div', { className: 'magi-reader-sidebar-folder-tree mt-1 space-y-1' });
      for (const folder of folderGroupsForCorpus(corpus)) children.append(renderFolderNode(corpus, folder));
      node.append(children);
    }
    return node;
  });
  replaceChildren(ui.readerCatalogTree, nodes);
  bindReaderTreeKeyboard();
}

const resolutionKey = (cue) => `${cue.resolverId ?? ''}|${cue.kind}|${cue.cueId}|${cue.mediaId ?? ''}`;

const resolveCue = async (cue) => {
  const key = resolutionKey(cue);
  if (!resolutionCache.has(key)) resolutionCache.set(key, mediaRegistry.resolve(cue));
  return resolutionCache.get(key);
};

const resolveSectionCues = async () => {
  const resolved = new Map();
  for (const event of activeSession.events) {
    for (const cue of event.cues ?? []) {
      if (cue.kind !== 'voice') continue;
      resolved.set(cue.cueId, await resolveCue(cue));
    }
  }
  return resolved;
};

const createSpeakerColumn = (event, locale, side) => {
  const record = event.speaker ?? {};
  const speaker = side === 'cn' ? cnText(record) : jpText(record);
  const text = side === 'cn' ? cnText(event.text) : jpText(event.text);
  const column = createElement('div', {
    className: side === 'cn'
      ? 'reader-font-cn-body flex min-w-0 gap-3 md:w-1/2'
      : 'reader-font-jp-body flex min-w-0 gap-2 mt-1 border-current border-opacity-10 md:mt-0 md:w-1/2 md:border-l md:pl-4',
  });
  column.append(
    createElement('div', {
      className: `magi-reader-speaker-label reader-font-${side}-title h-fit w-20 flex-shrink-0 break-words rounded px-1 pt-1 text-right font-bold leading-tight md:w-24${side === 'jp' ? ' opacity-50' : ''}`,
      text: speaker || '旁白',
    }),
    createElement('div', {
      className: side === 'cn'
        ? 'min-w-0 flex-1 break-words whitespace-pre-wrap pt-0.5 text-left'
        : 'exedra-jp-story-text min-w-0 flex-1 break-words whitespace-pre-wrap font-sans opacity-70 text-left',
      text,
    }),
  );
  column.dataset.locale = locale;
  return column;
};

const createVoiceSlot = (event, resolutions, audioState) => {
  const slot = voiceSlotForEvent(event);
  const cues = slot?.cues ?? [];
  const actions = createElement('div', { className: 'flex shrink-0 flex-wrap items-start gap-1' });
  if (cues.length === 0) {
    const button = createElement('button', {
      className: 'inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-2 py-2 text-sm font-semibold text-sky-800 transition disabled:cursor-wait disabled:opacity-60',
      type: 'button',
      text: '暂无语音',
    });
    button.disabled = true;
    actions.append(button);
  } else {
    for (const cue of cues) {
      const resolution = resolutions.get(cue.cueId);
      if (resolution?.status !== 'resolved') {
        const button = createElement('button', {
          className: 'inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-2 py-2 text-sm font-semibold text-sky-800 transition disabled:cursor-wait disabled:opacity-60',
          type: 'button',
          text: '语音待接入',
        });
        button.disabled = true;
        actions.append(button);
        continue;
      }
      const active = audioState.cueId === cue.cueId && ['loading', 'playing'].includes(audioState.status);
      const button = createElement('button', {
        className: 'inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-2 py-2 text-sm font-semibold text-sky-800 transition hover:bg-sky-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:cursor-wait shrink-0',
        type: 'button',
        text: active ? '停止' : '播放',
      });
      button.setAttribute('aria-pressed', String(active));
      button.addEventListener('click', () => void audioController.toggle(cue, resolution));
      actions.append(button);
    }
  }
  return actions;
};

const renderLineEvent = (event, current, resolutions, audioState) => {
  const pair = cloneAuthorityNode(authorityTemplates.readerRow) ?? createElement('div', {
    className: 'group flex transition-colors magi-bilingual-pair magi-bilingual-pair-responsive flex-col py-2 md:flex-row md:gap-4 hover:border-current hover:border-opacity-10',
  });
  pair.id = `event-${event.eventId}`;
  pair.dataset.eventId = event.eventId;
  pair.dataset.readerRowIndex = event.eventId;
  pair.classList.toggle('ring-2', current);
  pair.classList.toggle('ring-amber-400/50', current);
  const { cn, jp } = currentLocalePair();
  const cnColumn = pair.querySelector('.reader-font-cn-body');
  const jpColumn = pair.querySelector('.reader-font-jp-body');
  const cnSpeaker = cnColumn?.querySelector('.magi-reader-speaker-label');
  const jpSpeaker = jpColumn?.querySelector('.magi-reader-speaker-label');
  const cnBody = cnColumn?.querySelector(':scope > div:last-child');
  const jpBody = jpColumn?.querySelector(':scope > div:last-child');
  const speakerRecord = event.speaker ?? {};
  if (cnColumn) cnColumn.lang = 'zh-Hans';
  if (jpColumn) jpColumn.lang = 'ja';
  if (cnSpeaker) cnSpeaker.textContent = cnText(speakerRecord) || '旁白';
  if (jpSpeaker) jpSpeaker.textContent = jpText(speakerRecord) || '旁白';
  if (cnBody) cnBody.textContent = cnText(event.text);
  if (jpBody) jpBody.textContent = jpText(event.text);
  if (!cnColumn || !jpColumn) {
    pair.replaceChildren(createSpeakerColumn(event, cn, 'cn'), createSpeakerColumn(event, jp, 'jp'));
  }
  if (preferences.voicePanelExpanded && cnColumn) cnColumn.append(createVoiceSlot(event, resolutions, audioState));
  pair.addEventListener('click', (clickEvent) => {
    if (clickEvent.target.closest('button')) return;
    if (activeSession.location.eventId !== event.eventId) activeSession.goTo(event.eventId);
  });
  return pair;
};

const renderChoiceEvent = (event) => {
  const block = createElement('section', { className: 'my-3 flex flex-wrap justify-center gap-2' });
  block.id = `event-${event.eventId}`;
  const choiceThemeClass = isNightTheme(theme)
    ? 'border-amber-700 bg-gradient-to-r from-amber-900/60 to-orange-900/60 text-amber-200'
    : 'border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50 text-amber-800 shadow-sm';
  for (const choice of event.choices) {
    const button = createElement('button', {
      className: `reader-font-cn-title cursor-pointer rounded-xl border-2 px-5 py-2.5 text-sm font-bold transition hover:scale-105 active:scale-95 ${choiceThemeClass}`,
      type: 'button',
    });
    button.append(
      document.createTextNode(`👆 ${cnText(choice.label) || jpText(choice.label)}`),
      createElement('span', { className: 'ml-2 text-[10px] opacity-50', text: '↓ 点击跳转' }),
    );
    button.addEventListener('click', () => {
      if (activeSession.location.eventId !== event.eventId) activeSession.goTo(event.eventId);
      activeSession.choose(choice.choiceId);
    });
    block.append(button);
  }
  return block;
};

const renderSimpleEvent = (event) => {
  const label = event.kind === 'end' ? '本章节结束' : '场景动作';
  const line = createElement('div', {
    className: 'my-3 flex justify-center border-dashed border-current py-2 text-center font-mono text-xs opacity-50',
    text: `${event.eventId} · ${label}`,
  });
  line.id = `event-${event.eventId}`;
  return line;
};

const variantLabel = (variant, index) => {
  if (!variant.sourceVariant) {
    const kind = variant.locales.length > 1
      ? '中日对照'
      : variant.locales.some((locale) => locale.startsWith('zh'))
        ? '中文原脚本'
        : '日文原脚本';
    return `${kind} · ${variant.locales.join(' / ')}`;
  }
  const sourceId = variant.sourceVariant.id.split('/').at(-1) ?? `版本 ${index + 1}`;
  const layer = variant.sourceVariant.layer ?? variant.sourceVariant.engine ?? 'source';
  let displayId = sourceId;
  try { displayId = decodeURIComponent(sourceId); } catch { /* Preserve the source ID as-is. */ }
  return `${variant.locales.join(' / ')} · ${layer} · ${displayId}`;
};

const renderVariantPicker = () => {
  if (!activeStory || !activeSession) return;
  const options = activeStory.variants.map((variant, index) => {
    const option = createElement('option', { text: variantLabel(variant, index) });
    option.value = variant.variantId;
    return option;
  });
  replaceChildren(ui.readerVariant, options);
  ui.readerVariant.value = activeSession.variant.variantId;
  ui.readerVariant.disabled = activeStory.variants.length < 2;
  ui.readerVariant.title = `${activeStory.variants.length} 个可读取版本`;
};

const syncDeepLink = (snapshot) => {
  const url = buildStoryDeepLink(window.location.href, {
    ...snapshot.location,
    catalogRevision: catalog.revision,
  }, {
    storyRevision: activeStory.revision,
    catalogRevision: catalog.revision,
    bridgeRevision: BRIDGE_REVISION,
  });
  url.searchParams.delete('ui');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
};

function updateDisplayButtons() {
  const pair = currentLocalePair();
  const effective = pair.single ? (/^ja/iu.test(pair.jp) ? 'jp' : 'cn') : displayMode;
  ui.readerDocument.dataset.displayMode = effective;
  for (const button of document.querySelectorAll('[data-display-mode]')) {
    const active = button.dataset.displayMode === effective;
    button.className = `rounded px-2 py-1 ${
      active
        ? isNightTheme(theme) ? 'bg-gray-700 text-white' : 'bg-white shadow'
        : 'opacity-40'
    }`;
    button.setAttribute('aria-pressed', String(active));
    button.disabled = pair.single && !active;
  }
  for (const row of ui.readerDocument.querySelectorAll('.magi-bilingual-pair')) {
    const cnColumn = row.querySelector('.reader-font-cn-body');
    const jpColumn = row.querySelector('.reader-font-jp-body');
    if (cnColumn) cnColumn.hidden = effective === 'jp';
    if (jpColumn) jpColumn.hidden = effective === 'cn';
  }
}

const localizedWidth = (record = {}) => Math.max(
  0,
  ...Object.values(record).map((value) => [...String(value ?? '')]
    .reduce((width, character) => width + (/^[\x00-\xff]$/u.test(character) ? 0.5 : 1), 0)),
);

const renderReaderRulers = (events, start, total) => {
  const calibration = ui.readerFilmCalibration;
  if (!calibration) return;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const frame = `${currentPage + 1}/${totalPages}`;
  const visibleCount = Math.max(1, events.length);
  calibration.dataset.frame = frame;
  calibration.setAttribute('aria-label', `微缩胶片扫描刻度，第 ${currentPage + 1} 页，第 ${start + 1} 至 ${Math.min(total, start + visibleCount)} 行`);
  const frameText = calibration.querySelector('.magi-reader-film-frame-meta span:last-child');
  if (frameText) frameText.textContent = `FR ${String(currentPage + 1).padStart(2, '0')}`;
  const ruler = calibration.querySelector('.magi-reader-film-ruler');
  if (!ruler) return;
  const offsets = [];
  for (let offset = 0; offset < visibleCount; offset += 10) offsets.push(offset);
  if (!offsets.includes(visibleCount - 1)) offsets.push(visibleCount - 1);
  const marks = offsets.map((offset) => {
    const mark = createElement('span', { className: 'magi-reader-film-ruler-mark' });
    mark.dataset.major = String(offset === 0 || offset === visibleCount - 1);
    mark.dataset.rowIndex = String(offset);
    mark.dataset.offsetPx = String(offset);
    mark.style.top = `${visibleCount <= 1 ? 0 : (offset / (visibleCount - 1)) * 100}%`;
    mark.append(createElement('span', { text: String(start + offset + 1).padStart(3, '0') }));
    return mark;
  });
  replaceChildren(ruler, marks);
};

async function renderSession(snapshot, scrollCurrent = true) {
  if (!activeSession || snapshot.disposed) return;
  const generation = ++renderGeneration;
  const resolutions = await resolveSectionCues();
  if (generation !== renderGeneration || !activeSession) return;
  const audioState = audioController.getSnapshot();
  const totalPages = Math.max(1, Math.ceil(activeSession.events.length / PAGE_SIZE));
  currentPage = Math.max(0, Math.min(currentPage, totalPages - 1));
  const start = currentPage * PAGE_SIZE;
  const end = Math.min(activeSession.events.length, start + PAGE_SIZE);
  const events = activeSession.events.slice(start, end);
  const children = [ui.readerFilmCalibration];
  const sectionMarker = createElement('div', {
    className: 'mb-4 text-center mt-0 pt-0 reader-font-cn-title border-dashed border-current opacity-50',
  });
  sectionMarker.append(createElement('span', {
    className: 'rounded-full border border-current px-3 py-1 font-mono text-xs opacity-70',
    text: `${cnText(activeSession.section.title)} · ${activeSession.section.sectionId}`,
  }));
  children.push(sectionMarker);
  for (const event of events) {
    const current = event.eventId === snapshot.location.eventId;
    if (event.kind === 'line') children.push(renderLineEvent(event, current, resolutions, audioState));
    else if (event.kind === 'choice') children.push(renderChoiceEvent(event));
    else children.push(renderSimpleEvent(event));
  }
  replaceChildren(ui.readerDocument, children);
  renderReaderRulers(events, start, activeSession.events.length);
  updateDisplayButtons();
  ui.readerStoryTitle.textContent = activeStoryEntry.sourceCanonicalStoryId ?? activeStoryEntry.canonicalStoryId;
  ui.readerSectionTitle.textContent = `${activeCorpus.title} · ${activeStoryEntry.folderTitle ?? '剧情'} · ${cnText(activeSession.section.title)}`;
  renderVariantPicker();
  ui.voiceToggle.setAttribute('aria-pressed', String(preferences.voicePanelExpanded));
  const voiceLabel = ui.voiceToggle.querySelector('span');
  if (voiceLabel) voiceLabel.textContent = preferences.voicePanelExpanded ? '收起语音' : '语音';
  ui.pageSummary.textContent = `第 ${currentPage + 1} / ${totalPages} 页 · 第 ${start + 1}–${end} 条，共 ${activeSession.events.length} 条`;
  ui.previousPage.disabled = currentPage <= 0;
  ui.nextPage.disabled = currentPage >= totalPages - 1;
  syncDeepLink(snapshot);
  renderReaderTree();
  bridgeProvider?.emit('story.location', {
    ...snapshot.location,
    catalogRevision: catalog.revision,
    ordinal: snapshot.ordinal,
    total: snapshot.total,
  });
  if (scrollCurrent) {
    const element = byId(`event-${snapshot.location.eventId}`);
    element?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

async function openStory(corpus, storyEntry, requestedLocation = null) {
  setStatus(`读取 ${storyEntry.title}…`);
  audioController.stop();
  sessionUnsubscribe?.();
  sessionUnsubscribe = null;
  activeSession?.dispose();
  activeResolverUnregister?.();
  activeResolverUnregister = null;
  resolutionCache = new Map();
  compatibilityState = null;
  currentPage = 0;
  searchCursor = -1;

  const story = await loadStoryDocument(corpus, storyEntry);
  const mediaManifest = await loadMediaManifest(storyEntry, story);
  const mediaBaseUrl = new URL(storyEntry.mediaManifest, window.location.href);
  activeResolverUnregister = mediaRegistry.register(
    createManifestMediaResolver(mediaManifest, { baseUrl: mediaBaseUrl }),
  );

  let target = requestedLocation ?? {};
  if (target.canonicalStoryId === story.canonicalStoryId) {
    const currentUrl = new URL(window.location.href);
    const hasUrlLocation = currentUrl.searchParams.get('canonicalStoryId') === story.canonicalStoryId;
    if (hasUrlLocation) {
      const parsed = parseStoryDeepLink(currentUrl, {
        bridgeRevision: BRIDGE_REVISION,
        storyRevision: story.revision,
        catalogRevision: catalog.revision,
      });
      compatibilityState = parsed?.revision ?? null;
      target = { ...parsed?.location, ...target };
      if (parsed && !canSynchronizeExactEvent(parsed.revision)) target = { ...target, eventId: undefined };
    }
  }

  const variantId = target.variantId ?? storyEntry.preferredVariantId ?? story.variants[0].variantId;
  const variant = story.variants.find((item) => item.variantId === variantId) ?? story.variants[0];
  const sectionId = target.sectionId && variant.sections.some((section) => section.sectionId === target.sectionId)
    ? target.sectionId
    : variant.sections[0].sectionId;
  const location = {
    canonicalStoryId: story.canonicalStoryId,
    variantId: variant.variantId,
    sectionId,
    ...(target.eventId ? { eventId: target.eventId } : {}),
  };

  activeCorpus = corpus;
  activeStoryEntry = storyEntry;
  activeStory = story;
  activeSession = new ReaderSession(story, location);
  readerExpandedStories.add(storyEntry.canonicalStoryId);
  readerExpandedCorpora.add(corpus.corpusId);
  const pair = currentLocalePair();
  preferences = saveReaderPreferences({
    ...preferences,
    primaryLocale: pair.cn,
    secondaryLocale: pair.jp,
  });
  sessionUnsubscribe = activeSession.subscribe((nextSnapshot) => {
    currentPage = Math.floor(Math.max(0, nextSnapshot.ordinal) / PAGE_SIZE);
    void renderSession(nextSnapshot, true);
  });
  showReader();
  closeReaderSidebar();
  await renderSession(activeSession.snapshot(), false);
  setStatus(`${corpus.title} · 已载入`);
  return activeSession.snapshot();
}

const changePage = (delta) => {
  if (!activeSession) return;
  const totalPages = Math.max(1, Math.ceil(activeSession.events.length / PAGE_SIZE));
  const next = Math.max(0, Math.min(totalPages - 1, currentPage + delta));
  if (next === currentPage) return;
  currentPage = next;
  const target = activeSession.events[currentPage * PAGE_SIZE];
  if (target) activeSession.goTo(target.eventId);
  else void renderSession(activeSession.snapshot(), false);
  ui.readerMain.scrollTo({ top: 0, behavior: 'smooth' });
};

const openLocationFromBridge = async (payload) => {
  if (!payload || typeof payload.canonicalStoryId !== 'string') {
    throw new ReaderRouteError('canonicalStoryId is required');
  }
  const record = findStoryRecord(payload.canonicalStoryId);
  if (!record) throw new ReaderRouteError('story is not present in this catalog');
  if (activeStory?.canonicalStoryId !== payload.canonicalStoryId) {
    return openStory(record.corpus, record.storyEntry, payload);
  }
  activeSession.open(payload);
  return activeSession.snapshot();
};

const playVoiceFromBridge = async (payload) => {
  if (!activeSession) throw new ReaderRouteError('no story is open');
  if (payload.sectionId && payload.sectionId !== activeSession.section.sectionId) {
    activeSession.open({
      canonicalStoryId: activeStory.canonicalStoryId,
      variantId: payload.variantId ?? activeSession.variant.variantId,
      sectionId: payload.sectionId,
      eventId: payload.eventId,
    });
  } else if (payload.eventId && payload.eventId !== activeSession.location.eventId) {
    activeSession.goTo(payload.eventId);
  }
  const cues = (activeSession.currentEvent.cues ?? []).filter((cue) => cue.kind === 'voice');
  const cue = payload.cueId ? cues.find((item) => item.cueId === payload.cueId) : cues[0];
  if (!cue) throw new ReaderRouteError('current text event has no declared voice cue');
  const resolution = await resolveCue(cue);
  if (resolution.status !== 'resolved') throw new ReaderRouteError(resolution.reason);
  await audioController.play(cue, resolution);
  return { cueId: cue.cueId, state: audioController.getSnapshot() };
};

const attachBridge = async () => {
  const manifest = await fetchJson('./.well-known/adv-app.json');
  bridgeProvider = attachBridgeProvider({
    appId: manifest.appId,
    capabilities: manifest.capabilities.map((capability) => capability.id),
    allowedOrigins: manifest.embed?.trustedParentOrigins ?? [],
    actions: {
      'story.open': openLocationFromBridge,
      'story.getLocation': async () => activeSession ? ({
        ...activeSession.location,
        catalogRevision: catalog.revision,
      }) : null,
      'voice.play': playVoiceFromBridge,
      'lifecycle.suspend': async () => {
        audioController.suspend();
        activeSession?.suspend();
        return { suspended: true };
      },
      'lifecycle.resume': async () => {
        activeSession?.resume();
        return { suspended: false };
      },
      'lifecycle.dispose': async () => {
        audioController.suspend();
        activeSession?.suspend();
        return { disposed: true };
      },
    },
  });
};

const closeFloatingWindow = () => {
  ui.dialog.hidden = true;
  ui.dialog.dataset.windowState = 'open';
  ui.dialogMinimize.setAttribute('aria-pressed', 'false');
  ui.dialogMinimize.setAttribute('aria-label', '缩小窗口');
  ui.dialogMinimize.title = '缩小窗口';
};

const showFloatingWindow = ({ kind, title, systemLabel, footer, x, y, bodyClassName, children }) => {
  const host = ui.readerView.hidden ? ui.homeView : ui.readerView;
  host.append(ui.dialog);
  ui.dialog.dataset.windowKind = kind;
  ui.dialog.dataset.windowState = 'open';
  ui.dialog.style.setProperty('--magi-window-x', `${x}px`);
  ui.dialog.style.setProperty('--magi-window-y', `${y}px`);
  ui.dialogTitle.textContent = title;
  ui.dialogSystemLabel.textContent = systemLabel;
  ui.dialogFooter.textContent = footer;
  ui.dialogContent.className = `magi-floating-window-body ${bodyClassName}`;
  replaceChildren(ui.dialogContent, children);
  ui.dialog.hidden = false;
  applyFloatingWindowTheme();
  const nextZ = Number(document.documentElement.dataset.magiWindowZ || '70') + 1;
  document.documentElement.dataset.magiWindowZ = String(nextZ);
  ui.dialog.style.zIndex = String(nextZ);
  ui.dialog.focus({ preventScroll: true });
};

const floatingLink = ({ icon, title, subtitle }) => {
  const link = createElement('a', {
    className: `magi-floating-link group flex items-center gap-3.5 border px-3.5 py-3 transition-all active:scale-[0.99] ${isNightTheme(theme) ? 'border-white/[0.08] bg-white/[0.04]' : ''}`,
  });
  link.href = '#';
  link.addEventListener('click', (event) => event.preventDefault());
  link.append(
    createElement('div', {
      className: 'flex h-11 w-11 flex-shrink-0 items-center justify-center bg-gradient-to-br from-[#06b6d4] to-[#0891b2] text-xs font-black text-white',
      text: icon,
    }),
  );
  const copy = createElement('div', { className: 'magi-floating-link-copy' });
  copy.append(
    createElement('div', { className: 'magi-floating-link-title text-sm font-bold', text: title }),
    createElement('div', { className: 'magi-floating-link-subtitle mt-0.5 text-xs opacity-60', text: subtitle }),
  );
  link.append(copy, createElement('span', {
    className: 'flex-shrink-0 text-sm opacity-30 transition-all group-hover:translate-x-1 group-hover:opacity-60',
    text: '→',
  }));
  return link;
};

const showAbout = () => {
  showFloatingWindow({
    kind: 'about',
    title: '作品目录与说明',
    systemLabel: 'SYS://UNIVERSAL-ADV.LINKS',
    footer: 'Universal ADV Reader · Classic',
    x: 84,
    y: 62,
    bodyClassName: 'space-y-2.5 p-3 sm:p-4',
    children: [
      floatingLink({ icon: '10TH', title: 'Narcissu 10th Anniversary Anthology Project', subtitle: '完整脚本目录、版本与逐句语音' }),
      floatingLink({ icon: 'N3', title: 'Narcissu 3rd', subtitle: '章节、分支与双语正文' }),
      floatingLink({ icon: 'KANA', title: 'KANA: Okaeri!!', subtitle: '章节、选择项与语音路由' }),
    ],
  });
};

const settingsSection = (heading) => {
  const section = createElement('section', {
    className: `rounded-lg border p-3 ${
      isNightTheme(theme) ? 'border-gray-700 bg-white/5' : 'border-stone-300 bg-white/60'
    }`,
  });
  section.append(createElement('h3', { className: 'text-sm font-bold', text: heading }));
  return section;
};

const showSettings = () => {
  const themeSection = settingsSection('站点主题');
  const themeGrid = createElement('div', { className: 'mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5' });
  for (const item of THEMES) {
    const active = item.id === theme;
    const button = createElement('button', {
      className: `flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-bold transition ${
        active
          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
          : 'border-current opacity-60 hover:opacity-100'
      }`,
      type: 'button',
      text: `${item.symbol} ${item.label}`,
    });
    button.dataset.themeOption = item.id;
    button.setAttribute('aria-pressed', String(active));
    button.onclick = () => {
      applyTheme(item.id);
      showSettings();
    };
    themeGrid.append(button);
  }
  themeSection.append(themeGrid);

  const displaySection = settingsSection('正文显示');
  const displayGrid = createElement('div', { className: 'mt-2 grid grid-cols-3 gap-2' });
  for (const [value, label] of [['cn', '中文'], ['parallel', '双语'], ['jp', '日文']]) {
    const active = value === displayMode;
    const button = createElement('button', {
      className: `min-h-10 rounded-lg border px-2 py-2 text-xs font-bold transition ${
        active
          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
          : 'border-current opacity-60 hover:opacity-100'
      }`,
      type: 'button',
      text: label,
    });
    button.dataset.displayModeSetting = value;
    button.setAttribute('aria-pressed', String(active));
    button.onclick = () => {
      setDisplayMode(value);
      showSettings();
    };
    displayGrid.append(button);
  }
  displaySection.append(displayGrid);

  showFloatingWindow({
    kind: 'settings',
    title: '字体与站点设置',
    systemLabel: 'SYS://UNIVERSAL-ADV.SETTINGS',
    footer: '设置只保存在当前浏览器',
    x: 118,
    y: 76,
    bodyClassName: 'space-y-3 p-3 sm:p-4',
    children: [themeSection, displaySection],
  });
};

const setDisplayMode = (mode) => {
  displayMode = ['cn', 'parallel', 'jp'].includes(mode) ? mode : 'parallel';
  try { localStorage.setItem(DISPLAY_KEY, displayMode); } catch { /* localStorage may be unavailable */ }
  updateDisplayButtons();
};

const downloadLocale = (locale) => {
  if (!activeSession) return;
  const lines = activeSession.events.flatMap((event) => {
    if (event.kind !== 'line') return [];
    const speaker = localizedText(event.speaker, locale);
    const text = localizedText(event.text, locale);
    return [`${speaker ? `${speaker}\t` : ''}${text}`];
  });
  const blob = new Blob([`${lines.join('\n\n')}\n`], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${activeStory.canonicalStoryId.replaceAll('/', '_')}-${locale}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
};

const searchWithinStory = () => {
  if (!activeSession) return;
  const query = ui.readerSearch.value.trim().toLocaleLowerCase();
  if (!query) return;
  const matches = activeSession.events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.kind === 'line' && `${cnText(event.text)} ${jpText(event.text)} ${cnText(event.speaker)} ${jpText(event.speaker)}`.toLocaleLowerCase().includes(query));
  if (matches.length === 0) {
    showToast('本章节没有匹配文字。');
    return;
  }
  searchCursor = (searchCursor + 1) % matches.length;
  activeSession.goTo(matches[searchCursor].event.eventId);
};

const bindResizer = (handle, target, variable, min, max, fallback) => {
  if (!handle || !target) return;
  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const current = Number.parseFloat(getComputedStyle(target).getPropertyValue(variable)) || fallback;
    handle.setPointerCapture?.(event.pointerId);
    const move = (moveEvent) => {
      const next = Math.max(min, Math.min(max, current + moveEvent.clientX - startX));
      target.style.setProperty(variable, `${Math.round(next)}px`);
      handle.setAttribute('aria-valuenow', String(Math.round(next)));
    };
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  });
  handle.addEventListener('dblclick', () => {
    target.style.setProperty(variable, `${fallback}px`);
    handle.setAttribute('aria-valuenow', String(fallback));
  });
};

const bindDraggable = (widget, handle) => {
  if (!widget || !handle) return;
  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const parent = widget.parentElement.getBoundingClientRect();
    const start = widget.getBoundingClientRect();
    const offsetX = event.clientX - start.left;
    const offsetY = event.clientY - start.top;
    widget.style.right = 'auto';
    widget.style.bottom = 'auto';
    widget.style.left = `${start.left - parent.left}px`;
    widget.style.top = `${start.top - parent.top}px`;
    handle.setPointerCapture?.(event.pointerId);
    const move = (moveEvent) => {
      const left = Math.max(0, Math.min(parent.width - widget.offsetWidth, moveEvent.clientX - parent.left - offsetX));
      const top = Math.max(0, Math.min(parent.height - widget.offsetHeight, moveEvent.clientY - parent.top - offsetY));
      widget.style.left = `${left}px`;
      widget.style.top = `${top}px`;
    };
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  });
};

const bindFloatingWindow = () => {
  const titlebar = ui.dialog?.querySelector('.magi-floating-window-titlebar');
  if (!ui.dialog || !titlebar) return;
  const raise = () => {
    const nextZ = Number(document.documentElement.dataset.magiWindowZ || '70') + 1;
    document.documentElement.dataset.magiWindowZ = String(nextZ);
    ui.dialog.style.zIndex = String(nextZ);
  };
  ui.dialog.addEventListener('pointerdown', raise);
  titlebar.addEventListener('pointerdown', (event) => {
    if ((event.pointerType === 'mouse' && event.button !== 0) || event.target.closest('button, a, input')) return;
    event.preventDefault();
    raise();
    const rect = ui.dialog.getBoundingClientRect();
    const origin = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    const move = (moveEvent) => {
      const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
      const maxTop = Math.max(8, window.innerHeight - Math.min(rect.height, 52));
      const left = Math.max(8, Math.min(maxLeft, origin.left + moveEvent.clientX - origin.x));
      const top = Math.max(8, Math.min(maxTop, origin.top + moveEvent.clientY - origin.y));
      ui.dialog.style.setProperty('--magi-window-x', `${left}px`);
      ui.dialog.style.setProperty('--magi-window-y', `${top}px`);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
  });
  titlebar.addEventListener('dblclick', (event) => {
    if (event.target.closest('button')) return;
    const settings = ui.dialog.dataset.windowKind === 'settings';
    ui.dialog.style.setProperty('--magi-window-x', `${settings ? 118 : 84}px`);
    ui.dialog.style.setProperty('--magi-window-y', `${settings ? 76 : 62}px`);
  });
};

const bindUi = () => {
  ui.homeSearch.addEventListener('input', renderHomeCatalog);
  ui.homeMobileMenu?.addEventListener('click', () => {
    const opening = ui.homeMobileCategories.classList.contains('hidden');
    ui.homeMobileCategories.classList.toggle('hidden', !opening);
    ui.homeMobileMenu.setAttribute('aria-expanded', String(opening));
    ui.homeMobileMenu.setAttribute('aria-label', opening ? '关闭来源栏' : '打开来源栏');
    applyHomeThemeClasses();
  });
  ui.readerMobileMenu.addEventListener('click', () => {
    ui.readerView.dataset.mobileSidebarOpen = 'true';
    ui.readerSidebar.classList.remove('-translate-x-full', 'hidden');
    ui.readerSidebar.classList.add('translate-x-0', 'shadow-2xl');
    ui.readerScrim.hidden = false;
  });
  ui.readerScrim.addEventListener('click', closeReaderSidebar);
  ui.readerSidebarClose?.addEventListener('click', closeReaderSidebar);
  ui.homeSettings.addEventListener('click', showSettings);
  ui.readerSettings.addEventListener('click', showSettings);
  ui.homeAbout.addEventListener('click', showAbout);
  ui.readerAbout.addEventListener('click', showAbout);
  ui.dialogClose.addEventListener('click', closeFloatingWindow);
  ui.dialogMinimize.addEventListener('click', () => {
    const compact = ui.dialog.dataset.windowState !== 'compact';
    ui.dialog.dataset.windowState = compact ? 'compact' : 'open';
    ui.dialogMinimize.setAttribute('aria-pressed', String(compact));
    ui.dialogMinimize.setAttribute('aria-label', `${compact ? '还原' : '缩小'}窗口`);
    ui.dialogMinimize.title = `${compact ? '还原' : '缩小'}窗口`;
  });
  ui.returnHome.addEventListener('click', (event) => { event.preventDefault(); showHome(); });
  ui.readerBrand.addEventListener('click', (event) => { event.preventDefault(); showHome(); });
  ui.previousPage.addEventListener('click', () => changePage(-1));
  ui.nextPage.addEventListener('click', () => changePage(1));
  for (const search of ui.readerSearches) {
    search.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        ui.readerSearch.value = search.value;
        for (const peer of ui.readerSearches) if (peer !== search) peer.value = search.value;
        searchWithinStory();
      }
    });
    search.addEventListener('input', () => {
      searchCursor = -1;
      for (const peer of ui.readerSearches) if (peer !== search) peer.value = search.value;
    });
  }
  ui.readerVariant.addEventListener('change', () => {
    if (!activeStory || !activeCorpus || !activeStoryEntry) return;
    void openStory(activeCorpus, activeStoryEntry, {
      canonicalStoryId: activeStory.canonicalStoryId,
      variantId: ui.readerVariant.value,
    });
  });
  ui.voiceToggle.addEventListener('click', () => {
    preferences = saveReaderPreferences({
      ...preferences,
      voicePanelExpanded: !preferences.voicePanelExpanded,
    });
    if (activeSession) void renderSession(activeSession.snapshot(), false);
  });
  for (const button of document.querySelectorAll('[data-display-mode]')) {
    button.addEventListener('click', () => setDisplayMode(button.dataset.displayMode));
  }
  ui.downloadPrimary.addEventListener('click', () => downloadLocale(currentLocalePair().cn));
  ui.downloadSecondary.addEventListener('click', () => downloadLocale(currentLocalePair().jp));
  ui.utilityClose.addEventListener('click', () => {
    ui.utilityWidget.hidden = true;
    ui.utilityFab.hidden = false;
  });
  ui.utilityFab.addEventListener('click', () => {
    ui.utilityWidget.hidden = false;
    ui.utilityFab.hidden = true;
  });
  ui.fontWidgetClose.addEventListener('click', () => {
    ui.fontWidget.hidden = true;
    ui.fontWidgetFab.hidden = false;
  });
  ui.fontWidgetFab.addEventListener('click', () => {
    ui.fontWidget.hidden = false;
    ui.fontWidgetFab.hidden = true;
  });
  ui.fontSize.addEventListener('input', () => {
    const value = Number.parseInt(ui.fontSize.value, 10);
    ui.readerMain.style.fontSize = `${value}px`;
    ui.fontOutput.value = `${value}px`;
    ui.fontSize.setAttribute('aria-valuetext', `${value} 像素`);
    const ruler = ui.fontWidget.querySelector('.magi-reader-font-ruler');
    const current = ui.fontWidget.querySelector('.magi-reader-font-ruler-current');
    if (ruler) ruler.dataset.value = String(value);
    if (current) current.style.left = `${((value - 12) / 10) * 100}%`;
  });
  ui.openLocalStory.addEventListener('click', () => ui.localStoryInput.click());
  ui.localStoryInput.addEventListener('change', () => {
    const file = ui.localStoryInput.files?.[0];
    if (file) showToast(`已选择 ${file.name}`);
  });
  for (const button of ui.homeSearchModeButtons) {
    button.addEventListener('click', () => {
      for (const peer of ui.homeSearchModeButtons) peer.setAttribute('aria-pressed', String(peer === button));
      applyHomeThemeClasses();
      ui.homeSearch.focus();
    });
  }
  ui.homeJpToggle.addEventListener('change', () => {
    if (ui.homeJpToggle.checked) setDisplayMode('parallel');
    applyHomeThemeClasses();
  });
  const homeSidebar = ui.homeView.querySelector('.magi-home-sidebar');
  bindResizer(
    homeSidebar?.querySelector('.magi-sidebar-resize-handle'),
    homeSidebar,
    '--magi-home-sidebar-width',
    208,
    480,
    256,
  );
  bindResizer(
    ui.readerSidebar?.querySelector('.magi-sidebar-resize-handle'),
    ui.readerSidebar,
    '--magi-sidebar-width',
    240,
    560,
    240,
  );
  bindDraggable(ui.utilityWidget, ui.utilityWidget?.querySelector('.magi-reader-floating-grip'));
  bindDraggable(ui.fontWidget, ui.fontWidget?.querySelector('.magi-reader-floating-grip'));
  bindFloatingWindow();
  audioController.subscribe(() => {
    if (activeSession && !ui.readerView.hidden) void renderSession(activeSession.snapshot(), false);
  });
  window.addEventListener('pagehide', () => audioController.suspend());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) audioController.suspend();
  });
  window.addEventListener('popstate', () => {
    const url = new URL(window.location.href);
    const canonicalStoryId = url.searchParams.get('canonicalStoryId');
    if (!canonicalStoryId) {
      showHome({ syncUrl: false });
      return;
    }
    const record = findStoryRecord(canonicalStoryId);
    if (record) void openStory(record.corpus, record.storyEntry, { canonicalStoryId });
  });
  window.addEventListener('resize', () => {
    if (catalog && !ui.homeView.hidden) renderHomeCatalog();
  });
};

async function initialize() {
  bindUi();
  applyTheme(theme, false);
  await loadAuthorityTemplates();
  const readerManifest = await fetchJson('/corpus/manifests/generated/reader-adapter.json');
  const loadedCatalog = buildResearchCatalog(readerManifest, { corpusBaseUrl: '/corpus/' });
  catalog = validateCatalog({
    ...loadedCatalog,
    corpora: loadedCatalog.corpora.filter((corpus) => ALLOWED_CORPORA.has(corpus.corpusId)),
  });
  if (catalog.corpora.length !== 3) throw new Error('三部作品目录不完整');
  renderHome();
  setStatus(`${catalog.corpora.length} 部作品 · ${allStoryRecords().length} 个剧情入口`);

  const currentUrl = new URL(window.location.href);
  if (currentUrl.searchParams.has('ui')) {
    currentUrl.searchParams.delete('ui');
    window.history.replaceState(null, '', `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
  }
  let deepLink = null;
  try {
    deepLink = parseStoryDeepLink(currentUrl, {
      bridgeRevision: BRIDGE_REVISION,
      catalogRevision: catalog.revision,
    });
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error));
  }
  const record = deepLink?.location?.canonicalStoryId
    ? findStoryRecord(deepLink.location.canonicalStoryId)
    : null;
  if (record) await openStory(record.corpus, record.storyEntry, deepLink.location);
  else showHome({ syncUrl: false });
  await attachBridge();
  globalThis.AdvReader = Object.freeze({
    open: openLocationFromBridge,
    getLocation: () => activeSession ? ({ ...activeSession.location, catalogRevision: catalog.revision }) : null,
    playVoice: playVoiceFromBridge,
    suspend: () => {
      audioController.suspend();
      activeSession?.suspend();
    },
    resume: () => activeSession?.resume(),
  });
}

initialize().catch((error) => {
  console.error(error);
  setStatus('读取失败');
  ui.homeHeading.textContent = 'Reader 初始化失败';
  replaceChildren(ui.homeCatalog, [createElement('p', {
    className: 'rounded-lg border border-red-800 bg-red-950/40 p-4 text-sm text-red-200',
    text: error instanceof Error ? error.message : String(error),
  })]);
});
