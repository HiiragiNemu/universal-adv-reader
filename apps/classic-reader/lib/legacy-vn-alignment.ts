import type { AlignedStoryLine, StoryLine } from './story-parser.ts';
import { buildLegacyVoiceSlots, type LegacyVoiceCue, type LegacyVoiceRouteDocument, type LegacyVoiceSlot, type NativePresentationGroup } from './legacy-vn-voice-routing.ts';

export type ReviewedBilingualPassage = {
  schema: 'source-bound-bilingual-review/v1'; id: string;
  reviewer: 'AI'; humanVerified: false; translationQualityVerified: false;
  note: string; evidenceSha256: string; contextId: string;
  cnEventIds: string[]; jpEventIds: string[];
};

export type NativeAlignedRow = AlignedStoryLine & {
  pairing?: 'verified' | 'reviewed' | 'unpaired-cn' | 'unpaired-jp';
  reviewedPassage?: ReviewedBilingualPassage;
  reviewedParagraphs?: { cn: StoryLine[]; jp: StoryLine[] };
  nativeKeys: string[];
  nativeEventId?: string;
  nativeGroupReference?: boolean;
  presentationGroup?: NativePresentationGroup;
  cnIndices: number[];
  jpIndices: number[];
  cnSlot: LegacyVoiceSlot | null;
  jpSlot: LegacyVoiceSlot | null;
};
type NativeEditableLine = StoryLine & { nativeAlignmentKey?: string };

/** Same native occurrence in two language panes is one presentation. Preserve
 * its multiplicity, and never treat a URL repeated at another event as a duplicate.
 */
export function mergeNativeVoiceCues(cn: LegacyVoiceCue[], jp: LegacyVoiceCue[]): LegacyVoiceCue[] {
  const key = (cue: LegacyVoiceCue) => JSON.stringify(cue.occurrenceId
    ? ['native-instruction', cue.occurrenceId, cue.mediaId, cue.url]
    : [cue.eventId, cue.cueId, cue.mediaId, cue.url]);
  const remaining = new Map<string, number>();
  for (const cue of cn) remaining.set(key(cue), (remaining.get(key(cue)) ?? 0) + 1);
  const result = [...cn];
  for (const cue of jp) {
    const id = key(cue), count = remaining.get(id) ?? 0;
    if (count > 0) remaining.set(id, count - 1);
    else result.push(cue);
  }
  return result;
}
export function mergeNativeVoiceSlots(cn?: LegacyVoiceSlot | null, jp?: LegacyVoiceSlot | null): LegacyVoiceSlot | null {
  if (!cn) return jp ?? null;
  if (!jp) return cn;
  return { eventIds: [...new Set([...cn.eventIds, ...jp.eventIds])], cues: mergeNativeVoiceCues(cn.cues, jp.cues) };
}

/** Bind each physical source line to the route's explicit event/choice identity.
 * Translation omissions leave empty cells, not a shift of all following rows.
 * Different compiled variants intentionally require their own correspondence
 * manifest; matching byte-offset IDs is not evidence of cross-version identity.
 */
