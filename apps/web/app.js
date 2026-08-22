import {
  localizedText,
  validateCatalog,
  validateMediaManifest,
} from '../../packages/contracts/src/index.js';
import { AdapterRegistry } from '../../packages/core/src/adapter-registry.js';
import {
  ReaderRouteError,
  ReaderSession,
  voiceRouteSummary,
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

const byId = (id) => document.getElementById(id);
const ui = {
  status: byId('app-status'),
  sidebar: byId('sidebar'),
  sidebarToggle: byId('sidebar-toggle'),
  sidebarScrim: byId('sidebar-scrim'),
  storySearch: byId('story-search'),
  catalogTree: byId('catalog-tree'),
  catalogRevision: byId('catalog-revision'),
  storyTitle: byId('story-title'),
  sectionTitle: byId('section-title'),
  stageImage: byId('stage-image'),
  stageBadges: byId('stage-badges'),
  stageRoute: byId('stage-route'),
  variantSelect: byId('variant-select'),
  primaryLocale: byId('primary-locale'),
  secondaryLocale: byId('secondary-locale'),
  secondaryLocaleWrap: byId('secondary-locale-wrap'),
  voiceToggle: byId('voice-toggle'),
  voiceSummary: byId('voice-summary'),
  voicePanel: byId('voice-panel'),
  voiceSlotMode: byId('voice-slot-mode'),
  voiceMetrics: byId('voice-metrics'),
  compatibilityBanner: byId('compatibility-banner'),
  transcriptTitle: byId('transcript-title'),
  eventProgress: byId('event-progress'),
  eventList: byId('event-list'),
  previousEvent: byId('previous-event'),
  nextEvent: byId('next-event'),
  currentEventLabel: byId('current-event-label'),
  copyLink: byId('copy-link'),
  toast: byId('toast'),
};

const adapterRegistry = new AdapterRegistry();
adapterRegistry.register(createAdvIrAdapter());
const mediaRegistry = new MediaResolverRegistry();
const audioController = new AudioController();

let catalog = null;
let activeCorpus = null;
let activeStoryEntry = null;
let activeStory = null;
let activeMediaManifest = null;
let activeSession = null;
let activeResolverUnregister = null;
let sessionUnsubscribe = null;
let bridgeProvider = null;
let preferences = loadReaderPreferences();
let resolutionCache = new Map();
let compatibilityState = null;
let renderGeneration = 0;
let toastTimer = null;

const createElement = (tag, options = {}) => {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  if (options.type) element.type = options.type;
  if (options.title) element.title = options.title;
  return element;
};

const replaceChildren = (parent, children) => {
  parent.replaceChildren(...children.filter(Boolean));
};

const setStatus = (text) => {
  ui.status.textContent = text;
};

const showToast = (text) => {
  clearTimeout(toastTimer);
  ui.toast.textContent = text;
  ui.toast.hidden = false;
  toastTimer = setTimeout(() => {
    ui.toast.hidden = true;
  }, 2_800);
};

const fetchJson = async (source) => {
  const url = new URL(source, window.location.href);
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${url.pathname}: HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > 64 * 1024 * 1024) {
    throw new Error(`${url.pathname}: manifest exceeds 64 MiB`);
  }
  const raw = await response.text();
  if (raw.length > 64 * 1024 * 1024) throw new Error(`${url.pathname}: manifest exceeds 64 MiB`);
  return JSON.parse(raw);
};

const findStoryRecord = (canonicalStoryId) => {
  for (const corpus of catalog?.corpora ?? []) {
    const storyEntry = corpus.stories.find((story) => story.canonicalStoryId === canonicalStoryId);
    if (storyEntry) return { corpus, storyEntry };
  }
  return null;
};

const firstStoryRecord = () => {
  const corpus = catalog?.corpora?.[0];
  const storyEntry = corpus?.stories?.[0];
  return corpus && storyEntry ? { corpus, storyEntry } : null;
};

