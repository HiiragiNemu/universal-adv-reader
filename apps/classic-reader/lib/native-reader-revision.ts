import { loadNativeEditSource, readNativeEditSource, splitIkuraMessageText, type LoadedNativeEditSource, type NativeEditSource } from './native-translation-patch.ts';
import { hashNativeText } from './legacy-vn-correspondence.ts';
import type { NativeAlignedRow } from './legacy-vn-alignment.ts';
import type { LegacyVoiceRouteDocument } from './legacy-vn-voice-routing.ts';
import { validateTranslationReview, type TranslationReview } from './translation-review.ts';
import { readBoundedResponseBody } from './story-index.ts';

export type NativeRevisionRecord = { revision: string; path: string; sha256: string; storyPath: string; storySha256: string; textPath: string; textSha256: string };
export type NativeRevisionRegistry = { schema: 'native-reader-revisions/v1'; entries: Record<string, NativeRevisionRecord> };
export type NativeReaderRevision = {
  schema: 'native-reader-revision/v1'; storyId: string; revision: string; parentRevision: string | null;
  baseSourceSha256: string; parentSourceSha256: string; patchSha256: string;
  source: NativeEditSource; cnKeys: string[]; translationReview?: TranslationReview;
};
export type CurrentNativeEditSource = LoadedNativeEditSource & { revision?: NativeReaderRevision };
const equal = (a: unknown,b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const identity = (value: string) => /^[a-z0-9-]+\/[a-z0-9_]+$/.test(value);
export const EMPTY_NATIVE_REVISIONS: NativeRevisionRegistry = { schema: 'native-reader-revisions/v1', entries: {} };

export function parseNativeRevisionRegistry(raw: string): NativeRevisionRegistry {
  const value = JSON.parse(raw) as NativeRevisionRegistry;
  if (value?.schema !== 'native-reader-revisions/v1' || !value.entries || Array.isArray(value.entries) || typeof value.entries !== 'object'
    || Object.keys(value.entries).length > 100_000) throw Error('原生修订索引格式错误');
  for (const [storyId, record] of Object.entries(value.entries)) {
    if (!identity(storyId) || !record || !hash(record.revision) || !hash(record.sha256) || !hash(record.storySha256) || !hash(record.textSha256)) throw Error('原生修订身份错误');
    const stem = `/native-reader-revisions/${storyId}/${record.revision}`;
    if (record.path !== stem + '.json' || record.storyPath !== stem + '.adv.json' || record.textPath !== stem + '.native.txt') throw Error('原生修订路径错误');
  }
  return value;
}

export async function readNativeReaderRevision(raw: string, record: NativeRevisionRecord, base: LoadedNativeEditSource): Promise<CurrentNativeEditSource> {
  if (await hashNativeText(raw) !== record.sha256) throw Error('原生修订文件哈希不一致');
  const revision = JSON.parse(raw) as NativeReaderRevision;
  if (revision.schema !== 'native-reader-revision/v1' || revision.storyId !== base.document.storyId || revision.revision !== record.revision
    || revision.baseSourceSha256 !== base.sha256 || !hash(revision.parentSourceSha256) || !hash(revision.patchSha256)
    || (revision.parentRevision !== null && !hash(revision.parentRevision))) throw Error('原生修订原始版本不一致');
  const { normalizedStory: _original, ...binding } = base.document.binding;
  const source = await readNativeEditSource(JSON.stringify(revision.source) + '\n', { storyId: base.document.storyId, binding });
  if (!equal(source.document.nativeSources,base.document.nativeSources) || source.document.rows.length !== base.document.rows.length) throw Error('原生修订来源或事件总数改变');
  source.document.rows.forEach((row,index) => {
    const before = base.document.rows[index];
    if (row.key !== before.key || !equal(row.target,before.target) || !equal(row.allowed,before.allowed) || row.speakerReason !== before.speakerReason) throw Error('原生修订事件/权限改变');
    for (const field of ['text','speaker','choiceLabel'] as const) {
      if (before.allowed.includes(field) || field === 'text' && before.allowed.includes('choiceLabel')) continue;
      if (row.baseline[field] === before.baseline[field]) continue;
      // This adapter's IKURA messages are Kana event operands; even an original
      // narrator line can gain a derived name by editing its message prefix.
      const ikura = base.document.storyId.startsWith('kana-okaeri/') && before.target?.eventId.startsWith('ikura-');
      if (field === 'speaker' && (before.speakerReason === 'embedded-in-text' || ikura)) {
        const derived = splitIkuraMessageText(row.baseline.text).speaker;
        if (row.baseline.speaker === derived) continue;
      }
      if (row.baseline[field] !== before.baseline[field]) throw Error('原生修订改变只读字段');
    }
    if (row.allowed.includes('choiceLabel') && row.baseline.text !== `【${row.baseline.choiceLabel}】`) throw Error('原生选项显示不一致');
  });
  if (!Array.isArray(revision.cnKeys) || new Set(revision.cnKeys).size !== revision.cnKeys.length) throw Error('原生中文事件键重复');
  const keys = new Set(source.document.rows.map(row => row.key));
  if (revision.translationReview) validateTranslationReview(revision.translationReview, keys);
  if (revision.cnKeys.some(key => !keys.has(key))) throw Error('原生中文事件键不属于当前来源');
  return { ...source, revision };
}

/** Source TXT/routes remain immutable. Only keyed Chinese fields overlay the
 * existing native alignment, preserving BOTH compiled variants and all cues. */
export function projectNativeReaderRevisionRows(rows: NativeAlignedRow[], source: CurrentNativeEditSource | null): NativeAlignedRow[] {
  if (!source?.revision) return rows;
  if (rows.length === 0) return rows; // route/correspondence still loading
  if (rows.length !== source.document.rows.length) throw Error('修订事件分母不一致');
  const present = new Set(source.revision.cnKeys), definitions = new Map(source.document.rows.map(row => [row.key,row]));
  return rows.map(row => {
    if (row.nativeKeys.length !== 1) throw Error('修订需在未合并原作事件上消费');
    const key = row.nativeKeys[0], definition = definitions.get(key);
    if (!definition || row.cn && !present.has(key)) throw Error('修订遗漏已有中文事件');
    if (!present.has(key)) return row;
    const basis = row.cn ?? row.jp;
    if (!basis) throw Error('修订目标没有原生事件');
    return { ...row, cn: { ...basis, ...definition.baseline }, cnSlot: row.cnSlot ?? row.jpSlot };
  });
}

export function nativeRevisionTextRows(source: CurrentNativeEditSource) {
  if (!source.revision) throw Error('缺少修订投影');
  const present = new Set(source.revision.cnKeys);
  return source.document.rows.filter(row => present.has(row.key)).map(row => ({ key: row.key, target: row.target, ...row.baseline }));
}
/** UTF-8 JSON-lines TXT preserves empty names, tabs/newlines and native keys.
 * It is a revision text snapshot, not the lossy legacy narrator TXT parser. */
export function serializeNativeRevisionText(source: CurrentNativeEditSource): string {
  return '# native-reader-text/v1\tzh-CN\n' + nativeRevisionTextRows(source).map(row => JSON.stringify(row)).join('\n') + '\n';
}

export async function loadCurrentNativeEditSource(route: LegacyVoiceRouteDocument, cnRaw: string, jpRaw: string, signal: AbortSignal,
  fetcher: typeof fetch = fetch): Promise<CurrentNativeEditSource> {
  const base = await loadNativeEditSource(route,cnRaw,jpRaw,signal,fetcher);
  const registryResponse = await fetcher('/native-reader-revisions.json',{signal,cache:'no-store',credentials:'same-origin'});
  if (!registryResponse.ok) throw Error(`原生修订索引读取失败（HTTP ${registryResponse.status}）`);
  const decode = (bytes: Uint8Array) => new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const registry = parseNativeRevisionRegistry(decode(await readBoundedResponseBody(registryResponse,16*1024*1024,'原生修订索引')));
  const record = registry.entries[route.canonicalStoryId];
  if (signal.aborted) throw new DOMException('Aborted','AbortError');
  if (!record) return base;
  const response = await fetcher(record.path,{signal,cache:'no-store',credentials:'same-origin'});
  if (!response.ok) throw Error(`原生修订读取失败（HTTP ${response.status}）`);
  const current = await readNativeReaderRevision(decode(await readBoundedResponseBody(response,16*1024*1024,'原生修订')),record,base);
  if (signal.aborted) throw new DOMException('Aborted','AbortError');
  return current;
}