export function buildSharedNativeAlignment(
  route: LegacyVoiceRouteDocument,
  cn: StoryLine[],
  jp: StoryLine[],
): NativeAlignedRow[] | null {
  if (!route.japaneseVariantId) return null;
  if (route.chineseVariantId && route.chineseVariantId !== route.japaneseVariantId) return null;
  if (!route.chineseVariantId && cn.length) throw Error('无中文版本却提供了中文原作文本');
  const variant = route.variantRoutes.find(item => item.variantId === route.japaneseVariantId);
  if (!variant) throw Error('原作事件版本缺失');
  const cnSlots = buildLegacyVoiceSlots(route, 'zh-CN', cn).eventSlots;
  const jpSlots = buildLegacyVoiceSlots(route, 'ja-JP', jp).eventSlots;
  const rows: NativeAlignedRow[] = [];
  const cursors = { cn: 0, jp: 0 };
  const contentIndices = { cn: 0, jp: 0 };
  const keys = new Set<string>();
  const add = (key: string, cnIndex: number | null, jpIndex: number | null,
    event?: { eventId: string; source?: { presentationGroup?: NativePresentationGroup } }) => {
    if (keys.has(key)) throw Error('原作事件键重复');
    keys.add(key);
    if (cnIndex === null && jpIndex === null) return;
    rows.push({ nativeKeys: [key], cn: cnIndex === null ? undefined : cn[cnIndex], jp: jpIndex === null ? undefined : jp[jpIndex],
      cnIndices: cnIndex === null ? [] : [cnIndex], jpIndices: jpIndex === null ? [] : [jpIndex],
      cnSlot: cnIndex === null ? null : cnSlots[cnIndex], jpSlot: jpIndex === null ? null : jpSlots[jpIndex],
      ...(event?.source?.presentationGroup ? { nativeEventId: event.eventId, presentationGroup: event.source.presentationGroup } : {}) });
  };
  const take = (language: 'cn' | 'jp', validate: (line: StoryLine) => boolean): number => {
    const index = cursors[language]++, line = (language === 'cn' ? cn : jp)[index];
    if (!line || !validate(line)) throw Error(`${language} 原作事件与文本结构不一致：${index}`);
    return index;
  };
  variant.sections.forEach((section, sectionIndex) => {
    if (!section.sectionId) throw Error('原作 Section 标识缺失');
    const sectionKey = JSON.stringify([variant.variantId, section.sectionId]);
    const header = (line: StoryLine) => Boolean(line.isHeader && line.headerSection === String(sectionIndex + 1));
    add(`${sectionKey}/header`, cn.length ? take('cn', header) : null, jp.length ? take('jp', header) : null);
    for (const event of section.events) {
      const key = `${sectionKey}/${event.eventId}`;
      if (event.kind === 'line') {
        const takeBody = (language: 'cn' | 'jp', locale: 'zh-CN' | 'ja-JP') => {
          const nativeIndex = event.textLineIndex?.[locale];
          if (nativeIndex === undefined) return null;
          if (nativeIndex !== contentIndices[language]++) throw Error('原作文本事件顺序不一致');
          return take(language, line => !line.isHeader && !line.isChoice);
        };
        add(key, takeBody('cn', 'zh-CN'), takeBody('jp', 'ja-JP'), event);
      } else if (event.kind === 'choice') {
        for (const choice of event.choices ?? []) {
          const target = (choice.nextEventId || choice.choiceId).replace(/^group_?/i, '');
          const takeChoice = (language: 'cn' | 'jp', locale: 'zh-CN' | 'ja-JP') => {
            const label = choice.label?.[locale]?.trim();
            if (!label) return null;
            return take(language, line => Boolean(line.isChoice && line.choiceTargetId === target && line.choiceLabel?.trim() === label));
          };
          add(`${key}/choice/${choice.choiceId}`, takeChoice('cn', 'zh-CN'), takeChoice('jp', 'ja-JP'));
        }
      }
    }
  });
  if (cursors.cn !== cn.length || cursors.jp !== jp.length) throw Error('原作事件未覆盖全部文本或分支');
  return rows;
}

/** Display-only reconstruction of native append buffers. A matching speaker
 * is insufficient: every visible member must occur in the source-proven group,
 * in its original order, without a choice/header/voice boundary. Raw event rows
 * remain unchanged and continue to be the sole input to the editor.
 */