const closeSidebar = () => {
  ui.sidebar.classList.remove('open');
  ui.sidebarToggle.setAttribute('aria-expanded', 'false');
};

const toggleSidebar = () => {
  const open = ui.sidebar.classList.toggle('open');
  ui.sidebarToggle.setAttribute('aria-expanded', String(open));
};

const primaryText = (localized) => localizedText(
  localized,
  preferences.primaryLocale,
  [preferences.secondaryLocale],
);

const secondaryText = (localized) => localizedText(
  localized,
  preferences.secondaryLocale,
  [preferences.primaryLocale],
);

const makeBadge = (text) => createElement('span', { className: 'badge', text });

function renderCatalog() {
  if (!catalog) return;
  const query = ui.storySearch.value.trim().toLocaleLowerCase();
  const blocks = [];
  for (const corpus of catalog.corpora) {
    const stories = corpus.stories.filter((story) => {
      if (!query) return true;
      const sectionText = activeStory?.canonicalStoryId === story.canonicalStoryId
        ? activeStory.variants.flatMap((variant) => variant.sections)
          .map((section) => Object.values(section.title).join(' ')).join(' ')
        : '';
      return `${corpus.title} ${story.title} ${story.canonicalStoryId} ${sectionText}`
        .toLocaleLowerCase().includes(query);
    });
    if (stories.length === 0) continue;
    const block = createElement('section', { className: 'corpus-block' });
    const heading = createElement('div', { className: 'corpus-heading' });
    heading.append(
      createElement('span', { text: corpus.title }),
      createElement('span', { text: corpus.adapterId }),
    );
    block.append(heading);
    for (const storyEntry of stories) {
      const storyButton = createElement('button', {
        className: `story-link${activeStoryEntry === storyEntry ? ' active' : ''}`,
        text: storyEntry.title,
        type: 'button',
      });
      storyButton.title = storyEntry.canonicalStoryId;
      storyButton.addEventListener('click', () => {
        closeSidebar();
        void openStory(corpus, storyEntry, {
          canonicalStoryId: storyEntry.canonicalStoryId,
          variantId: storyEntry.preferredVariantId,
        });
      });
      block.append(storyButton);

      if (activeStoryEntry === storyEntry && activeSession) {
        const sectionList = createElement('div', { className: 'section-list' });
        for (const section of activeSession.variant.sections) {
          const sectionButton = createElement('button', {
            className: `section-link${activeSession.section.sectionId === section.sectionId ? ' active' : ''}`,
            text: primaryText(section.title),
            type: 'button',
          });
          sectionButton.title = section.sectionId;
          sectionButton.addEventListener('click', () => {
            closeSidebar();
            activeSession.open({
              canonicalStoryId: activeStory.canonicalStoryId,
              variantId: activeSession.variant.variantId,
              sectionId: section.sectionId,
            });
            renderCatalog();
          });
          sectionList.append(sectionButton);
        }
        block.append(sectionList);
      }
    }
    blocks.push(block);
  }
  if (blocks.length === 0) {
    blocks.push(createElement('p', { className: 'voice-empty', text: '没有匹配的剧情。' }));
  }
  replaceChildren(ui.catalogTree, blocks);
}

const savePreferencesAndRender = (update) => {
  preferences = saveReaderPreferences({ ...preferences, ...update });
  if (activeSession) void renderSession(activeSession.snapshot(), false);
};

