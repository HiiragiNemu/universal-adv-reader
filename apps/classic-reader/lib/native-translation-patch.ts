import type { StoryLine } from './story-parser.ts';
import type { NativeAlignedRow } from './legacy-vn-alignment.ts';
import { seedNativeEditableLines } from './legacy-vn-alignment.ts';
import { hashNativeText } from './legacy-vn-correspondence.ts';
import { legacyVoiceRoutePath, type LegacyVoiceRouteDocument } from './legacy-vn-voice-routing.ts';
import { readBoundedResponseBody } from './story-index.ts';

export type NativeEditableField = 'text' | 'speaker' | 'choiceLabel';
export type NativeEditTarget = { variantId: string; sectionId: string; eventId: string; choiceId?: string };
export type NativeEditRow = {
  key: string;
  target: NativeEditTarget | null;
  baseline: { text: string; speaker: string; choiceLabel?: string };
  allowed: NativeEditableField[];
  readOnlyReason?: 'translation-on-native-group-members';
  speakerReason: 'separate-native-message' | 'embedded-in-text' | 'no-native-speaker' | 'structural-row';
};
export type NativeEditSource = {
  schema: 'native-reader-edit-source/v1';
  storyId: string;
  binding: { route: string; cnText: string; jpText: string; adapter: string; normalizedStory: string };
  nativeSources: Array<{ path: string; sha256: string }>;
  rows: NativeEditRow[];
};
export type LoadedNativeEditSource = { document: NativeEditSource; sha256: string };
export type NativeTranslationPatch = {
  schema: 'native-reader-translation-patch/v1';
  storyId: string;
  sourceSha256: string;
  binding: NativeEditSource['binding'];
  locale: 'zh-CN';
  changes: Array<{ key: string; field: NativeEditableField; before: string; after: string }>;
};
type EditedLine = StoryLine & { nativeAlignmentKey?: string };
type Localized = Record<string, string>;
export type NativeStoryDocument = {
  schema: string;
  provenance: { sourceCanonicalStoryId: string; [key: string]: unknown };
  variants: Array<{ variantId: string; sections: Array<{ sectionId: string; events: Array<{
    eventId: string; kind: string; text?: Localized; speaker?: Localized;
    source?: { engine?: string; textEventIndices?: number[]; [key: string]: unknown };
    choices?: Array<{ choiceId: string; label: Localized; [key: string]: unknown }>;
    [key: string]: unknown;
  }>; [key: string]: unknown }>; [key: string]: unknown }>;
  [key: string]: unknown;
};

const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: unknown, keys: string[]) => record(value) && equal(Object.keys(value).sort(), [...keys].sort());
const validText = (value: unknown): value is string => typeof value === 'string' && value.length <= 200_000
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);

export function splitIkuraMessageText(value: string): { speaker: string; body: string; prefix: string } {
  const match = value.match(/^(\s*)([^:：「『\n]{1,24})([：:])(?=[「『])/u);
  return match ? { speaker: match[2].trim().replace(/\s+/gu, ''), body: value.slice(match[0].length), prefix: match[0] }
    : { speaker: '', body: value, prefix: '' };
}

type IkuraMessageEvent = { text?: Localized; speaker?: Localized; source?: { engine?: string; [key: string]: unknown } };

/** Reconstruct the editable native message string without changing the original
 * operand evidence. Display text stays separate from the name; an unchanged
 * name retains the native prefix's fullwidth spacing and colon exactly.
 */
export function composeIkuraMessageText(event: IkuraMessageEvent, locale = 'zh-CN'): string {
  const bodyText = event.text?.[locale] ?? '', current = splitIkuraMessageText(bodyText);
  const original = record(event.source?.originalDisplayText) ? event.source.originalDisplayText[locale] : bodyText;
  const basis = splitIkuraMessageText(typeof original === 'string' ? original : '');
  const speaker = event.speaker?.[locale] ?? current.speaker;
  if (!speaker || speaker === '旁白' && !basis.speaker) return current.body;
  const prefix = basis.speaker === speaker ? basis.prefix
    : (basis.prefix.match(/^\s*/u)?.[0] ?? '') + speaker + (basis.prefix.match(/[：:]$/u)?.[0] ?? '：');
  return prefix + current.body;
}

