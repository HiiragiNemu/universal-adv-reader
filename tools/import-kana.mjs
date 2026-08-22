import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateMediaManifest,
  validateStoryDocument,
} from '../packages/contracts/src/index.js';
import {
  IKURA_PRODUCTION_ADAPTER_ID,
} from '../packages/adapters/src/ikura-production-v1.js';
import {
  ImportMediaRegistry,
  basenameWithoutExtension,
  lineEventId,
  mediaKindForRole,
  normalizeText,
  parseArguments,
  readJson,
  safeIdPart,
} from './lib/import-utils.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_RESOURCE_ROOT = path.resolve(repositoryRoot, '..', 'narcissu-kana-research');
const READER_MANIFEST = 'manifests/generated/reader-adapter.json';
const PLAYBACK_MANIFEST = 'manifests/generated/playback-media.json';
const ROUTE_ROOT = 'manifests/generated/kana-route-diff';
const RESOLVER_ID = 'kana-manifest';
const STORIES = [
  {
    canonicalStoryId: 'kana-okaeri/ev494',
    scriptId: 'EV494',
    slug: 'ev494',
    title: 'KANA: Okaeri!! · EV494',
    sectionTitle: { 'zh-CN': '高等期 · 回到医院', 'ja-JP': '高等期・病院に戻って' },
    mode: 'narrative',
  },
  {
    canonicalStoryId: 'kana-okaeri/ev00',
    scriptId: 'EV00',
    slug: 'ev00',
    title: 'KANA: Okaeri!! · EV00',
    sectionTitle: { 'zh-CN': '开始 · 路线选择', 'ja-JP': 'はじまり・ルート選択' },
    mode: 'choice',
  },
];

const asciiTokens = (buffer) => [...buffer.toString('latin1')
  .matchAll(/[A-Za-z][A-Za-z0-9_.-]{2,}/gu)].map((match) => match[0]);

const createMediaIndex = (playback) => {
  const byStem = new Map();
  const add = (stem, record) => {
    const folded = stem.toLocaleLowerCase();
    if (!byStem.has(folded)) byStem.set(folded, []);
    byStem.get(folded).push(record);
  };
  for (const record of playback.audio.filter((item) => item.path.startsWith('raw/kana/'))) {
    const kind = mediaKindForRole(record.role);
    if (kind) add(basenameWithoutExtension(record.path), { kind, path: record.path });
  }
  for (const record of playback.images.filter((item) =>
    item.path.startsWith('derived/images/kana/'))) {
    add(basenameWithoutExtension(record.path), { kind: 'image', path: record.path });
  }
  return {
    match(buffer, allowedKinds = null) {
      const hits = [];
      for (const token of asciiTokens(buffer)) {
        const stem = basenameWithoutExtension(token).toLocaleLowerCase();
        for (const record of byStem.get(stem) ?? []) {
          if (!allowedKinds || allowedKinds.has(record.kind)) hits.push({ token, ...record });
        }
      }
      return hits;
    },
  };
};

const instructionOperand = (document, bytecode, instructionIndex) => {
  const instruction = document.instructions[instructionIndex];
  return bytecode.subarray(
    instruction.operandOffset,
    instruction.operandOffset + instruction.operandLength,
  );
};

const normalBoundary = (route) => {
  const transfers = route.crossScriptTransfers.filter((item) =>
    item.kind === 'load-script' && item.jaTargetScript.toLocaleLowerCase() === 'title');
  return transfers.length > 0
    ? Math.min(...transfers.map((item) => item.sourceInstructionIndex))
    : route.summary.instructionPairs;
};

const storyAlignments = (route) => {
  const boundary = normalBoundary(route);
  return route.textAlignments.filter((item) => item.instructionIndex < boundary);
};

const sourceForAlignment = (alignment, routeRecordPath) => ({
  engine: 'ikura',
  routeRecordPath,
  instructionIndex: alignment.instructionIndex,
  opcode: alignment.opcode,
  status: alignment.status,
  instructionOffsets: {
    'zh-CN': alignment.zhOffset,
    'ja-JP': alignment.jaOffset,
  },
  anchors: {
    'zh-CN': `ikura-${alignment.zhOffset.toString(16)}`,
    'ja-JP': `ikura-${alignment.jaOffset.toString(16)}`,
  },
});

