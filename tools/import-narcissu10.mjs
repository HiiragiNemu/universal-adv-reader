import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateMediaManifest,
  validateStoryDocument,
} from '../packages/contracts/src/index.js';
import {
  MAJIRO_PRODUCTION_ADAPTER_ID,
} from '../packages/adapters/src/majiro-production-v1.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_RESOURCE_ROOT = path.resolve(repositoryRoot, '..', 'narcissu-kana-research');
const DEFAULT_STORY_ID = 'narcissu-himeko/himeko_ep00';
const READER_MANIFEST = 'manifests/generated/reader-adapter.json';
const PLAYBACK_MANIFEST = 'manifests/generated/playback-media.json';
const MEDIA_VIEW_MANIFEST = 'manifests/generated/narcissu10-media-view.json';
const RESOLVER_ID = 'narcissu10-manifest';

const parseArguments = (values) => {
  const result = { resourceRoot: DEFAULT_RESOURCE_ROOT, storyId: DEFAULT_STORY_ID };
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    const value = values[index + 1];
    if (flag === '--resource' && value) {
      result.resourceRoot = path.resolve(value);
      index += 1;
    } else if (flag === '--story' && value) {
      result.storyId = value;
      index += 1;
    } else {
      throw new TypeError(`unknown or incomplete argument: ${flag}`);
    }
  }
  return result;
};

const readJson = async (resourceRoot, relativePath) => JSON.parse(await readFile(
  path.join(resourceRoot, relativePath),
  'utf8',
));

const normalizeText = (value, { trim = false } = {}) => {
  const normalized = String(value ?? '').replace(/\r\n?/gu, '\n');
  return trim ? normalized.trim() : normalized;
};

