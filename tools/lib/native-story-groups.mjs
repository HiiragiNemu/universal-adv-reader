/**
 * Build navigation from native menu membership and IKURA title commands.
 * No source text, route id, path, event or original title is rewritten.
 *
 * The menu ids below come from config/narcissu-direct-title-evidence-v5.json.
 * Four Narcissu 3rd work labels are also visible in the user's 2026-10-13
 * native-game menu screenshots. Menu entry order supplies chapter order.
 */
const GROUPS = Object.freeze({
  'n3-narcissu1': { title: 'Narcissu 1st', order: 10 },
  'n3-narcissu2': { title: 'Narcissu 2nd', order: 20 },
  'n3-bride': { title: '死神的新娘', order: 30 },
  'n3-ciras': { title: '-Ci- 向着卷云的高度', order: 40 },
  'n3-messiah': { title: '弥赛亚', order: 50 },
  'n3-main': { title: '小小的伊丽丝', order: 60 },
  'n3-himeko': { title: '姬子终章', order: 70 },
  'n3-production': { title: '后记与附加短篇', order: 80 },
  'n10-one-two-narcissu1': { title: 'Narcissu 1st', order: 10 },
  'n10-one-two-narcissu2': { title: 'Narcissu 2nd', order: 20 },
  'n10-himeko': { title: '姬子篇', order: 30 },
  'n10-iris': { title: '小小的伊丽丝', order: 40 },
  'n10-zero': { title: 'Zero 篇', order: 50 },
  'n10-sumire': { title: '堇篇', order: 60 },
  'n10-bonus': { title: '附带短篇', order: 70 },
  'kana-opening': { title: '序篇', order: 10 },
  'kana-childhood': { title: '少年期', order: 20 },
  'kana-middle': { title: '中等期', order: 30 },
  'kana-high': { title: '高等期', order: 40 },
  'kana-endings': { title: '结局', order: 50 },
});

const MENU_ALIASES = Object.freeze({
  'n10-zero-chapters': 'n10-zero',
  'n10-zero-epilogue': 'n10-zero',
  'n10-himeko-start': 'n10-himeko',
});
const SOURCE_GAME_GROUPS = Object.freeze({
  'narcissu-himeko': 'n10-himeko',
  'narcissu-iris': 'n10-iris',
  'narcissu-sumire': 'n10-sumire',
  'narcissu-zero': 'n10-zero',
});
const SOURCE_SUPPLEMENTS = Object.freeze({
  'narcissu-3rd/product': {
    groupId: 'n3-production',
    titleCn: '制作后记与１９９３',
    titleJp: '制作後記',
    evidence: {
      labelBasis: 'Native product menu contains author afterword, other material, Chinese patch afterword and the 1993 short story',
      bodySource: 'archive/derived/scripts/narcissu3/update.arc.unpacked/product.script.json',
      menuSource: 'archive/derived/scripts/narcissu3/update.arc.unpacked/product.strings.json',
    },
  },
  'narcissu-himeko/omake_062': {
    groupId: 'n10-bonus', order: 0,
    titleCn: '短篇 #062 淡路 SA',
    titleJp: 'ショートエピソード ＃０６２ 淡路ＳＡ',
    evidence: {
      labelBasis: 'Chinese navigation translation of the first original Japanese body heading; no Chinese patch text is implied',
      sourceCanonicalStoryId: 'narcissu-himeko/%E3%81%8A%E3%81%BE%E3%81%91',
      bodySource: 'archive/derived/scripts/narcissu10-original-ja-JP/narci_himeko/scenario.arc.unpacked/おまけ.script.json',
      sourceSha256: 'f23c7f73030ebe0bc0225deaa2d973032c209c3cc125ec68abf14c0c77d49f79',
      nativeTitle: '■ショートエピソード　＃０６２　淡路ＳＡ',
      codeOffset: 181, fileOffset: 221,
      rawHex: '81a183568387815b836783478373835c815b836881408194824f8255825181409257984882728260',
    },
  },
});
const NATIVE_RE = /^[A-Za-z0-9_.:-]+$/u;
const collator = new Intl.Collator(['zh-CN', 'ja-JP'], { numeric: true });