const separatedIkuraMessage = (event: IkuraMessageEvent): boolean => event.source?.engine === 'ikura'
  && event.source.opcode === 0x2B && record(event.source.originalDisplayText);

/** Binding keys come from the actual native alignment, not UI array positions. */
export function buildNativeEditRows(story: NativeStoryDocument, rows: NativeAlignedRow[]): NativeEditRow[] {
  const targets = new Map<string, { target: NativeEditTarget; allowed: NativeEditableField[]; speakerReason: NativeEditRow['speakerReason'] }>();
  for (const variant of story.variants) for (const section of variant.sections) for (const event of section.events) {
    const key = `${JSON.stringify([variant.variantId, section.sectionId])}/${event.eventId}`;
    const target = { variantId: variant.variantId, sectionId: section.sectionId, eventId: event.eventId };
    if (event.kind === 'line') {
      const unit = event.source?.nativeUnit;
      const nativeName = record(unit) && record(unit.speakerRaw) ? unit.speakerRaw : null;
      const separate = event.source?.engine === 'majiro' && Boolean(event.speaker)
        && (record(unit) ? nativeName?.method === 'native-name-slot' : event.source.textEventIndices?.length === 2);
      const inline = event.source?.engine === 'majiro' && Boolean(event.speaker)
        && nativeName?.method === 'native-inline-name-delimiter';
      targets.set(key, { target, allowed: separate || inline || separatedIkuraMessage(event) ? ['text', 'speaker'] : ['text'],
        speakerReason: separate ? 'separate-native-message'
          : inline || event.source?.engine === 'ikura' && event.speaker ? 'embedded-in-text' : 'no-native-speaker' });
    } else if (event.kind === 'choice') for (const choice of event.choices ?? []) {
      targets.set(`${key}/choice/${choice.choiceId}`, { target: { ...target, choiceId: choice.choiceId }, allowed: ['choiceLabel'], speakerReason: 'structural-row' });
    }
  }
  const baseline = seedNativeEditableLines(rows, 'current');
  return rows.map((row, index) => {
    if (row.nativeKeys.length !== 1) throw Error('原生编辑需要未合并的事件');
    const key = row.nativeKeys[0], line = baseline[index];
    let targetKey = key;
    if ((row.pairing === 'verified' || row.pairing === 'reviewed') && !line.isHeader && !targets.has(key)) {
      const pair: unknown = JSON.parse(key);
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(v => typeof v === 'string')) throw Error('跨版本编辑键无效');
      targetKey = pair[row.cn ? 0 : 1];
    }
    const target = line.isHeader ? null : targets.get(targetKey);
    if (!line.isHeader && !target) throw Error(`原生编辑事件未找到：${targetKey}`);
    return { key, ...(target ?? { target: null, allowed: [], speakerReason: 'structural-row' as const }),
      ...(row.nativeGroupReference ? { allowed: [], readOnlyReason: 'translation-on-native-group-members' as const } : {}),
      baseline: { text: line.text, speaker: line.speaker, ...(line.isChoice ? { choiceLabel: line.choiceLabel ?? '' } : {}) } };
  });
}

export async function readNativeEditSource(raw: string, binding: { storyId: string; binding: Partial<NativeEditSource['binding']> }): Promise<LoadedNativeEditSource> {
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.schema !== 'native-reader-edit-source/v1' || value.storyId !== binding.storyId
    || !exactKeys(value.binding, ['route','cnText','jpText','adapter','normalizedStory'])
    || Object.values(value.binding as object).some(hash => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))
    || Object.entries(binding.binding).some(([key,hash]) => (value.binding as Record<string,string>)[key] !== hash)
    || !Array.isArray(value.rows) || !Array.isArray(value.nativeSources)) throw Error('原生编辑来源身份或哈希不一致');
  const keys = new Set();
  for (const row of value.rows) {
    if (!record(row) || typeof row.key !== 'string' || keys.has(row.key) || !record(row.baseline)
      || !validText(row.baseline.text) || !validText(row.baseline.speaker) || !Array.isArray(row.allowed)
      || row.allowed.some(field => !['text', 'speaker', 'choiceLabel'].includes(String(field)))) throw Error('原生编辑字段清单无效');
    keys.add(row.key);
  }
  return { document: value as NativeEditSource, sha256: await hashNativeText(raw) };
}