const isDialogue = (value) => /^[\s]*[「『（("“]/u.test(value);

const buildLogicalGroups = (textEvents) => {
  const groups = [];
  for (let index = 0; index < textEvents.length; index += 1) {
    const current = textEvents[index];
    const next = textEvents[index + 1];
    const speakerPair = next
      && !isDialogue(current.text)
      && !current.text.includes('\n')
      && current.text.length <= 24
      && isDialogue(next.text);
    if (speakerPair) {
      groups.push({
        sourceIndices: [index, index + 1],
        speakerIndex: index,
        textIndex: index + 1,
        startOffset: current.codeOffset,
      });
      index += 1;
    } else {
      groups.push({
        sourceIndices: [index],
        speakerIndex: null,
        textIndex: index,
        startOffset: current.codeOffset,
      });
    }
  }
  return groups;
};

const basenameWithoutExtension = (value) => {
  const filename = value.replaceAll('\\', '/').split('/').at(-1) ?? '';
  const extension = path.posix.extname(filename);
  return extension ? filename.slice(0, -extension.length) : filename;
};

const safeIdPart = (value) => {
  const output = [...String(value)].map((character) =>
    /[A-Za-z0-9_.-]/u.test(character)
      ? character
      : `x${character.codePointAt(0).toString(16)}`).join('');
  return output || 'asset';
};

const mimeTypeForPath = (value) => {
  const extension = path.posix.extname(value).toLowerCase();
  return new Map([
    ['.ogg', 'audio/ogg'],
    ['.wav', 'audio/wav'],
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.webp', 'image/webp'],
  ]).get(extension) ?? 'application/octet-stream';
};

const sourceRootForLocale = (locale) => locale === 'en'
  ? 'raw/narcissu10-original/narci_himeko/'
  : 'raw/narcissu10-original-ja-JP/narci_himeko/';

const mediaKindForAudioRole = (role) => new Map([
  ['voice', 'voice'],
  ['music', 'bgm'],
  ['sound-effect', 'sfx'],
]).get(role) ?? null;

const createMediaRouter = ({ playback, mediaView, resourceRoot }) => {
  const audioByPath = new Map(playback.audio.map((record) => [record.path, record]));
  const entries = new Map();

  const registerEntry = async ({ locale, key, kind, playbackPath }) => {
    const localeTag = locale === 'en' ? 'en' : 'ja';
    const mediaId = `n10.${localeTag}.${kind}.${safeIdPart(key)}`;
    const url = playbackPath.startsWith('archive/')
      ? `/corpus/${playbackPath}`
      : `/corpus/archive/${playbackPath}`;
    const entry = {
      mediaId,
      role: kind,
      url,
      mimeType: mimeTypeForPath(playbackPath),
    };
    const existing = entries.get(mediaId);
    if (existing && existing.url !== entry.url) {
      throw new Error(`media ID collision for ${mediaId}`);
    }
    if (!existing) {
      const repositoryPath = url.slice('/corpus/'.length);
      await access(path.join(resourceRoot, repositoryPath));
      entries.set(mediaId, entry);
    }
    return mediaId;
  };

  const resolveOperand = async (locale, key) => {
    const resolved = [];
    const sourceRoot = sourceRootForLocale(locale);
    const audioPath = (playback.audioById[key] ?? []).find((candidate) =>
      candidate.startsWith(sourceRoot));
    if (audioPath) {
      const audioRecord = audioByPath.get(audioPath);
      const kind = mediaKindForAudioRole(audioRecord?.role);
      if (!kind) throw new Error(`audio role is not routable for ${key}: ${audioRecord?.role}`);
      resolved.push({
        key,
        kind,
        mediaId: await registerEntry({ locale, key, kind, playbackPath: audioPath }),
        playbackPath: audioPath,
      });
    }

    const imageRecord = mediaView.files.find((record) =>
      record.locale === locale
      && record.game === 'narci_himeko'
      && record.kind === 'image'
      && basenameWithoutExtension(record.canonicalPlaybackPath) === key);
    if (imageRecord) {
      resolved.push({
        key,
        kind: 'image',
        mediaId: await registerEntry({
          locale,
          key,
          kind: 'image',
          playbackPath: imageRecord.canonicalPlaybackPath,
        }),
        playbackPath: imageRecord.canonicalPlaybackPath,
      });
    }
    return resolved;
  };

  return {
    entries,
    async routeVariant({ locale, sourceStrings, groups, sourceStringPath }) {
      const buckets = Array.from({ length: groups.length + 1 }, () => []);
      const unresolved = [];
      let commandCount = 0;
      for (const operand of sourceStrings.strings.filter((entry) => entry.mnemonic === 'ldstr')) {
        const routes = await resolveOperand(locale, operand.text);
        if (routes.length === 0) continue;
        commandCount += 1;
        const nextGroupIndex = groups.findIndex((group) => group.startOffset > operand.codeOffset);
        const targetIndex = nextGroupIndex === -1 ? groups.length : nextGroupIndex;
        for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
          const route = routes[routeIndex];
          const eventId = targetIndex === groups.length
            ? 'end-001'
            : `line-${String(targetIndex + 1).padStart(3, '0')}`;
          buckets[targetIndex].push({
            cueId: `${route.kind}:${eventId}:${safeIdPart(route.key)}:${routeIndex + 1}`,
            kind: route.kind,
            timing: ['image', 'bgm'].includes(route.kind) ? 'scene' : 'utterance',
            mediaId: route.mediaId,
            resolverId: RESOLVER_ID,
            raw: {
              sourceKey: route.key,
              codeOffset: operand.codeOffset,
              sourceStringPath,
              playbackPath: route.playbackPath,
            },
          });
        }
      }
      return { buckets, unresolved, commandCount };
    },
  };
};

const variantTextRecord = (variant, script, translationByOffset, eventIndex) => {
  const event = script.textEvents[eventIndex];
  if (variant.outputId.endsWith('/zh-ja')) {
    const translation = translationByOffset.get(event.codeOffset);
    if (translation === undefined) throw new Error(`missing exact translation at ${event.codeOffset}`);
    return {
      'zh-CN': normalizeText(translation),
      'ja-JP': normalizeText(event.text),
    };
  }
  return { [variant.locales[0]]: normalizeText(event.text) };
};

const buildStoryVariant = ({ descriptor, loaded, groups, mediaRouting }) => {
  if (loaded.script.textEvents.length !== 24) {
    throw new Error(`${descriptor.outputId} expected 24 source text events`);
  }
  const translationByOffset = new Map(
    (loaded.script.translation?.entries ?? []).map((entry) => [
      entry.target.codeOffset,
      entry.displayText,
    ]),
  );
  const events = groups.map((group, groupIndex) => {
    const eventId = `line-${String(groupIndex + 1).padStart(3, '0')}`;
    const nextEventId = groupIndex + 1 < groups.length
      ? `line-${String(groupIndex + 2).padStart(3, '0')}`
      : 'end-001';
    const event = {
      eventId,
      kind: 'line',
      text: variantTextRecord(descriptor, loaded.script, translationByOffset, group.textIndex),
      nextEventId,
      cues: mediaRouting.buckets[groupIndex],
      source: {
        engine: 'majiro',
        variantSourceId: descriptor.source.id,
        scriptPath: descriptor.source.references.script,
        textEventIndices: group.sourceIndices,
        codeOffsets: group.sourceIndices.map((index) => loaded.script.textEvents[index].codeOffset),
        textCodeOffset: loaded.script.textEvents[group.textIndex].codeOffset,
        mjoAnchor: `mjo-${loaded.script.textEvents[group.textIndex].codeOffset.toString(16)}`,
      },
    };
    if (group.speakerIndex !== null) {
      const speaker = variantTextRecord(
        descriptor,
        loaded.script,
        translationByOffset,
        group.speakerIndex,
      );
      event.speaker = Object.fromEntries(Object.entries(speaker).map(([locale, value]) => [
        locale,
        normalizeText(value, { trim: true }),
      ]));
    }
    if (event.cues.length === 0) delete event.cues;
    return event;
  });
  const endEvent = { eventId: 'end-001', kind: 'end', cues: mediaRouting.buckets.at(-1) };
  if (endEvent.cues.length === 0) delete endEvent.cues;
  events.push(endEvent);

  return {
    variantId: descriptor.outputId,
    locales: descriptor.locales,
    sections: [{
      sectionId: 'main',
      title: descriptor.sectionTitle,
      entryEventId: 'line-001',
      events,
    }],
  };
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const readerManifest = await readJson(options.resourceRoot, READER_MANIFEST);
  if (options.storyId !== DEFAULT_STORY_ID) {
    throw new Error(`this production slice currently supports only ${DEFAULT_STORY_ID}`);
  }
  const sourceStory = readerManifest.stories.find((story) =>
    story.canonicalStoryId === options.storyId);
  if (!sourceStory) throw new Error(`source story not found: ${options.storyId}`);

  const japanese = sourceStory.variants.find((variant) =>
    variant.layer === 'base-scenario' && variant.sourceLocale === 'ja-JP');
  const english = sourceStory.variants.find((variant) =>
    variant.layer === 'base-scenario' && variant.sourceLocale === 'en');
  const bilingual = sourceStory.variants.find((variant) =>
    variant.layer === 'patch-source'
    && variant.translation?.locale === 'zh-CN'
    && variant.translation?.alignment === 'exact-bytecode-order');
  if (!japanese || !english || !bilingual) {
    throw new Error('required Japanese, English, and exact bilingual variants were not found');
  }

  const descriptors = [
    {
      outputId: 'narcissu10/himeko-ep00/zh-ja',
      locales: ['zh-CN', 'ja-JP'],
      assetLocale: 'ja-JP',
      source: bilingual,
      sectionTitle: { 'zh-CN': '姬子 EP00', 'ja-JP': '姫子 EP00' },
    },
    {
      outputId: 'narcissu10/himeko-ep00/ja',
      locales: ['ja-JP'],
      assetLocale: 'ja-JP',
      source: japanese,
      sectionTitle: { 'ja-JP': '姫子 EP00' },
    },
    {
      outputId: 'narcissu10/himeko-ep00/en',
      locales: ['en'],
      assetLocale: 'en',
      source: english,
      sectionTitle: { en: 'Himeko EP00' },
    },
  ];

  const loadedById = new Map();
  for (const descriptor of descriptors) {
    loadedById.set(descriptor.outputId, {
      script: await readJson(options.resourceRoot, descriptor.source.references.script),
      strings: await readJson(options.resourceRoot, descriptor.source.references.strings),
    });
  }
  const japaneseLoaded = loadedById.get('narcissu10/himeko-ep00/ja');
  const groups = buildLogicalGroups(japaneseLoaded.script.textEvents);
  if (groups.length !== 13) throw new Error(`logical grouping changed: expected 13, found ${groups.length}`);

  const playback = await readJson(options.resourceRoot, PLAYBACK_MANIFEST);
  const mediaView = await readJson(options.resourceRoot, MEDIA_VIEW_MANIFEST);
  const router = createMediaRouter({ playback, mediaView, resourceRoot: options.resourceRoot });
  const variants = [];
  const routeReports = [];
  for (const descriptor of descriptors) {
    const loaded = loadedById.get(descriptor.outputId);
    const variantGroups = buildLogicalGroups(loaded.script.textEvents);
    if (JSON.stringify(variantGroups.map((group) => group.sourceIndices))
      !== JSON.stringify(groups.map((group) => group.sourceIndices))) {
      throw new Error(`logical source grouping differs for ${descriptor.outputId}`);
    }
    const mediaRouting = await router.routeVariant({
      locale: descriptor.assetLocale,
      sourceStrings: loaded.strings,
      groups: variantGroups,
      sourceStringPath: descriptor.source.references.strings,
    });
    variants.push(buildStoryVariant({ descriptor, loaded, groups: variantGroups, mediaRouting }));
    routeReports.push({
      variantId: descriptor.outputId,
      sourceVariantId: descriptor.source.id,
      sourceTextEvents: loaded.script.textEvents.length,
      logicalLines: groups.length,
      routedMediaCommands: mediaRouting.commandCount,
      unresolvedMediaKeys: mediaRouting.unresolved,
    });
  }

  const story = validateStoryDocument({
    schema: 'adv-story/v1',
    corpusId: 'narcissu10',
    canonicalStoryId: options.storyId,
    adapterId: MAJIRO_PRODUCTION_ADAPTER_ID,
    revision: `himeko-ep00-${readerManifest.bridgeRevision}`,
    title: 'Narcissu 10th · Himeko EP00',
    provenance: {
      engine: 'majiro',
      sourceSchema: 'vn-mjo-reader-script/v1',
      sourceRepository: 'narcissu-kana-research',
      sourceManifest: READER_MANIFEST,
      sourceBridgeRevision: readerManifest.bridgeRevision,
      canonicalSourceStoryId: sourceStory.canonicalStoryId,
      extractionAccess: 'read-only',
    },
    variants,
  });
  const media = validateMediaManifest({
    schema: 'adv-media/v1',
    revision: 'narcissu10-himeko-ep00-media-r1',
    resolverId: RESOLVER_ID,
    entries: [...router.entries.values()].sort((left, right) =>
      left.mediaId.localeCompare(right.mediaId)),
  });

  const roleCounts = Object.fromEntries(
    ['voice', 'bgm', 'sfx', 'image'].map((role) => [
      role,
      media.entries.filter((entry) => entry.role === role).length,
    ]),
  );
  const report = {
    schema: 'adv-import-report/v1',
    result: 'PASS',
    importer: 'tools/import-narcissu10.mjs',
    sourceRepository: 'narcissu-kana-research',
    sourceMount: '/corpus',
    sourceAccess: 'read-only',
    sourceBridgeRevision: readerManifest.bridgeRevision,
    canonicalStoryId: sourceStory.canonicalStoryId,
    generated: {
      variants: story.variants.length,
      logicalLinesPerVariant: groups.length,
      totalLineEvents: groups.length * story.variants.length,
      mediaEntries: media.entries.length,
      mediaEntriesByRole: roleCounts,
    },
    variants: routeReports,
    unresolvedMediaKeys: routeReports.flatMap((record) => record.unresolvedMediaKeys),
  };
  if (report.unresolvedMediaKeys.length > 0) throw new Error('media routing contains unresolved keys');

  const outputRoot = path.join(repositoryRoot, 'apps', 'web', 'data', 'corpora', 'narcissu10');
  await mkdir(outputRoot, { recursive: true });
  const outputs = [
    ['himeko-ep00.story.json', story],
    ['himeko-ep00.media.json', media],
    ['himeko-ep00.import-report.json', report],
  ];
  for (const [filename, document] of outputs) {
    await writeFile(path.join(outputRoot, filename), `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify({
    status: 'PASS',
    canonicalStoryId: story.canonicalStoryId,
    variants: story.variants.length,
    linesPerVariant: groups.length,
    mediaEntries: media.entries.length,
    roleCounts,
    outputRoot,
  }, null, 2));
};

await main();