const localizedForMode = (alignment, mode) => {
  if (mode === 'zh-ja') {
    return {
      'zh-CN': normalizeText(alignment.zhText),
      'ja-JP': normalizeText(alignment.jaText),
    };
  }
  if (mode === 'ja') return { 'ja-JP': normalizeText(alignment.jaText) };
  return { 'zh-CN': normalizeText(alignment.zhText) };
};

const speakerForMode = (alignment, mode) => {
  const parse = (text) => {
    const match = String(text ?? '').match(/^([^：「\n]{1,16})：「/u);
    return match ? normalizeText(match[1], { trim: true }) : '';
  };
  const values = {};
  if (mode !== 'ja') {
    const speaker = parse(alignment.zhText);
    if (speaker) values['zh-CN'] = speaker;
  }
  if (mode !== 'zh') {
    const speaker = parse(alignment.jaText);
    if (speaker) values['ja-JP'] = speaker;
  }
  return Object.keys(values).length > 0 ? values : null;
};

const routeMedia = async ({
  definition,
  route,
  japaneseDocument,
  japaneseBytecode,
  alignments,
  mediaIndex,
  resourceRoot,
}) => {
  const media = new ImportMediaRegistry({
    namespace: `kana.${definition.slug}`,
    resolverId: RESOLVER_ID,
    resourceRoot,
  });
  const eventIds = definition.mode === 'choice'
    ? ['line-001', 'choice-001']
    : alignments.map((_, index) => lineEventId(index));
  const buckets = Array.from({ length: eventIds.length + 1 }, () => []);
  const boundary = normalBoundary(route);
  let voiceCueCount = 0;
  let routedCallCount = 0;

  const targetForSource = (instructionIndex) => {
    if (definition.mode === 'choice') {
      const labelIndices = alignments.filter((item) => item.kind === 'localized-label')
        .map((item) => item.instructionIndex);
      if (labelIndices.length > 0 && instructionIndex >= Math.min(...labelIndices)) return 1;
      return instructionIndex < alignments[0].instructionIndex ? 0 : buckets.length - 1;
    }
    const next = alignments.findIndex((item) => item.instructionIndex > instructionIndex);
    return next === -1 ? buckets.length - 1 : next;
  };

  const addCue = async ({ bucketIndex, key, kind, playbackPath, source }) => {
    const targetEventId = bucketIndex === buckets.length - 1 ? 'end-001' : eventIds[bucketIndex];
    const cueId = `${kind}:${targetEventId}:${safeIdPart(key)}:${source.instructionIndex}`;
    if (buckets[bucketIndex].some((item) => item.cueId === cueId)) return;
    buckets[bucketIndex].push({
      cueId,
      kind,
      timing: kind === 'image' || kind === 'bgm' ? 'scene' : 'utterance',
      mediaId: await media.register({ key, kind, playbackPath }),
      resolverId: RESOLVER_ID,
      raw: {
        sourceKey: key,
        playbackPath,
        routeRecordPath: `${ROUTE_ROOT}/scripts/${definition.scriptId}.json`,
        ...source,
      },
    });
  };

  for (let alignmentIndex = 0; alignmentIndex < alignments.length; alignmentIndex += 1) {
    const alignment = alignments[alignmentIndex];
    const operand = instructionOperand(
      japaneseDocument,
      japaneseBytecode,
      alignment.instructionIndex,
    );
    const voices = mediaIndex.match(operand, new Set(['voice']));
    for (const voice of voices) {
      const bucketIndex = definition.mode === 'choice' ? 0 : alignmentIndex;
      await addCue({
        bucketIndex,
        key: voice.token,
        kind: 'voice',
        playbackPath: voice.path,
        source: {
          instructionIndex: alignment.instructionIndex,
          jaInstructionOffset: alignment.jaOffset,
          zhInstructionOffset: alignment.zhOffset,
          opcode: alignment.opcode,
          routeTopologyEqual: route.summary.routeTopologyEqual,
        },
      });
      voiceCueCount += 1;
    }
  }

  for (const transfer of route.localTransfers.filter((item) =>
    item.kind === 'call' && item.sourceInstructionIndex < boundary)) {
    const hits = [];
    for (let index = transfer.targetInstructionIndex;
      index < Math.min(japaneseDocument.instructions.length, transfer.targetInstructionIndex + 10);
      index += 1) {
      const instruction = japaneseDocument.instructions[index];
      const allowedKinds = instruction.opcode === 0x56
        ? new Set(['image'])
        : instruction.opcode === 0x70
          ? new Set(['bgm', 'sfx'])
          : new Set();
      if (allowedKinds.size > 0) {
        hits.push(...mediaIndex.match(
          instructionOperand(japaneseDocument, japaneseBytecode, index),
          allowedKinds,
        ));
      }
      if ([0x04, 0x06].includes(instruction.opcode) && index > transfer.targetInstructionIndex) {
        break;
      }
    }
    if (hits.length === 0) continue;
    routedCallCount += 1;
    const bucketIndex = targetForSource(transfer.sourceInstructionIndex);
    for (const hit of hits) {
      await addCue({
        bucketIndex,
        key: hit.token,
        kind: hit.kind,
        playbackPath: hit.path,
        source: {
          instructionIndex: transfer.sourceInstructionIndex,
          jaInstructionOffset: transfer.jaSourceOffset,
          zhInstructionOffset: transfer.zhSourceOffset,
          opcode: transfer.sourceOpcode,
          targetInstructionIndex: transfer.targetInstructionIndex,
          targetJaOffset: transfer.jaTargetOffset,
          targetZhOffset: transfer.zhTargetOffset,
          routeTopologyEqual: route.summary.routeTopologyEqual,
        },
      });
    }
  }
  return { media, buckets, voiceCueCount, routedCallCount, boundary };
};

