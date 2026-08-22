import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateMediaManifest,
  validateStoryDocument,
} from '../packages/contracts/src/index.js';
import {
  MAJIRO_PRODUCTION_ADAPTER_ID,
} from '../packages/adapters/src/majiro-production-v1.js';
import {
  ImportMediaRegistry,
  basenameWithoutExtension,
  buildMajiroLogicalGroups,
  lineEventId,
  mediaKindForRole,
  normalizeText,
  parseArguments,
  readJson,
  safeIdPart,
} from './lib/import-utils.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_RESOURCE_ROOT = path.resolve(repositoryRoot, '..', 'narcissu-kana-research');
const STORY_DEFINITIONS = [
  {
    canonicalStoryId: 'narcissu-3rd/nard14',
    slug: 'nard14',
    title: 'Narcissu 3rd · nard14',
    sectionTitle: 'nard14 · 7階行き前日',
    expectedSourceTextEvents: 32,
    expectedLogicalLines: 30,
  },
  {
    canonicalStoryId: 'narcissu-3rd/nar3_01',
    slug: 'nar3_01',
    title: 'Narcissu 3rd · nar3_01',
    sectionTitle: 'nar3_01 · イリス編',
    expectedSourceTextEvents: 524,
  },
];
const READER_MANIFEST = 'manifests/generated/reader-adapter.json';
const PLAYBACK_MANIFEST = 'manifests/generated/playback-media.json';
const RESOLVER_ID = 'narcissu3-manifest';
const isTransitionImageKey = (key) => /^(?:b\d*|w\d*|n3d_ck_|rule)/iu.test(key);

const chooseNarcissu3Image = (paths) => [...paths].sort((left, right) => {
  const score = (value) => {
    if (value.includes('/data1.arc.unpacked/')) return 0;
    if (value.includes('/fastdata.arc.unpacked/')) return 1;
    if (value.includes('/update.arc.unpacked/')) return 2;
    return 3;
  };
  return score(left) - score(right) || left.localeCompare(right);
})[0];

const createRouter = ({ playback, resourceRoot, namespace }) => {
  const audioByPath = new Map(playback.audio.map((record) => [record.path, record]));
  const audioByStem = new Map();
  for (const [stem, paths] of Object.entries(playback.audioById)) {
    audioByStem.set(stem.toLocaleLowerCase(), paths);
  }
  const imageByStem = new Map();
  for (const record of playback.images.filter((item) =>
    item.path.startsWith('derived/images/narcissu3/'))) {
    const stem = basenameWithoutExtension(record.path).toLocaleLowerCase();
    if (!imageByStem.has(stem)) imageByStem.set(stem, []);
    imageByStem.get(stem).push(record.path);
  }
  const media = new ImportMediaRegistry({
    namespace,
    resolverId: RESOLVER_ID,
    resourceRoot,
  });

  const resolveOperand = async (key) => {
    const routes = [];
    const folded = key.toLocaleLowerCase();
    const audioPath = (audioByStem.get(folded) ?? []).find((candidate) =>
      candidate.startsWith('raw/narcissu3/'));
    if (audioPath) {
      const kind = mediaKindForRole(audioByPath.get(audioPath)?.role);
      if (!kind) throw new Error(`unroutable Narcissu 3 audio role for ${key}`);
      routes.push({
        key,
        kind,
        playbackPath: audioPath,
        mediaId: await media.register({ key, kind, playbackPath: audioPath }),
      });
    }
    const imageCandidates = imageByStem.get(folded) ?? [];
    if (imageCandidates.length > 0) {
      const playbackPath = chooseNarcissu3Image(imageCandidates);
      routes.push({
        key,
        kind: 'image',
        playbackPath,
        mediaId: await media.register({ key, kind: 'image', playbackPath }),
        candidates: imageCandidates,
      });
    }
    return routes;
  };

  return {
    media,
    async route({ strings, groups, sourceStringPath }) {
      const buckets = Array.from({ length: groups.length + 1 }, () => []);
      const unresolved = [];
      let commandCount = 0;
      for (const operand of strings.strings.filter((entry) => entry.mnemonic === 'ldstr')) {
        const routes = await resolveOperand(operand.text);
        if (routes.length === 0) {
          unresolved.push({ key: operand.text, codeOffset: operand.codeOffset });
          continue;
        }
        commandCount += 1;
        const nextGroupIndex = groups.findIndex((group) => group.startOffset > operand.codeOffset);
        const targetIndex = nextGroupIndex === -1 ? groups.length : nextGroupIndex;
        const targetEventId = targetIndex === groups.length ? 'end-001' : lineEventId(targetIndex);
        for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
          const route = routes[routeIndex];
          buckets[targetIndex].push({
            cueId: `${route.kind}:${targetEventId}:${safeIdPart(route.key)}:${operand.codeOffset}:${routeIndex + 1}`,
            kind: route.kind,
            timing: route.kind === 'image' || route.kind === 'bgm' ? 'scene' : 'utterance',
            mediaId: route.mediaId,
            resolverId: RESOLVER_ID,
            raw: {
              sourceKey: route.key,
              codeOffset: operand.codeOffset,
              sourceStringPath,
              playbackPath: route.playbackPath,
              ...(route.kind === 'image'
                ? { presentationRole: isTransitionImageKey(route.key) ? 'transition' : 'scene' }
                : {}),
              ...(route.candidates?.length > 1
                ? { losslessCandidates: route.candidates, selectedLayer: 'base-scenario' }
                : {}),
            },
          });
        }
      }
      return { buckets, unresolved, commandCount };
    },
  };
};

