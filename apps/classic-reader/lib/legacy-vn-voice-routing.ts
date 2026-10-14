import type { VoiceSequenceEntry } from './audio/voice-player.ts';
import type { StoryLine } from './story-parser.ts';
import { isLegacyVnVoiceUrl } from './audio/voice-cue.ts';

export type LegacyVoiceLocale = 'zh-CN' | 'ja-JP';

export type LegacyVoiceCue = {
  occurrenceId?: string;
  cueId: string;
  eventId: string;
  mediaId: string;
  url: string;
  mimeType: string;
  sourceKey: string;
};

export type LegacyVoiceSlot = {
  eventIds: string[];
  cues: LegacyVoiceCue[];
};

export type LegacyVoiceSlotSet = {
  eventSlots: Array<LegacyVoiceSlot | null>;
  displaySlots: Array<LegacyVoiceSlot | null>;
  detachedCues: LegacyVoiceCue[];
};

export type LegacyVoiceSummary = {
  cueCount: number;
  resolvedLines: number;
  totalLines: number;
};

type RouteCue = {
  cueId?: unknown;
  kind?: unknown;
  mediaId?: unknown;
  raw?: { sourceKey?: unknown };
};

type RouteChoice = { choiceId: string; nextEventId: string; label: Partial<Record<LegacyVoiceLocale, string>> };
export type NativePresentationGroup = {
  schema: 'ikura-presentation-group/v1' | 'majiro-presentation-group/v1';
  id: string;
  displayJoinMode: 'native-append';
  position: number;
  joinBeforeByEventId?: Record<string, string>;
  allowFollowingVoiceCues?: boolean;
  sourceEventIds: string[];
  visibleEventIdsByLocale: Record<LegacyVoiceLocale, string[]>;
  firstVisibleEventIdByLocale: Record<LegacyVoiceLocale, string | null>;
  speaker: Record<LegacyVoiceLocale, string>;
};
type RouteEvent = {
  choices?: RouteChoice[];
  nextEventId?: string;
  eventId: string;
  kind: string;
  textLineIndex?: Partial<Record<LegacyVoiceLocale, number>>;
  cues?: RouteCue[];
  source?: { presentationGroup?: NativePresentationGroup };
};

type RouteSection = {
  sectionId?: string;
  events: RouteEvent[];
};

type VariantRoute = {
  variantId: string;
  readerLocales: LegacyVoiceLocale[];
  textLineCounts: Partial<Record<LegacyVoiceLocale, number>>;
  sections: RouteSection[];
};

type RouteMedia = {
  mediaId: string;
  role: string;
  url: string;
  mimeType: string;
};

export type LegacyVoiceRouteDocument = {
  documentSha256?: string;
  canonicalStoryId: string;
  japaneseVariantId: string;
  chineseVariantId: string | null;
  variantRoutes: VariantRoute[];
  media: RouteMedia[];
};

const MAX_ROUTE_MEDIA = 100_000;
const MAX_ROUTE_EVENTS = 200_000;
const SOURCE_IDENTITY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const CUE_ID_PATTERN = /^cue-[a-f0-9]{16}$/u;
const MEDIA_ID_PATTERN = /^asset\/a-[a-f0-9]{16}$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asString = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const isVoiceLocale = (value: unknown): value is LegacyVoiceLocale =>
  value === 'zh-CN' || value === 'ja-JP';

export const legacyVoiceRoutePath = (sourceIdentity: string): string | null => {
  if (!SOURCE_IDENTITY_PATTERN.test(sourceIdentity)) return null;
  return `/data/legacy-vn/${sourceIdentity
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/')}.routes.json`;
};