const buildNarrativeVariant = ({ definition, alignments, routing, mode }) => {
  const events = alignments.map((alignment, index) => {
    const event = {
      eventId: lineEventId(index),
      kind: 'line',
      text: localizedForMode(alignment, mode),
      nextEventId: index + 1 < alignments.length ? lineEventId(index + 1) : 'end-001',
      cues: routing.buckets[index],
      source: sourceForAlignment(
        alignment,
        `${ROUTE_ROOT}/scripts/${definition.scriptId}.json`,
      ),
    };
    const speaker = speakerForMode(alignment, mode);
    if (speaker) event.speaker = speaker;
    if (event.cues.length === 0) delete event.cues;
    return event;
  });
  const end = { eventId: 'end-001', kind: 'end', cues: routing.buckets.at(-1) };
  if (end.cues.length === 0) delete end.cues;
  events.push(end);
  const locales = mode === 'zh-ja' ? ['zh-CN', 'ja-JP'] : [mode === 'ja' ? 'ja-JP' : 'zh-CN'];
  return {
    variantId: `kana/${definition.slug}/${mode}`,
    locales,
    sections: [{
      sectionId: 'main',
      title: Object.fromEntries(Object.entries(definition.sectionTitle)
        .filter(([locale]) => locales.includes(locale))),
      entryEventId: 'line-001',
      events,
    }],
  };
};

