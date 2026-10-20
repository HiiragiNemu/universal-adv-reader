import { spawnSync } from 'node:child_process';
import {
  copyFile,
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classicStoryIds } from './generate-classic-story-ids.mjs';
import { buildGenericSearchIndex } from './build-generic-search-index.mjs';
import { buildNativeEditSources } from './build-native-edit-sources.mjs';
import { computeContentPipelineRevision } from './lib/content-pipeline-revision.mjs';
import { readEffectiveReaderManifests } from './lib/content-selection-corrections.mjs';
import { buildNativeStoryGroups } from './lib/native-story-groups.mjs';
import { buildNarcissu3ProductNavigation } from './lib/narcissu3-product-navigation.mjs';
import { buildNarcissu3ChapterRelations, NARCISSU3_CHAPTER_RELATION_STORIES } from './lib/narcissu3-chapter-relations.mjs';
import { buildKanaNativePlan, kanaNarrativeOrderFromMainRoute } from './lib/kana-native-sections.mjs';

import {
  buildResearchCatalog,
  createResearchReaderAdapter,
} from '../packages/adapters/src/research-reader-v1.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpusRoot = path.resolve(
  process.env.ADV_CORPUS_REPOSITORY
    ?? path.resolve(repositoryRoot, '..', 'narcissu-kana-research'),
);
const optionValue = key => {
  const index = process.argv.indexOf(key);
  if (index < 0) return undefined;
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith('--')) throw Error(`Missing value for ${key}`);
  return process.argv[index + 1];
};
const publicRoot = path.resolve(
  optionValue('--output') ?? process.env.CLASSIC_READER_PUBLIC
    ?? path.join(repositoryRoot, 'apps', 'classic-reader', 'public'),
);
const expectedPublicRoot = path.join(repositoryRoot, 'apps', 'classic-reader', 'public');
const evidenceRoot = path.join(repositoryRoot, 'reports');
if (publicRoot !== expectedPublicRoot && !publicRoot.startsWith(evidenceRoot + path.sep)) {
  throw new TypeError('Classic output must be the existing public directory or a candidate inside this checkout reports directory');
}
const buildReportRoot = path.resolve(optionValue('--report-root')
  ?? path.join(repositoryRoot, 'reports/verification/content-repair-20261013/build'));
if (!buildReportRoot.startsWith(evidenceRoot + path.sep)) throw new TypeError('Build reports must stay inside this checkout reports directory');
await mkdir(buildReportRoot, { recursive: true });

const localResourcePath = (url) => {
  if (!url.startsWith('/corpus/')) throw new TypeError(`unexpected corpus URL: ${url}`);
  const candidate = path.resolve(
    corpusRoot,
    ...decodeURIComponent(url.slice('/corpus/'.length)).split('/'),
  );
  const prefix = `${corpusRoot}${path.sep}`;
  if (candidate !== corpusRoot && !candidate.startsWith(prefix)) {
    throw new TypeError(`corpus URL escapes its mount: ${url}`);
  }
  return candidate;
};

const io = {
  fetchJson: async (url) => JSON.parse(await readFile(localResourcePath(url), 'utf8')),
  fetchBinary: async (url) => new Uint8Array(await readFile(localResourcePath(url))),
};

const sourceManifestPath = path.join(
  corpusRoot,
  'manifests',
  'generated',
  'reader-adapter.json',
);
const selectionManifestPath = path.join(
  corpusRoot,
  'manifests',
  'generated',
  'reader-selection.json',
);
const bilingualTitleManifestPath = path.join(
  corpusRoot,
  'manifests',
  'generated',
  'bilingual-titles.json',
);
const bilingualTitleAuthorityPath = path.join(
  corpusRoot,
  'manifests',
  'generated',
  'bilingual-title-authority.json',
);
const { readerManifest, selectionManifest, bilingualTitleManifest, bilingualTitleAuthority,
  receipt: contentCorrectionReceipt } = await readEffectiveReaderManifests(corpusRoot);