export function mergeNativeAlignedRows(rows: NativeAlignedRow[]): NativeAlignedRow[] {
  const result: NativeAlignedRow[] = [];
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const signature = (group: NativePresentationGroup) => {
    const { position: _position, ...shared } = group;
    return shared;
  };
  for (let index = 0; index < rows.length;) {
    const first = rows[index], group = first.presentationGroup;
    const review = first.reviewedPassage;
    if (review && (review.cnEventIds.length > 1 || review.jpEventIds.length > 1)) {
      let end = index + 1;
      while (end < rows.length && rows[end].reviewedPassage?.id === review.id) end++;
      const members = rows.slice(index, end);
      if (members.some(row => row.nativeKeys.length !== 1 || !equal(row.reviewedPassage, review)
        || row.cn?.isChoice || row.jp?.isChoice || row.cn?.isHeader || row.jp?.isHeader)) {
        throw Error('复核句段包含重复来源或非正文边界');
      }
      const paragraphs = { cn: [] as StoryLine[], jp: [] as StoryLine[] };
      for (const language of ['cn', 'jp'] as const) {
        const slotKey = language === 'cn' ? 'cnSlot' : 'jpSlot';
        const ids = members.flatMap(row => row[slotKey]?.eventIds ?? []);
        if (!equal(ids, review[language === 'cn' ? 'cnEventIds' : 'jpEventIds'])) throw Error('复核句段事件不完整');
        // Reconstruct only the original engine's append buffers. Separate
        // paragraphs stay separate even when a translation has N:M units.
        const original = members.filter(row => row[language]).map(row => ({ ...row, reviewedPassage: undefined }));
        paragraphs[language] = mergeNativeAlignedRows(original).map(row => row[language]!);
      }
      const combine = (language: 'cn' | 'jp'): StoryLine => ({
        ...paragraphs[language][0], text: paragraphs[language].map(line => line.text).join('\n\n'),
      });
      const slot = (language: 'cn' | 'jp'): LegacyVoiceSlot => {
        const parts = members.flatMap(row => row[language === 'cn' ? 'cnSlot' : 'jpSlot'] ?? []);
        return { eventIds: parts.flatMap(part => part.eventIds), cues: parts.flatMap(part => part.cues) };
      };
      result.push({ ...first, pairing: 'reviewed', presentationGroup: undefined,
        nativeKeys: members.flatMap(row => row.nativeKeys), cn: combine('cn'), jp: combine('jp'),
        reviewedParagraphs: paragraphs, cnIndices: members.flatMap(row => row.cnIndices),
        jpIndices: members.flatMap(row => row.jpIndices), cnSlot: slot('cn'), jpSlot: slot('jp') });
      index = end; continue;
    }
    if (!group || group.displayJoinMode !== 'native-append' || first.nativeKeys.length !== 1) {
      result.push({ ...first }); index += 1; continue;
    }
    let end = index + 1;
    while (end < rows.length && rows[end].presentationGroup?.id === group.id) end += 1;
    const members = rows.slice(index, end);
    const visible = new Set([...group.visibleEventIdsByLocale['zh-CN'], ...group.visibleEventIdsByLocale['ja-JP']]);
    const expectedIds = group.sourceEventIds.filter(id => visible.has(id));
    const majiro = group.schema === 'majiro-presentation-group/v1';
    const nativeIds = (row: NativeAlignedRow, language: 'cn' | 'jp'): string[] =>
      majiro ? row[language === 'cn' ? 'cnSlot' : 'jpSlot']?.eventIds ?? []
        : row.nativeEventId ? [row.nativeEventId] : [];
    let valid = (majiro || equal(members.map(row => row.nativeEventId), expectedIds))
      && members.every(row => row.nativeKeys.length === 1 && row.presentationGroup
        && equal(signature(row.presentationGroup), signature(group))
        && !row.cn?.isHeader && !row.jp?.isHeader && !row.cn?.isChoice && !row.jp?.isChoice
        && !row.cn?.isScene0 && !row.jp?.isScene0);
    for (const [language, locale] of [['cn', 'zh-CN'], ['jp', 'ja-JP']] as const) {
      const firstLine = members.find(row => row[language])?.[language];
      const sourceIds = members.filter(row => row[language === 'cn' ? 'cnIndices' : 'jpIndices'].length > 0).flatMap(row => nativeIds(row, language));
      valid &&= equal(sourceIds, group.visibleEventIdsByLocale[locale]);
      // A user revision can introduce an explicit new speaker. Keep its raw
      // boundary instead of replacing the user's choice with source metadata.
      valid &&= members.every((row, position) => {
        const line = row[language], slot = row[language === 'cn' ? 'cnSlot' : 'jpSlot'];
        return (!line || !line.speaker || line.speaker === '旁白' || line.speaker === firstLine?.speaker)
          && (position === 0 || group.allowFollowingVoiceCues || !slot?.cues.length);
      });
    }
    if (!valid || members.length < 2) result.push(...members.map(row => ({ ...row })));
    else {
      const line = (language: 'cn' | 'jp'): StoryLine | undefined => {
        const parts = members.filter(row => row[language]);
        return parts.length ? { ...parts[0][language]!, text: parts.map((row, partIndex) =>
          (partIndex ? group.joinBeforeByEventId?.[nativeIds(row, language)[0] ?? row.nativeEventId ?? ''] ?? '' : '') + row[language]!.text).join('') } : undefined;
      };
      const slot = (language: 'cn' | 'jp'): LegacyVoiceSlot | null => {
        const parts = members.flatMap(row => row[language === 'cn' ? 'cnSlot' : 'jpSlot']
          ? [row[language === 'cn' ? 'cnSlot' : 'jpSlot']!] : []);
        return parts.length ? { eventIds: parts.flatMap(part => part.eventIds), cues: parts.flatMap(part => part.cues) } : null;
      };
      result.push({ ...first, nativeKeys: members.flatMap(row => row.nativeKeys), cn: line('cn'), jp: line('jp'),
        ...(members.some(row => row.reviewedPassage) ? { pairing: 'reviewed' as const,
          reviewedPassage: members.find(row => row.reviewedPassage)?.reviewedPassage } : {}),
        cnIndices: members.flatMap(row => row.cnIndices), jpIndices: members.flatMap(row => row.jpIndices),
        cnSlot: slot('cn'), jpSlot: slot('jp') });
    }
    index = end;
  }
  return result;
}