const buildChoiceVariant = ({ definition, alignments, route, routing, mode }) => {
  const title = alignments.find((item) => item.kind === 'title');
  const labels = alignments.filter((item) => item.kind === 'localized-label');
  if (!title || labels.length !== 2) throw new Error('EV00 choice labels changed');
  const selectorGroups = new Map();
  for (const transfer of route.localTransfers.filter((item) => item.kind === 'indexed-jump')) {
    if (!selectorGroups.has(transfer.sourceInstructionIndex)) {
      selectorGroups.set(transfer.sourceInstructionIndex, []);
    }
    selectorGroups.get(transfer.sourceInstructionIndex).push(transfer);
  }
  const selector = [...selectorGroups.entries()].find(([instructionIndex, arms]) =>
    instructionIndex > labels.at(-1).instructionIndex && arms.length >= 3);
  if (!selector) throw new Error('EV00 indexed choice selector was not found');
  const [selectorInstructionIndex, arms] = selector;
  const choiceArms = arms.filter((item) => item.armIndex > 0).slice(0, labels.length);
  const locales = mode === 'zh-ja' ? ['zh-CN', 'ja-JP'] : [mode === 'ja' ? 'ja-JP' : 'zh-CN'];
  const line = {
    eventId: 'line-001',
    kind: 'line',
    text: localizedForMode(title, mode),
    nextEventId: 'choice-001',
    cues: routing.buckets[0],
    source: sourceForAlignment(title, `${ROUTE_ROOT}/scripts/${definition.scriptId}.json`),
  };
  if (line.cues.length === 0) delete line.cues;
  const choice = {
    eventId: 'choice-001',
    kind: 'choice',
    choices: labels.map((label, index) => ({
      choiceId: `route-${index + 1}`,
      label: localizedForMode(label, mode),
      nextEventId: `branch-${String(index + 1).padStart(3, '0')}-end`,
    })),
    cues: routing.buckets[1].filter((cue) =>
      cue.raw.instructionIndex <= selectorInstructionIndex),
    source: {
      engine: 'ikura',
      routeRecordPath: `${ROUTE_ROOT}/scripts/${definition.scriptId}.json`,
      selectorInstructionIndex,
      selectorOpcode: arms[0].sourceOpcode,
      labels: labels.map((label) => sourceForAlignment(
        label,
        `${ROUTE_ROOT}/scripts/${definition.scriptId}.json`,
      )),
      arms: arms.map((arm) => ({
        armIndex: arm.armIndex,
        pointerIndex: arm.pointerIndex,
        targetInstructionIndex: arm.targetInstructionIndex,
        jaTargetOffset: arm.jaTargetOffset,
        zhTargetOffset: arm.zhTargetOffset,
      })),
      routeTopologyEqual: route.summary.routeTopologyEqual,
    },
  };
  if (choice.cues.length === 0) delete choice.cues;
  const ends = choiceArms.map((arm, index) => ({
    eventId: `branch-${String(index + 1).padStart(3, '0')}-end`,
    kind: 'end',
    source: {
      engine: 'ikura',
      selectorInstructionIndex,
      armIndex: arm.armIndex,
      pointerIndex: arm.pointerIndex,
      targetInstructionIndex: arm.targetInstructionIndex,
      jaTargetOffset: arm.jaTargetOffset,
      zhTargetOffset: arm.zhTargetOffset,
    },
  }));
  const runtimeArm = arms.find((item) => item.armIndex === 0);
  const runtimeEnd = {
    eventId: 'runtime-error-end',
    kind: 'end',
    source: {
      engine: 'ikura',
      hiddenInternalArm: true,
      selectorInstructionIndex,
      armIndex: runtimeArm.armIndex,
      pointerIndex: runtimeArm.pointerIndex,
      targetInstructionIndex: runtimeArm.targetInstructionIndex,
      jaTargetOffset: runtimeArm.jaTargetOffset,
      zhTargetOffset: runtimeArm.zhTargetOffset,
    },
  };
  const terminalCues = [
    ...routing.buckets[1].filter((cue) => cue.raw.instructionIndex > selectorInstructionIndex),
    ...routing.buckets.at(-1),
  ];
  if (terminalCues.length > 0) {
    for (const end of ends) end.cues = terminalCues;
  }
  return {
    variantId: `kana/${definition.slug}/${mode}`,
    locales,
    sections: [{
      sectionId: 'main',
      title: Object.fromEntries(Object.entries(definition.sectionTitle)
        .filter(([locale]) => locales.includes(locale))),
      entryEventId: 'line-001',
      events: [line, choice, ...ends, runtimeEnd],
    }],
  };
};