const updateLocaleControls = () => {
  if (!activeSession) return;
  const locales = activeSession.variant.locales;
  if (!locales.includes(preferences.primaryLocale)) preferences.primaryLocale = locales[0];
  if (!locales.includes(preferences.secondaryLocale)) {
    preferences.secondaryLocale = locales.find((locale) => locale !== preferences.primaryLocale)
      ?? locales[0];
  }
  preferences = saveReaderPreferences(preferences);

  const localeOptions = (selected) => locales.map((locale) => {
    const option = createElement('option', { text: locale });
    option.value = locale;
    option.selected = locale === selected;
    return option;
  });
  replaceChildren(ui.primaryLocale, localeOptions(preferences.primaryLocale));
  replaceChildren(ui.secondaryLocale, localeOptions(preferences.secondaryLocale));
  ui.secondaryLocaleWrap.hidden = preferences.localeMode !== 'parallel';
  for (const button of document.querySelectorAll('[data-locale-mode]')) {
    button.classList.toggle('active', button.dataset.localeMode === preferences.localeMode);
    button.setAttribute('aria-pressed', String(button.dataset.localeMode === preferences.localeMode));
  }

  const variantOptions = activeStory.variants.map((variant) => {
    const option = createElement('option', { text: variant.variantId });
    option.value = variant.variantId;
    option.selected = variant.variantId === activeSession.variant.variantId;
    return option;
  });
  replaceChildren(ui.variantSelect, variantOptions);
};

const resolutionKey = (cue) => `${cue.resolverId ?? ''}|${cue.kind}|${cue.cueId}|${cue.mediaId ?? ''}`;

const resolveCue = async (cue) => {
  const key = resolutionKey(cue);
  if (!resolutionCache.has(key)) {
    resolutionCache.set(key, mediaRegistry.resolve(cue, {
      defaultResolverId: activeMediaManifest?.resolverId,
      canonicalStoryId: activeStory?.canonicalStoryId,
    }));
  }
  return resolutionCache.get(key);
};

const resolveSectionCues = async () => {
  const cues = activeSession.events.flatMap((event) => [
    ...(event.cues ?? []),
    ...(event.choices ?? []).flatMap((choice) => choice.cues ?? []),
  ]);
  const entries = await Promise.all(cues.map(async (cue) => [cue.cueId, await resolveCue(cue)]));
  return new Map(entries);
};

const appendLocalizedText = (body, record, className = 'text-track') => {
  const primary = createElement('p', { className, text: primaryText(record) });
  body.append(primary);
  if (preferences.localeMode === 'parallel') {
    const secondary = secondaryText(record);
    if (secondary && secondary !== primary.textContent) {
      body.append(createElement('p', { className: `${className} secondary`, text: secondary }));
    }
  }
};

const addCardNavigation = (card, eventId) => {
  card.classList.add('clickable');
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `定位到事件 ${eventId}`);
  const activate = () => {
    if (activeSession.location.eventId !== eventId) activeSession.goTo(eventId);
  };
  card.addEventListener('click', (event) => {
    if (event.target.closest('button, summary, select, a')) return;
    activate();
  });
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  });
};

const makeCueRow = (cue, resolution, audioState, label) => {
  const row = createElement('div', {
    className: `voice-cue${resolution?.status === 'resolved' ? '' : ' unresolved'}`,
  });
  row.append(createElement('code', { text: cue.cueId }));
  if (resolution?.status === 'resolved') {
    row.append(createElement('span', { text: resolution.mediaId }));
    const current = audioState.cueId === cue.cueId;
    const active = current && ['loading', 'playing'].includes(audioState.status);
    const button = createElement('button', {
      className: `voice-action${active ? ' stop' : ''}`,
      text: active ? (audioState.status === 'loading' ? '停止加载' : '停止') : label,
      type: 'button',
    });
    button.setAttribute('aria-pressed', String(active));
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      void audioController.toggle(cue, resolution);
    });
    row.append(button);
  } else {
    row.append(createElement('span', {
      text: `待接入 · ${resolution?.reason ?? '尚未解析'}`,
    }));
  }
  if (audioState.cueId === cue.cueId && audioState.status === 'error') {
    row.append(createElement('span', { text: audioState.error ?? '播放失败' }));
  }
  return row;
};