const buildVariant = ({ definition, source, script, groups, routing }) => {
  const events = groups.map((group, groupIndex) => {
    const eventId = lineEventId(groupIndex);
    const event = {
      eventId,
      kind: 'line',
      text: { 'ja-JP': normalizeText(script.textEvents[group.textIndex].text) },
      nextEventId: groupIndex + 1 < groups.length ? lineEventId(groupIndex + 1) : 'end-001',
      cues: routing.buckets[groupIndex],
      source: {
        engine: 'majiro',
        variantSourceId: source.id,
        scriptPath: source.references.script,
        textEventIndices: group.sourceIndices,
        codeOffsets: group.sourceIndices.map((index) => script.textEvents[index].codeOffset),
        textCodeOffset: script.textEvents[group.textIndex].codeOffset,
        mjoAnchor: `mjo-${script.textEvents[group.textIndex].codeOffset.toString(16)}`,
      },
    };
    if (group.speakerIndex !== null) {
      event.speaker = {
        'ja-JP': normalizeText(script.textEvents[group.speakerIndex].text, { trim: true }),
      };
    }
    if (event.cues.length === 0) delete event.cues;
    return event;
  });
  const end = { eventId: 'end-001', kind: 'end', cues: routing.buckets.at(-1) };
  if (end.cues.length === 0) delete end.cues;
  events.push(end);
  return {
    variantId: `narcissu3/${definition.slug}/ja`,
    locales: ['ja-JP'],
    sections: [{
      sectionId: 'main',
      title: { 'ja-JP': definition.sectionTitle },
      entryEventId: 'line-001',
      events,
    }],
  };
};

