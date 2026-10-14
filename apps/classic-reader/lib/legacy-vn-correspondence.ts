import type { StoryLine } from './story-parser.ts';
import type { LegacyVoiceCue, LegacyVoiceRouteDocument, NativePresentationGroup } from './legacy-vn-voice-routing.ts';
import { legacyVoiceRoutePath } from './legacy-vn-voice-routing.ts';
import { buildSharedNativeAlignment, type NativeAlignedRow, type ReviewedBilingualPassage } from './legacy-vn-alignment.ts';

export type NativeCorrespondence = {
  schema: 'native-story-correspondence/v1';
  storyId: string;
  cnVariantId: string;
  jpVariantId: string;
  hashes: { route: string; cnText: string; jpText: string };
  pairs: Array<{ cnEventId: string; jpEventId: string }>;
  reviewedPassages?: ReviewedBilingualPassage[];
  groupPairs?: Array<{ cnEventIds: string[]; jpEventIds: string[]; proof: {
    classification: 'exact-native-display-text' | 'lexical-with-punctuation-variation';
    completeNativeBuffers: true; existingAnchorsRetainOrder: true;
    uniqueInEachNativeChapterAndN10Binding: true;
    cnNativeBuffer: { eventIds: string[]; joinBeforeByEventId: Record<string,string> };
    jpNativeBuffer: { eventIds: string[]; joinBeforeByEventId: Record<string,string> };
  } }>;
  choicePairs?: Array<{
    cnEventId: string; jpEventId: string;
    method: 'native-menu-call-return-value-and-mapped-case-edges';
    options: Array<{ cnChoiceId: string; jpChoiceId: string; caseValue: number; cnTargetEventId: string; jpTargetEventId: string }>;
  }>;
  unpairedChoices?: { cn: string[]; jp: string[] };
  cueAliases: Array<{ cnCueId: string; jpCueId: string; cnEventId: string; jpEventId: string; mediaId: string; occurrenceId: string }>;
  unpaired: { cn: string[]; jp: string[] };
};

/** Hash the actual source bytes represented by UTF-8, without editorial newline
 * or whitespace normalization. The published sidecar is bound to these inputs.
 */