const appendVoiceSlot = (body, event, resolutions, audioState) => {
  const slot = voiceSlotForEvent(event);
  if (!slot) return;
  if (preferences.voiceSlotMode === 'declared' && slot.cues.length === 0) return;
  const details = createElement('details', { className: 'voice-slot' });
  details.open = true;
  const summary = createElement('summary', {
    text: slot.cues.length > 0 ? `语音路由 · ${slot.cues.length} cue` : '语音路由 · 待建立',
  });
  details.append(summary);
  const list = createElement('div', { className: 'voice-cue-list' });
  if (slot.cues.length === 0) {
    list.append(createElement('div', {
      className: 'voice-empty',
      text: '本条文本尚无 cue；槽位已保留，后续适配器可直接接入。',
    }));
  } else {
    for (const cue of slot.cues) {
      list.append(makeCueRow(cue, resolutions.get(cue.cueId), audioState, '播放'));
    }
  }
  details.append(list);
  body.append(details);
};

const appendNonVoiceMedia = (body, event, resolutions, audioState) => {
  const cues = (event.cues ?? []).filter((cue) => cue.kind !== 'voice');
  if (cues.length === 0) return;
  const list = createElement('div', { className: 'voice-cue-list' });
  for (const cue of cues) {
    const resolution = resolutions.get(cue.cueId);
    if (['sfx', 'bgm'].includes(cue.kind)) {
      list.append(makeCueRow(cue, resolution, audioState, `播放 ${cue.kind.toUpperCase()}`));
    } else {
      const row = createElement('div', {
        className: `voice-cue${resolution?.status === 'resolved' ? '' : ' unresolved'}`,
      });
      row.append(
        createElement('code', { text: cue.cueId }),
        createElement('span', {
          text: resolution?.status === 'resolved'
            ? `${cue.kind} 已路由至舞台`
            : `待接入 · ${resolution?.reason ?? '尚未解析'}`,
        }),
      );
      list.append(row);
    }
  }
  body.append(list);
};

const renderLineCard = (event, current, resolutions, audioState) => {
  const card = createElement('article', {
    className: `event-card${current ? ' current' : ''}`,
  });
  card.id = `event-${event.eventId}`;
  addCardNavigation(card, event.eventId);
  const speaker = createElement('div', {
    className: 'speaker',
    text: primaryText(event.speaker) || '旁白',
  });
  const body = createElement('div', { className: 'event-body' });
  body.append(createElement('div', { className: 'event-id', text: event.eventId }));
  appendLocalizedText(body, event.text);
  appendNonVoiceMedia(body, event, resolutions, audioState);
  if (preferences.voicePanelExpanded) appendVoiceSlot(body, event, resolutions, audioState);
  card.append(speaker, body);
  return card;
};

const renderChoiceCard = (event, current) => {
  const card = createElement('article', {
    className: `event-card choice-card${current ? ' current' : ''}`,
  });
  card.id = `event-${event.eventId}`;
  card.append(
    createElement('div', { className: 'event-id', text: event.eventId }),
    createElement('h3', { text: '选择一条剧情分支' }),
  );
  const options = createElement('div', { className: 'choice-options' });
  for (const choice of event.choices) {
    const button = createElement('button', { className: 'choice-option', type: 'button' });
    const labels = createElement('span');
    labels.append(createElement('span', { text: primaryText(choice.label) }));
    if (preferences.localeMode === 'parallel') {
      const secondary = secondaryText(choice.label);
      if (secondary && secondary !== primaryText(choice.label)) {
        labels.append(createElement('small', { text: ` / ${secondary}` }));
      }
    }
    button.append(labels, createElement('small', { text: `→ ${choice.nextEventId}` }));
    button.addEventListener('click', () => {
      if (activeSession.location.eventId !== event.eventId) activeSession.goTo(event.eventId);
      activeSession.choose(choice.choiceId);
    });
    options.append(button);
  }
  card.append(options);
  return card;
};