function identity(story) {
  return String(story.source_identity ?? story.readerIdentity ?? story.sourceCanonicalStoryId
    ?? story.canonicalStoryId ?? '');
}
function sourceTitle(story, locale) {
  return String(locale === 'ja-JP' ? story.title_jp ?? story.title ?? ''
    : story.title_cn ?? story.title ?? '').trim();
}
function menuEvidence(story) {
  return [...new Set(Object.values(story.title_evidence ?? {}).flat()
    .filter(value => typeof value === 'string' && value.startsWith('groupId='))
    .map(value => value.slice('groupId='.length)))];
}
function menuEntryOrdinal(story) {
  const marker = Object.values(story.title_evidence ?? {}).flat()
    .find(value => typeof value === 'string' && value.startsWith('visibleEntry='));
  const value = marker?.slice('visibleEntry='.length) ?? '';
  if (value === 'prologue') return 0;
  if (value === 'epilogue') return 1000;
  const chapter = value.match(/^chapter:(\d+)$/u);
  return chapter ? Number(chapter[1]) : null;
}
function sourceOrder(story, menuPosition) {
  const canonical = identity(story);
  if (canonical.endsWith('/narsumi00')) return 0;
  if (/\/(?:\d+)?(?:atogaki|himeko_atogaki)$/u.test(canonical)) return 9998;
  if (canonical.endsWith('/omake')) return 9999;
  if (canonical.endsWith('/nar4_ep')) return 1000;
  if (menuPosition !== undefined) return menuPosition + 1;
  const exactMenuOrder = menuEntryOrdinal(story);
  if (exactMenuOrder !== null) return exactMenuOrder;
  const knownHimekoPart = canonical.match(/^narcissu-himeko\/himeko_ep(\d+)$/u);
  if (knownHimekoPart) return Number(knownHimekoPart[1]) + 1;
  return 5000;
}

export function nativeSectionsFromKanaPlan(script) {
  if (!script) return [];
  if (!Array.isArray(script.sections) || script.sections.length === 0) {
    throw new TypeError('KANA chapter plan must retain every native section: ' + script.canonicalStoryId);
  }
  const ids = new Set();
  let previousOrder = -1;
  return script.sections.map(section => {
    const id = String(section.sectionId ?? '');
    const ordinal = Number(section.order);
    const titleCn = String(section.title?.['zh-CN'] ?? '').trim();
    const titleJp = String(section.title?.['ja-JP'] ?? '').trim();
    if (!NATIVE_RE.test(id) || ids.has(id) || !Number.isSafeInteger(ordinal)
      || ordinal <= previousOrder || (!titleCn && !titleJp)) {
      throw new TypeError('Invalid or repeated native section for ' + script.canonicalStoryId);
    }
    ids.add(id); previousOrder = ordinal;
    return {
      id,
      anchorId: id,
      title_cn: titleCn,
      title_jp: titleJp,
      ordinal,
      ...(section.firstEventId ? { target_event_id_jp: section.firstEventId } : {}),
      inherited_title: section.titleKind !== 'native-title-opcode',
      native_title_event: section.titleKind === 'native-title-opcode',
    };
  });
}

