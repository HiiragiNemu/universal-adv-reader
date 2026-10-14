import {
  validateCatalog,
  validateMediaManifest,
  validateStoryDocument,
} from '../../contracts/src/index.js';
import { buildMajiroNativeUnits, collectMajiroNativeNames, wireMajiroNativeBranches, localizeMajiroNativeUnit, attachMajiroPresentationGroups, repairMajiroQuotedSpeakerPrefixes } from './majiro-native-content.js';

export const RESEARCH_READER_ADAPTER_ID = 'research-reader-v1';
export const RESEARCH_READER_SOURCE_FORMAT = 'vn-reader-adapter/story-v1';
export const RESEARCH_READER_MANIFEST_SCHEMA = 'vn-reader-adapter/v1';
export const KANA_ROUTE_INDEX_SCHEMA = 'vn-kana-route-diff-index/v1';

import { applyKanaChineseContentCorrections } from '../../../tools/lib/kana-content-corrections.mjs';
import { deriveKanaPresentationGroups, attachKanaPresentationGroups } from '../../../tools/lib/kana-presentation-groups.mjs';
import { localizeKanaChineseSpeaker } from '../../../tools/lib/kana-speaker-labels.mjs';

const CORPUS_DEFINITIONS = Object.freeze([
  Object.freeze({
    corpusId: 'narcissu10',
    title: 'Narcissu 10th Anniversary Anthology Project',
    gameIds: Object.freeze([
      'narcissu-himeko',
      'narcissu-iris',
      'narcissu-one-two',
      'narcissu-sumire',
      'narcissu-zero',
    ]),
  }),
  Object.freeze({
    corpusId: 'narcissu3',
    title: 'Narcissu 3rd',
    gameIds: Object.freeze(['narcissu-3rd']),
  }),
  Object.freeze({
    corpusId: 'kana',
    title: 'KANA: Okaeri!!',
    gameIds: Object.freeze(['kana-okaeri']),
  }),
]);

const FOLDER_TITLES = Object.freeze({
  'narcissu-himeko': '姬子篇',
  'narcissu-iris': '伊莉丝篇',
  'narcissu-one-two': 'Narcissu 1st & 2nd',
  'narcissu-sumire': '堇篇',
  'narcissu-zero': 'Zero 篇',
  'narcissu-3rd': 'Narcissu 3rd 剧情',
  'kana-okaeri': 'KANA: Okaeri!! 剧情',
});

const RESOURCE_CLASS_TITLES = Object.freeze({
  narrative: '',
  'localized-supplement': '汉化补充脚本',
  supplement: '附加内容',
  system: '系统脚本',
  sample: '引擎样例',
  archive: '归档脚本',
});

const resourceClassOf = (story) => story.resource?.class ?? 'archive';

const resourceFolder = (story, gameTitle) => {
  const resourceClass = resourceClassOf(story);
  const baseTitle = FOLDER_TITLES[story.gameId] ?? gameTitle ?? story.gameId;
  if (story.resource?.reader?.decision === 'include') {
    return { folderId: story.gameId, folderTitle: baseTitle };
  }
  const suffix = RESOURCE_CLASS_TITLES[resourceClass] ?? resourceClass;
  return {
    folderId: resourceClass === 'narrative'
      ? story.gameId
      : `${story.gameId}:${resourceClass}`,
    folderTitle: suffix ? `${baseTitle} · ${suffix}` : baseTitle,
  };
};

const NARCISSU_GAME_NAMES = Object.freeze({
  'narcissu-himeko': 'narci_himeko',
  'narcissu-iris': 'narci_iris',
  'narcissu-one-two': 'narci_onetwo',
  'narcissu-sumire': 'narci_sumire',
  'narcissu-zero': 'narci_zero',
  'narcissu-3rd': 'narcissu3',
});

const MEDIA_ROLE = Object.freeze({
  voice: 'voice',
  music: 'bgm',
  'sound-effect': 'sfx',
  audio: 'sfx',
  'game-graphic': 'image',
  icon: 'image',
  'interface-effect': 'image',
  image: 'image',
  movie: 'video',
  video: 'video',
});

const MIME_TYPES = Object.freeze({
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.mp4': 'video/mp4',
});

const normalizeText = (value) => String(value ?? '')
  .replace(/\r\n?/gu, '\n')
  .replace(/\p{Cc}/gu, (character) => (
    character === '\n' || character === '\t' ? character : '\uFFFD'
  ));