const renderSimpleCard = (event, current) => {
  const label = event.kind === 'end' ? '本路线在此结束' : '场景动作';
  const card = createElement('article', {
    className: `event-card ${event.kind === 'end' ? 'end-card' : 'action-card'}${current ? ' current' : ''}`,
  });
  card.id = `event-${event.eventId}`;
  addCardNavigation(card, event.eventId);
  card.append(createElement('span', { text: `${event.eventId} · ${label}` }));
  return card;
};

const updateStage = (snapshot, resolutions) => {
  ui.storyTitle.textContent = activeStory.title;
  ui.sectionTitle.textContent = primaryText(activeSession.section.title);
  ui.stageRoute.textContent = [
    snapshot.location.canonicalStoryId,
    snapshot.location.variantId,
    snapshot.location.sectionId,
    snapshot.location.eventId,
  ].join(' / ');
  replaceChildren(ui.stageBadges, [
    makeBadge(activeCorpus.adapterId),
    makeBadge(activeCorpus.sourceFormat),
    ...activeCorpus.features.slice(0, 4).map(makeBadge),
  ]);

  const currentIndex = Math.max(0, snapshot.ordinal);
  let imageCue = null;
  for (let index = 0; index <= currentIndex; index += 1) {
    const candidate = (activeSession.events[index]?.cues ?? []).find((cue) => cue.kind === 'image');
    if (candidate) imageCue = candidate;
  }
  const resolution = imageCue ? resolutions.get(imageCue.cueId) : null;
  if (resolution?.status === 'resolved') {
    ui.stageImage.src = resolution.url;
    ui.stageImage.alt = `${activeStory.title} · ${primaryText(activeSession.section.title)}`;
    ui.stageImage.hidden = false;
  } else {
    ui.stageImage.removeAttribute('src');
    ui.stageImage.hidden = true;
  }
};

const updateVoicePanel = (resolutions) => {
  const summary = voiceRouteSummary(activeStory);
  ui.voiceSummary.textContent = `${summary.cueEvents} / ${summary.eligibleEvents}`;
  ui.voiceToggle.setAttribute('aria-expanded', String(preferences.voicePanelExpanded));
  ui.voicePanel.hidden = !preferences.voicePanelExpanded;
  ui.voiceSlotMode.value = preferences.voiceSlotMode;

  const voiceCues = activeSession.events.flatMap((event) =>
    (event.cues ?? []).filter((cue) => cue.kind === 'voice'),
  );
  const resolved = voiceCues.filter((cue) => resolutions.get(cue.cueId)?.status === 'resolved').length;
  replaceChildren(ui.voiceMetrics, [
    createElement('span', { className: 'metric', text: `全部文本槽位 ${summary.eligibleEvents}` }),
    createElement('span', { className: 'metric', text: `已声明 cue ${summary.voiceCues}` }),
    createElement('span', { className: 'metric', text: `本节可播放 ${resolved}` }),
    createElement('span', { className: 'metric', text: `本节待接入 ${voiceCues.length - resolved}` }),
  ]);
};

const updateCompatibilityBanner = () => {
  const mismatch = compatibilityState
    && Object.values(compatibilityState).includes('mismatch');
  ui.compatibilityBanner.hidden = !mismatch;
  if (mismatch) {
    ui.compatibilityBanner.textContent =
      '目录或剧情修订不一致：已打开同一剧情/章节，但没有猜测旧 eventId 的精确位置。';
  }
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
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
};