const selectedSources = readerManifest.stories.filter(story => story.resource?.reader?.decision === 'include');
const selectedIds = new Set(selectedSources.map(story => story.readerIdentity ?? story.canonicalStoryId));
const selectedRecords = selectionManifest.records.filter(record => record.decision === 'include');
if (selectionManifest.result !== 'PASS' || selectedSources.length === 0
  || selectedIds.size !== selectedSources.length
  || selectionManifest.counts?.included !== selectedSources.length
  || selectedRecords.length !== selectedSources.length
  || selectedRecords.some(record => !selectedIds.has(record.readerIdentity ?? record.canonicalStoryId))) {
  throw new TypeError('Reader selection must match the complete reviewed source membership');
}
if (bilingualTitleManifest.result !== 'PASS'
  || bilingualTitleManifest.counts?.byType?.story !== selectedSources.length
  || bilingualTitleManifest.counts?.byType?.section < selectedSources.length) {
  throw new TypeError('Bilingual title manifest must cover every selected source and its native sections');
}
if (bilingualTitleAuthority.result !== 'PASS'
  || bilingualTitleAuthority.revision !== bilingualTitleManifest.authorityAudit?.authorityRevision) {
  throw new TypeError('Bilingual title authority must be PASS and match the title manifest');
}
const titleNodeById = new Map(
  bilingualTitleManifest.nodes.map((node) => [node.id, node]),
);
const localizedTitleAuthority = (node) => ({
  authorityId: node.id,
  title_cn: String(node.title?.['zh-CN'] ?? ''),
  title_jp: String(node.title?.['ja-JP'] ?? ''),
  source: node.source,
  evidence: node.evidence,
  confidence: node.confidence,
});

const catalog = buildResearchCatalog(readerManifest, { corpusBaseUrl: '/corpus/' });
const adapter = createResearchReaderAdapter({ corpusBaseUrl: '/corpus/' });
const dataRoot = path.join(publicRoot, 'data', 'legacy-vn');
const manifestsRoot = path.join(dataRoot, 'manifests');
const ensureOutputPath = (candidate) => {
  const resolved = path.resolve(candidate);
  const prefix = `${publicRoot}${path.sep}`;
  if (resolved !== publicRoot && !resolved.startsWith(prefix)) {
    throw new TypeError(`output escapes Classic public root: ${resolved}`);
  }
  return resolved;
};

// Regenerate known derived files only. Source revisions and unrelated files are never
// removed; candidate output can be inspected before promoting the complete result.
await mkdir(ensureOutputPath(manifestsRoot), { recursive: true });

const compactText = (value) => String(value ?? '')
  .replace(/\r\n?/gu, '\n')
  .replace(/\0/gu, '\uFFFD')
  .replace(/\\/gu, '\\\\')
  .replace(/\n/gu, '\\n')
  .trim();
const localizedValue = (record, locale) => compactText(record?.[locale]);
const safeStoryId = (storyEntry) => {
  const value = `legacy-${storyEntry.canonicalStoryId.replace('/', '-')}`;
  if (!/^[A-Za-z0-9_.:-]+$/u.test(value)) {
    throw new TypeError(`story cannot form a stable Classic route: ${storyEntry.canonicalStoryId}`);
  }
  return value;
};
const sourceLocaleText = (record) => (
  localizedValue(record, 'ja-JP') || localizedValue(record, 'en')
);
const sourceLocaleSpeaker = (record) => (
  localizedValue(record, 'ja-JP') || localizedValue(record, 'en') || 'ナレーション'
);

const corpusMetadata = {
  narcissu10: { category: 'main_story', game: 'narcissu' },
  narcissu3: { category: 'event_story', game: 'narcissu' },
  kana: { category: 'character_story', game: 'kana' },
};
const storyIndex = [];
const kanaScriptPlans = [];
const chapterRelationInputs = [];
let productNavigation = null;
const bundleEntries = [];
const byCorpus = {};
let textUnits = 0;
let translatedUnits = 0;
let choiceEvents = 0;
let choiceOptions = 0;
let mediaReferences = 0;
const contentCharacters = { 'ja-JP': 0, 'zh-CN': 0 };
const characterCount = value => [...String(value ?? '').replace(/\s/gu, '')].length;