function parseNativePresentationGroup(value: unknown, eventId: string): NativePresentationGroup | undefined {
  if (value === undefined) return undefined;
  const fail = (): never => { throw Error('原作续写组元数据无效'); };
  if (!isRecord(value) || !['ikura-presentation-group/v1', 'majiro-presentation-group/v1'].includes(String(value.schema))
    || value.displayJoinMode !== 'native-append' || typeof value.id !== 'string'
    || value.id.length === 0 || value.id.length > 256 || !Array.isArray(value.sourceEventIds)
    || value.sourceEventIds.length < 2 || value.sourceEventIds.length > 256) return fail();
  const sourceEventIds = value.sourceEventIds;
  if (sourceEventIds.some(id => typeof id !== 'string' || id.length === 0 || id.length > 128)
    || new Set(sourceEventIds).size !== sourceEventIds.length || !Number.isSafeInteger(value.position)
    || sourceEventIds[value.position as number] !== eventId
    || !isRecord(value.visibleEventIdsByLocale) || !isRecord(value.firstVisibleEventIdByLocale)
    || !isRecord(value.speaker)) return fail();
  const joinBeforeByEventId: Record<string, string> = {};
  if (value.joinBeforeByEventId !== undefined) {
    if (!isRecord(value.joinBeforeByEventId)) return fail();
    for (const [id, separator] of Object.entries(value.joinBeforeByEventId)) {
      if (!sourceEventIds.includes(id) || typeof separator !== 'string' || separator.length > 8 || !/^[ \t\r\n]*$/u.test(separator)) return fail();
      joinBeforeByEventId[id] = separator;
    }
  }
  if (value.allowFollowingVoiceCues !== undefined && (value.schema !== 'majiro-presentation-group/v1' || typeof value.allowFollowingVoiceCues !== 'boolean')) return fail();
  const visibleEventIdsByLocale = {} as Record<LegacyVoiceLocale, string[]>;
  const firstVisibleEventIdByLocale = {} as Record<LegacyVoiceLocale, string | null>;
  const speaker = {} as Record<LegacyVoiceLocale, string>;
  for (const locale of ['zh-CN', 'ja-JP'] as const) {
    const visibleIds = value.visibleEventIdsByLocale[locale], name = value.speaker[locale];
    if (!Array.isArray(visibleIds) || visibleIds.some(id => typeof id !== 'string' || !sourceEventIds.includes(id))
      || new Set(visibleIds).size !== visibleIds.length
      || visibleIds.some((id, index) => index > 0 && sourceEventIds.indexOf(id) <= sourceEventIds.indexOf(visibleIds[index - 1]))
      || value.firstVisibleEventIdByLocale[locale] !== (visibleIds[0] ?? null)
      || typeof name !== 'string' || name.length > 64) return fail();
    visibleEventIdsByLocale[locale] = [...visibleIds];
    firstVisibleEventIdByLocale[locale] = visibleIds[0] ?? null;
    speaker[locale] = name;
  }
  return { schema: value.schema as NativePresentationGroup['schema'], id: value.id, displayJoinMode: 'native-append',
    ...(value.joinBeforeByEventId !== undefined ? { joinBeforeByEventId } : {}),
    ...(typeof value.allowFollowingVoiceCues === 'boolean' ? { allowFollowingVoiceCues: value.allowFollowingVoiceCues } : {}),
    position: value.position as number, sourceEventIds: [...sourceEventIds],
    visibleEventIdsByLocale, firstVisibleEventIdByLocale, speaker };
}

