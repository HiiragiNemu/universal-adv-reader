import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { NARCISSU10_EXCLUSION_CORRECTIONS } from './narcissu10-exclusion-corrections.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
export const READER_SELECTION_CORRECTIONS = Object.freeze([
  {
    canonicalStoryId: 'narcissu-3rd/product',
    fromDecision: 'exclude',
    fromReason: 'runtime-system',
    expectedEntryReachable: true,
    resourceClass: 'supplement',
    reasonCode: 'native-accessible-afterword-and-localized-extra',
    titles: { 'zh-CN': '制作后记与附加短篇', 'ja-JP': '制作後記・追加短編' },
    titleMethod: 'editorial-source-based',
    evidence: [
      'Native start script explicitly loads product: JP ldstr codeOffset 7116; CN codeOffset 7110.',
      'Japanese product contains the author afterword; Chinese update adds afterwords, staff and the native 1993 short-story menu.',
      'Navigation title describes the source contents; it is not asserted to be a verbatim native title.',
      'reports/verification/content-repair-20261013/catalog/narcissu3-archive-audit.json',
    ],
    sources: {
      'archive/raw/narcissu3/scenario.arc.unpacked/product.mjo': '9daa7cf86dc05f3231e5766ffd0688bab0ec3f91f1793257ac5c52b758aa4019',
      'archive/raw/narcissu3/update.arc.unpacked/product.mjo': 'ba5f0aa6735c1f22fb1628bc3ad18957b3fa0ddaf08c9ce7a5dadfcddec60d8a',
    },
  },
  {
    "canonicalStoryId": "narcissu-himeko/%E3%81%8A%E3%81%BE%E3%81%91",
    "readerIdentity": "narcissu-himeko/omake_062",
    "fromDecision": "exclude",
    "fromReason": "engine-sample",
    "expectedEntryReachable": false,
    "resourceClass": "supplement",
    "reasonCode": "bundled-native-short-story",
    "titles": {
      "zh-CN": "短篇 #062 淡路 SA",
      "ja-JP": "ショートエピソード　＃０６２　淡路ＳＡ"
    },
    "titleMethod": "native-title-with-editorial-zh-navigation",
    "evidence": [
      "Native text codeOffset 181 names short episode #062 Awaji SA; Chinese navigation title is an editorial translation of this source heading.",
      "179 original text events; the bundled story is not an engine sample or part of the selected main narrative.",
      "The retained subutitle_1 wrapper references おまけ at ldstr 3917 and execution syscall 3954; current title-menu reachability is not asserted.",
      "No Chinese translation exists in the supplied patch. Three byte-identical archive copies are represented by this single reader entry.",
      "reports/verification/content-repair-20261013/narcissu10/awaji-bonus-evidence.json"
    ],
    "sources": {
      "archive/raw/narcissu10-original-ja-JP/narci_himeko/scenario.arc.unpacked/おまけ.mjo": "f23c7f73030ebe0bc0225deaa2d973032c209c3cc125ec68abf14c0c77d49f79",
      "archive/raw/narcissu10-original/narci_himeko/scenario.arc.unpacked/おまけ.mjo": "f23c7f73030ebe0bc0225deaa2d973032c209c3cc125ec68abf14c0c77d49f79",
      "archive/derived/scripts/narcissu10-original-ja-JP/narci_himeko/scenario.arc.unpacked/おまけ.plain.mjo": "66fdd749ede243cf1f6a132d3398ef54f2c1ee8bf7b3745b75f0a9a7e208689b"
    }
  },
  {
    "canonicalStoryId": "narcissu-iris/%E3%81%8A%E3%81%BE%E3%81%91",
    "fromDecision": "exclude",
    "fromReason": "engine-sample",
    "expectedEntryReachable": false,
    "decision": "exclude",
    "resourceClass": "supplement",
    "reasonCode": "byte-identical-bundled-short-story-copy",
    "replacementStoryIds": [
      "narcissu-himeko/%E3%81%8A%E3%81%BE%E3%81%91"
    ],
    "evidence": [
      "Encrypted and decrypted MJO bytes are SHA-256 identical to the included Awaji SA short story; retain one reader entry.",
      "reports/verification/content-repair-20261013/narcissu10/awaji-bonus-evidence.json"
    ],
    "sources": {
      "archive/raw/narcissu10-original-ja-JP/narci_iris/scenario.arc.unpacked/おまけ.mjo": "f23c7f73030ebe0bc0225deaa2d973032c209c3cc125ec68abf14c0c77d49f79",
      "archive/derived/scripts/narcissu10-original-ja-JP/narci_iris/scenario.arc.unpacked/おまけ.plain.mjo": "66fdd749ede243cf1f6a132d3398ef54f2c1ee8bf7b3745b75f0a9a7e208689b"
    }
  },
  {
    "canonicalStoryId": "narcissu-sumire/%E3%81%8A%E3%81%BE%E3%81%91",
    "fromDecision": "exclude",
    "fromReason": "engine-sample",
    "expectedEntryReachable": false,
    "decision": "exclude",
    "resourceClass": "supplement",
    "reasonCode": "byte-identical-bundled-short-story-copy",
    "replacementStoryIds": [
      "narcissu-himeko/%E3%81%8A%E3%81%BE%E3%81%91"
    ],
    "evidence": [
      "Encrypted and decrypted MJO bytes are SHA-256 identical to the included Awaji SA short story; retain one reader entry.",
      "reports/verification/content-repair-20261013/narcissu10/awaji-bonus-evidence.json"
    ],
    "sources": {
      "archive/raw/narcissu10-original-ja-JP/narci_sumire/scenario.arc.unpacked/おまけ.mjo": "f23c7f73030ebe0bc0225deaa2d973032c209c3cc125ec68abf14c0c77d49f79",
      "archive/derived/scripts/narcissu10-original-ja-JP/narci_sumire/scenario.arc.unpacked/おまけ.plain.mjo": "66fdd749ede243cf1f6a132d3398ef54f2c1ee8bf7b3745b75f0a9a7e208689b"
    }
  },
  {
    "canonicalStoryId": "narcissu-zero/%E3%81%8A%E3%81%BE%E3%81%91",
    "fromDecision": "exclude",
    "fromReason": "engine-sample",
    "expectedEntryReachable": false,
    "decision": "exclude",
    "resourceClass": "supplement",
    "reasonCode": "byte-identical-bundled-short-story-copy",
    "replacementStoryIds": [
      "narcissu-himeko/%E3%81%8A%E3%81%BE%E3%81%91"
    ],
    "evidence": [
      "Encrypted and decrypted MJO bytes are SHA-256 identical to the included Awaji SA short story; retain one reader entry.",
      "reports/verification/content-repair-20261013/narcissu10/awaji-bonus-evidence.json"
    ],
    "sources": {
      "archive/raw/narcissu10-original-ja-JP/narci_zero/scenario.arc.unpacked/おまけ.mjo": "f23c7f73030ebe0bc0225deaa2d973032c209c3cc125ec68abf14c0c77d49f79",
      "archive/derived/scripts/narcissu10-original-ja-JP/narci_zero/scenario.arc.unpacked/おまけ.plain.mjo": "66fdd749ede243cf1f6a132d3398ef54f2c1ee8bf7b3745b75f0a9a7e208689b"
    }
  },
  {
    "canonicalStoryId": "narcissu-3rd/nar3",
    "fromDecision": "exclude",
    "fromReason": "combined-duplicate",
    "expectedEntryReachable": false,
    "decision": "exclude",
    "resourceClass": "archive",
    "reasonCode": "historical-revision-without-normal-menu-entry",
    "evidence": [
      "The combined script has genuine wording/revision differences from the released split chapters; it is not an exact duplicate.",
      "All native execute/library sinks were audited: ordinary start and chapter-selection paths use nar3_00 through nar3_08, with no entry into this historical revision.",
      "Preserve original bytes and revision differences as research evidence; replacementStoryIds identify the current narrative counterparts, not byte equivalence.",
      "reports/verification/content-repair-20261013/catalog/narcissu3-entry-flow.json",
      "reports/verification/content-repair-20261013/catalog/narcissu3-revision-differences.json"
    ],
    "sources": {
      "archive/raw/narcissu3/scenario.arc.unpacked/nar3.mjo": "5550003aafd8c7358efe8511c2f542ff2262c3bc5a8160cbbf8167501068d977"
    }
  },
  {
    "canonicalStoryId": "narcissu-3rd/prologue",
    "fromDecision": "exclude",
    "fromReason": "combined-duplicate",
    "expectedEntryReachable": false,
    "decision": "exclude",
    "resourceClass": "archive",
    "reasonCode": "historical-revision-without-normal-menu-entry",
    "evidence": [
      "The combined script has genuine wording/revision differences from the released split chapters; it is not an exact duplicate.",
      "All native execute/library sinks were audited: ordinary start and chapter-selection paths use nar3_00 through nar3_08, with no entry into this historical revision.",
      "Preserve original bytes and revision differences as research evidence; replacementStoryIds identify the current narrative counterparts, not byte equivalence.",
      "reports/verification/content-repair-20261013/catalog/narcissu3-entry-flow.json",
      "reports/verification/content-repair-20261013/catalog/narcissu3-revision-differences.json"
    ],
    "sources": {
      "archive/raw/narcissu3/scenario.arc.unpacked/prologue.mjo": "a8d12c2a0caf6e9fd42bb6c6e8409d19b945421ed09a748360bdf31605dfdba2"
    }
  },
  ...NARCISSU10_EXCLUSION_CORRECTIONS,
]);
const tally = (items, key) => {
  const counts = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
};