function kanaAssignment(story, scriptPlan, nativeOrder) {
  const canonical = identity(story);
  const scriptId = canonical.split('/').at(-1).toUpperCase();
  const nativeIndex = nativeOrder.indexOf(scriptId);
  if (nativeIndex < 0) {
    throw new TypeError('KANA script is absent from the native MAIN order: ' + canonical);
  }
  let groupId;
  const japaneseTitle = scriptPlan?.sections?.[0]?.title?.['ja-JP']
    || sourceTitle(story, 'ja-JP');
  if (['EV00', 'EV01', 'EV11'].includes(scriptId)) groupId = 'kana-opening';
  else if (/^ED\d+[A-Z]?$/u.test(scriptId)) groupId = 'kana-endings';
  else if (/^幼少期[・･·、。，,\s]/u.test(japaneseTitle)) groupId = 'kana-childhood';
  else if (/^中等期[・･·、。，,\s]/u.test(japaneseTitle)) groupId = 'kana-middle';
  else if (/^高等期[・･·、。，,\s]/u.test(japaneseTitle)) groupId = 'kana-high';
  else throw new TypeError('KANA stage has no native title evidence: ' + canonical);

  let titleCn = sourceTitle(story, 'zh-CN');
  let titleJp = sourceTitle(story, 'ja-JP');
  // These labels explain native script roles; the actual title stays in title_*.
  if (scriptId === 'EV00') { titleCn += '（序幕选择）'; titleJp += '（選択）'; }
  if (scriptId === 'EV01') { titleCn += '（正文）'; titleJp += '（本文）'; }
  if (scriptId === 'EV482A') { titleCn += '（续篇 1）'; titleJp += '（続き 1）'; }
  if (scriptId === 'EV482B') { titleCn += '（续篇 2）'; titleJp += '（続き 2）'; }
  const ending = scriptId.match(/^ED(\d+)([A-Z]?)$/u);
  if (ending) {
    titleCn = '结局 ' + ending[1] + ' · ' + titleCn;
    titleJp = 'エンディング ' + ending[1] + ' · ' + titleJp;
    if (scriptId === 'ED4B') { titleCn += '（片尾后续）'; titleJp += '（スタッフロール後）'; }
    if (scriptId === 'ED5') { titleCn += '（前段）'; titleJp += '（前半）'; }
    if (scriptId === 'ED5B') { titleCn += '（后段）'; titleJp += '（後半）'; }
  }
  return {
    groupId, order: nativeIndex, titleCn, titleJp,
    sections: nativeSectionsFromKanaPlan(scriptPlan),
    evidence: {
      method: 'native-MAIN-call-order-and-title-opcode-stage',
      nativeScriptId: scriptId,
      mainFirstOccurrence: nativeIndex,
      source: 'manifests/generated/kana-route-diff/scripts/MAIN.json',
      titleSource: `manifests/generated/kana-route-diff/scripts/${scriptId}.json`,
      titleAuthority: 'paired original 0xF7 title events; untitled openings retain the inherited script title',
    },
  };
}

/**
 * @param {Array<object>} stories Existing index entries (never mutated).
 * @param {{menuGroups?:Array<object>, kanaChapterPlan?:object}} options
 * @returns {{stories:Array<object>,groups:Array<object>,assignments:Array<object>,counts:object}}
 */