export function parseLegacyVoiceRouteDocument(
  value: unknown,
  expectedStoryId: string,
): LegacyVoiceRouteDocument {
  if (!isRecord(value) || value.schema !== 'classic-reader-story-routes/v1') {
    throw new Error('语音路由清单格式无效');
  }
  if (value.canonicalStoryId !== expectedStoryId) {
    throw new Error('语音路由与当前剧情不一致');
  }
  const contract = value.voiceRouting;
  if (
    !isRecord(contract)
    || contract.schema !== 'classic-reader-voice-routing/v1'
    || contract.defaultState !== 'collapsed'
    || contract.expandedSlotMode !== 'all-lines'
    || contract.unresolvedLineBehavior !== 'visible'
  ) {
    throw new Error('语音路由清单缺少全行展开契约');
  }

  const rawMedia = value.media;
  if (!Array.isArray(rawMedia) || rawMedia.length > MAX_ROUTE_MEDIA) {
    throw new Error('语音媒体清单数量无效');
  }
  const media = rawMedia.map((item): RouteMedia => {
    if (!isRecord(item)) throw new Error('语音媒体条目无效');
    return {
      mediaId: asString(item.mediaId),
      role: asString(item.role),
      url: asString(item.url),
      mimeType: asString(item.mimeType),
    };
  });

  const rawVariants = value.variantRoutes;
  if (!Array.isArray(rawVariants) || rawVariants.length === 0 || rawVariants.length > 8) {
    throw new Error('语音变体路由数量无效');
  }
  let eventCount = 0;
  const variantRoutes = rawVariants.map((item): VariantRoute => {
    if (!isRecord(item) || !Array.isArray(item.sections)) {
      throw new Error('语音变体路由格式无效');
    }
    const readerLocales = Array.isArray(item.readerLocales)
      ? item.readerLocales.filter(isVoiceLocale)
      : [];
    const textLineCounts = isRecord(item.textLineCounts)
      ? item.textLineCounts as Partial<Record<LegacyVoiceLocale, number>>
      : {};
    const sections = item.sections.map((section): RouteSection => {
      if (!isRecord(section) || !Array.isArray(section.events)) {
        throw new Error('语音路由 Section 无效');
      }
      eventCount += section.events.length;
      if (eventCount > MAX_ROUTE_EVENTS) throw new Error('语音路由事件过多');
      return {
        ...(typeof section.sectionId === 'string' ? { sectionId: section.sectionId } : {}),
        events: section.events.map((event): RouteEvent => {
          if (!isRecord(event)) throw new Error('语音路由事件无效');
          const textLineIndex = isRecord(event.textLineIndex)
            ? event.textLineIndex as Partial<Record<LegacyVoiceLocale, number>>
            : undefined;
          const presentationGroup = parseNativePresentationGroup(
            isRecord(event.source) ? event.source.presentationGroup : undefined, asString(event.eventId));
          if (presentationGroup && event.kind !== 'line') throw Error('原作续写组包含非正文事件');
          if (event.nextEventId !== undefined && (typeof event.nextEventId !== 'string' || !event.nextEventId)) throw Error('原作后继事件字段无效');
          return {
            eventId: asString(event.eventId),
            kind: asString(event.kind),
            ...(typeof event.nextEventId === 'string' ? { nextEventId: event.nextEventId } : {}),
            ...(textLineIndex ? { textLineIndex } : {}),
            ...(Array.isArray(event.choices) ? { choices: event.choices.map(choice => {
              if (!isRecord(choice) || !isRecord(choice.label)) throw Error('原作选项结构无效');
              return { choiceId: asString(choice.choiceId), nextEventId: asString(choice.nextEventId),
                label: Object.fromEntries(Object.entries(choice.label).filter(([locale, label]) => isVoiceLocale(locale) && typeof label === 'string')) };
            }) } : {}),
            ...(Array.isArray(event.cues) ? { cues: event.cues as RouteCue[] } : {}),
            ...(presentationGroup ? { source: { presentationGroup } } : {}),
          };
        }),
      };
    });
    return {
      variantId: asString(item.variantId),
      readerLocales,
      textLineCounts,
      sections,
    };
  });

  return {
    canonicalStoryId: asString(value.canonicalStoryId),
    japaneseVariantId: asString(value.japaneseVariantId),
    chineseVariantId:
      typeof value.chineseVariantId === 'string' ? value.chineseVariantId : null,
    variantRoutes,
    media,
  };
}

const emptySlot = (): LegacyVoiceSlot => ({ eventIds: [], cues: [] });

const mergeSlot = (
  target: LegacyVoiceSlot,
  source: LegacyVoiceSlot,
): LegacyVoiceSlot => {
  const cueKeys = new Set(target.cues.map(cue => `${cue.cueId}\0${cue.url}`));
  return {
    eventIds: [...new Set([...target.eventIds, ...source.eventIds])],
    cues: [
      ...target.cues,
      ...source.cues.filter(cue => !cueKeys.has(`${cue.cueId}\0${cue.url}`)),
    ],
  };
};

