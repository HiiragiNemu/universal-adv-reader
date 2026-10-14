/**
 * Native KANA title metadata for the Classic materializer.
 *
 * Keep the complete `main` route as the event-graph authority. A native chapter
 * is a range into that graph, not a new graph: choices may cross title ranges.
 * IDs use bilingual instruction ordinals, so translated byte offsets do not
 * change them. Existing event IDs and edges are never rewritten by this module.
 */
const normalized = (value) => String(value ?? '').replace(/\r\n?/gu, '\n');
const visible = (value) => Boolean(normalized(value).trim());
const sourceInstruction = (event) => event.source?.instructionIndex
  ?? event.source?.selectorInstructionIndex;

export function kanaNormalInstructionBoundary(route) {
  const boundaries = (route.crossScriptTransfers ?? [])
    .filter((transfer) => transfer.kind === 'load-script'
      && String(transfer.jaTargetScript).toLowerCase() === 'title')
    .map((transfer) => transfer.sourceInstructionIndex);
  const count = route.summary?.instructionPairs;
  if (!Number.isInteger(count) || count < 0
    || boundaries.some((value) => !Number.isInteger(value) || value < 0 || value >= count)) {
    throw new TypeError('KANA route has invalid instruction bounds');
  }
  return Math.min(count, ...boundaries);
}

export function deriveKanaNativeSections(route, { fallbackTitle = {} } = {}) {
  const boundary = kanaNormalInstructionBoundary(route);
  const alignments = (route.textAlignments ?? [])
    .filter((alignment) => alignment.instructionIndex < boundary);
  if (alignments.some((alignment, index) => !Number.isInteger(alignment.instructionIndex)
    || (index > 0 && alignment.instructionIndex <= alignments[index - 1].instructionIndex))) {
    throw new TypeError('KANA text alignments must have unique increasing instruction indices');
  }
  const titles = alignments.filter((alignment) => alignment.kind === 'title');
  const firstTitle = titles[0]?.instructionIndex ?? boundary;
  const opening = !titles.length || alignments.some((alignment) =>
    alignment.instructionIndex < firstTitle && alignment.kind !== 'title'
      && (visible(alignment.jaText) || visible(alignment.zhText)));
  const starts = [
    ...(opening ? [{ start: 0, title: null }] : []),
    ...titles.map((title) => ({ start: title.instructionIndex, title })),
  ];
  return starts.map(({ start, title }, index) => {
    const end = starts[index + 1]?.start ?? boundary;
    const members = alignments.filter((alignment) =>
      start <= alignment.instructionIndex && alignment.instructionIndex < end);
    if (!members.some((alignment) => visible(alignment.jaText) || visible(alignment.zhText))) {
      throw new TypeError(`KANA native section at instruction ${start} has no visible text`);
    }
    const firstVisible = (locale) => members.find((alignment) =>
      visible(locale === 'ja-JP' ? alignment.jaText : alignment.zhText));
    const firstJapanese = firstVisible('ja-JP');
    const firstChinese = firstVisible('zh-CN');
    return {
      sectionId: title ? `native-title-${start}` : 'native-opening',
      legacySectionId: 'main',
      order: index + 1,
      sourceInstructionStart: start,
      sourceInstructionEndExclusive: end,
      title: title ? {
        'zh-CN': normalized(title.zhText).trim(),
        'ja-JP': normalized(title.jaText).trim(),
      } : { ...fallbackTitle },
      titleKind: title ? 'native-title-opcode' : 'inherited-opening-title',
      titleSource: title ? {
        opcode: 0xF7,
        instructionIndex: start,
        japaneseOffset: title.jaOffset,
        chineseOffset: title.zhOffset,
      } : null,
      firstJapaneseTextInstructionIndex: firstJapanese?.instructionIndex ?? null,
      firstChineseTextInstructionIndex: firstChinese?.instructionIndex ?? null,
      firstJapaneseTextIndex: alignments.filter((alignment) =>
        alignment.instructionIndex < start && alignment.kind !== 'localized-label'
          && visible(alignment.jaText)).length,
      firstChineseTextIndex: alignments.filter((alignment) =>
        alignment.instructionIndex < start && alignment.kind !== 'localized-label'
          && visible(alignment.zhText)).length,
    };
  });
}