for (const corpus of catalog.corpora) {
  byCorpus[corpus.corpusId] = 0;
  for (const storyEntry of corpus.stories) {
    const story = await adapter.load({ corpus, storyEntry, io });
    if (NARCISSU3_CHAPTER_RELATION_STORIES.includes(storyEntry.canonicalStoryId)) {
      chapterRelationInputs.push({identity:storyEntry.canonicalStoryId,story});
    }
    const preferredVariant = story.variants.find((item) =>
      item.variantId === storyEntry.preferredVariantId) ?? story.variants[0];
    const japaneseVariant = preferredVariant.locales.includes('ja-JP')
      ? preferredVariant
      : story.variants.find((item) => item.locales.includes('ja-JP'));
    const chineseVariant = preferredVariant.locales.includes('zh-CN')
      ? preferredVariant
      : story.variants.find((item) => item.locales.includes('zh-CN'));
    if (!japaneseVariant) {
      throw new TypeError(`${storyEntry.canonicalStoryId} has no Japanese Reader variant`);
    }
    if (storyEntry.sourceCanonicalStoryId === 'narcissu-3rd/product') {
      productNavigation = buildNarcissu3ProductNavigation([
        {sourceLocale:'ja-JP',variantId:japaneseVariant.variantId,events:japaneseVariant.sections.flatMap(section=>section.events)},
        {sourceLocale:'zh-CN',variantId:chineseVariant.variantId,events:chineseVariant.sections.flatMap(section=>section.events)},
      ]);
    }
    const routeId = safeStoryId(storyEntry);
    const title = String(storyEntry.title);
    const storyTitleAuthority = titleNodeById.get(
      `story/${storyEntry.sourceCanonicalStoryId}`,
    );
    if (!storyTitleAuthority) {
      throw new TypeError(`${storyEntry.sourceCanonicalStoryId} has no title authority node`);
    }
    const arcTitleAuthority = titleNodeById.get(storyTitleAuthority.parentId);
    const workTitleAuthority = titleNodeById.get(arcTitleAuthority?.parentId);
    if (!arcTitleAuthority || !workTitleAuthority) {
      throw new TypeError(`${storyEntry.sourceCanonicalStoryId} has incomplete title hierarchy`);
    }
    const storyTitleRecord = localizedTitleAuthority(storyTitleAuthority);
    const arcTitleRecord = localizedTitleAuthority(arcTitleAuthority);
    const workTitleRecord = localizedTitleAuthority(workTitleAuthority);
    const titleCn = String(storyTitleAuthority.title?.['zh-CN'] ?? '');
    const titleJp = String(storyTitleAuthority.title?.['ja-JP'] ?? '');
    if (storyEntry.sourceGameId === 'kana-okaeri') {
      const route = await io.fetchJson('/corpus/manifests/generated/kana-route-diff/scripts/'
        + title.toUpperCase() + '.json');
      kanaScriptPlans.push(buildKanaNativePlan({
        route,
        events: preferredVariant.sections.flatMap(section => section.events),
        fallbackTitle: { 'zh-CN': titleCn, 'ja-JP': titleJp },
      }));
    }
    const relativeStem = storyEntry.canonicalStoryId;
    const jpRelative = `${relativeStem}_jp.txt`;
    const cnRelative = `${relativeStem}_cn.txt`;
    const jpLines = [];
    const cnLines = [];
    const sections = [];
    const sectionTitles = [];
    let storyUnits = 0;
    let storyTranslated = 0;
    let storyChoiceEvents = 0;
    let storyChoiceOptions = 0;
    const storyCharacters = { 'ja-JP': 0, 'zh-CN': 0 };

    japaneseVariant.sections.forEach((section, sectionIndex) => {
      const sectionNumber = sectionIndex + 1;
      const sectionLabel = `${title} Section ${sectionNumber}`;
      const sectionTitleAuthority = titleNodeById.get(
        `section/${storyEntry.sourceCanonicalStoryId}/${section.sectionId}`,
      );
      if (!sectionTitleAuthority) {
        throw new TypeError(
          `${storyEntry.sourceCanonicalStoryId}/${section.sectionId} has no section title authority`,
        );
      }
      const header = `--- Start: ${title}.txt Section ${sectionNumber} ---`;
      sections.push(sectionLabel);
      sectionTitles.push({
        sectionId: section.sectionId,
        ...localizedTitleAuthority(sectionTitleAuthority),
      });
      jpLines.push(header);
      for (const event of section.events) {
        if (event.kind === 'line') {
          const jpText = sourceLocaleText(event.text);
          if (!jpText) continue;
          const jpSpeaker = sourceLocaleSpeaker(event.speaker);
          jpLines.push(`${jpSpeaker}: ${jpText}`);
          storyUnits += 1;
          storyCharacters['ja-JP'] += characterCount(event.text?.['ja-JP'] ?? event.text?.en);
        } else if (event.kind === 'choice') {
          storyChoiceEvents += 1;
          for (const choice of event.choices) {
            const jpLabel = sourceLocaleText(choice.label);
            if (!jpLabel) continue;
            const target = choice.nextEventId ?? choice.choiceId;
            jpLines.push(`Choice: 【${jpLabel}】 -> group_${target}`);
            storyUnits += 1;
            storyChoiceOptions += 1;
            storyCharacters['ja-JP'] += characterCount(choice.label?.['ja-JP'] ?? choice.label?.en);
          }
        }
      }
    });
    if (storyUnits === 0) throw new TypeError(`${storyEntry.canonicalStoryId} has no story text`);

    for (const [sectionIndex, section] of (chineseVariant?.sections ?? []).entries()) {
      const sectionNumber = sectionIndex + 1;
      cnLines.push(`--- Start: ${title}.txt Section ${sectionNumber} ---`);
      for (const event of section.events) {
        if (event.kind === 'line') {
          const cnText = localizedValue(event.text, 'zh-CN');
          if (!cnText) continue;
          const cnSpeaker = localizedValue(event.speaker, 'zh-CN') || '旁白';
          cnLines.push(`${cnSpeaker}: ${cnText}`);
          storyTranslated += 1;
          storyCharacters['zh-CN'] += characterCount(event.text?.['zh-CN']);
        } else if (event.kind === 'choice') {
          for (const choice of event.choices) {
            const cnLabel = localizedValue(choice.label, 'zh-CN');
            if (!cnLabel) continue;
            const target = choice.nextEventId ?? choice.choiceId;
            cnLines.push(`选项: 【${cnLabel}】 -> group_${target}`);
            storyTranslated += 1;
            storyCharacters['zh-CN'] += characterCount(choice.label?.['zh-CN']);
          }
        }
      }
    }

    const hasChinese = storyTranslated > 0;
    const jpPath = path.join(dataRoot, jpRelative);
    const cnPath = path.join(dataRoot, cnRelative);
    await mkdir(path.dirname(jpPath), { recursive: true });
    await writeFile(jpPath, `${jpLines.join('\n')}\n`, 'utf8');
    if (hasChinese) await writeFile(cnPath, `${cnLines.join('\n')}\n`, 'utf8');

    const routeRelative = `${relativeStem}.routes.json`;
    const publicRoutePath = `/data/legacy-vn/${routeRelative.replaceAll('\\', '/')}`;
    const routeSections = (variant, readerLocales) => {
      const textLineCounts = Object.fromEntries(
        readerLocales.map((locale) => [locale, 0]),
      );
      const sectionsWithIndexes = variant.sections.map((section) => ({
        sectionId: section.sectionId,
        entryEventId: section.entryEventId,
        events: section.events.map((event) => {
          const textLineIndex = {};
          if (event.kind === 'line') {
            if (
              readerLocales.includes('ja-JP')
              && sourceLocaleText(event.text)
            ) {
              textLineIndex['ja-JP'] = textLineCounts['ja-JP'];
              textLineCounts['ja-JP'] += 1;
            }
            if (
              readerLocales.includes('zh-CN')
              && localizedValue(event.text, 'zh-CN')
            ) {
              textLineIndex['zh-CN'] = textLineCounts['zh-CN'];
              textLineCounts['zh-CN'] += 1;
            }
          }
          return {
            eventId: event.eventId,
            kind: event.kind,
            ...(event.source ? { source: event.source } : {}),
            ...(event.nextEventId ? { nextEventId: event.nextEventId } : {}),
            ...(Object.keys(textLineIndex).length > 0 ? { textLineIndex } : {}),
            ...(event.kind === 'choice' ? {
              choices: event.choices.map((choice) => ({
                choiceId: choice.choiceId,
                nextEventId: choice.nextEventId,
                label: choice.label,
                ...(choice.source ? { source: choice.source } : {}),
              })),
            } : {}),
            ...(event.cues?.length ? { cues: event.cues } : {}),
          };
        }),
      }));
      return { sections: sectionsWithIndexes, textLineCounts };
    };
    const japaneseRoute = routeSections(japaneseVariant, ['ja-JP']);
    const readerLocalesByVariantId = new Map([
      [japaneseVariant.variantId, new Set(['ja-JP'])],
    ]);
    if (chineseVariant) {
      const locales = readerLocalesByVariantId.get(chineseVariant.variantId)
        ?? new Set();
      locales.add('zh-CN');
      readerLocalesByVariantId.set(chineseVariant.variantId, locales);
    }
    const variantsById = new Map([
      [japaneseVariant.variantId, japaneseVariant],
      ...(chineseVariant ? [[chineseVariant.variantId, chineseVariant]] : []),
    ]);
    const routeDocument = {
      schema: 'classic-reader-story-routes/v1',
      canonicalStoryId: storyEntry.canonicalStoryId,
      sourceCanonicalStoryId: storyEntry.sourceCanonicalStoryId,
      preferredVariantId: preferredVariant.variantId,
      japaneseVariantId: japaneseVariant.variantId,
      chineseVariantId: chineseVariant?.variantId ?? null,
      voiceRouting: {
        schema: 'classic-reader-voice-routing/v1',
        defaultState: 'collapsed',
        expandedSlotMode: 'all-lines',
        unresolvedLineBehavior: 'visible',
      },
      titleAuthority: {
        work: workTitleRecord,
        arc: arcTitleRecord,
        story: storyTitleRecord,
      },
      sections: japaneseRoute.sections.map((section) => ({
        ...section,
        titleAuthority: sectionTitles.find((record) => record.sectionId === section.sectionId),
      })),
      variantRoutes: [...variantsById.entries()].map(([variantId, variant]) => {
        const readerLocales = [...readerLocalesByVariantId.get(variantId)];
        const routed = variantId === japaneseVariant.variantId
          && readerLocales.length === 1
          && readerLocales[0] === 'ja-JP'
          ? japaneseRoute
          : routeSections(variant, readerLocales);
        return {
          variantId,
          locales: variant.locales,
          readerLocales,
          textLineCounts: routed.textLineCounts,
          sections: routed.sections,
        };
      }),
      media: story.embeddedMedia.entries,
    };
    await writeFile(
      path.join(dataRoot, routeRelative),
      `${JSON.stringify(routeDocument, null, 2)}\n`,
      'utf8',
    );

    const metadata = corpusMetadata[corpus.corpusId];
    const publicJpPath = `/data/legacy-vn/${jpRelative.replaceAll('\\', '/')}`;
    const publicCnPath = hasChinese
      ? `/data/legacy-vn/${cnRelative.replaceAll('\\', '/')}`
      : '';
    storyIndex.push({
      id: routeId,
      category: metadata.category,
      folder: storyEntry.folderTitle,
      percent: hasChinese ? 100 : 0,
      has_cn: hasChinese,
      has_jp: true,
      ...(hasChinese ? { filename_cn: path.basename(cnRelative), path_cn: publicCnPath } : {}),
      filename_jp: path.basename(jpRelative),
      path_jp: publicJpPath,
      title: titleCn || titleJp || '',
      title_cn: titleCn,
      title_jp: titleJp,
      title_source: storyTitleAuthority.source,
      title_evidence: storyTitleAuthority.evidence,
      title_confidence: storyTitleAuthority.confidence,
      titleAuthorityId: storyTitleAuthority.id,
      work_title_cn: workTitleRecord.title_cn,
      work_title_jp: workTitleRecord.title_jp,
      workTitleAuthorityId: workTitleRecord.authorityId,
      folder_title_cn: arcTitleRecord.title_cn,
      folder_title_jp: arcTitleRecord.title_jp,
      folderTitleAuthorityId: arcTitleRecord.authorityId,
      sections,
      sectionTitles,
      ...(storyEntry.sourceCanonicalStoryId === 'narcissu-3rd/product' ? { native_sections:productNavigation.nativeSections } : {}),
      game: metadata.game,
      source_format: 'plain-text',
      source_identity: storyEntry.canonicalStoryId,
      source_archive_identity: storyEntry.sourceCanonicalStoryId,
    });
    bundleEntries.push({
      id: routeId,
      canonicalStoryId: storyEntry.canonicalStoryId,
      sourceCanonicalStoryId: storyEntry.sourceCanonicalStoryId,
      corpusId: corpus.corpusId,
      gameId: storyEntry.sourceGameId,
      title,
      titleAuthorityId: storyTitleAuthority.id,
      titles: { 'zh-CN': titleCn, 'ja-JP': titleJp },
      hierarchyTitles: {
        work: workTitleRecord,
        arc: arcTitleRecord,
        story: storyTitleRecord,
      },
      sectionTitles,
      folder: storyEntry.folderTitle,
      preferredVariantId: preferredVariant.variantId,
      japaneseVariantId: japaneseVariant.variantId,
      chineseVariantId: chineseVariant?.variantId ?? null,
      locales: [...new Set([
        ...japaneseVariant.locales,
        ...(chineseVariant?.locales ?? []),
      ])],
      sectionCount: japaneseVariant.sections.length,
      textUnits: storyUnits,
      translatedUnits: storyTranslated,
      contentCharacters: storyCharacters,
      choiceOptions: storyChoiceOptions,
      mediaEntries: story.embeddedMedia.entries.length,
      routePath: publicRoutePath,
      pathCn: publicCnPath || null,
      pathJp: publicJpPath,
    });
    byCorpus[corpus.corpusId] += 1;
    textUnits += storyUnits;
    translatedUnits += storyTranslated;
    choiceEvents += storyChoiceEvents;
    choiceOptions += storyChoiceOptions;
    mediaReferences += story.embeddedMedia.entries.length;
    for (const locale of ['ja-JP', 'zh-CN']) contentCharacters[locale] += storyCharacters[locale];
  }
}