const hashId = (value) => {
  let hash = 14695981039346656037n;
  for (const character of String(value)) {
    hash ^= BigInt(character.codePointAt(0));
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return hash.toString(16).padStart(16, '0');
};

const repositoryUrl = (baseUrl, relativePath) => {
  const encoded = String(relativePath).replaceAll('\\', '/').split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${String(baseUrl).replace(/\/?$/u, '/')}${encoded}`;
};

const basenameWithoutExtension = (value) => {
  const filename = String(value).replaceAll('\\', '/').split('/').at(-1) ?? '';
  const dot = filename.lastIndexOf('.');
  return (dot > 0 ? filename.slice(0, dot) : filename).toLocaleLowerCase();
};

const extensionOf = (value) => {
  const filename = String(value).replaceAll('\\', '/').split('/').at(-1) ?? '';
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLocaleLowerCase() : '';
};

const sourceStoryId = (story) => story.readerIdentity ?? story.canonicalStoryId;
const sourceVariantId = (variant) => variant.id;
const pairedKanaVariantId = (story) => `paired/${story.canonicalStoryId}/zh-ja`;

const preferredVariantId = (story) => story.gameId === 'kana-okaeri'
  ? pairedKanaVariantId(story)
  : sourceVariantId(
    story.variants.find((variant) => variant.id === story.preferredVariantId)
      ?? story.variants[0],
  );

const assertReaderManifest = (manifest) => {
  if (!manifest || manifest.schema !== RESEARCH_READER_MANIFEST_SCHEMA) {
    throw new TypeError(`reader manifest must use ${RESEARCH_READER_MANIFEST_SCHEMA}`);
  }
  if (manifest.result !== 'PASS' || !Array.isArray(manifest.games) || !Array.isArray(manifest.stories)) {
    throw new TypeError('reader manifest is incomplete');
  }
  const selection = manifest.readerSelection;
  if (selection?.schema !== 'vn-reader-story-selection/v1'
    || selection.counts?.unreviewed !== 0
    || manifest.stories.some((story) => (
      story.resource?.reader?.schema !== 'vn-reader-story-decision/v1'
      || story.resource.reader.reviewed !== true
      || !['include', 'exclude'].includes(story.resource.reader.decision)
    ))) {
    throw new TypeError('reader manifest selection is incomplete');
  }
  return manifest;
};

export function buildResearchCatalog(manifestValue, {
  corpusBaseUrl = '/corpus/',
  readerManifestPath = 'manifests/generated/reader-adapter.json',
} = {}) {
  const manifest = assertReaderManifest(manifestValue);
  const gameTitles = new Map(manifest.games.map((game) => [game.id, game.title]));
  const seenStoryIds = new Set();
  const corpora = CORPUS_DEFINITIONS.map((definition) => {
    const gameIds = new Set(definition.gameIds);
    const stories = manifest.stories
      .filter((story) => gameIds.has(story.gameId))
      .filter((story) => story.resource.reader.decision === 'include')
      .map((story) => {
        const canonicalStoryId = sourceStoryId(story);
        if (seenStoryIds.has(canonicalStoryId)) throw new TypeError(`duplicate story ID ${canonicalStoryId}`);
        seenStoryIds.add(canonicalStoryId);
        const folder = resourceFolder(story, gameTitles.get(story.gameId));
        return {
          canonicalStoryId,
          title: story.displayTitle,
          ...folder,
          source: repositoryUrl(corpusBaseUrl, readerManifestPath),
          mediaManifest: './data/media.json',
          preferredVariantId: preferredVariantId(story),
          sourceCanonicalStoryId: story.canonicalStoryId,
          sourceGameId: story.gameId,
          sourcePreferredVariantId: story.preferredVariantId,
          sourceStory: story,
        };
      });
    return {
      corpusId: definition.corpusId,
      title: definition.title,
      adapterId: RESEARCH_READER_ADAPTER_ID,
      sourceFormat: RESEARCH_READER_SOURCE_FORMAT,
      features: ['text', 'variants', 'branches', 'voice', 'bgm', 'sfx', 'image', 'video'],
      stories,
    };
  });
  const catalog = {
    schema: 'adv-catalog/v1',
    revision: `research-${hashId(manifest.bridgeRevision)}`,
    corpora,
    sourceCounts: { ...manifest.counts },
    sourceBridgeRevision: manifest.bridgeRevision,
  };
  return validateCatalog(catalog);
}

const isDialogue = (value) => /^[\s]*[「『（("“]/u.test(value);

const majiroGroups = (textEvents) => {
  const groups = [];
  for (let index = 0; index < textEvents.length; index += 1) {
    const current = textEvents[index];
    const next = textEvents[index + 1];
    const speakerPair = next
      && !isDialogue(current.text)
      && !String(current.text).includes('\n')
      && String(current.text).length <= 24
      && isDialogue(next.text);
    if (speakerPair) {
      groups.push({ sourceIndices: [index, index + 1], speakerIndex: index, textIndex: index + 1 });
      index += 1;
    } else {
      groups.push({ sourceIndices: [index], speakerIndex: null, textIndex: index });
    }
  }
  return groups;
};

const fallbackEventId = (index) => `line-${String(index + 1).padStart(6, '0')}`;
const offsetEventId = (engine, offset, fallbackIndex) => Number.isInteger(offset)
  ? `${engine}-${offset.toString(16)}`
  : fallbackEventId(fallbackIndex);
const majiroEventId = (group, index, textEvents) => offsetEventId(
  'mjo',
  group.nativeUnit?.bodyCodeOffset ?? textEvents[group.textIndex]?.codeOffset,
  index,
);

const translationByOffset = (script) => new Map((script.translation?.entries ?? [])
  .filter((entry) => Number.isInteger(entry.target?.codeOffset))
  .map((entry) => [entry.target.codeOffset, normalizeText(entry.displayText ?? entry.text)]));

const localesForVariant = (variant, script) => {
  const locales = [];
  const sourceLocale = variant.sourceLocale ?? script.locale ?? 'und';
  if (!locales.includes(sourceLocale)) locales.push(sourceLocale);
  const translationLocale = variant.translation?.locale ?? script.translation?.locale;
  if (translationLocale && !locales.includes(translationLocale)) locales.push(translationLocale);
  return locales;
};

const localizedMajiroRecord = (sourceEvent, sourceLocale, translations) => {
  const record = { [sourceLocale]: normalizeText(sourceEvent?.text) };
  const translated = translations.get(sourceEvent?.codeOffset);
  if (translated !== undefined) record['zh-CN'] = translated;
  return record;
};

const cueTargetIndex = (groups, codeOffset) => {
  const index = groups.findIndex((group) => group.startOffset > codeOffset);
  return index === -1 ? groups.length : index;
};

const createMediaAccumulator = (corpusBaseUrl) => {
  const entries = new Map();
  const register = (path, role) => {
    const mediaId = `asset/a-${hashId(`${role}:${path}`)}`;
    if (!entries.has(mediaId)) {
      entries.set(mediaId, {
        mediaId,
        role,
        url: repositoryUrl(corpusBaseUrl, path.startsWith('archive/') ? path : `archive/${path}`),
        mimeType: MIME_TYPES[extensionOf(path)] ?? 'application/octet-stream',
      });
    }
    return mediaId;
  };
  return { entries, register };
};

const createNarcissuMediaIndex = (mediaView, playback, gameId, sourceLocale) => {
  const game = NARCISSU_GAME_NAMES[gameId];
  const locale = sourceLocale === 'en' ? 'en' : 'ja-JP';
  const index = new Map();
  const add = (path, role, priority) => {
    const key = basenameWithoutExtension(path);
    if (!index.has(key)) index.set(key, []);
    const entries = index.get(key);
    if (!entries.some((entry) => entry.path === path && entry.role === role)) {
      entries.push({ path, role, priority });
      entries.sort((left, right) => right.priority - left.priority
        || left.path.localeCompare(right.path));
    }
  };

  const patchPrefixes = gameId === 'narcissu-3rd' ? [] : [
    `raw/patch-archives/${game}/`,
    `derived/images/patch-archives/${game}/`,
    `raw/patches/${game}/`,
    `derived/images/patches/${game}/`,
  ];
  const basePrefixes = gameId === 'narcissu-3rd'
    ? ['raw/narcissu3/', 'derived/images/narcissu3/']
    : [];
  for (const collection of ['audio', 'images', 'video']) {
    for (const record of playback?.[collection] ?? []) {
      const path = String(record.path ?? '');
      const role = MEDIA_ROLE[record.role] ?? MEDIA_ROLE[record.kind];
      if (!role) continue;
      if (patchPrefixes.some((prefix) => path.startsWith(prefix))) add(path, role, 30);
      else if (basePrefixes.some((prefix) => path.startsWith(prefix))) add(path, role, 20);
    }
  }

  for (const record of mediaView?.files ?? []) {
    if (record.game !== game || record.locale !== locale) continue;
    const role = MEDIA_ROLE[record.role];
    if (role) add(record.canonicalPlaybackPath, role, 10);
  }
  return index;
};

const routeMajiroMedia = ({ strings, groups, textEvents, mediaIndex, media, variant }) => {
  const buckets = Array.from({ length: groups.length + 1 }, () => []);
  for (const operand of strings?.strings ?? []) {
    if (operand.mnemonic !== 'ldstr') continue;
    const matches = mediaIndex.get(basenameWithoutExtension(operand.text)) ?? [];
    for (const match of matches.slice(0, 1)) {
      const bucketIndex = cueTargetIndex(groups, operand.codeOffset);
      const target = bucketIndex < groups.length
        ? majiroEventId(groups[bucketIndex], bucketIndex, textEvents)
        : 'end-001';
      const cueId = `cue-${hashId(`${variant.id}:${operand.codeOffset}:${match.path}`)}`;
      if (buckets[bucketIndex].some((cue) => cue.cueId === cueId)) continue;
      buckets[bucketIndex].push({
        cueId,
        kind: match.role,
        timing: ['image', 'bgm', 'video'].includes(match.role) ? 'scene' : 'utterance',
        mediaId: media.register(match.path, match.role),
        resolverId: 'research-media-v1',
        raw: {
          sourceKey: operand.text,
          codeOffset: operand.codeOffset,
          playbackPath: match.path,
          targetEventId: target,
        },
      });
    }
  }
  return buckets;
};

const buildMajiroVariant = ({
  sourceStory,
  variant,
  script,
  strings,
  mediaView,
  playback,
  media,
  nativeGroups,
  nativePlain,
}) => {
  const textEvents = Array.isArray(script.textEvents) ? script.textEvents : [];
  const translations = translationByOffset(script);
  const sourceLocale = variant.sourceLocale ?? 'und';
  const groups = (nativeGroups ?? majiroGroups(textEvents)).map((group) => ({
    ...group,
    startOffset: group.startOffset ?? textEvents[group.sourceIndices[0]]?.codeOffset ?? Number.MAX_SAFE_INTEGER,
  }));
  const mediaIndex = createNarcissuMediaIndex(
    mediaView,
    playback,
    sourceStory.gameId,
    sourceLocale,
  );
  const mediaBuckets = routeMajiroMedia({
    strings,
    groups,
    textEvents,
    mediaIndex,
    media,
    variant,
  });
  const eventIds = groups.map((group, index) => majiroEventId(group, index, textEvents));
  let events = groups.map((group, index) => {
    const sourceEvent = textEvents[group.textIndex];
    const native = group.nativeUnit ? localizeMajiroNativeUnit(group, script, sourceLocale) : null;
    const record = {
      eventId: eventIds[index],
      kind: 'line',
      text: native
        ? Object.fromEntries(Object.entries(native.text).map(([locale, text]) => [locale, normalizeText(text)]))
        : localizedMajiroRecord(sourceEvent, sourceLocale, translations),
      nextEventId: index + 1 < groups.length ? eventIds[index + 1] : 'end-001',
      source: {
        engine: 'majiro',
        variantSourceId: variant.id,
        scriptPath: variant.references.script,
        textEventIndices: group.sourceIndices,
        codeOffsets: group.sourceIndices.map((sourceIndex) => textEvents[sourceIndex]?.codeOffset),
        ...(native ? { nativeUnit: native.nativeUnit } : {}),
      },
    };
    if (native?.speaker) {
      record.speaker = native.speaker;
    } else if (!group.nativeUnit && group.speakerIndex !== null) {
      record.speaker = localizedMajiroRecord(
        textEvents[group.speakerIndex],
        sourceLocale,
        translations,
      );
    }
    if (mediaBuckets[index].length > 0) record.cues = mediaBuckets[index];
    return record;
  });
  if (events.length === 0 && Array.isArray(script.translation?.entries)) {
    for (const entry of script.translation.entries) {
      events.push({
        eventId: fallbackEventId(events.length),
        kind: 'line',
        text: { 'zh-CN': normalizeText(entry.displayText ?? entry.text) },
        nextEventId: 'end-001',
        source: { engine: 'majiro', variantSourceId: variant.id, translationLine: entry.line },
      });
      if (events.length > 1) events.at(-2).nextEventId = events.at(-1).eventId;
    }
  }
  if (nativePlain) events = wireMajiroNativeBranches({ plain: nativePlain, strings, sourceLocale, events, groups, variant });
  if (nativePlain) events = attachMajiroPresentationGroups({ plain: nativePlain, events, variant });
  const end = { eventId: 'end-001', kind: 'end' };
  if (mediaBuckets.at(-1)?.length > 0) end.cues = mediaBuckets.at(-1);
  events.push(end);
  const locales = localesForVariant(variant, script);
  const sections = [{
    sectionId: 'main',
    title: Object.fromEntries(locales.map((locale) => [locale, sourceStory.displayTitle])),
    entryEventId: events[0].eventId,
    events,
  }];
  if (
    textEvents.length > 0
    &&
    script.translation?.alignment === 'sequential-unmapped'
    && Array.isArray(script.translation.entries)
    && script.translation.entries.length > 0
  ) {
    const translationEvents = script.translation.entries.map((entry, index) => ({
      eventId: `translation-line-${String(index + 1).padStart(6, '0')}`,
      kind: 'line',
      text: { 'zh-CN': normalizeText(entry.displayText ?? entry.text) },
      nextEventId: index + 1 < script.translation.entries.length
        ? `translation-line-${String(index + 2).padStart(6, '0')}`
        : 'translation-end-001',
      source: {
        engine: 'majiro',
        variantSourceId: variant.id,
        translationLine: entry.line,
        alignment: 'sequential-unmapped',
      },
    }));
    translationEvents.push({ eventId: 'translation-end-001', kind: 'end' });
    sections.push({
      sectionId: 'translation-archive',
      title: { 'zh-CN': `${sourceStory.displayTitle} · 中文补丁原序` },
      entryEventId: translationEvents[0].eventId,
      events: translationEvents,
    });
  }
  return {
    variantId: sourceVariantId(variant),
    locales,
    sections,
    sourceVariant: variant,
  };
};

const normalKanaBoundary = (route) => {
  const transfers = route.crossScriptTransfers.filter((item) =>
    item.kind === 'load-script' && item.jaTargetScript.toLocaleLowerCase() === 'title');
  return transfers.length > 0
    ? Math.min(...transfers.map((item) => item.sourceInstructionIndex))
    : route.summary.instructionPairs;
};

const alignmentText = (alignment, mode) => mode === 'paired'
  ? { 'zh-CN': normalizeText(alignment.zhText), 'ja-JP': normalizeText(alignment.jaText) }
  : mode === 'zh-CN'
    ? { 'zh-CN': normalizeText(alignment.zhText) }
    : { 'ja-JP': normalizeText(alignment.jaText) };

const alignmentSpeaker = (alignment, mode) => {
  const parse = (text) => String(text ?? '').match(/^\s*([^：「『\n]{1,24})[：:][「『]/u)?.[1]?.trim().replace(/\s+/gu, '') ?? '';
  const record = {};
  if (mode !== 'ja-JP') {
    const value = parse(alignment.zhText);
    if (value) record['zh-CN'] = localizeKanaChineseSpeaker(value);
  }
  if (mode !== 'zh-CN') {
    const value = parse(alignment.jaText);
    if (value) record['ja-JP'] = value;
  }
  return Object.keys(record).length > 0 ? record : null;
};

const indexedJumpGroups = (route) => {
  const groups = new Map();
  for (const transfer of route.localTransfers.filter((item) => item.kind === 'indexed-jump')) {
    if (!groups.has(transfer.sourceInstructionIndex)) groups.set(transfer.sourceInstructionIndex, []);
    groups.get(transfer.sourceInstructionIndex).push(transfer);
  }
  return [...groups.entries()].sort((left, right) => left[0] - right[0]);
};

const groupKanaAlignments = (alignments, route) => {
  const nodes = [];
  const selectors = indexedJumpGroups(route);
  for (let index = 0; index < alignments.length; index += 1) {
    const alignment = alignments[index];
    if (alignment.kind !== 'localized-label') {
      nodes.push({ kind: 'line', alignment, sourceInstructionIndex: alignment.instructionIndex });
      continue;
    }
    const labels = [alignment];
    while (alignments[index + 1]?.kind === 'localized-label') {
      labels.push(alignments[index + 1]);
      index += 1;
    }
    const nextAlignmentIndex = alignments[index + 1]?.instructionIndex ?? Number.MAX_SAFE_INTEGER;
    const selector = selectors.find(([instructionIndex, arms]) =>
      instructionIndex > labels.at(-1).instructionIndex
      && instructionIndex < nextAlignmentIndex
      && arms.filter((arm) => arm.armIndex > 0).length >= labels.length);
    if (selector) {
      nodes.push({
        kind: 'choice',
        labels,
        selectorInstructionIndex: selector[0],
        arms: selector[1],
        sourceInstructionIndex: labels[0].instructionIndex,
      });
    } else {
      for (const label of labels) {
        nodes.push({ kind: 'line', alignment: label, sourceInstructionIndex: label.instructionIndex });
      }
    }
  }
  return nodes;
};

const createKanaMediaIndex = (playback) => {
  const index = new Map();
  const add = (record, role) => {
    const key = basenameWithoutExtension(record.path);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ path: record.path, role });
  };
  for (const record of playback?.audio ?? []) {
    if (!record.path.startsWith('raw/kana/')) continue;
    const role = MEDIA_ROLE[record.role];
    if (role) add(record, role);
  }
  for (const record of playback?.images ?? []) {
    if (record.path.startsWith('derived/images/kana/')) add(record, 'image');
  }
  return index;
};

const asciiTokens = (bytes) => {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return [...text.matchAll(/[A-Za-z][A-Za-z0-9_.-]{2,}/gu)].map((match) => match[0]);
};

const instructionOperand = (document, bytecode, instructionIndex) => {
  const instruction = document.instructions[instructionIndex];
  if (!instruction) return new Uint8Array();
  return bytecode.subarray(
    instruction.operandOffset,
    instruction.operandOffset + instruction.operandLength,
  );
};

const mediaMatches = (index, operand, allowedRoles = null) => {
  const output = [];
  for (const token of asciiTokens(operand)) {
    for (const record of index.get(basenameWithoutExtension(token)) ?? []) {
      if (!allowedRoles || allowedRoles.has(record.role)) output.push({ token, ...record });
    }
  }
  return output;
};

const routeKanaMedia = ({ route, document, bytecode, nodes, playback, media }) => {
  const buckets = Array.from({ length: nodes.length + 1 }, () => []);
  const mediaIndex = createKanaMediaIndex(playback);
  const boundary = normalKanaBoundary(route);
  const targetForInstruction = (instructionIndex) => {
    const index = nodes.findIndex((node) => node.sourceInstructionIndex > instructionIndex);
    return index === -1 ? nodes.length : index;
  };
  const add = (bucketIndex, hit, source) => {
    const cueId = `cue-${hashId(`kana:${source.instructionIndex}:${hit.role}:${hit.path}`)}`;
    if (buckets[bucketIndex].some((cue) => cue.cueId === cueId)) return;
    buckets[bucketIndex].push({
      cueId,
      kind: hit.role,
      timing: ['image', 'bgm', 'video'].includes(hit.role) ? 'scene' : 'utterance',
      mediaId: media.register(hit.path, hit.role),
      resolverId: 'research-media-v1',
      raw: { sourceKey: hit.token, playbackPath: hit.path, ...source },
    });
  };
  for (const node of nodes) {
    if (node.kind !== 'line') continue;
    const index = nodes.indexOf(node);
    for (const hit of mediaMatches(
      mediaIndex,
      instructionOperand(document, bytecode, node.alignment.instructionIndex),
      new Set(['voice']),
    )) add(index, hit, { instructionIndex: node.alignment.instructionIndex });
  }
  for (const transfer of route.localTransfers.filter((item) =>
    item.kind === 'call' && item.sourceInstructionIndex < boundary)) {
    const hits = [];
    for (let index = transfer.targetInstructionIndex;
      index < Math.min(document.instructions.length, transfer.targetInstructionIndex + 10);
      index += 1) {
      const instruction = document.instructions[index];
      const allowedRoles = instruction.opcode === 0x56
        ? new Set(['image'])
        : instruction.opcode === 0x70
          ? new Set(['bgm', 'sfx'])
          : null;
      if (allowedRoles) hits.push(...mediaMatches(
        mediaIndex,
        instructionOperand(document, bytecode, index),
        allowedRoles,
      ));
      if ([0x04, 0x06].includes(instruction.opcode) && index > transfer.targetInstructionIndex) break;
    }
    const bucketIndex = targetForInstruction(transfer.sourceInstructionIndex);
    for (const hit of hits) add(bucketIndex, hit, {
      instructionIndex: transfer.sourceInstructionIndex,
      targetInstructionIndex: transfer.targetInstructionIndex,
    });
  }
  return buckets;
};

const instructionOffset = (document, instructionIndex) =>
  document.instructions[instructionIndex]?.offset;

const firstNodeAtOrAfter = (nodes, instructionIndex, document) => {
  const index = nodes.findIndex((node) => node.sourceInstructionIndex >= instructionIndex);
  return index === -1 ? 'end-001' : nodeEventId(nodes[index], index, document);
};

const nodeEventId = (node, index, document) => offsetEventId(
  'ikura',
  node.kind === 'choice'
    ? instructionOffset(document, node.selectorInstructionIndex)
    : node.alignment.jaOffset,
  index,
);

const buildKanaVariant = ({ sourceStory, route, nodes, mediaBuckets, document, mode, variantId, presentationGroups = [] }) => {
  const events = nodes.map((node, index) => {
    const id = nodeEventId(node, index, document);
    if (node.kind === 'choice') {
      const arms = node.arms.filter((arm) => arm.armIndex > 0).slice(0, node.labels.length);
      return {
        eventId: id,
        kind: 'choice',
        choices: node.labels.map((label, labelIndex) => ({
          choiceId: offsetEventId(
            'arm',
            instructionOffset(document, arms[labelIndex]?.targetInstructionIndex),
            labelIndex,
          ),
          label: alignmentText(label, mode),
          nextEventId: firstNodeAtOrAfter(
            nodes,
            arms[labelIndex]?.targetInstructionIndex,
            document,
          ),
        })),
        ...(mediaBuckets[index].length > 0 ? { cues: mediaBuckets[index] } : {}),
        source: {
          engine: 'ikura',
          routeRecordPath: `manifests/generated/kana-route-diff/scripts/${sourceStory.displayTitle}.json`,
          selectorInstructionIndex: node.selectorInstructionIndex,
          arms,
        },
      };
    }
    const record = {
      eventId: id,
      kind: 'line',
      text: alignmentText(node.alignment, mode),
      nextEventId: index + 1 < nodes.length
        ? nodeEventId(nodes[index + 1], index + 1, document)
        : 'end-001',
      source: {
        engine: 'ikura',
        instructionIndex: node.alignment.instructionIndex,
        opcode: node.alignment.opcode,
        status: node.alignment.status,
        zhOffset: node.alignment.zhOffset,
        jaOffset: node.alignment.jaOffset,
        originalDisplayText: alignmentText(node.alignment, mode),
        ...(node.alignment.readerContentCorrection ? {
          readerContentCorrection: node.alignment.readerContentCorrection,
        } : {}),
      },
    };
    const speaker = alignmentSpeaker(node.alignment, mode);
    if (speaker) {
      record.speaker = speaker;
      for (const locale of Object.keys(speaker)) {
        record.text[locale] = record.text[locale].replace(/^\s*[^：「『\n]{1,24}[：:](?=[「『])/u, '');
      }
    }
    if (mediaBuckets[index].length > 0) record.cues = mediaBuckets[index];
    return record;
  });
  const projectedEvents = attachKanaPresentationGroups(events, presentationGroups);
  const end = { eventId: 'end-001', kind: 'end' };
  if (mediaBuckets.at(-1)?.length > 0) end.cues = mediaBuckets.at(-1);
  projectedEvents.push(end);
  const locales = mode === 'paired' ? ['zh-CN', 'ja-JP'] : [mode];
  const title = route.textAlignments.find((alignment) => alignment.kind === 'title');
  return {
    variantId,
    locales,
    sections: [{
      sectionId: 'main',
      title: title ? alignmentText(title, mode) : Object.fromEntries(
        locales.map((locale) => [locale, sourceStory.displayTitle]),
      ),
      entryEventId: projectedEvents[0].eventId,
      events: projectedEvents,
    }],
  };
};

const loadMajiroStory = async ({ sourceStory, io, corpusBaseUrl, media, fetchSharedJson }) => {
  const [mediaView, playback] = await Promise.all([
    fetchSharedJson(repositoryUrl(
      corpusBaseUrl,
      'manifests/generated/narcissu10-media-view.json',
    )),
    fetchSharedJson(repositoryUrl(
      corpusBaseUrl,
      'manifests/generated/playback-media.json',
    )),
  ]);
  const nativeEnabled = true;
  const inputs = await Promise.all(sourceStory.variants.map(async variant => {
    const [script, strings, plain] = await Promise.all([
      io.fetchJson(repositoryUrl(corpusBaseUrl, variant.references.script)),
      variant.references.strings
        ? io.fetchJson(repositoryUrl(corpusBaseUrl, variant.references.strings))
        : Promise.resolve(null),
      nativeEnabled && variant.references.plainObject
        ? io.fetchBinary(repositoryUrl(corpusBaseUrl, variant.references.plainObject))
        : Promise.resolve(null),
    ]);
    return {variant, script, strings, plain};
  }));
  const knownNames = new Map();
  for (const input of inputs) if (input.plain && input.variant.sourceLocale === 'ja-JP') {
    for (const [raw,name] of collectMajiroNativeNames(input.plain,input.script)) knownNames.set(raw,name);
  }
  const variants = inputs.map(({variant,script,strings,plain}) => buildMajiroVariant({
    sourceStory,variant,script,strings,mediaView,playback,media,
    nativePlain: plain,
    nativeGroups: plain ? buildMajiroNativeUnits({plain,script,strings,
      sourceLocale:variant.sourceLocale,knownNames,localizeNames:true}) : undefined,
  }));
  return repairMajiroQuotedSpeakerPrefixes({variants,inputs});
};

const loadKanaStory = async ({ sourceStory, io, corpusBaseUrl, media, fetchSharedJson }) => {
  const scriptId = sourceStory.displayTitle.toLocaleUpperCase();
  const japanese = sourceStory.variants.find((variant) => variant.sourceLocale === 'ja-JP');
  const chinese = sourceStory.variants.find((variant) => variant.sourceLocale === 'zh-CN');
  if (!japanese || !chinese) throw new TypeError(`${scriptId} bilingual source pair is missing`);
  const [originalRoute, japaneseDocument, japaneseBytecode, chineseDocument, chineseBytecode, playback] = await Promise.all([
    io.fetchJson(repositoryUrl(
      corpusBaseUrl,
      `manifests/generated/kana-route-diff/scripts/${scriptId}.json`,
    )),
    io.fetchJson(repositoryUrl(corpusBaseUrl, japanese.references.script)),
    io.fetchBinary(repositoryUrl(corpusBaseUrl, japanese.references.bytecode)),
    io.fetchJson(repositoryUrl(corpusBaseUrl, chinese.references.script)),
    io.fetchBinary(repositoryUrl(corpusBaseUrl, chinese.references.bytecode)),
    fetchSharedJson(repositoryUrl(corpusBaseUrl, 'manifests/generated/playback-media.json')),
  ]);
  const { route } = applyKanaChineseContentCorrections(originalRoute);
  const presentationGroups = deriveKanaPresentationGroups({
    route, japaneseDocument, japaneseBytecode, chineseDocument, chineseBytecode,
  });
  const boundary = normalKanaBoundary(route);
  const alignments = route.textAlignments.filter((item) => item.instructionIndex < boundary);
  const nodes = groupKanaAlignments(alignments, route);
  const mediaBuckets = routeKanaMedia({
    route,
    document: japaneseDocument,
    bytecode: japaneseBytecode,
    nodes,
    playback,
    media,
  });
  return [
    buildKanaVariant({
      sourceStory,
      route,
      nodes,
      mediaBuckets,
      document: japaneseDocument,
      presentationGroups,
      mode: 'paired',
      variantId: pairedKanaVariantId(sourceStory),
    }),
    buildKanaVariant({
      sourceStory,
      route,
      nodes,
      mediaBuckets,
      document: japaneseDocument,
      presentationGroups,
      mode: 'zh-CN',
      variantId: sourceVariantId(chinese),
    }),
    buildKanaVariant({
      sourceStory,
      route,
      nodes,
      mediaBuckets,
      document: japaneseDocument,
      presentationGroups,
      mode: 'ja-JP',
      variantId: sourceVariantId(japanese),
    }),
  ];
};

export function createResearchReaderAdapter({ corpusBaseUrl = '/corpus/' } = {}) {
  const sharedJsonByIo = new WeakMap();
  const fetchSharedJson = (io, url) => {
    let cache = sharedJsonByIo.get(io);
    if (!cache) {
      cache = new Map();
      sharedJsonByIo.set(io, cache);
    }
    if (!cache.has(url)) {
      const pending = io.fetchJson(url).catch((error) => {
        cache.delete(url);
        throw error;
      });
      cache.set(url, pending);
    }
    return cache.get(url);
  };
  return Object.freeze({
    id: RESEARCH_READER_ADAPTER_ID,
    sourceFormats: Object.freeze([RESEARCH_READER_SOURCE_FORMAT]),
    async load({ corpus, storyEntry, io }) {
      if (typeof io?.fetchJson !== 'function' || typeof io?.fetchBinary !== 'function') {
        throw new TypeError(`${RESEARCH_READER_ADAPTER_ID} requires fetchJson and fetchBinary`);
      }
      const sourceStory = storyEntry.sourceStory;
      if (!sourceStory || !Array.isArray(sourceStory.variants)) {
        throw new TypeError('catalog entry is missing its source story descriptor');
      }
      const media = createMediaAccumulator(corpusBaseUrl);
      const variants = sourceStory.gameId === 'kana-okaeri'
        ? await loadKanaStory({
          sourceStory,
          io,
          corpusBaseUrl,
          media,
          fetchSharedJson: (url) => fetchSharedJson(io, url),
        })
        : await loadMajiroStory({
          sourceStory,
          io,
          corpusBaseUrl,
          media,
          fetchSharedJson: (url) => fetchSharedJson(io, url),
        });
      const story = {
        schema: 'adv-story/v1',
        corpusId: corpus.corpusId,
        canonicalStoryId: storyEntry.canonicalStoryId,
        adapterId: RESEARCH_READER_ADAPTER_ID,
        revision: `story-${hashId(`${sourceStory.canonicalStoryId}:${sourceStory.preferredVariantId}`)}`,
        title: sourceStory.displayTitle,
        provenance: {
          engine: sourceStory.gameId === 'kana-okaeri' ? 'ikura' : 'majiro',
          sourceSchema: RESEARCH_READER_MANIFEST_SCHEMA,
          sourceCanonicalStoryId: sourceStory.canonicalStoryId,
          sourceGameId: sourceStory.gameId,
          sourceVariantCount: sourceStory.variants.length,
        },
        variants,
      };
      story.embeddedMedia = validateMediaManifest({
        schema: 'adv-media/v1',
        revision: `media-${hashId(sourceStory.canonicalStoryId)}`,
        resolverId: 'research-media-v1',
        entries: [...media.entries.values()],
      });
      return validateStoryDocument(story);
    },
  });
}