const appendUniqueCues = (
  target: LegacyVoiceCue[],
  source: LegacyVoiceCue[],
): void => {
  const existing = new Set(target.map(cue => `${cue.cueId}\0${cue.url}`));
  for (const cue of source) {
    const key = `${cue.cueId}\0${cue.url}`;
    if (existing.has(key)) continue;
    existing.add(key);
    target.push(cue);
  }
};

const shouldMergeDisplayLines = (
  previous: StoryLine | undefined,
  current: StoryLine,
): boolean => Boolean(
  previous
  && !previous.isHeader
  && !previous.isChoice
  && !current.isHeader
  && !current.isChoice
  && !previous.isScene0
  && !current.isScene0
  && previous.speaker === current.speaker,
);

export function buildLegacyVoiceSlots(
  route: LegacyVoiceRouteDocument,
  locale: LegacyVoiceLocale,
  eventLines: StoryLine[],
): LegacyVoiceSlotSet {
  const variantId = locale === 'zh-CN'
    ? route.chineseVariantId
    : route.japaneseVariantId;
  const variant = route.variantRoutes.find(item => item.variantId === variantId);
  const contentLineCount = eventLines.filter(
    line => !line.isHeader && !line.isChoice,
  ).length;
  if (!variant || !variant.readerLocales.includes(locale)) {
    return collapseEventSlots(
      eventLines,
      Array.from({ length: contentLineCount }, emptySlot),
    );
  }
  if (variant.textLineCounts[locale] !== contentLineCount) {
    throw new Error(
      `${locale} 语音路由行数不一致：路由 ${variant.textLineCounts[locale]}，文本 ${contentLineCount}`,
    );
  }

  const mediaById = new Map(
    route.media
      .filter(media => media.role === 'voice' && isLegacyVnVoiceUrl(media.url))
      .map(media => [media.mediaId, media]),
  );
  const contentSlots = Array.from({ length: contentLineCount }, emptySlot);
  const detachedCues: LegacyVoiceCue[] = [];
  const seenIndexes = new Set<number>();
  for (const event of variant.sections.flatMap(section => section.events)) {
    const cues: LegacyVoiceCue[] = [];
    for (const cue of event.cues ?? []) {
      if (cue.kind !== 'voice') continue;
      const cueId = asString(cue.cueId);
      const mediaId = asString(cue.mediaId);
      const media = mediaById.get(mediaId);
      if (!CUE_ID_PATTERN.test(cueId) || !MEDIA_ID_PATTERN.test(mediaId) || !media) {
        continue;
      }
      cues.push({
        cueId,
        eventId: event.eventId,
        mediaId,
        url: media.url,
        mimeType: media.mimeType,
        sourceKey: asString(cue.raw?.sourceKey),
      });
    }
    const lineIndex = event.textLineIndex?.[locale];
    if (event.kind !== 'line' || lineIndex === undefined) {
      appendUniqueCues(detachedCues, cues);
      continue;
    }
    if (
      !Number.isSafeInteger(lineIndex)
      || lineIndex < 0
      || lineIndex >= contentLineCount
      || seenIndexes.has(lineIndex)
    ) {
      throw new Error(`${locale} 语音路由行号无效：${lineIndex}`);
    }
    seenIndexes.add(lineIndex);
    contentSlots[lineIndex] = {
      eventIds: [event.eventId],
      cues,
    };
  }
  if (seenIndexes.size !== contentLineCount) {
    throw new Error(
      `${locale} 语音路由未覆盖所有正文行：${seenIndexes.size}/${contentLineCount}`,
    );
  }
  return collapseEventSlots(eventLines, contentSlots, detachedCues);
}

export function buildUnresolvedLegacyVoiceSlots(
  eventLines: StoryLine[],
): LegacyVoiceSlotSet {
  const contentLineCount = eventLines.filter(
    line => !line.isHeader && !line.isChoice,
  ).length;
  return collapseEventSlots(
    eventLines,
    Array.from({ length: contentLineCount }, emptySlot),
  );
}