if (storyIndex.length !== selectedSources.length
  || new Set(storyIndex.map(story => story.source_identity)).size !== selectedIds.size
  || storyIndex.some(story => !selectedIds.has(story.source_identity))
  || catalog.corpora.some(corpus => byCorpus[corpus.corpusId] !== corpus.stories.length)) {
  throw new TypeError(`Classic source membership differs from the reviewed catalog: ${JSON.stringify(byCorpus)}`);
}

const nativeMenuEvidence = JSON.parse(await readFile(
  path.join(corpusRoot, 'config/narcissu-direct-title-evidence-v5.json'), 'utf8'));
const kanaMainRoute = await io.fetchJson('/corpus/manifests/generated/kana-route-diff/scripts/MAIN.json');
const kanaChapterPlan = {
  schema: 'kana-native-chapter-plan/v1',
  nativeMainFirstOccurrenceOrder: kanaNarrativeOrderFromMainRoute(kanaMainRoute, {
    knownScriptIds: kanaScriptPlans.map(script => script.scriptId),
  }),
  scripts: kanaScriptPlans,
};
const nativeNavigation = buildNativeStoryGroups(storyIndex, {
  menuGroups: nativeMenuEvidence.menuGroups,
  kanaChapterPlan,
});
const kanaPlanByIdentity = new Map(kanaScriptPlans.map(script => [script.canonicalStoryId, script]));
for (const story of nativeNavigation.stories) {
  const plan = kanaPlanByIdentity.get(story.source_identity);
  if (!plan) continue;
  const byId = new Map(plan.sections.map(section => [section.sectionId, section]));
  story.native_sections = story.native_sections.map(section => {
    const target = byId.get(section.id)?.targetEventIdByLocale;
    if (!target?.['ja-JP'] || !target?.['zh-CN']) throw Error('Native KANA chapter target missing: ' + story.id + '/' + section.id);
    return {
      ...section,
      target_event_id_jp: target['ja-JP'],
      target_event_id_cn: target['zh-CN'],
    };
  });
}
const chapterRelations = await buildNarcissu3ChapterRelations(chapterRelationInputs, corpusRoot);
for (const story of nativeNavigation.stories) {
  const relations = chapterRelations.byStory[story.source_identity];
  if (relations) story.cross_chapter_relations = relations;
}
storyIndex.splice(0, storyIndex.length, ...nativeNavigation.stories);
const nativeIndexById = new Map(storyIndex.map(story => [story.id, story]));
for (const entry of bundleEntries) {
  const story = nativeIndexById.get(entry.id);
  entry.folder = story.folder;
  entry.nativeGroupId = story.native_group_id;
  entry.nativeChapterCount = story.native_sections?.length ?? story.sections.length;
}
const nativeChapters = bundleEntries.reduce((sum, entry) => sum + entry.nativeChapterCount, 0);
const sourcePipelineRevision = await computeContentPipelineRevision(repositoryRoot);
const bundleManifest = {
  schema: 'classic-reader-resource-bundle/v1',
  result: 'PASS',
  revision: `${selectionManifest.revision}--${readerManifest.bridgeRevision}--${bilingualTitleManifest.revision}--${sourcePipelineRevision}`,
  sourcePipelineRevision,
  sourceBridgeRevision: readerManifest.bridgeRevision,
  sourceTitleRevision: bilingualTitleManifest.revision,
  sourceManifests: {
    readerAdapter: '/data/legacy-vn/manifests/reader-adapter.json',
    readerSelection: '/data/legacy-vn/manifests/reader-selection.json',
    bilingualTitleAuthority: '/data/legacy-vn/manifests/bilingual-title-authority.json',
    bilingualTitles: '/data/legacy-vn/manifests/bilingual-titles.json',
    chineseContent: '/data/legacy-vn/manifests/chinese-content.json',
    playbackMedia: '/data/legacy-vn/manifests/playback-media.json',
    catalog: '/data/legacy-vn/manifests/catalog.json',
    narcissu10MediaView: '/data/legacy-vn/manifests/narcissu10-media-view.json',
    nativeNavigation: '/data/legacy-vn/manifests/native-navigation.json',
    kanaNativeChapters: '/data/legacy-vn/manifests/kana-native-chapters.json',
    contentCorrections: '/data/legacy-vn/manifests/content-corrections.json',
    productNativeNavigation: '/data/legacy-vn/manifests/narcissu3-product-navigation.json',
    crossChapterRelations: '/data/legacy-vn/manifests/narcissu3-chapter-relations.json',
  },
  counts: {
    stories: storyIndex.length,
    nativeChapters,
    nativeGroups: nativeNavigation.counts.nativeGroups,
    kanaNativeChapters: nativeNavigation.counts.kanaNativeSections,
    contentCharacters,
    byCorpus,
    chineseStories: storyIndex.filter((story) => story.has_cn).length,
    japaneseStories: storyIndex.filter((story) => story.has_jp).length,
    textUnits,
    translatedUnits,
    choiceEvents,
    choiceOptions,
    mediaReferences,
    titleStoryRecords: storyIndex.length,
    titleWorkRecords: bilingualTitleManifest.counts.byType.work,
    titleArcRecords: bilingualTitleManifest.counts.byType.arc,
    titleSectionRecords: storyIndex.reduce(
      (sum, story) => sum + story.sectionTitles.length,
      0,
    ),
    zhAuthoritativeTitles: storyIndex.filter((story) => story.title_cn).length,
    jaAuthoritativeTitles: storyIndex.filter((story) => story.title_jp).length,
  },
  entries: bundleEntries,
};