export function kanaSectionForInstruction(sections, instructionIndex) {
  if (!Number.isInteger(instructionIndex)) return null;
  return sections.find((section) =>
    section.sourceInstructionStart <= instructionIndex
      && instructionIndex < section.sourceInstructionEndExclusive) ?? null;
}

export function partitionKanaReaderEvents(events, sections) {
  const partitions = sections.map((section) => ({ ...section, events: [] }));
  const byId = new Map(partitions.map((section) => [section.sectionId, section]));
  const assigned = new Set();
  for (const event of events) {
    if (event.kind === 'end') continue;
    const instruction = sourceInstruction(event);
    const section = kanaSectionForInstruction(sections, instruction);
    if (!section) {
      throw new TypeError(`KANA event ${event.eventId} at ${instruction} has no native title range`);
    }
    if (assigned.has(event.eventId)) throw new TypeError(`Duplicate KANA event ${event.eventId}`);
    assigned.add(event.eventId);
    byId.get(section.sectionId).events.push(event);
  }
  for (const section of partitions) {
    if (!section.events.length) throw new TypeError(`Empty KANA native section ${section.sectionId}`);
    const firstForLocale = (locale) => section.events.find((event) =>
      event.kind === 'line' && visible(event.text?.[locale]));
    section.entryEventId = section.events[0].eventId;
    section.targetEventIdByLocale = {
      'ja-JP': firstForLocale('ja-JP')?.eventId ?? section.entryEventId,
      'zh-CN': firstForLocale('zh-CN')?.eventId ?? section.entryEventId,
    };
  }
  return partitions;
}

/** Build fresh metadata directly from an adapter route and its original events. */
export function buildKanaNativePlan({ route, events, fallbackTitle = {} }) {
  if (!route.scriptId) throw new TypeError('KANA native plan requires a script ID');
  const sections = deriveKanaNativeSections(route, { fallbackTitle });
  const partitions = partitionKanaReaderEvents(events, sections);
  return {
    schema: 'kana-native-script-plan/v1',
    scriptId: route.scriptId,
    canonicalStoryId: `kana-okaeri/${route.scriptId.toLowerCase()}`,
    originalSectionId: 'main',
    normalInstructionBoundary: kanaNormalInstructionBoundary(route),
    nativeTitleCount: sections.filter((section) => section.titleKind === 'native-title-opcode').length,
    hasUntitledOpening: sections.some((section) => section.sectionId === 'native-opening'),
    sections: partitions.map(({ events: members, ...section }) => ({
      ...section,
      firstEventId: section.entryEventId,
      sourceEventIds: members.map((event) => event.eventId),
      japaneseOffset: section.titleSource?.japaneseOffset
        ?? members[0]?.source?.jaOffset ?? null,
      chineseOffset: section.titleSource?.chineseOffset
        ?? members[0]?.source?.zhOffset ?? null,
    })),
  };
}

/** Stable navigation order from native MAIN calls, retaining branch alternatives. */
export function kanaNarrativeOrderFromMainRoute(route, { knownScriptIds = null } = {}) {
  if (String(route.scriptId).toUpperCase() !== 'MAIN') {
    throw new TypeError('KANA navigation order must come from the MAIN script');
  }
  const allowed = knownScriptIds ? new Set(knownScriptIds.map((id) => id.toUpperCase())) : null;
  const output = [];
  for (const transfer of [...route.crossScriptTransfers].sort((a, b) =>
    a.sourceInstructionIndex - b.sourceInstructionIndex)) {
    const target = String(transfer.jaTargetScript).toUpperCase();
    if (!/^(?:EV|ED)[0-9A-Z]+$/u.test(target) || (allowed && !allowed.has(target))) continue;
    if (!output.includes(target)) output.push(target);
  }
  return output;
}