async function renderSession(snapshot, scrollCurrent = true) {
  if (!activeSession || snapshot.disposed) return;
  const generation = ++renderGeneration;
  updateLocaleControls();
  const resolutions = await resolveSectionCues();
  if (generation !== renderGeneration || !activeSession) return;
  const audioState = audioController.getSnapshot();

  updateStage(snapshot, resolutions);
  updateVoicePanel(resolutions);
  updateCompatibilityBanner();
  ui.transcriptTitle.textContent = primaryText(activeSession.section.title);
  ui.eventProgress.textContent = `${snapshot.ordinal + 1} / ${snapshot.total}`;
  ui.currentEventLabel.textContent = snapshot.location.eventId;

  const cards = activeSession.events.map((event) => {
    const current = event.eventId === snapshot.location.eventId;
    if (event.kind === 'line') return renderLineCard(event, current, resolutions, audioState);
    if (event.kind === 'choice') return renderChoiceCard(event, current);
    return renderSimpleCard(event, current);
  });
  replaceChildren(ui.eventList, cards);

  ui.previousEvent.disabled = snapshot.history.length <= 1;
  const event = snapshot.currentEvent;
  ui.nextEvent.disabled = event.kind === 'end' || event.kind === 'choice' || !event.nextEventId;
  ui.nextEvent.textContent = event.kind === 'choice' ? '请选择分支' : '下一事件 →';
  syncDeepLink(snapshot);
  bridgeProvider?.emit('story.location', {
    ...snapshot.location,
    catalogRevision: catalog.revision,
    ordinal: snapshot.ordinal,
    total: snapshot.total,
  });
  renderCatalog();

  if (scrollCurrent) {
    const currentCard = document.getElementById(`event-${snapshot.location.eventId}`);
    currentCard?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

async function openStory(corpus, storyEntry, requestedLocation = null) {
  setStatus(`正在载入 ${storyEntry.title}…`);
  audioController.stop();
  sessionUnsubscribe?.();
  sessionUnsubscribe = null;
  activeSession?.dispose();
  activeResolverUnregister?.();
  activeResolverUnregister = null;
  resolutionCache = new Map();
  compatibilityState = null;

  const story = await adapterRegistry.loadStory(corpus, storyEntry, { fetchJson });
  const mediaManifest = validateMediaManifest(await fetchJson(storyEntry.mediaManifest));
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
      target = { ...target, ...parsed?.location };
      if (parsed && !canSynchronizeExactEvent(parsed.revision)) {
        target = { ...target, eventId: undefined };
      }
    }
  }

  const variantId = target.variantId
    ?? storyEntry.preferredVariantId
    ?? story.variants[0].variantId;
  const variant = story.variants.find((item) => item.variantId === variantId) ?? story.variants[0];
  const sectionId = target.sectionId
    && variant.sections.some((section) => section.sectionId === target.sectionId)
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
  activeMediaManifest = mediaManifest;
  activeSession = new ReaderSession(story, location);
  sessionUnsubscribe = activeSession.subscribe((snapshot) => {
    void renderSession(snapshot, true);
  });
  setStatus(`${corpus.title} · ${corpus.adapterId}`);
  await renderSession(activeSession.snapshot(), false);
  return activeSession.snapshot();
}

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
  const event = activeSession.currentEvent;
  const cues = (event.cues ?? []).filter((cue) => cue.kind === 'voice');
  const cue = payload.cueId
    ? cues.find((item) => item.cueId === payload.cueId)
    : cues[0];
  if (!cue) throw new ReaderRouteError('current text event has no declared voice cue');
  const resolution = await resolveCue(cue);
  if (resolution.status !== 'resolved') throw new ReaderRouteError(resolution.reason);
  await audioController.play(cue, resolution);
  return { cueId: cue.cueId, state: audioController.getSnapshot() };
};

const attachBridge = async () => {
  const manifest = await fetchJson('./.well-known/adv-app.json');
  const trusted = manifest.embed?.trustedParentOrigins ?? [];
  bridgeProvider = attachBridgeProvider({
    appId: manifest.appId,
    capabilities: manifest.capabilities.map((capability) => capability.id),
    allowedOrigins: trusted,
    actions: {
      'story.open': openLocationFromBridge,
      'story.getLocation': async () => ({
        ...activeSession.location,
        catalogRevision: catalog.revision,
      }),
      'voice.play': playVoiceFromBridge,
      'lifecycle.suspend': async () => {
        audioController.suspend();
        activeSession.suspend();
        return { suspended: true };
      },
      'lifecycle.resume': async () => {
        activeSession.resume();
        return { suspended: false };
      },
      'lifecycle.dispose': async () => {
        audioController.suspend();
        activeSession.suspend();
        return { disposed: true };
      },
    },
  });
};