const snapshotManifests = [
  'reader-adapter.json',
  'reader-selection.json',
  'bilingual-title-authority.json',
  'bilingual-titles.json',
  'chinese-content.json',
  'playback-media.json',
  'catalog.json',
  'narcissu10-media-view.json',
];
const effectiveSnapshots = {
  'reader-adapter.json': readerManifest,
  'reader-selection.json': selectionManifest,
  'bilingual-titles.json': bilingualTitleManifest,
  'bilingual-title-authority.json': bilingualTitleAuthority,
};
for (const filename of snapshotManifests) {
  if (effectiveSnapshots[filename]) {
    await writeFile(path.join(manifestsRoot, filename),
      JSON.stringify(effectiveSnapshots[filename], null, 2) + '\n', 'utf8');
  } else await copyFile(
    path.join(corpusRoot, 'manifests', 'generated', filename),
    path.join(manifestsRoot, filename),
  );
}
await writeFile(path.join(manifestsRoot, 'content-corrections.json'),
  JSON.stringify(contentCorrectionReceipt, null, 2) + '\n', 'utf8');
await writeFile(path.join(manifestsRoot, 'native-navigation.json'),
  JSON.stringify({ ...nativeNavigation, stories: undefined }, null, 2) + '\n', 'utf8');
await writeFile(path.join(manifestsRoot, 'narcissu3-chapter-relations.json'),
  JSON.stringify(chapterRelations, null, 2) + '\n', 'utf8');
