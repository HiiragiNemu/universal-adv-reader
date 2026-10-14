/**
 * Expose product.mjo's native afterword/short-story menu as stable reader
 * sections, using the original menu case edges and exact resolved event ids.
 * This changes navigation only; events and their runtime graph remain intact.
 */
const LOCALES = ['zh-CN', 'ja-JP'];
const LABELS = new Map([
  ['汉化后记(果断先看这个吧)', 'translation-afterword'],
  ['关于水仙3', 'about'],
  ['ナルキ3について', 'about'],
  ['其他', 'other'],
  ['その他', 'other'],
  ['1993(可能会影响到你的心情)', '1993'],
  ['再见', 'exit'],
  ['さよなな', 'exit'],
]);
const ORDER = ['opening', 'translation-afterword', 'about', 'other', '1993'];
const clean = value => String(value ?? '').normalize('NFKC').trim();
const offset = event => event.source?.nativeUnit?.codeOffset
  ?? event.source?.nativeSelection?.codeOffset
  ?? Math.min(...(event.source?.codeOffsets ?? [Number.MAX_SAFE_INTEGER]));
const heading = (event, locale, label) =>
  /^[■#＃]/u.test(String(event.text?.[locale] ?? '').trim())
  && clean(event.text?.[locale]).replace(/^[■#＃]\s*/u, '') === clean(label).replace(/\(.+\)$/u, '');

export function buildNarcissu3ProductNavigation(readerVariants) {
  if (!Array.isArray(readerVariants) || readerVariants.length === 0) {
    throw new TypeError('Product navigation requires the original reader variants');
  }
  const groups = new Map();
  const variants = [];
  const knownLocales = new Set();
  const add = (key, record, locale) => {
    const group = groups.get(key) ?? { key, sources: {} };
    if (group.sources[locale]) throw new TypeError('Duplicate product section locale: ' + key + ':' + locale);
    group.sources[locale] = record;
    groups.set(key, group);
  };
  for (const variant of readerVariants) {
    const { sourceLocale, variantId, events } = variant;
    if (!LOCALES.includes(sourceLocale) || knownLocales.has(sourceLocale)
      || !Array.isArray(events) || !events.length) {
      throw new TypeError('Invalid or repeated product source locale');
    }
    knownLocales.add(sourceLocale);
    const selections = events.filter(event => event.kind === 'choice'
      && event.source?.nativeSelection?.callHex?.slice(4, 12) === 'e8c27928');
    if (selections.length !== 1) throw new TypeError('Product must have exactly one original menu');
    const menu = selections[0];
    const native = menu.source.nativeSelection;
    const eventById = new Map(events.map(event => [event.eventId, event]));
    const members = events.filter(event => event.kind === 'line');
    const assigned = new Set();
    const opening = members.filter(event => offset(event) < native.codeOffset);
    if (opening.length) {
      opening.forEach(event => assigned.add(event.eventId));
      add('opening', {
        title: sourceLocale === 'zh-CN' ? '开场' : 'はじめに',
        titleAuthority: 'editorial-source-based',
        firstEventId: opening[0].eventId,
        codeOffset: offset(opening[0]),
        sourceInstructionStart: 0,
        sourceInstructionEndExclusive: native.codeOffset,
        nativeTitleEvent: false,
        eventIds: opening.map(event => event.eventId),
        variantId,
      }, sourceLocale);
    }
    const actions = [];
    for (const choice of menu.choices) {
      const label = String(choice.label?.[sourceLocale] ?? '');
      const key = LABELS.get(clean(label));
      if (!key) throw new TypeError('Unrecognized original product menu label: ' + label);
      const arm = native.caseEdges.find(edge => edge.caseValue === choice.source?.nativeCaseValue);
      const operand = native.options.find(option => option.caseValue === choice.source?.nativeCaseValue);
      if (!arm || !operand || operand.rawHex !== choice.source?.rawHex || operand.text !== label) {
        throw new TypeError('Product menu option lost its original case/raw-byte identity');
      }
      const target = eventById.get(choice.nextEventId);
      if (key === 'exit') {
        if (!target || target.kind !== 'end') throw new TypeError('Product exit unexpectedly contains story text');
        actions.push({ label, nextEventId: choice.nextEventId, nativeCaseValue: arm.caseValue,
          codeOffset: operand.codeOffset, rawHex: operand.rawHex });
        continue;
      }
      if (!target || target.kind !== 'line' || !Number.isSafeInteger(arm.nextCaseCodeOffset)) {
        throw new TypeError('Product section does not resolve to an original body event');
      }
      const sectionEvents = members.filter(event => offset(event) >= arm.armCodeOffset
        && offset(event) < arm.nextCaseCodeOffset);
      if (!sectionEvents.some(event => event.eventId === choice.nextEventId)) {
        throw new TypeError('Product menu target lies outside its original branch range');
      }
      sectionEvents.forEach(event => {
        if (assigned.has(event.eventId)) throw new TypeError('Product body event belongs to two sections');
        assigned.add(event.eventId);
      });
      add(key, {
        title: label,
        titleAuthority: 'native-menu-choice-operand',
        firstEventId: target.eventId,
        codeOffset: offset(target),
        sourceInstructionStart: arm.armCodeOffset,
        sourceInstructionEndExclusive: arm.nextCaseCodeOffset,
        nativeTitleEvent: heading(target, sourceLocale, label),
        eventIds: sectionEvents.map(event => event.eventId),
        variantId,
        menuEventId: menu.eventId,
        menuCallCodeOffset: native.callCodeOffset,
        menuCallHex: native.callHex,
        nativeCaseValue: arm.caseValue,
        labelCodeOffset: operand.codeOffset,
        labelRawHex: operand.rawHex,
      }, sourceLocale);
    }
    if (assigned.size !== members.length) {
      throw new TypeError('Product native sections leave body events uncovered');
    }
    variants.push({ sourceLocale, variantId, bodyEventCount: members.length,
      assignedEventCount: assigned.size, menuEventId: menu.eventId, actions });
  }
  const ordered = [...groups.values()].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  const nativeSections = ordered.map((group, index) => {
    const cn = group.sources['zh-CN'], jp = group.sources['ja-JP'];
    const id = 'native-product-' + group.key;
    return {
      id, anchorId: id, ordinal: index + 1,
      title_cn: cn?.title ?? '', title_jp: jp?.title ?? '',
      available_locales: LOCALES.filter(locale => Boolean(group.sources[locale])),
      ...(cn ? { target_event_id_cn: cn.firstEventId } : {}),
      ...(jp ? { target_event_id_jp: jp.firstEventId } : {}),
      native_title_event: Boolean(cn?.nativeTitleEvent || jp?.nativeTitleEvent),
      inherited_title: group.key === 'opening',
    };
  });
  return {
    schema: 'narcissu3-product-native-navigation/v1',
    nativeSections,
    variants,
    sectionEvidence: ordered.map(group => ({ id: 'native-product-' + group.key, sources: group.sources })),
    counts: { nativeSections: nativeSections.length,
      chineseSections: nativeSections.filter(section => section.available_locales.includes('zh-CN')).length,
      japaneseSections: nativeSections.filter(section => section.available_locales.includes('ja-JP')).length },
  };
}