const importStory = async ({ definition, reader, playback, resourceRoot }) => {
  const sourceStory = reader.stories.find((story) =>
    story.canonicalStoryId === definition.canonicalStoryId);
  if (!sourceStory) throw new Error(`source story not found: ${definition.canonicalStoryId}`);
  const japanese = sourceStory.variants.find((variant) => variant.sourceLocale === 'ja-JP');
  const chinese = sourceStory.variants.find((variant) => variant.sourceLocale === 'zh-CN');
  if (!japanese || !chinese) throw new Error(`${definition.scriptId} bilingual pair was not found`);
  const routeRecordPath = `${ROUTE_ROOT}/scripts/${definition.scriptId}.json`;
  const [route, japaneseDocument, chineseDocument, japaneseBytecode] = await Promise.all([
    readJson(resourceRoot, routeRecordPath),
    readJson(resourceRoot, japanese.references.script),
    readJson(resourceRoot, chinese.references.script),
    readFile(path.join(resourceRoot, japanese.references.bytecode)),
  ]);
  if (route.summary.result !== 'PASS' || !route.summary.routeTopologyEqual) {
    throw new Error(`${definition.scriptId} route evidence is not exact`);
  }
  if (japaneseDocument.instructions.length !== chineseDocument.instructions.length) {
    throw new Error(`${definition.scriptId} instruction pair length differs`);
  }
  const alignments = storyAlignments(route);
  const mediaIndex = createMediaIndex(playback);
  const routing = await routeMedia({
    definition,
    route,
    japaneseDocument,
    japaneseBytecode,
    alignments,
    mediaIndex,
    resourceRoot,
  });
  const variants = ['zh-ja', 'ja', 'zh'].map((mode) => definition.mode === 'choice'
    ? buildChoiceVariant({ definition, alignments, route, routing, mode })
    : buildNarrativeVariant({ definition, alignments, routing, mode }));
  const story = validateStoryDocument({
    schema: 'adv-story/v1',
    corpusId: 'kana',
    canonicalStoryId: definition.canonicalStoryId,
    adapterId: IKURA_PRODUCTION_ADAPTER_ID,
    revision: `${definition.slug}-${reader.bridgeRevision}`,
    title: definition.title,
    provenance: {
      engine: 'ikura',
      sourceSchema: 'vn-ikura-script/v1',
      routeSchema: route.schema,
      sourceRepository: 'narcissu-kana-research',
      sourceManifest: READER_MANIFEST,
      routeRecord: routeRecordPath,
      sourceBridgeRevision: reader.bridgeRevision,
      canonicalSourceStoryId: sourceStory.canonicalStoryId,
      extractionAccess: 'read-only',
      routeTopologyEqual: true,
    },
    variants,
  });
  const media = validateMediaManifest({
    schema: 'adv-media/v1',
    revision: `kana-${definition.slug}-media-r1`,
    resolverId: RESOLVER_ID,
    entries: routing.media.entries,
  });
  const roleCounts = Object.fromEntries(['voice', 'bgm', 'sfx', 'image'].map((role) => [
    role,
    media.entries.filter((entry) => entry.role === role).length,
  ]));
  const report = {
    schema: 'adv-import-report/v1',
    result: 'PASS',
    importer: 'tools/import-kana.mjs',
    sourceRepository: 'narcissu-kana-research',
    sourceMount: '/corpus',
    sourceAccess: 'read-only',
    sourceBridgeRevision: reader.bridgeRevision,
    canonicalStoryId: definition.canonicalStoryId,
    generated: {
      variants: variants.length,
      routeMode: definition.mode,
      normalTextAlignments: alignments.length,
      hiddenInternalTextAlignments: route.textAlignments.length - alignments.length,
      normalInstructionBoundary: routing.boundary,
      exactLocalTransfers: route.summary.localTransferCount,
      exactCrossScriptTransfers: route.summary.crossScriptTransferCount,
      voiceCues: routing.voiceCueCount,
      routedMediaCalls: routing.routedCallCount,
      mediaEntries: media.entries.length,
      mediaEntriesByRole: roleCounts,
      ...(definition.mode === 'choice' ? { preservedUserChoices: 2, preservedSelectorArms: 3 } : {}),
    },
    routeVerification: {
      opcodeSequenceEqual: route.summary.opcodeSequenceEqual,
      pointerTargetOrdinalEqual: route.summary.pointerTargetOrdinalEqual,
      routeTopologyEqual: route.summary.routeTopologyEqual,
      nonTextOperandDifferenceCount: route.summary.nonTextOperandDifferenceCount,
      mixedByteMarkerCount: route.summary.mixedByteMarkerCount,
    },
    unresolvedMediaKeys: [],
  };
  const outputRoot = path.join(repositoryRoot, 'apps', 'web', 'data', 'corpora', 'kana');
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
    mode: definition.mode,
    variants: variants.length,
    alignments: alignments.length,
    mediaEntries: media.entries.length,
    roleCounts,
  };
};

const main = async () => {
  const { resourceRoot } = parseArguments(process.argv.slice(2), {
    resourceRoot: DEFAULT_RESOURCE_ROOT,
  });
  const [reader, playback] = await Promise.all([
    readJson(resourceRoot, READER_MANIFEST),
    readJson(resourceRoot, PLAYBACK_MANIFEST),
  ]);
  const stories = [];
  for (const definition of STORIES) {
    stories.push(await importStory({ definition, reader, playback, resourceRoot }));
  }
  console.log(JSON.stringify({ status: 'PASS', stories }, null, 2));
};

await main();