function collapseEventSlots(
  eventLines: StoryLine[],
  contentSlots: LegacyVoiceSlot[],
  detachedCues: LegacyVoiceCue[] = [],
): LegacyVoiceSlotSet {
  const eventSlots: Array<LegacyVoiceSlot | null> = [];
  const displaySlots: Array<LegacyVoiceSlot | null> = [];
  let contentIndex = 0;
  let previous: StoryLine | undefined;
  for (const line of eventLines) {
    if (line.isHeader || line.isChoice) {
      eventSlots.push(null);
      displaySlots.push(null);
      previous = line;
      continue;
    }
    const slot = contentSlots[contentIndex] ?? emptySlot();
    contentIndex += 1;
    eventSlots.push(slot);
    if (shouldMergeDisplayLines(previous, line)) {
      const previousSlot = displaySlots.at(-1);
      if (previousSlot) displaySlots[displaySlots.length - 1] = mergeSlot(previousSlot, slot);
    } else {
      displaySlots.push(slot);
    }
    previous = line;
  }
  return { eventSlots, displaySlots, detachedCues };
}

export function summarizeLegacyVoiceSlots(
  slots: Array<LegacyVoiceSlot | null>,
): LegacyVoiceSummary {
  const contentSlots = slots.filter((slot): slot is LegacyVoiceSlot => slot !== null);
  return {
    cueCount: contentSlots.reduce((total, slot) => total + slot.cues.length, 0),
    resolvedLines: contentSlots.filter(slot => slot.cues.length > 0).length,
    totalLines: contentSlots.length,
  };
}

/** Native script order, including uncaptioned events. Never zip language arrays
 * or deduplicate URLs: repeated assets at different events are real occurrences.
 * The caller selects ONE version (CN for Chinese, JP for Japanese/bilingual).
 * Bilingual cross-version text alignment is a separate, explicit correspondence.
 */
export function buildLegacyVoiceSequence(
  route: LegacyVoiceRouteDocument,
  locale: LegacyVoiceLocale,
  slots: Array<LegacyVoiceSlot | null>,
): Array<VoiceSequenceEntry & { mediaId: string; sourceKey: string; variantId: string }> {
  const variantId = locale === 'zh-CN' ? route.chineseVariantId : route.japaneseVariantId;
  const variant = route.variantRoutes.find(item => item.variantId === variantId);
  if (!variant || !variant.readerLocales.includes(locale)) return [];
  const rowByEvent = new Map<string, number>();
  const events = new Map(variant.sections.flatMap(section => section.events.map(event => [event.eventId, event] as const)));
  slots.forEach((slot, rowIndex) => slot?.eventIds.forEach(id => {
    // Revised Chinese can share a Japanese-only row slot. Byte-offset event
    // IDs are not cross-variant identities: require the original cue identity
    // before assigning a selected-variant sequence event to a presentation row.
    const event = events.get(id);
    if (slot.cues.some(present => event?.cues?.some(cue => cue.kind === 'voice'
      && asString(cue.cueId) === present.cueId && asString(cue.mediaId) === present.mediaId
      && asString(cue.raw?.sourceKey) === present.sourceKey))) rowByEvent.set(id, rowIndex);
  }));
  const media = new Map(route.media.filter(item => item.role === 'voice' && isLegacyVnVoiceUrl(item.url)).map(item => [item.mediaId, item]));
  return variant.sections.flatMap(section => section.events.flatMap(event =>
    (event.cues ?? []).flatMap(cue => {
      const cueId = asString(cue.cueId), mediaId = asString(cue.mediaId), asset = media.get(mediaId);
      if (cue.kind !== 'voice' || !CUE_ID_PATTERN.test(cueId) || !MEDIA_ID_PATTERN.test(mediaId) || !asset) return [];
      return [{ cueId, mediaId, eventId: event.eventId, sourceUrl: asset.url,
        sourceKey: asString(cue.raw?.sourceKey), variantId: variant.variantId,
        rowIndex: rowByEvent.get(event.eventId) ?? null }];
    }),
  ));
}