const importStory = async ({ definition, reader, playback, resourceRoot }) => {
  const sourceStory = reader.stories.find((story) =>
    story.canonicalStoryId === definition.canonicalStoryId);
  if (!sourceStory) throw new Error(`source story not found: ${definition.canonicalStoryId}`);
  const source = sourceStory.variants.find((variant) =>
    variant.layer === 'base-scenario' && variant.sourceLocale === 'ja-JP');
  if (!source) throw new Error('reader-ready Narcissu 3 Japanese scenario was not found');
  const script = await readJson(resourceRoot, source.references.script);
  const strings = await readJson(resourceRoot, source.references.strings);
  const groups = buildMajiroLogicalGroups(script.textEvents);
  if (script.textEvents.length !== definition.expectedSourceTextEvents
    || (definition.expectedLogicalLines && groups.length !== definition.expectedLogicalLines)) {
    throw new Error(`${definition.slug} grouping changed: ${script.textEvents.length}/${groups.length}`);
  }
  const router = createRouter({
    playback,
    resourceRoot,
    namespace: `n3.${definition.slug}.ja`,
  });
  const routing = await router.route({
    strings,
    groups,
    sourceStringPath: source.references.strings,
  });
  if (routing.unresolved.length > 0) {
    throw new Error(`${definition.slug} contains unresolved ldstr operands: ${JSON.stringify(routing.unresolved)}`);
  }
  const story = validateStoryDocument({
    schema: 'adv-story/v1',
    corpusId: 'narcissu3',
    canonicalStoryId: definition.canonicalStoryId,
    adapterId: MAJIRO_PRODUCTION_ADAPTER_ID,
    revision: `${definition.slug}-${reader.bridgeRevision}`,
    title: definition.title,
    provenance: {
      engine: 'majiro',
      sourceSchema: 'vn-mjo-reader-script/v1',
      sourceRepository: 'narcissu-kana-research',
      sourceManifest: READER_MANIFEST,
      sourceBridgeRevision: reader.bridgeRevision,
      canonicalSourceStoryId: sourceStory.canonicalStoryId,
      extractionAccess: 'read-only',
    },
    variants: [buildVariant({ definition, source, script, groups, routing })],
  });
  const media = validateMediaManifest({
    schema: 'adv-media/v1',
    revision: `narcissu3-${definition.slug}-media-r1`,
    resolverId: RESOLVER_ID,
    entries: router.media.entries,
  });
  const roleCounts = Object.fromEntries(['voice', 'bgm', 'sfx', 'image'].map((role) => [
    role,
    media.entries.filter((entry) => entry.role === role).length,
  ]));
  const report = {
    schema: 'adv-import-report/v1',
    result: 'PASS',
    importer: 'tools/import-narcissu3.mjs',
    sourceRepository: 'narcissu-kana-research',
    sourceMount: '/corpus',
    sourceAccess: 'read-only',
    sourceBridgeRevision: reader.bridgeRevision,
    canonicalStoryId: definition.canonicalStoryId,
    generated: {
      variants: 1,
      sourceTextEvents: script.textEvents.length,
      logicalLines: groups.length,
      routedMediaCommands: routing.commandCount,
      mediaEntries: media.entries.length,
      mediaEntriesByRole: roleCounts,
    },
    unresolvedMediaKeys: [],
  };
  const outputRoot = path.join(repositoryRoot, 'apps', 'web', 'data', 'corpora', 'narcissu3');
  await mkdir(outputRoot, { recursive: true });
  for (const [filename, document] of [
    [`${definition.slug}.story.json`, story],
    [`${definition.slug}.media.json`, media],
    [`${definition.slug}.import-report.json`, report],
  ]) {
    await writeFile(path.join(outputRoot, filename), `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  }
  return {
    canonicalStoryId: definition.canonicalStoryId,
    variants: 1,
    lines: groups.length,
    mediaEntries: media.entries.length,
    roleCounts,
  };
};

const main = async () => {
  const { resourceRoot } = parseArguments(process.argv.slice(2), {
    resourceRoot: DEFAULT_RESOURCE_ROOT,
  });
  const reader = await readJson(resourceRoot, READER_MANIFEST);
  const playback = await readJson(resourceRoot, PLAYBACK_MANIFEST);
  const stories = [];
  for (const definition of STORY_DEFINITIONS) {
    stories.push(await importStory({ definition, reader, playback, resourceRoot }));
  }
  console.log(JSON.stringify({ status: 'PASS', stories }, null, 2));
};

await main();