export async function loadNativeEditSource(route: LegacyVoiceRouteDocument, cnRaw: string, jpRaw: string, signal: AbortSignal,
  fetcher: typeof fetch = fetch): Promise<LoadedNativeEditSource> {
  const routePath = legacyVoiceRoutePath(route.canonicalStoryId);
  if (!routePath || !route.documentSha256) throw Error('原生编辑缺少当前路由哈希');
  const response = await fetcher(routePath.replace(/\.routes\.json$/, '.edit-source.json'), { signal, cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw Error(`原生编辑来源读取失败（HTTP ${response.status}）`);
  const bytes = await readBoundedResponseBody(response, 16 * 1024 * 1024, '原生编辑来源');
  const [cnText,jpText] = await Promise.all([hashNativeText(cnRaw),hashNativeText(jpRaw)]);
  if (signal.aborted) throw new DOMException('Aborted','AbortError');
  return readNativeEditSource(new TextDecoder('utf-8',{fatal:true}).decode(bytes), { storyId: route.canonicalStoryId,
    binding: { route: route.documentSha256, cnText, jpText } });
}

/** The upload supplies only text deltas. Event targets, branches, media and
 * source locations always come from the current hash-bound source, never it. */
export function validateNativeTranslationPatch(source: LoadedNativeEditSource, value: unknown): NativeTranslationPatch {
  if (!exactKeys(value, ['schema', 'storyId', 'sourceSha256', 'binding', 'locale', 'changes'])) throw Error('原生翻译补丁结构无效');
  const patch = value as unknown as NativeTranslationPatch;
  if (patch.schema !== 'native-reader-translation-patch/v1' || patch.storyId !== source.document.storyId
    || patch.sourceSha256 !== source.sha256 || !equal(patch.binding, source.document.binding) || patch.locale !== 'zh-CN'
    || !Array.isArray(patch.changes) || patch.changes.length > source.document.rows.length * 2) throw Error('原生翻译补丁来源版本不一致');
  const rows = new Map(source.document.rows.map(row => [row.key, row])), changed = new Set();
  for (const change of patch.changes) {
    if (!exactKeys(change, ['key', 'field', 'before', 'after'])) throw Error('补丁只接受显式文本字段');
    const row = rows.get(change.key), identity = JSON.stringify([change.key, change.field]);
    if (!row || !row.target || !row.allowed.includes(change.field) || changed.has(identity)
      || !validText(change.before) || !validText(change.after) || change.before !== row.baseline[change.field]
      || change.before === change.after) throw Error('补丁字段重复、只读或基准不一致');
    changed.add(identity);
  }
  return patch;
}

export function createNativeTranslationPatch(source: LoadedNativeEditSource, edited: StoryLine[]): NativeTranslationPatch {
  const lines = new Map<string, EditedLine>();
  for (const line of edited as EditedLine[]) {
    if (!line.nativeAlignmentKey || lines.has(line.nativeAlignmentKey)) throw Error('编辑事件键缺失或重复');
    lines.set(line.nativeAlignmentKey, line);
  }
  if (lines.size !== source.document.rows.length) throw Error('编辑事件总数改变');
  const changes: NativeTranslationPatch['changes'] = [];
  for (const row of source.document.rows) {
    const line = lines.get(row.key); if (!line) throw Error('编辑事件与原生来源不匹配');
    for (const field of ['text', 'speaker', 'choiceLabel'] as const) {
      // A choice's bracketed display text is derived from its editable label.
      if (field === 'text' && row.allowed.includes('choiceLabel')) continue;
      const before = row.baseline[field], after = line[field];
      if (before === after || (before === undefined && after === undefined)) continue;
      if (!row.allowed.includes(field) || !validText(after) || before === undefined) throw Error(`此原作字段只读：${field}`);
      changes.push({ key: row.key, field, before, after });
    }
  }
  return validateNativeTranslationPatch(source, { schema: 'native-reader-translation-patch/v1', storyId: source.document.storyId,
    sourceSha256: source.sha256, binding: source.document.binding, locale: 'zh-CN', changes });
}

export function importNativeTranslationPatch(source: LoadedNativeEditSource, value: unknown, rows: NativeAlignedRow[]): StoryLine[] {
  const patch = validateNativeTranslationPatch(source, value), lines = seedNativeEditableLines(rows, 'current') as EditedLine[];
  // A round-trip establishes the full event denominator before applying deltas.
  createNativeTranslationPatch(source, lines);
  const byKey = new Map(lines.map(line => [line.nativeAlignmentKey, line]));
  for (const change of patch.changes) {
    const line = byKey.get(change.key)!; line[change.field] = change.after;
    if (change.field === 'choiceLabel') line.text = `【${change.after}】`;
  }
  return lines;
}

export async function applyNativeTranslationPatch(source: LoadedNativeEditSource, value: unknown, original: NativeStoryDocument): Promise<NativeStoryDocument> {
  const patch = validateNativeTranslationPatch(source, value);
  const readerIdentity = original.canonicalStoryId ?? original.provenance.sourceCanonicalStoryId;
  if (original.schema !== 'adv-story/v1' || readerIdentity !== patch.storyId
    || await hashNativeText(JSON.stringify(original)) !== source.document.binding.normalizedStory) throw Error('原生结构源已变化，补丁停止');
  const result = structuredClone(original), rows = new Map(source.document.rows.map(row => [row.key, row]));
  const editedIkura = new Map<IkuraMessageEvent, Set<NativeEditableField>>();
  for (const change of patch.changes) {
    const target = rows.get(change.key)!.target!;
    const variant = result.variants.find(v => v.variantId === target.variantId);
    const event = variant?.sections.find(s => s.sectionId === target.sectionId)?.events.find(e => e.eventId === target.eventId);
    if (!variant || !event) throw Error('原生结构目标缺失');
    if (Array.isArray(variant.locales) && !variant.locales.includes('zh-CN')) variant.locales.push('zh-CN');
    if (change.field === 'choiceLabel') {
      const choice = event.choices?.find(c => c.choiceId === target.choiceId); if (!choice) throw Error('原作选项缺失');
      choice.label['zh-CN'] = change.after;
    } else {
      event[change.field] ??= {}; event[change.field]!['zh-CN'] = change.after;
      if (event.source?.engine === 'ikura') {
        if (separatedIkuraMessage(event)) {
          const fields = editedIkura.get(event) ?? new Set<NativeEditableField>();
          fields.add(change.field); editedIkura.set(event, fields);
        } else if (change.field === 'text') {
          // Previously published edit sources still use the embedded operand.
          const speaker = splitIkuraMessageText(change.after).speaker;
          if (speaker) { event.speaker ??= {}; event.speaker['zh-CN'] = speaker; }
          else if (event.speaker) { delete event.speaker['zh-CN']; if (!Object.keys(event.speaker).length) delete event.speaker; }
        }
      }
    }
  }
  for (const [event, fields] of editedIkura) {
    // Accept a legacy embedded name pasted into the body once. An explicit
    // speaker-field edit takes precedence, and the display retains only one name.
    const embedded = splitIkuraMessageText(event.text?.['zh-CN'] ?? '');
    if (fields.has('text') && embedded.prefix) {
      event.text!['zh-CN'] = embedded.body;
      if (!fields.has('speaker')) { event.speaker ??= {}; event.speaker['zh-CN'] = embedded.speaker; }
    }
    const rawMessage = composeIkuraMessageText(event), named = splitIkuraMessageText(rawMessage);
    if (/^[「『]/u.test(event.text?.['zh-CN'] ?? '') && event.speaker?.['zh-CN'] && event.speaker['zh-CN'] !== '旁白'
      && (named.speaker !== event.speaker['zh-CN'] || named.body !== event.text?.['zh-CN'])) {
      throw Error('IKURA 姓名与原作消息正文无法无损重组');
    }
  }
  return result;
}