export async function hashNativeText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function loadNativeCorrespondence(
  route: LegacyVoiceRouteDocument,
  cnText: string,
  jpText: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<NativeCorrespondence> {
  const routePath = legacyVoiceRoutePath(route.canonicalStoryId);
  if (!routePath || !route.documentSha256) throw Error('原作对应缺少来源绑定');
  const response = await fetcher(routePath.replace(/\.routes\.json$/, '.alignment.json'), { signal, cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw Error(`原作对应清单读取失败（HTTP ${response.status}）`);
  const maximum = 2 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > maximum || !response.body) {
    await response.body?.cancel(); throw Error('原作对应清单大小无效');
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > maximum) { await reader.cancel(); throw Error('原作对应清单超过大小限制'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as NativeCorrespondence;
  if (value?.schema !== 'native-story-correspondence/v1' || value.storyId !== route.canonicalStoryId
    || value.cnVariantId !== route.chineseVariantId || value.jpVariantId !== route.japaneseVariantId
    || !Array.isArray(value.pairs) || !Array.isArray(value.cueAliases)
    || (value.choicePairs !== undefined && !Array.isArray(value.choicePairs))
    || (value.groupPairs !== undefined && !Array.isArray(value.groupPairs))
    || (value.reviewedPassages !== undefined && !Array.isArray(value.reviewedPassages))
    || !Array.isArray(value.unpaired?.cn) || !Array.isArray(value.unpaired?.jp)) throw Error('原作对应清单身份或结构不一致');
  const [cnHash, jpHash] = await Promise.all([hashNativeText(cnText), hashNativeText(jpText)]);
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (value.hashes?.route !== route.documentSha256 || value.hashes?.cnText !== cnHash || value.hashes?.jpText !== jpHash) {
    throw Error('原作对应清单与当前路由／中日源文本版本不一致，请重新生成');
  }
  return value;
}

export function applyNativeCueAliases(cues: LegacyVoiceCue[], language: 'cn' | 'jp', manifest: NativeCorrespondence | null): LegacyVoiceCue[] {
  if (!manifest) return cues;
  const aliases = new Map(manifest.cueAliases.map(alias => [JSON.stringify([
    language === 'cn' ? alias.cnCueId : alias.jpCueId,
    language === 'cn' ? alias.cnEventId : alias.jpEventId, alias.mediaId,
  ]), alias.occurrenceId]));
  return cues.map(cue => {
    const occurrenceId = aliases.get(JSON.stringify([cue.cueId, cue.eventId, cue.mediaId]));
    return occurrenceId ? { ...cue, occurrenceId } : cue;
  });
}

export function unpairedNativeCorrespondence(route: LegacyVoiceRouteDocument): NativeCorrespondence {
  const bodies = (id: string | null) => route.variantRoutes.find(v => v.variantId === id)?.sections
    .flatMap(s => s.events).filter(e => e.kind === 'line').map(e => e.eventId) ?? [];
  return { schema: 'native-story-correspondence/v1', storyId: route.canonicalStoryId,
    cnVariantId: route.chineseVariantId ?? '', jpVariantId: route.japaneseVariantId,
    hashes: { route: '', cnText: '', jpText: '' }, pairs: [], cueAliases: [],
    unpaired: { cn: bodies(route.chineseVariantId), jp: bodies(route.japaneseVariantId) } };
}

/** All original rows survive. Only evidenced pairs occupy the same bilingual
 * row. Unknown intervals retain separate CN/JP rows and stable source keys;
 * they are NOT labelled added/deleted or silently zipped by ordinal position.
 */
export function buildParallelNativeAlignment(
  route: LegacyVoiceRouteDocument,
  cn: StoryLine[], jp: StoryLine[], manifest: NativeCorrespondence,
): NativeAlignedRow[] {
  if (!route.chineseVariantId || route.chineseVariantId === route.japaneseVariantId
    || manifest.storyId !== route.canonicalStoryId || manifest.cnVariantId !== route.chineseVariantId
    || manifest.jpVariantId !== route.japaneseVariantId) throw Error('跨版本对应身份不一致');
  const cnVariant = route.variantRoutes.find(v => v.variantId === route.chineseVariantId)!;
  const jpVariant = route.variantRoutes.find(v => v.variantId === route.japaneseVariantId)!;
  if (!cnVariant || !jpVariant || cnVariant.sections.length !== jpVariant.sections.length
    || cnVariant.sections.some((section, index) => !section.sectionId || section.sectionId !== jpVariant.sections[index].sectionId)) throw Error('跨版本 Section 需要独立原作对应证据');
  const cr = buildSharedNativeAlignment({ ...route, japaneseVariantId: route.chineseVariantId }, cn, [])!;
  const jr = buildSharedNativeAlignment({ ...route, chineseVariantId: route.japaneseVariantId }, [], jp)!;
  const ci = new Map(cr.flatMap((row, index) => row.cnSlot?.eventIds.map(id => [id, index] as const) ?? []));
  const ji = new Map(jr.flatMap((row, index) => row.jpSlot?.eventIds.map(id => [id, index] as const) ?? []));
  const ce = cnVariant.sections.flatMap(s => s.events).filter(e => e.kind === 'line').map(e => e.eventId);
  const je = jpVariant.sections.flatMap(s => s.events).filter(e => e.kind === 'line').map(e => e.eventId);
  const corder = new Map(ce.map((id, index) => [id, index])), jorder = new Map(je.map((id, index) => [id, index]));
  const pairedCn = new Set<string>(), pairedJp = new Set<string>();
  let previousCn = -1, previousJp = -1;
  const anchors: Array<[number, number]> = [];
  for (const pair of manifest.pairs) {
    const c = corder.get(pair.cnEventId), j = jorder.get(pair.jpEventId);
    if (c === undefined || j === undefined || c <= previousCn || j <= previousJp) throw Error('跨版本对应有重复、未知或交叉事件');
    previousCn = c; previousJp = j; pairedCn.add(pair.cnEventId); pairedJp.add(pair.jpEventId);
    const left = ci.get(pair.cnEventId), right = ji.get(pair.jpEventId);
    if (left !== undefined && right !== undefined) anchors.push([left, right]);
  }
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const groupBlocks: Array<{ cnStart:number; cnEnd:number; jpStart:number; jpEnd:number; group:NativePresentationGroup }> = [];
  const grouped = { cn:new Set<string>(), jp:new Set<string>() };
  for (const [ordinal, pair] of (manifest.groupPairs ?? []).entries()) {
    if (!Array.isArray(pair.cnEventIds) || !Array.isArray(pair.jpEventIds)
      || !pair.proof || !['exact-native-display-text','lexical-with-punctuation-variation'].includes(pair.proof.classification)
      || pair.proof.completeNativeBuffers !== true || pair.proof.existingAnchorsRetainOrder !== true
      || pair.proof.uniqueInEachNativeChapterAndN10Binding !== true) throw Error('原生句段对应缺少完整来源证据');
    const ranges: Record<'cn'|'jp',[number,number]> = { cn:[0,0],jp:[0,0] };
    const separators: Record<string,string> = {};
    const speakers: Record<'zh-CN'|'ja-JP',string> = {'zh-CN':'','ja-JP':''};
    for (const [language,locale,source,indexes,orders] of [
      ['cn','zh-CN',cr,ci,corder],['jp','ja-JP',jr,ji,jorder],
    ] as const) {
      const ids=pair[language === 'cn' ? 'cnEventIds' : 'jpEventIds'];
      const proof=pair.proof[language === 'cn' ? 'cnNativeBuffer' : 'jpNativeBuffer'];
      if (!ids.length || new Set(ids).size !== ids.length || !proof || !equal(proof.eventIds,ids)) throw Error('原生句段事件列表无效');
      const positions=ids.map(id=>indexes.get(id));
      if (positions.some(index=>index===undefined)
        || positions.some((index,at)=>at>0 && index!==positions[at-1]!+1)
        || ids.some((id,at)=>!orders.has(id) || grouped[language].has(id)
          || at>0 && orders.get(id)!!==orders.get(ids[at-1])!+1)) throw Error('原生句段有缺失、重复或不连续事件');
      const selected=(positions as number[]).map(index=>source[index]);
      const original=selected[0].presentationGroup;
      if (ids.length>1 && (!original || original.schema!=='majiro-presentation-group/v1'
        || !equal(original.sourceEventIds,ids) || !equal(original.visibleEventIdsByLocale[locale],ids)
        || selected.some(row=>row.presentationGroup?.id!==original.id))) throw Error('多事件句段不是完整原生续写组');
      if (ids.length===1 && original && !equal(original.sourceEventIds,ids)) throw Error('句段对应截断了原生续写组');
      for (const id of ids) {
        const separator=proof.joinBeforeByEventId?.[id];
        if (typeof separator!=='string' || separator.length>8 || /\S/u.test(separator)
          || separator!==(original?.joinBeforeByEventId?.[id]??'')
          || separators[id]!==undefined && separators[id]!==separator) throw Error('原生句段分隔符与来源不一致');
        separators[id]=separator; grouped[language].add(id);
        (language==='cn'?pairedCn:pairedJp).add(id);
      }
      speakers[locale]=selected[0][language]?.speaker??'';
      ranges[language]=[positions[0]!,positions.at(-1)!+1];
    }
    if (pair.cnEventIds.length===1 && pair.jpEventIds.length===1) throw Error('单事件应使用独立正文对应');
    const cnVisible=pair.cnEventIds,jpVisible=pair.jpEventIds;
    const group:NativePresentationGroup={schema:'majiro-presentation-group/v1',
      id:'verified-buffer/'+manifest.storyId+'/'+ordinal,displayJoinMode:'native-append',position:0,
      sourceEventIds:[...new Set([...cnVisible,...jpVisible])],
      visibleEventIdsByLocale:{'zh-CN':cnVisible,'ja-JP':jpVisible},
      firstVisibleEventIdByLocale:{'zh-CN':cnVisible[0],'ja-JP':jpVisible[0]},
      speaker:speakers,joinBeforeByEventId:separators,allowFollowingVoiceCues:true};
    groupBlocks.push({cnStart:ranges.cn[0],cnEnd:ranges.cn[1],jpStart:ranges.jp[0],jpEnd:ranges.jp[1],group});
  }
  const reviewedAnchors = new Map<number, ReviewedBilingualPassage>();
  const reviewedBlocks: Array<{ cnStart:number; cnEnd:number; jpStart:number; jpEnd:number; review:ReviewedBilingualPassage }> = [];
  const reviewIds = new Set<string>();
  const nativeEvents = { cn:cnVariant.sections.flatMap(section=>section.events), jp:jpVariant.sections.flatMap(section=>section.events) };
  for (const review of manifest.reviewedPassages ?? []) {
    if (review.schema !== 'source-bound-bilingual-review/v1' || review.reviewer !== 'AI'
      || review.humanVerified !== false || review.translationQualityVerified !== false
      || !/^review-[A-Za-z0-9_-]+$/.test(review.id) || reviewIds.has(review.id)
      || !/^[a-f0-9]{64}$/.test(review.evidenceSha256) || typeof review.contextId !== 'string'
      || typeof review.note !== 'string' || review.note.length < 8) throw Error('句段复核缺少明确来源或误标人工完成');
    reviewIds.add(review.id);
    const ranges = { cn:[0,0], jp:[0,0] };
    for (const [language,source,indexes,orders,paired] of [
      ['cn',cr,ci,corder,pairedCn], ['jp',jr,ji,jorder,pairedJp],
    ] as const) {
      const ids=review[language==='cn'?'cnEventIds':'jpEventIds'];
      if (!Array.isArray(ids) || ids.length<1 || ids.length>12 || new Set(ids).size!==ids.length) throw Error('复核句段事件列表无效');
      const positions=ids.map(id=>indexes.get(id));
      if (positions.some(index=>index===undefined)
        || positions.some((index,at)=>at>0 && index!==positions[at-1]!+1)
        || ids.some((id,at)=>paired.has(id) || !orders.has(id) || at>0 && orders.get(id)!==orders.get(ids[at-1])!+1)) {
        throw Error('复核句段缺失、重复或跨越已有原生对应');
      }
      const all=nativeEvents[language], nativeIndexes=ids.map(id=>all.findIndex(event=>event.eventId===id));
      if (nativeIndexes.some((index,at)=>index<0 || at>0 && (index!==nativeIndexes[at-1]+1
        || all[nativeIndexes[at-1]].nextEventId!==ids[at]))) throw Error('复核句段跨越原生分支或非正文事件');
      const selected=(positions as number[]).map(index=>source[index]);
      if (selected.some(row=>row.cn?.isHeader || row.jp?.isHeader || row.cn?.isChoice || row.jp?.isChoice)) throw Error('复核句段不是正文');
      if (review.cnEventIds.length>1 || review.jpEventIds.length>1) {
        const locale=language==='cn'?'zh-CN':'ja-JP';
        if (selected.some(row=>row.presentationGroup?.visibleEventIdsByLocale[locale].some(id=>!ids.includes(id)))) {
          throw Error('复核句段截断了原生续写组');
        }
      }
      for (const id of ids) paired.add(id);
      ranges[language]=[positions[0]!,positions.at(-1)!+1];
    }
    if (review.cnEventIds.length===1 && review.jpEventIds.length===1) {
      anchors.push([ranges.cn[0],ranges.jp[0]]); reviewedAnchors.set(ranges.cn[0],review);
    } else reviewedBlocks.push({cnStart:ranges.cn[0],cnEnd:ranges.cn[1],jpStart:ranges.jp[0],jpEnd:ranges.jp[1],review});
  }
  for (const [all, paired, unpaired] of [[ce, pairedCn, manifest.unpaired.cn], [je, pairedJp, manifest.unpaired.jp]] as const) {
    const rest = new Set(unpaired);
    if (rest.size !== unpaired.length || [...rest].some(id => paired.has(id) || !all.includes(id))
      || all.some(id => !paired.has(id) && !rest.has(id))) throw Error('跨版本对应未完整列出未对应事件');
  }
  // A choice's integer return value and actual target are separate evidence
  // from its translated label. Never infer option identity from label order.
  const eventPairs = new Map(manifest.pairs.map(pair => [pair.cnEventId, pair.jpEventId]));
  for (const review of reviewedAnchors.values()) eventPairs.set(review.cnEventIds[0],review.jpEventIds[0]);
  eventPairs.set('end-001', 'end-001');
  for (const pair of manifest.choicePairs ?? []) {
    if (eventPairs.has(pair.cnEventId)) throw Error('跨版本选择事件重复');
    eventPairs.set(pair.cnEventId, pair.jpEventId);
  }
  const choiceIndex = (variant: typeof cnVariant, rows: NativeAlignedRow[]) => {
    const keys = new Map(rows.flatMap((row, index) => row.nativeKeys.map(key => [key, index] as const)));
    return new Map(variant.sections.flatMap(section => section.events.filter(event => event.kind === 'choice').map(event => [
      event.eventId, { event, keys: new Map((event.choices ?? []).map(choice => [
        choice.choiceId, keys.get(JSON.stringify([variant.variantId, section.sectionId]) + '/' + event.eventId + '/choice/' + choice.choiceId),
      ])) },
    ] as const)));
  };
  const cc = choiceIndex(cnVariant, cr), jc = choiceIndex(jpVariant, jr);
  const pairedChoicesCn = new Set<string>(), pairedChoicesJp = new Set<string>();
  for (const pair of manifest.choicePairs ?? []) {
    const left = cc.get(pair.cnEventId), right = jc.get(pair.jpEventId);
    if (!left || !right || pair.method !== 'native-menu-call-return-value-and-mapped-case-edges'
      || pairedChoicesCn.has(pair.cnEventId) || pairedChoicesJp.has(pair.jpEventId)
      || !Array.isArray(pair.options) || pair.options.length !== left.event.choices?.length
      || pair.options.length !== right.event.choices?.length) throw Error('跨版本选择对应缺少原生分支证据');
    pairedChoicesCn.add(pair.cnEventId); pairedChoicesJp.add(pair.jpEventId);
    const leftOptions = new Set<string>(), rightOptions = new Set<string>(), caseValues = new Set<number>();
    for (const option of pair.options) {
      const cChoice = left.event.choices?.find(choice => choice.choiceId === option.cnChoiceId);
      const jChoice = right.event.choices?.find(choice => choice.choiceId === option.jpChoiceId);
      const cRow = left.keys.get(option.cnChoiceId), jRow = right.keys.get(option.jpChoiceId);
      if (!cChoice || !jChoice || cRow === undefined || jRow === undefined
        || !Number.isInteger(option.caseValue) || option.caseValue < 1 || caseValues.has(option.caseValue)
        || leftOptions.has(option.cnChoiceId) || rightOptions.has(option.jpChoiceId)
        || cChoice.nextEventId !== option.cnTargetEventId || jChoice.nextEventId !== option.jpTargetEventId
        || eventPairs.get(option.cnTargetEventId) !== option.jpTargetEventId) throw Error('跨版本选择目标或返回值不一致');
      leftOptions.add(option.cnChoiceId); rightOptions.add(option.jpChoiceId); caseValues.add(option.caseValue);
      anchors.push([cRow, jRow]);
    }
  }
  if (manifest.unpairedChoices) {
    for (const [all, paired, unpaired] of [[cc, pairedChoicesCn, manifest.unpairedChoices.cn], [jc, pairedChoicesJp, manifest.unpairedChoices.jp]] as const) {
      if (!Array.isArray(unpaired) || new Set(unpaired).size !== unpaired.length
        || unpaired.some(id => !all.has(id) || paired.has(id))
        || [...all.keys()].some(id => !paired.has(id) && !unpaired.includes(id))) throw Error('跨版本选择未完整列出未对应事件');
    }
  }
  const jpHeaders = new Map(jr.flatMap((row, index) => row.jp?.isHeader ? [[row.jp.headerSection, index] as const] : []));
  cr.forEach((row, index) => {
    if (row.cn?.isHeader) {
      const pairedHeader = jpHeaders.get(row.cn.headerSection);
      if (pairedHeader === undefined) throw Error('跨版本标题锚点缺失');
      anchors.push([index, pairedHeader]);
    }
  });
  anchors.sort((left, right) => left[0] - right[0]);
  const rows: NativeAlignedRow[] = [];
  let c = 0, j = 0;
  const annotate = (row: NativeAlignedRow): NativeAlignedRow => ({ ...row,
    cnSlot: row.cnSlot ? { ...row.cnSlot, cues: applyNativeCueAliases(row.cnSlot.cues, 'cn', manifest) } : null,
    jpSlot: row.jpSlot ? { ...row.jpSlot, cues: applyNativeCueAliases(row.jpSlot.cues, 'jp', manifest) } : null });
  const emitPair = () => {
    const review=reviewedAnchors.get(c);
    rows.push(annotate({ cn:cr[c].cn,jp:jr[j].jp,
      nativeKeys:[JSON.stringify([cr[c].nativeKeys[0],jr[j].nativeKeys[0]])],
      cnIndices:cr[c].cnIndices,jpIndices:jr[j].jpIndices,cnSlot:cr[c].cnSlot,jpSlot:jr[j].jpSlot,
      pairing:review?'reviewed':'verified',...(review?{reviewedPassage:review}:{}) }));
    c++; j++;
  };
  const emitUntil = (nextCn:number,nextJp:number) => {
    if (nextCn<c || nextJp<j) throw Error('跨版本正文锚点交叉');
    while(c<nextCn)rows.push(annotate({...cr[c++],pairing:'unpaired-cn'}));
    while(j<nextJp)rows.push(annotate({...jr[j++],pairing:'unpaired-jp'}));
  };
  const blocks: Array<{cnStart:number;cnEnd:number;jpStart:number;jpEnd:number;group?:NativePresentationGroup;review?:ReviewedBilingualPassage;inner?:Array<[number,number]>}> =
    [...groupBlocks.map(block=>({...block,inner:[]})), ...reviewedBlocks];
  for (const [left,right] of anchors) {
    const inside=blocks.filter(block=>left>=block.cnStart&&left<block.cnEnd || right>=block.jpStart&&right<block.jpEnd);
    if (inside.length) {
      if (inside.length!==1 || left<inside[0].cnStart || left>=inside[0].cnEnd
        || right<inside[0].jpStart || right>=inside[0].jpEnd) throw Error('原生句段与已有对应锚冲突');
      inside[0].inner!.push([left,right]);
    } else blocks.push({cnStart:left,cnEnd:left+1,jpStart:right,jpEnd:right+1});
  }
  blocks.sort((a,b)=>a.cnStart-b.cnStart);
  for (const block of blocks) {
    emitUntil(block.cnStart,block.jpStart);
    if (block.review) {
      const first=rows.length;
      emitUntil(block.cnEnd,block.jpEnd);
      for (let index=first;index<rows.length;index++) rows[index]={...rows[index],pairing:'reviewed',
        reviewedPassage:block.review,...(!rows[index].cn?{nativeGroupReference:true}:{})};
      continue;
    }
    if (!block.group) { emitPair();continue; }
    const first=rows.length;
    for (const [left,right] of block.inner ?? []) { emitUntil(left,right);emitPair(); }
    emitUntil(block.cnEnd,block.jpEnd);
    for(let index=first;index<rows.length;index++)rows[index]={...rows[index],pairing:'verified',
      presentationGroup:block.group,...(!rows[index].cn?{nativeGroupReference:true}: {})};
  }
  emitUntil(cr.length,jr.length);
  // Join the two independently parsed buffer groups only when every native
  // event in the first group has an existing, ordered correspondence in the
  // other complete group. Byte offsets from different variants are not IDs.
  const groupRecords = (source: NativeAlignedRow[]) => new Map(source.flatMap(row =>
    row.presentationGroup?.schema === 'majiro-presentation-group/v1'
      ? [[row.presentationGroup.id, row.presentationGroup] as const] : []));
  const chineseGroups = groupRecords(cr), japaneseGroups = groupRecords(jr);
  const jpGroupByEvent = new Map([...japaneseGroups.values()].flatMap(group =>
    group.sourceEventIds.map(id => [id, group] as const)));
  const outputByCnEvent = new Map(rows.flatMap((row, index) => row.cnSlot?.eventIds.map(id => [id, index] as const) ?? []));
  const outputByJpEvent = new Map(rows.flatMap((row, index) => row.jpSlot?.eventIds.map(id => [id, index] as const) ?? []));
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const cg of chineseGroups.values()) {
    const mapped = cg.sourceEventIds.map(id => eventPairs.get(id));
    const jg = mapped[0] ? jpGroupByEvent.get(mapped[0]) : undefined;
    if (!jg || !same(mapped, jg.sourceEventIds)) continue;
    const cnVisible = cg.visibleEventIdsByLocale['zh-CN'], jpVisible = jg.visibleEventIdsByLocale['ja-JP'];
    const indices = [...new Set([...cnVisible.map(id => outputByCnEvent.get(id)), ...jpVisible.map(id => outputByJpEvent.get(id))])];
    if (indices.some(index => index === undefined)) continue;
    const ordered = (indices as number[]).sort((a,b) => a-b);
    if (ordered.length < 2 || ordered.some((index, at) => at > 0 && index !== ordered[at-1]+1)) continue;
    const selected = ordered.map(index => rows[index]);
    if (!same(selected.flatMap(row => row.cnSlot?.eventIds ?? []), cnVisible)
      || !same(selected.flatMap(row => row.jpSlot?.eventIds ?? []), jpVisible)) continue;
    const separators = { ...cg.joinBeforeByEventId };
    let conflict = false;
    for (const [id, separator] of Object.entries(jg.joinBeforeByEventId ?? {})) {
      if (separators[id] !== undefined && separators[id] !== separator) conflict = true;
      separators[id] = separator;
    }
    if (conflict) continue;
    const group: NativePresentationGroup = { schema:'majiro-presentation-group/v1',
      id:'paired-buffer/' + cg.id + '/' + jg.id, displayJoinMode:'native-append', position:0,
      sourceEventIds:[...new Set([...cg.sourceEventIds,...jg.sourceEventIds])],
      visibleEventIdsByLocale:{'zh-CN':cnVisible,'ja-JP':jpVisible},
      firstVisibleEventIdByLocale:{'zh-CN':cnVisible[0]??null,'ja-JP':jpVisible[0]??null},
      speaker:{'zh-CN':cg.speaker['zh-CN'],'ja-JP':jg.speaker['ja-JP']},
      joinBeforeByEventId:separators,allowFollowingVoiceCues:true };
    for (const index of ordered) rows[index]={...rows[index],presentationGroup:group};
  }
  return rows;
}