export function seedNativeEditableLines(rows: NativeAlignedRow[], seed: 'empty' | 'jp' | 'current'): StoryLine[] {
  return rows.map(row => {
    if (row.nativeKeys.length !== 1) throw Error('编辑必须使用未合并的原作事件');
    const basis = row.cn ?? row.jp!;
    const structural = basis.isHeader || basis.isChoice;
    return { ...basis, nativeAlignmentKey: row.nativeKeys[0],
      speaker: row.nativeGroupReference ? '' : row.cn?.speaker ?? row.jp?.speaker ?? '',
      text: structural ? basis.text : row.nativeGroupReference ? '' : seed === 'jp' ? (row.jp ?? basis).text : seed === 'current' ? row.cn?.text ?? '' : '' };
  });
}

export function applyNativeEditedLines(rows: NativeAlignedRow[], edited: StoryLine[]): NativeAlignedRow[] {
  const byKey = new Map<string, StoryLine>();
  for (const line of edited as NativeEditableLine[]) {
    if (!line.nativeAlignmentKey || byKey.has(line.nativeAlignmentKey)) throw Error('编辑事件键缺失或重复');
    byKey.set(line.nativeAlignmentKey, line);
  }
  if (byKey.size !== rows.length) throw Error('编辑事件数量改变');
  return rows.map(row => {
    const line = byKey.get(row.nativeKeys[0]);
    if (!line) throw Error('编辑内容与当前原作事件不匹配');
    return { ...row, cn: line, cnSlot: row.cnSlot ?? (row.pairing ? null : row.jpSlot) };
  });
}

/** Plain TXT has no event IDs. Only an exact unmerged positional round-trip is
 * accepted; structural targets are checked and never copied from an upload.
 * Native structured patch/export remains the separate GEN-10 delivery.
 */
export function importNativeEditableLines(rows: NativeAlignedRow[], imported: StoryLine[]): StoryLine[] {
  if (rows.length !== imported.length) throw Error('导入 TXT 的原作事件数量不一致；请使用逐事件下载文件');
  return seedNativeEditableLines(rows, 'current').map((basis, index) => {
    const line = imported[index];
    if (Boolean(line.isHeader) !== Boolean(basis.isHeader) || Boolean(line.isChoice) !== Boolean(basis.isChoice)
      || (basis.isHeader && line.headerId !== basis.headerId)
      || (basis.isChoice && line.choiceTargetId !== basis.choiceTargetId)) throw Error(`导入 TXT 的分支或标题结构不一致：${index}`);
    if (basis.isHeader || basis.isChoice) return basis;
    return { ...basis, speaker: line.speaker, text: line.text };
  });
}