/** The original research repository stays immutable. This checked, reproducible
 * overlay corrects publication decisions using byte-bound native evidence. */
export async function readEffectiveReaderManifests(corpusRoot) {
  const names = {
    readerManifest: 'reader-adapter.json',
    selectionManifest: 'reader-selection.json',
    bilingualTitleManifest: 'bilingual-titles.json',
    bilingualTitleAuthority: 'bilingual-title-authority.json',
  };
  const result = Object.fromEntries(await Promise.all(Object.entries(names).map(async ([key,name]) =>
    [key, JSON.parse(await readFile(path.join(corpusRoot,'manifests/generated',name),'utf8'))])));
  const { readerManifest: reader, selectionManifest: selection,
    bilingualTitleManifest: titles, bilingualTitleAuthority: authority } = result;
  const baseRevisions = {
    adapter:reader.bridgeRevision, selection:selection.revision,
    titles:titles.revision, titleAuthority:authority.revision,
  };
  const correctionRevision = 'content-selection-' + sha(JSON.stringify(READER_SELECTION_CORRECTIONS)).slice(0,20);
  for (const correction of READER_SELECTION_CORRECTIONS) {
    for (const [relative,expected] of Object.entries(correction.sources)) {
      const actual = sha(await readFile(path.join(corpusRoot,relative)));
      if (actual !== expected) throw Error('Selection correction source changed: ' + relative);
    }
    const story = reader.stories.find(story => story.canonicalStoryId === correction.canonicalStoryId);
    const record = selection.records.find(record => record.canonicalStoryId === correction.canonicalStoryId);
    if (!story || !record || story.resource.reader.decision !== correction.fromDecision
      || story.resource.reader.reasonCode !== correction.fromReason
      || record.decision !== correction.fromDecision || record.reasonCode !== correction.fromReason
      || story.resource.entryReachable !== correction.expectedEntryReachable
      || record.entryReachable !== correction.expectedEntryReachable) {
      throw Error('Selection correction expected original classification: ' + correction.canonicalStoryId);
    }
    const decision = {
      ...story.resource.reader, reviewed:true, decision:correction.decision ?? 'include',
      reasonCode:correction.reasonCode,
      replacementStoryIds:correction.replacementStoryIds ?? (correction.decision === 'exclude'
        ? story.resource.reader.replacementStoryIds : []), correction,
    };
    story.resource = { ...story.resource, class:correction.resourceClass, reader:decision };
    Object.assign(record,{resourceClass:correction.resourceClass,decision:decision.decision,
      reasonCode:correction.reasonCode,replacementStoryIds:decision.replacementStoryIds,correction});
    if (correction.readerIdentity) {
      if (!/^[a-z0-9-]+\/[a-z0-9_]+$/u.test(correction.readerIdentity)) throw Error('Unsafe explicit reader identity');
      story.readerIdentity = correction.readerIdentity;
      record.readerIdentity = correction.readerIdentity;
    }
    if (!correction.titles) continue;
    const titleSources = Object.fromEntries(['zh-CN','ja-JP'].map(locale => [
      locale, (story.variants.find(variant => variant.sourceLocale === locale)
        ?? story.variants.find(variant => variant.sourceLocale === 'ja-JP'))?.references.script,
    ]));
    const common = {
      title:{...correction.titles}, source:titleSources,
      evidence:Object.fromEntries(['zh-CN','ja-JP'].map(locale => [locale,
        ['method=' + correction.titleMethod,...correction.evidence]])),
      confidence:{'zh-CN':1,'ja-JP':1},
      titleMethod:correction.titleMethod,
      canonicalStoryId:story.canonicalStoryId,
    };
    const nodes = [
      { id:'story/' + story.canonicalStoryId, type:'story',parentId:'arc/' + story.gameId,
        ...common,gameId:story.gameId,
        fallback:{label:story.displayTitle,kind:'technical-script-id',isLocalizedTitle:false} },
      { id:'section/' + story.canonicalStoryId + '/main',type:'section',
        parentId:'story/' + story.canonicalStoryId,...common,sectionId:'main',
        fallback:{label:'main',kind:'stable-section-id',isLocalizedTitle:false} },
    ];
    for (const node of nodes) {
      if (titles.nodes.some(existing => existing.id === node.id)) throw Error('Duplicate corrected title: ' + node.id);
      titles.nodes.push(node);
      for (const locale of ['zh-CN','ja-JP']) authority.records.push({
        nodeId:node.id,locale,title:node.title[locale],source:node.source[locale],
        evidence:node.evidence[locale],confidence:node.confidence[locale],method:correction.titleMethod,
      });
    }
  }
  const included = selection.records.filter(record => record.decision === 'include');
  const excluded = selection.records.filter(record => record.decision === 'exclude');
  const readerIdentities = included.map(record => record.readerIdentity ?? record.canonicalStoryId);
  if (new Set(readerIdentities).size !== included.length) throw Error('Corrected reader identities collide');
  selection.counts = {
    ...selection.counts,archived:selection.records.length,included:included.length,excluded:excluded.length,
    byGame:tally(included,record=>record.gameId),byReason:tally(selection.records,record=>record.reasonCode),
    includedByReason:tally(included,record=>record.reasonCode),excludedByReason:tally(excluded,record=>record.reasonCode),
  };
  selection.sourceRevision = baseRevisions.selection;
  selection.revision = baseRevisions.selection + '--' + correctionRevision;
  reader.sourceBridgeRevision = baseRevisions.adapter;
  reader.bridgeRevision = baseRevisions.adapter + '--' + correctionRevision;
  reader.readerSelection.revision = selection.revision;
  const perGame = {};
  for (const story of reader.stories) {
    const item = perGame[story.gameId] ??= {archived:0,included:0,excluded:0};
    item.archived++; item[story.resource.reader.decision === 'include' ? 'included' : 'excluded']++;
  }
  reader.readerSelection.counts = {
    archived:reader.stories.length,included:included.length,excluded:excluded.length,unreviewed:0,
    byGame:perGame,byReason:selection.counts.byReason,
  };
  const classCounts = tally(reader.stories,story=>story.resource.class);
  Object.assign(reader.counts,{
    readerVisibleStories:included.length,readerExcludedStories:excluded.length,resourceClasses:classCounts,
  });
  reader.resourceClassification = {...reader.resourceClassification,counts:classCounts,
    revision:reader.resourceClassification.revision + '--' + correctionRevision};
  titles.sourceRevision = baseRevisions.titles;
  titles.revision = baseRevisions.titles + '--' + correctionRevision;
  titles.counts.nodes = titles.nodes.length;
  titles.counts.byType = tally(titles.nodes,node=>node.type);
  titles.counts.localizedTitles = Object.fromEntries(['zh-CN','ja-JP'].map(locale => {
    const available = titles.nodes.filter(node=>node.title?.[locale]);
    return [locale,{total:available.length,byType:tally(available,node=>node.type)}];
  }));
  authority.sourceRevision = baseRevisions.titleAuthority;
  authority.revision = baseRevisions.titleAuthority + '--' + correctionRevision;
  titles.authorityAudit.authorityRevision = authority.revision;
  authority.counts = {...authority.counts,records:authority.records.length,promotedNodes:titles.nodes.length,
    byLocale:tally(authority.records,record=>record.locale),
    byNodeType:tally(authority.records,record=>record.nodeId.split('/')[0]),
    narcissuSelectedStories:included.filter(record=>record.gameId.startsWith('narcissu-')).length,
    sourceBasedEditorialStories:READER_SELECTION_CORRECTIONS.filter(c => c.titles).length,
  };
  const receipt = {schema:'reader-selection-corrections/v1',revision:correctionRevision,baseRevisions,
    corrections:READER_SELECTION_CORRECTIONS};
  for (const document of [reader,selection,titles,authority]) document.contentCorrections = receipt;
  selection.sourceBridgeRevision = reader.bridgeRevision;
  return {...result,receipt};
}