const bindUi = () => {
  ui.sidebarToggle.addEventListener('click', toggleSidebar);
  ui.sidebarScrim.addEventListener('click', closeSidebar);
  ui.storySearch.addEventListener('input', renderCatalog);

  for (const button of document.querySelectorAll('[data-locale-mode]')) {
    button.addEventListener('click', () => {
      savePreferencesAndRender({ localeMode: button.dataset.localeMode });
    });
  }
  ui.primaryLocale.addEventListener('change', () => {
    savePreferencesAndRender({ primaryLocale: ui.primaryLocale.value });
  });
  ui.secondaryLocale.addEventListener('change', () => {
    savePreferencesAndRender({ secondaryLocale: ui.secondaryLocale.value });
  });
  ui.variantSelect.addEventListener('change', () => {
    const variant = activeStory.variants.find((item) => item.variantId === ui.variantSelect.value);
    if (!variant) return;
    activeSession.open({
      canonicalStoryId: activeStory.canonicalStoryId,
      variantId: variant.variantId,
      sectionId: variant.sections[0].sectionId,
    });
  });
  ui.voiceToggle.addEventListener('click', () => {
    savePreferencesAndRender({ voicePanelExpanded: !preferences.voicePanelExpanded });
  });
  ui.voiceSlotMode.addEventListener('change', () => {
    savePreferencesAndRender({ voiceSlotMode: ui.voiceSlotMode.value });
  });
  ui.previousEvent.addEventListener('click', () => activeSession.back());
  ui.nextEvent.addEventListener('click', () => {
    try {
      activeSession.next();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    }
  });
  ui.copyLink.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast('当前位置链接已复制。');
    } catch {
      showToast('浏览器未开放剪贴板；可直接复制地址栏链接。');
    }
  });

  audioController.subscribe(() => {
    if (activeSession) void renderSession(activeSession.snapshot(), false);
  });
  window.addEventListener('pagehide', () => audioController.suspend());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) audioController.suspend();
  });
};

async function initialize() {
  bindUi();
  catalog = validateCatalog(await fetchJson('./data/catalog.json'));
  ui.catalogRevision.textContent = `目录修订：${catalog.revision}`;
  let deepLink = null;
  try {
    deepLink = parseStoryDeepLink(window.location.href, {
      bridgeRevision: BRIDGE_REVISION,
      catalogRevision: catalog.revision,
    });
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error));
  }
  const record = deepLink?.location?.canonicalStoryId
    ? findStoryRecord(deepLink.location.canonicalStoryId)
    : firstStoryRecord();
  if (!record) throw new Error('catalog contains no loadable story');
  await openStory(record.corpus, record.storyEntry, deepLink?.location ?? null);
  await attachBridge();
  globalThis.AdvReader = Object.freeze({
    open: openLocationFromBridge,
    getLocation: () => ({ ...activeSession.location, catalogRevision: catalog.revision }),
    playVoice: playVoiceFromBridge,
    suspend: () => {
      audioController.suspend();
      activeSession.suspend();
    },
    resume: () => activeSession.resume(),
  });
  setStatus(`${record.corpus.title} · 接入就绪`);
}

initialize().catch((error) => {
  console.error(error);
  setStatus('载入失败');
  ui.storyTitle.textContent = 'Reader 初始化失败';
  ui.sectionTitle.textContent = error instanceof Error ? error.message : String(error);
  ui.eventList.replaceChildren(createElement('div', {
    className: 'compatibility-banner',
    text: '请检查目录、适配器和媒体 manifest。',
  }));
});
