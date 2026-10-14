import {
  access,
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeContentPipelineRevision } from './lib/content-pipeline-revision.mjs';
import { readEffectiveReaderManifests } from './lib/content-selection-corrections.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpusRoot = path.resolve(
  process.env.ADV_CORPUS_REPOSITORY
    ?? path.resolve(repositoryRoot, '..', 'narcissu-kana-research'),
);
const optionValue = key => {
  const index = process.argv.indexOf(key);
  return index < 0 ? undefined : process.argv[index + 1];
};
const publicRoot = path.resolve(optionValue('--public')
  ?? process.env.CLASSIC_READER_PUBLIC
  ?? path.join(repositoryRoot, 'apps', 'classic-reader', 'public'));
const storyIndexPath = path.join(publicRoot, 'story_index.json');
const bundlePath = path.join(publicRoot, 'data', 'legacy-vn', 'manifest.json');
const selectionPath = path.join(
  corpusRoot,
  'manifests',
  'generated',
  'reader-selection.json',
);
const bilingualTitlePath = path.join(
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
const deployedTitleAuthorityPath = path.join(
  publicRoot,
  'data',
  'legacy-vn',
  'manifests',
  'bilingual-title-authority.json',
);
const storyIndex = JSON.parse(await readFile(storyIndexPath, 'utf8'));
const bundle = JSON.parse(await readFile(bundlePath, 'utf8'));
const { selectionManifest: selection, bilingualTitleManifest: bilingualTitles,
  bilingualTitleAuthority } = await readEffectiveReaderManifests(corpusRoot);
const deployedTitleAuthority = JSON.parse(await readFile(deployedTitleAuthorityPath, 'utf8'));
const failures = [];
const includedRecords = selection.records.filter(record => record.decision === 'include');
const excludedRecords = selection.records.filter(record => record.decision === 'exclude');
const expectedStories = includedRecords.length;
const pipelineRevision = await computeContentPipelineRevision(repositoryRoot);

const publicPath = (url) => path.join(publicRoot, ...url.replace(/^\//u, '').split('/'));
const corpusPath = (url) => path.join(
  corpusRoot,
  ...decodeURIComponent(url.replace(/^\/corpus\//u, '')).split('/'),
);
const requireFile = async (filename, label) => {
  try {
    await access(filename);
  } catch {
    failures.push({ label, path: filename, error: 'missing file' });
  }
};
const emittedTextLineCount = (raw) => raw
  .replace(/\r\n?/gu, '\n')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line
    && !line.startsWith('---')
    && !/^(?:选项|選択肢|Choice)\s*[:：]/iu.test(line))
  .length;

if (!Array.isArray(storyIndex) || expectedStories === 0 || storyIndex.length !== expectedStories) {
  failures.push({ label: 'story-index', path: storyIndexPath, error: 'expected exact reviewed source membership' });
}
if (bundle.result !== 'PASS' || bundle.counts?.stories !== expectedStories) {
  failures.push({ label: 'bundle', path: bundlePath, error: 'bundle is incomplete' });
}
if (selection.result !== 'PASS'
  || selection.counts?.included !== expectedStories
  || selection.counts?.excluded !== excludedRecords.length
  || selection.records.length !== expectedStories + excludedRecords.length
  || selection.exclusionGate?.missingIncludedReplacementCount !== 0) {
  failures.push({ label: 'selection', path: selectionPath, error: 'selection gate is incomplete' });
}
if (bilingualTitles.result !== 'PASS'
  || bilingualTitles.counts?.byType?.story !== expectedStories
  || bilingualTitles.counts?.byType?.section < expectedStories) {
  failures.push({ label: 'bilingual-titles', path: bilingualTitlePath, error: 'title authority coverage is incomplete' });
}
if (bilingualTitleAuthority.result !== 'PASS'
  || bilingualTitleAuthority.revision !== bilingualTitles.authorityAudit?.authorityRevision
  || deployedTitleAuthority.revision !== bilingualTitleAuthority.revision
  || deployedTitleAuthority.counts?.records !== bilingualTitleAuthority.counts?.records) {
  failures.push({ label: 'bilingual-title-authority', path: deployedTitleAuthorityPath, error: 'deployed authority snapshot differs from source' });
}
if (bundle.sourceTitleRevision !== bilingualTitles.revision
  || bundle.sourcePipelineRevision !== pipelineRevision
  || bundle.revision !== `${selection.revision}--${bundle.sourceBridgeRevision}--${bilingualTitles.revision}--${pipelineRevision}`) {
  failures.push({ label: 'bundle-title-revision', path: bundlePath, error: 'bundle revision does not include title revision' });
}

const indexByIdentity = new Map(storyIndex.map((story) => [story.source_identity, story]));
const includedIds = new Set(selection.records
  .filter((record) => record.decision === 'include')
  .map((record) => record.readerIdentity ?? record.canonicalStoryId));
if (indexByIdentity.size !== expectedStories
  || includedIds.size !== expectedStories
  || new Set(storyIndex.map(story => story.id)).size !== expectedStories
  || [...indexByIdentity.keys()].some((storyId) => !includedIds.has(storyId))) {
  failures.push({ label: 'story-index', path: storyIndexPath, error: 'published identities differ from include decisions' });
}
const titleNodeById = new Map(
  (bilingualTitles.nodes ?? []).map((node) => [node.id, node]),
);

let jpFiles = 0;
let cnFiles = 0;
let routeFiles = 0;
let choiceEvents = 0;
let choiceOptions = 0;
let cueRoutes = 0;
let mediaReferences = 0;
let voiceSlotStories = 0;
let voiceSlotTextLines = 0;
let storiesWithRoutedVoice = 0;
let routedVoiceCues = 0;
let titleStoryRecords = 0;
let titleSectionRecords = 0;
let zhAuthoritativeTitles = 0;
let jaAuthoritativeTitles = 0;
let sumireEpilogueChineseReady = false;
let nativeChapterCount = 0;
let kanaNativeChapterCount = 0;
const nativeGroupIds = new Set();
const workTitleAuthorityIds = new Set();
const arcTitleAuthorityIds = new Set();
const mediaUrls = new Set();
for (const entry of bundle.entries ?? []) {
  const story = indexByIdentity.get(entry.canonicalStoryId);
  if (!story) {
    failures.push({ label: 'bundle-entry', path: entry.canonicalStoryId, error: 'not in story index' });
    continue;
  }
  const archiveIdentity = entry.sourceCanonicalStoryId ?? entry.canonicalStoryId;
  if ((story.source_archive_identity ?? story.source_identity) !== archiveIdentity) {
    failures.push({label:'source-provenance',path:entry.canonicalStoryId,error:'reader alias lost archive identity'});
  }
  const titleNode = titleNodeById.get(`story/${archiveIdentity}`);
  if (!titleNode) {
    failures.push({ label: 'title-authority', path: entry.canonicalStoryId, error: 'story node is missing' });
  } else {
    const arcTitleNode = titleNodeById.get(titleNode.parentId);
    const workTitleNode = titleNodeById.get(arcTitleNode?.parentId);
    titleStoryRecords += 1;
    const expectedCn = String(titleNode.title?.['zh-CN'] ?? '');
    const expectedJp = String(titleNode.title?.['ja-JP'] ?? '');
    if (story.title_cn !== expectedCn
      || story.title_jp !== expectedJp
      || story.title !== (expectedCn || expectedJp || '')
      || story.titleAuthorityId !== titleNode.id) {
      failures.push({ label: 'title-authority', path: entry.canonicalStoryId, error: 'story title fields differ from authority manifest' });
    }
    if (!arcTitleNode || !workTitleNode
      || story.folderTitleAuthorityId !== arcTitleNode.id
      || story.workTitleAuthorityId !== workTitleNode.id
      || story.folder_title_cn !== String(arcTitleNode.title?.['zh-CN'] ?? '')
      || story.folder_title_jp !== String(arcTitleNode.title?.['ja-JP'] ?? '')
      || story.work_title_cn !== String(workTitleNode.title?.['zh-CN'] ?? '')
      || story.work_title_jp !== String(workTitleNode.title?.['ja-JP'] ?? '')) {
      failures.push({ label: 'title-authority', path: entry.canonicalStoryId, error: 'work/arc title fields differ from authority manifest' });
    } else {
      arcTitleAuthorityIds.add(arcTitleNode.id);
      workTitleAuthorityIds.add(workTitleNode.id);
    }
    if (expectedCn) zhAuthoritativeTitles += 1;
    if (expectedJp) jaAuthoritativeTitles += 1;
  }
  if (!Array.isArray(story.sectionTitles) || story.sectionTitles.length !== 1) {
    failures.push({ label: 'title-authority', path: entry.canonicalStoryId, error: 'expected one section title record' });
  }
  for (const sectionTitle of story.sectionTitles ?? []) {
    const sectionNode = titleNodeById.get(
      `section/${archiveIdentity}/${sectionTitle.sectionId}`,
    );
    if (!sectionNode
      || sectionTitle.authorityId !== sectionNode.id
      || sectionTitle.title_cn !== String(sectionNode.title?.['zh-CN'] ?? '')
      || sectionTitle.title_jp !== String(sectionNode.title?.['ja-JP'] ?? '')) {
      failures.push({ label: 'title-authority', path: entry.canonicalStoryId, error: `section title differs: ${sectionTitle.sectionId}` });
    } else {
      titleSectionRecords += 1;
    }
  }
  if (!story.native_group_id || !Number.isSafeInteger(story.native_story_order)) {
    failures.push({ label: 'native-navigation', path: entry.canonicalStoryId, error: 'native work or order missing' });
  } else nativeGroupIds.add(story.native_group_id);
  nativeChapterCount += story.native_sections?.length ?? story.sections?.length ?? 0;
  if (entry.corpusId === 'kana') kanaNativeChapterCount += story.native_sections?.length ?? 0;
  const jpPath = publicPath(story.path_jp);
  await requireFile(jpPath, 'path_jp');
  const jpText = await readFile(jpPath, 'utf8').catch(() => '');
  if (!jpText.trim()) failures.push({ label: 'path_jp', path: jpPath, error: 'empty text' });
  jpFiles += 1;
  let cnText = '';
  if (story.has_cn) {
    const cnPath = publicPath(story.path_cn);
    await requireFile(cnPath, 'path_cn');
    cnText = await readFile(cnPath, 'utf8').catch(() => '');
    if (!cnText.trim()) failures.push({ label: 'path_cn', path: cnPath, error: 'empty text' });
    if (entry.corpusId === 'narcissu3'
      && /[\uFF61-\uFF9F\uE000-\uF8FF\uFFFD]/u.test(cnText)) {
      failures.push({ label: 'narcissu3-chinese', path: cnPath, error: 'compiled Chinese text retains mojibake code points' });
    }
    if (entry.canonicalStoryId === 'narcissu-3rd/nard12') {
      if (!cnText.includes('——我被哥哥带到天台上。')
        || !cnText.includes('「……稍微冷静下来了吗？」')) {
        failures.push({ label: 'narcissu3-chinese', path: cnPath, error: 'nard12 Chinese evidence lines are missing' });
      }
    }
    if (entry.canonicalStoryId === 'narcissu-sumire/ep') {
      if (story.title_cn !== '尾声'
        || story.title_jp !== 'エピローグ'
        || entry.chineseVariantId !== 'mjo/curated-zh-cn/narcissu-sumire/ep'
        || !cnText.includes('旁白: ―数月后。夏天。')
        || !cnText.includes('旁白: 或许，给她导航去那片海也不错……')) {
        failures.push({ label: 'sumire-ep-chinese', path: cnPath, error: 'curated Sumire ep title, variant, or boundary lines differ' });
      } else {
        sumireEpilogueChineseReady = true;
      }
    }
    cnFiles += 1;
  } else if (entry.corpusId === 'narcissu3') {
    failures.push({ label: 'narcissu3-chinese', path: entry.canonicalStoryId, error: 'selected Narcissu 3rd story has no path_cn' });
  }
  const routePath = publicPath(entry.routePath);
  await requireFile(routePath, 'route');
  const route = JSON.parse(await readFile(routePath, 'utf8'));
  if (route.canonicalStoryId !== entry.canonicalStoryId) {
    failures.push({ label: 'route', path: routePath, error: 'canonicalStoryId differs' });
  }
  if (route.voiceRouting?.schema !== 'classic-reader-voice-routing/v1'
    || route.voiceRouting?.defaultState !== 'collapsed'
    || route.voiceRouting?.expandedSlotMode !== 'all-lines'
    || route.voiceRouting?.unresolvedLineBehavior !== 'visible') {
    failures.push({ label: 'voice-routing', path: routePath, error: 'all-line expansion contract is missing' });
  }
  if (!Array.isArray(route.variantRoutes)
    || !route.variantRoutes.some((variant) => variant.variantId === entry.japaneseVariantId)
    || (entry.chineseVariantId
      && !route.variantRoutes.some((variant) => variant.variantId === entry.chineseVariantId))) {
    failures.push({ label: 'variant-route', path: routePath, error: 'locale variant route is missing' });
  }
  for (const variantRoute of route.variantRoutes ?? []) {
    for (const section of variantRoute.sections ?? []) {
      const events = section.events ?? [];
      const ids = new Set(events.map(event => event.eventId));
      if (ids.size !== events.length || !ids.has(section.entryEventId)) {
        failures.push({ label: 'native-graph', path: routePath, error: 'event identity or entry is invalid' });
      }
      for (const event of events) {
        const targets = [event.nextEventId, ...(event.choices ?? []).map(choice => choice.nextEventId)].filter(Boolean);
        for (const target of targets) if (!ids.has(target)) {
          failures.push({ label: 'native-graph', path: routePath, error: `missing target ${target} from ${event.eventId}` });
        }
      }
    }
  }
  const sectionAnchors = new Set();
  for (const section of story.native_sections ?? []) {
    if (!section.id || sectionAnchors.has(section.anchorId)
      || !/^native-[a-z0-9-]+$/u.test(section.anchorId)) {
      failures.push({ label: 'native-navigation', path: routePath, error: 'invalid chapter anchor' });
    }
    sectionAnchors.add(section.anchorId);
    for (const [locale, target] of [['ja-JP', section.target_event_id_jp], ['zh-CN', section.target_event_id_cn]]) {
      if (locale === 'zh-CN' && !story.has_cn) continue;
      if (section.available_locales && !section.available_locales.includes(locale)) continue;
      const variant = route.variantRoutes.find(item => item.readerLocales?.includes(locale));
      const event = variant?.sections.flatMap(item => item.events ?? []).find(item => item.eventId === target);
      if (!target || !event || !Number.isInteger(event.textLineIndex?.[locale])) {
        failures.push({ label: 'native-navigation', path: routePath, error: `${section.id} lacks visible ${locale} target` });
      }
    }
  }
  if (entry.corpusId === 'kana' && sectionAnchors.size === 0) {
    failures.push({ label: 'native-navigation', path: routePath, error: 'KANA native title ranges missing' });
  }
  const routeMediaIds = new Set((route.media ?? []).map((media) => media.mediaId));
  mediaReferences += routeMediaIds.size;
  for (const media of route.media ?? []) {
    if (typeof media.url !== 'string' || !media.url.startsWith('/corpus/')) {
      failures.push({ label: 'media-route', path: routePath, error: `invalid URL for ${media.mediaId}` });
    } else {
      mediaUrls.add(media.url);
    }
  }
  for (const event of (route.sections ?? []).flatMap((section) => section.events ?? [])) {
    if (event.kind === 'choice') {
      choiceEvents += 1;
      choiceOptions += event.choices?.length ?? 0;
      if ((event.choices ?? []).some((choice) => !choice.choiceId || !choice.nextEventId)) {
        failures.push({ label: 'branch-route', path: routePath, error: `incomplete choices at ${event.eventId}` });
      }
    }
    for (const cue of event.cues ?? []) {
      cueRoutes += 1;
      if (!cue.mediaId || !routeMediaIds.has(cue.mediaId)) {
        failures.push({ label: 'media-route', path: routePath, error: `unresolved cue at ${event.eventId}` });
      }
    }
  }
  const expectedTextLines = {
    'ja-JP': emittedTextLineCount(jpText),
    'zh-CN': emittedTextLineCount(cnText),
  };
  let storyVoiceSlotsValid = true;
  let storyHasRoutedVoice = false;
  const checkedReaderLocales = new Set();
  for (const variantRoute of route.variantRoutes ?? []) {
    for (const locale of variantRoute.readerLocales ?? []) {
      if (locale !== 'ja-JP' && locale !== 'zh-CN') {
        storyVoiceSlotsValid = false;
        failures.push({ label: 'voice-routing', path: routePath, error: `invalid reader locale ${locale}` });
        continue;
      }
      if (checkedReaderLocales.has(locale)) {
        storyVoiceSlotsValid = false;
        failures.push({ label: 'voice-routing', path: routePath, error: `duplicate reader locale ${locale}` });
        continue;
      }
      checkedReaderLocales.add(locale);
      const expectedCount = expectedTextLines[locale];
      const declaredCount = variantRoute.textLineCounts?.[locale];
      const indexes = [];
      for (const event of (variantRoute.sections ?? []).flatMap((section) => section.events ?? [])) {
        const lineIndex = event.textLineIndex?.[locale];
        if (lineIndex !== undefined) indexes.push(lineIndex);
      }
      const sorted = [...indexes].sort((left, right) => left - right);
      const exactCoverage = sorted.length === expectedCount
        && sorted.every((value, index) => value === index);
      if (declaredCount !== expectedCount || !exactCoverage) {
        storyVoiceSlotsValid = false;
        failures.push({
          label: 'voice-routing',
          path: routePath,
          error: `${locale} line indexes differ: declared=${declaredCount}, expected=${expectedCount}, indexed=${indexes.length}`,
        });
      } else {
        voiceSlotTextLines += expectedCount;
      }
    }
    for (const event of (variantRoute.sections ?? []).flatMap((section) => section.events ?? [])) {
      if (event.kind === 'choice'
        && (event.choices ?? []).some((choice) => !choice.choiceId || !choice.nextEventId)) {
        failures.push({ label: 'variant-branch-route', path: routePath, error: `incomplete choices at ${variantRoute.variantId}/${event.eventId}` });
      }
      for (const cue of event.cues ?? []) {
        if (!cue.mediaId || !routeMediaIds.has(cue.mediaId)) {
          failures.push({ label: 'variant-media-route', path: routePath, error: `unresolved cue at ${variantRoute.variantId}/${event.eventId}` });
        }
        if (cue.kind === 'voice') {
          storyHasRoutedVoice = true;
          routedVoiceCues += 1;
        }
      }
    }
  }
  if (!checkedReaderLocales.has('ja-JP')
    || (story.has_cn && !checkedReaderLocales.has('zh-CN'))) {
    storyVoiceSlotsValid = false;
    failures.push({ label: 'voice-routing', path: routePath, error: 'CN/JP reader locale mapping is incomplete' });
  }
  if (storyVoiceSlotsValid) voiceSlotStories += 1;
  if (storyHasRoutedVoice) storiesWithRoutedVoice += 1;
  routeFiles += 1;
}

const relationTargets = new Map(storyIndex.map(story => [story.id, story]));
let crossChapterRelationCount = 0;
for (const story of storyIndex) {
  if (!(story.cross_chapter_relations ?? []).length) continue;
  const sourceEntry = bundle.entries.find(entry => entry.canonicalStoryId === story.source_identity);
  const sourceRoute = JSON.parse(await readFile(publicPath(sourceEntry.routePath), 'utf8'));
  for (const relation of story.cross_chapter_relations) {
    crossChapterRelationCount += 1;
    const sourceVariant = sourceRoute.variantRoutes.find(variant => variant.readerLocales?.includes(relation.source_locale));
    const sourceEvents = new Set(sourceVariant?.sections.flatMap(section => section.events ?? [])
      .filter(event => Number.isInteger(event.textLineIndex?.[relation.source_locale])).map(event => event.eventId) ?? []);
    const target = relationTargets.get(relation.target_story_id);
    const targetEntry = target && bundle.entries.find(entry => entry.canonicalStoryId === target.source_identity);
    if (!relation.source_event_ids.length || relation.source_event_ids.some(id => !sourceEvents.has(id)) || !targetEntry) {
      failures.push({label:'cross-chapter-navigation',path:story.id,error:'source range or target story is missing'});
      continue;
    }
    const targetRoute = JSON.parse(await readFile(publicPath(targetEntry.routePath), 'utf8'));
    const targetVariant = targetRoute.variantRoutes.find(variant => variant.readerLocales?.includes(relation.target_locale));
    const targetEvent = targetVariant?.sections.flatMap(section => section.events ?? []).find(event => event.eventId === relation.target_event_id);
    if (!Number.isInteger(targetEvent?.textLineIndex?.[relation.target_locale])) {
      failures.push({label:'cross-chapter-navigation',path:story.id,error:'target language event is not a visible source row'});
    }
  }
}

const mediaList = [...mediaUrls];
for (let index = 0; index < mediaList.length; index += 128) {
  await Promise.all(mediaList.slice(index, index + 128).map(async (url) => {
    await requireFile(corpusPath(url), 'media-file');
  }));
}
for (const url of Object.values(bundle.sourceManifests ?? {})) {
  await requireFile(publicPath(url), 'manifest-snapshot');
}

const counts = {
  stories: storyIndex.length,
  nativeChapters: nativeChapterCount,
  crossChapterRelations: crossChapterRelationCount,
  kanaNativeChapters: kanaNativeChapterCount,
  nativeGroups: nativeGroupIds.size,
  byCorpus: bundle.counts?.byCorpus,
  pathJpFiles: jpFiles,
  pathCnFiles: cnFiles,
  routeFiles,
  choiceEvents,
  choiceOptions,
  cueRoutes,
  mediaReferences,
  uniqueMediaFiles: mediaUrls.size,
  voiceSlotStories,
  voiceSlotTextLines,
  storiesWithRoutedVoice,
  routedVoiceCues,
  titleStoryRecords,
  titleWorkRecords: workTitleAuthorityIds.size,
  titleArcRecords: arcTitleAuthorityIds.size,
  titleSectionRecords,
  zhAuthoritativeTitles,
  jaAuthoritativeTitles,
  sumireEpilogueChineseReady,
  excludedStories: selection.counts?.excluded,
  exclusionsByReason: selection.counts?.excludedByReason,
};
const expected = {
  stories: expectedStories,
  nativeChapters: bundle.counts.nativeChapters,
  kanaNativeChapters: bundle.counts.kanaNativeChapters,
  nativeGroups: bundle.counts.nativeGroups,
  pathJpFiles: expectedStories,
  pathCnFiles: storyIndex.filter(story => story.has_cn).length,
  routeFiles: expectedStories,
  voiceSlotStories: expectedStories,
  choiceEvents: bundle.counts.choiceEvents,
  choiceOptions: bundle.counts.choiceOptions,
  titleStoryRecords: expectedStories,
  titleWorkRecords: bilingualTitles.counts.byType.work,
  titleArcRecords: bilingualTitles.counts.byType.arc,
  titleSectionRecords: bilingualTitles.counts.byType.section,
  zhAuthoritativeTitles: bilingualTitles.counts?.localizedTitles?.['zh-CN']?.byType?.story,
  jaAuthoritativeTitles: bilingualTitles.counts?.localizedTitles?.['ja-JP']?.byType?.story,
  sumireEpilogueChineseReady: true,
};
for (const [field, value] of Object.entries(expected)) {
  if (counts[field] !== value) {
    failures.push({ label: field, path: bundlePath, error: `expected=${value}, actual=${counts[field]}` });
  }
}

const report = {
  schema: 'classic-reader-resource-verification/v1',
  result: failures.length === 0 ? 'PASS' : 'FAIL',
  revision: bundle.revision,
  paths: {
    storyIndex: storyIndexPath,
    dataRoot: path.join(publicRoot, 'data', 'legacy-vn'),
    bundleManifest: bundlePath,
    sourceSelection: selectionPath,
    sourceBilingualTitleAuthority: bilingualTitleAuthorityPath,
    deployedBilingualTitleAuthority: deployedTitleAuthorityPath,
    sourceBilingualTitles: bilingualTitlePath,
  },
  counts,
  missingReferenceCount: failures.length,
  failures,
};

const reportArg = process.argv.find((value) => value.startsWith('--report='));
if (reportArg) {
  const reportPath = path.resolve(repositoryRoot, reportArg.slice('--report='.length));
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify(report, null, 2));
if (report.result !== 'PASS') process.exitCode = 1;