export function buildNativeStoryGroups(stories, { menuGroups = [], kanaChapterPlan } = {}) {
  if (!Array.isArray(stories)) throw new TypeError('Expected the existing story index');
  const menuByCanonical = new Map();
  for (const menu of menuGroups) {
    for (const [index, entry] of (menu.entries ?? []).entries()) {
      const previous = menuByCanonical.get(entry.canonicalStoryId);
      if (previous && previous.groupId !== menu.groupId) {
        throw new TypeError('Conflicting native menu membership: ' + entry.canonicalStoryId);
      }
      menuByCanonical.set(entry.canonicalStoryId, {
        groupId: menu.groupId, index, routeSource: menu.routeSource,
      });
    }
  }
  const kanaPlans = new Map((kanaChapterPlan?.scripts ?? [])
    .map(script => [script.canonicalStoryId, script]));
  const nativeOrder = kanaChapterPlan?.nativeMainFirstOccurrenceOrder ?? [];
  const assignments = [];
  const seenRoutes = new Set();
  const enhanced = stories.map(story => {
    if (!story?.id || seenRoutes.has(story.id.toLowerCase())) {
      throw new TypeError('Original story ids must be present and unique');
    }
    seenRoutes.add(story.id.toLowerCase());
    const canonical = identity(story);
    const sourceGame = canonical.split('/')[0];
    let assignment;
    if (sourceGame === 'kana-okaeri') {
      const plan = kanaPlans.get(canonical);
      if (!plan) throw new TypeError('KANA story lacks native chapter coverage: ' + canonical);
      assignment = kanaAssignment(story, plan, nativeOrder);
    } else if (sourceGame.startsWith('narcissu-')) {
      const menu = menuByCanonical.get(canonical);
      const evidenceIds = menuEvidence(story);
      if (menu && evidenceIds.some(id => id !== menu.groupId)) {
        throw new TypeError('Native menu disagrees with the title evidence: ' + canonical);
      }
      if (evidenceIds.length > 1) {
        throw new TypeError('Title evidence has multiple native menu owners: ' + canonical);
      }
      const menuId = menu?.groupId ?? evidenceIds[0];
      const supplement = SOURCE_SUPPLEMENTS[canonical];
      const groupId = supplement?.groupId ?? MENU_ALIASES[menuId] ?? menuId
        ?? (canonical === 'narcissu-3rd/hime_ep' ? 'n3-himeko' : SOURCE_GAME_GROUPS[sourceGame]);
      if (!GROUPS[groupId]) {
        throw new TypeError('No verified native work group for ' + canonical);
      }
      assignment = {
        groupId,
        order: supplement?.order ?? sourceOrder(story, menu?.index),
        titleCn: supplement?.titleCn ?? sourceTitle(story, 'zh-CN'),
        titleJp: supplement?.titleJp ?? sourceTitle(story, 'ja-JP'),
        evidence: {
          method: supplement ? 'editorial-source-based'
            : menuId ? 'native-chapter-menu-target' : 'source-work-and-script-heading',
          ...(supplement?.evidence ?? {}),
          nativeMenuId: menuId ?? null,
          routeSource: menu?.routeSource ?? null,
          originalTitleEvidence: story.title_evidence ?? null,
        },
      };
    } else {
      return { ...story };
    }
    const group = GROUPS[assignment.groupId];
    assignments.push({
      id: story.id,
      canonicalStoryId: canonical,
      previousFolder: story.folder,
      groupId: assignment.groupId,
      title: group.title,
      order: assignment.order,
      nativeSectionCount: assignment.sections?.length ?? story.sections?.length ?? 0,
      evidence: assignment.evidence,
    });
    return {
      ...story,
      folder: group.title,
      native_group_id: assignment.groupId,
      native_group_order: group.order,
      native_story_order: assignment.order,
      nav_title_cn: assignment.titleCn,
      nav_title_jp: assignment.titleJp,
      ...(assignment.sections ? { native_sections: assignment.sections } : {}),
    };
  });

  // A matching title is not a matching story. Number indistinguishable labels
  // only in navigation; keep each original route and every original title.
  const duplicateLabels = new Map();
  for (const story of enhanced) {
    if (!story.native_group_id) continue;
    const key = story.native_group_id + '\0' + story.nav_title_cn;
    const entries = duplicateLabels.get(key) ?? [];
    entries.push(story); duplicateLabels.set(key, entries);
  }
  for (const entries of duplicateLabels.values()) {
    if (entries.length < 2) continue;
    entries.sort((a, b) => a.native_story_order - b.native_story_order || collator.compare(a.id, b.id))
      .forEach((story, index) => {
        story.nav_title_cn += '（' + (index + 1) + '）';
        story.nav_title_jp += '（' + (index + 1) + '）';
      });
  }
  const grouped = new Map();
  for (const story of enhanced) {
    if (!story.native_group_id) continue;
    const group = grouped.get(story.native_group_id) ?? {
      id: story.native_group_id, title: story.folder,
      category: story.category, order: story.native_group_order, stories: [],
    };
    group.stories.push(story);
    grouped.set(group.id, group);
  }
  const groups = [...grouped.values()].map(group => ({
    ...group,
    storyIds: group.stories.sort((a, b) => a.native_story_order - b.native_story_order
      || collator.compare(a.id, b.id)).map(story => story.id),
    storyCount: group.stories.length,
    nativeSectionCount: group.stories.reduce((total, story) =>
      total + (story.native_sections?.length ?? story.sections?.length ?? 0), 0),
    stories: undefined,
  }));
  return {
    schema: 'native-story-navigation/v1',
    stories: enhanced,
    groups,
    assignments,
    counts: {
      inputStories: stories.length,
      outputStories: enhanced.length,
      nativeGroups: groups.length,
      byCategory: Object.fromEntries([...new Set(groups.map(group => group.category))]
        .map(category => [category, groups.filter(group => group.category === category).length])),
      kanaNativeSections: enhanced.filter(story => identity(story).startsWith('kana-okaeri/'))
        .reduce((total, story) => total + (story.native_sections?.length ?? 0), 0),
    },
  };
}