if (!productNavigation) throw Error('Native accessible product supplement was omitted');
await writeFile(path.join(manifestsRoot, 'narcissu3-product-navigation.json'),
  JSON.stringify(productNavigation, null, 2) + '\n', 'utf8');
await writeFile(path.join(manifestsRoot, 'kana-native-chapters.json'),
  JSON.stringify(kanaChapterPlan, null, 2) + '\n', 'utf8');
if (publicRoot !== expectedPublicRoot) {
  // Carry the user's existing revision registry into the candidate. It is never
  // recreated or silently emptied when the base parser changes.
  await copyFile(path.join(expectedPublicRoot, 'native-reader-revisions.json'),
    path.join(publicRoot, 'native-reader-revisions.json'));
  const revisionRegistry = JSON.parse(await readFile(
    path.join(publicRoot, 'native-reader-revisions.json'), 'utf8'));
  for (const revision of Object.values(revisionRegistry.entries ?? {})) {
    const relative = String(revision.path).replace(/^\//u, '');
    const from = path.resolve(expectedPublicRoot, relative);
    const to = ensureOutputPath(path.join(publicRoot, relative));
    if (!from.startsWith(expectedPublicRoot + path.sep)) throw Error('Revision path escapes source public root');
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(from, to);
  }
}
await writeFile(
  path.join(dataRoot, 'manifest.json'),
  `${JSON.stringify(bundleManifest, null, 2)}\n`,
  'utf8',
);
const indexText = `${JSON.stringify(storyIndex, null, 2)}\n`;
await writeFile(path.join(publicRoot, 'story_index.json'), indexText, 'utf8');
await writeFile(
  path.join(publicRoot, 'data', 'story_ids.generated.json'),
  `${JSON.stringify(classicStoryIds(storyIndex), null, 2)}\n`,
  'utf8',
);
await mkdir(path.join(publicRoot, 'apps', 'web'), { recursive: true });
await writeFile(path.join(publicRoot, 'apps', 'web', 'story_index.json'), indexText, 'utf8');

const nativeCorrespondenceBuild = spawnSync('python', ['-B',
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'build-native-correspondence.py'),
  '--public', publicRoot, '--output', publicRoot,
  '--report', path.join(buildReportRoot, 'native-correspondence-materialization.json')],
  { cwd: repositoryRoot, encoding: 'utf8' });
if (nativeCorrespondenceBuild.status !== 0) throw Error(nativeCorrespondenceBuild.stderr || 'Native correspondence generation failed');
console.log(nativeCorrespondenceBuild.stdout.trim());

console.log(JSON.stringify({
  result: bundleManifest.result,
  revision: bundleManifest.revision,
  counts: bundleManifest.counts,
  storyIndex: path.join(publicRoot, 'story_index.json'),
  dataRoot,
}, null, 2));

const nativeEditBuild = await buildNativeEditSources(publicRoot);
console.log(JSON.stringify({ nativeEdit: nativeEditBuild.counts }));

// Revision archives live outside data/legacy-vn; validate and consume them only
// after regenerating their immutable source bindings.
await buildGenericSearchIndex(publicRoot, publicRoot);
