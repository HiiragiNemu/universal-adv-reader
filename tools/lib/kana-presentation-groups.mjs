/**
 * Prove continuous KANA message-buffer appends from native bytecode.
 * The original VM consumes 0x2B messages without clearing the text cursor.
 * Between grouped messages we permit only text-id updates and delay/frame
 * instructions; no branch, call, title, voice start, or explicit buffer reset.
 */
import { kanaNormalInstructionBoundary } from './kana-native-sections.mjs';

const argumentSizes = new Map([[1, 4], [4, 1], [7, 1], [8, 4], [9, 1], [10, 4]]);
const visible = (value) => String(value ?? '').trim().length > 0;
const sourceEventId = (alignment) => `ikura-${alignment.jaOffset.toString(16)}`;
const operand = (document, bytecode, index) => {
  const instruction = document.instructions[index];
  if (!instruction) throw new TypeError(`KANA instruction ${index} is absent`);
  return bytecode.subarray(instruction.operandOffset, instruction.operandOffset + instruction.operandLength);
};

const messageControls = (bytes) => {
  const controls = [];
  let position = 1;
  while (position < bytes.length) {
    const command = bytes[position++];
    if (command === 0xFF || command === 0x13) {
      while (position < bytes.length && bytes[position] !== 0) position += 1;
      if (position >= bytes.length) throw new TypeError('Unterminated native KANA message operand');
      position += 1;
      continue;
    }
    const argumentSize = argumentSizes.get(command) ?? 0;
    if (position + argumentSize > bytes.length) throw new TypeError('Truncated native KANA message control');
    controls.push(command);
    position += argumentSize;
  }
  return controls;
};

const safeInstructionGap = (from, to, document, bytecode) => {
  if (from >= to) return false;
  for (let index = from + 1; index < to; index += 1) {
    const opcode = document.instructions[index]?.opcode;
    if (opcode === 0xF1 || opcode === 0xF2) continue;
    if (opcode !== 0x41) return false;
    const bytes = operand(document, bytecode, index);
    if (bytes.length !== 6 || bytes[0] !== 0x0B || bytes[1] !== 0) return false;
  }
  return true;
};

const nativeSpeaker = (text) => String(text ?? '').match(/^\s*([^：「『\n]{1,24})[：:][「『]/u)?.[1]?.trim().replace(/\s+/gu, '') ?? '';

export function deriveKanaPresentationGroups({
  route, japaneseDocument, japaneseBytecode, chineseDocument, chineseBytecode,
}) {
  if (!japaneseDocument || !chineseDocument || !japaneseBytecode || !chineseBytecode) {
    throw new TypeError('KANA presentation proof requires both native bytecode streams');
  }
  const boundary = kanaNormalInstructionBoundary(route);
  const groups = [];
  let pending = [];
  const proof = (alignment, document, bytecode) => {
    if (document.instructions[alignment.instructionIndex]?.opcode !== 0x2B) return null;
    const controls = messageControls(operand(document, bytecode, alignment.instructionIndex));
    // 0 = indentation reset; 6 = line advance; 8 = text-record ID.
    // 2/3/5 wait or clear a buffer. Native dispatch explicitly ignores
    // 0x0B..0x12 and 0x14..0xFE; the source CN patch contains 0x0B/0x80.
    const ignoredByEngine = (command) => command > 0x0A && command !== 0x13 && command !== 0xFF;
    return controls.every((command) => [0, 6, 8].includes(command) || ignoredByEngine(command)) ? controls : null;
  };
  const finish = () => {
    if (pending.length > 1 && pending.some(({ alignment }) => visible(alignment.jaText) || visible(alignment.zhText))) {
      const alignments = pending.map((item) => item.alignment);
      const first = alignments[0];
      const id = `kana/${route.scriptId.toLowerCase()}/append-${first.instructionIndex}`;
      const visibleIds = (locale) => alignments
        .filter((alignment) => visible(locale === 'ja-JP' ? alignment.jaText : alignment.zhText))
        .map(sourceEventId);
      const jaIds = visibleIds('ja-JP');
      const cnIds = visibleIds('zh-CN');
      // A whitespace marker plus one real line needs no display merge.
      if (Math.max(jaIds.length, cnIds.length) > 1) groups.push({
        id,
        scriptId: route.scriptId,
        canonicalStoryId: `kana-okaeri/${route.scriptId.toLowerCase()}`,
        display_join_mode: 'native-append',
        sourceEventIds: alignments.map(sourceEventId),
        visibleEventIdsByLocale: { 'ja-JP': jaIds, 'zh-CN': cnIds },
        firstVisibleEventIdByLocale: { 'ja-JP': jaIds[0] ?? null, 'zh-CN': cnIds[0] ?? null },
        sourceInstructionIndices: alignments.map((alignment) => alignment.instructionIndex),
        sourceTexts: {
          'ja-JP': alignments.map((alignment) => alignment.jaText),
          'zh-CN': alignments.map((alignment) => alignment.zhText),
        },
        joinedText: {
          'ja-JP': alignments.map((alignment) => alignment.jaText ?? '').join(''),
          'zh-CN': alignments.map((alignment) => alignment.zhText ?? '').join(''),
        },
        speaker: { 'ja-JP': nativeSpeaker(first.jaText), 'zh-CN': nativeSpeaker(first.zhText) },
        nativeControls: {
          'ja-JP': pending.map((item) => item.jpControls),
          'zh-CN': pending.map((item) => item.cnControls),
        },
        nativeLineAdvanceCommandsRetainedInEvidence: true,
        proof: {
          bilingualInstructionGap: 'Only 0x41 variable 0x000B, 0xF1, 0xF2 between messages',
          bufferControlAllowlist: [0, 6, 8],
          ignoredByNativeDispatch: '0x0B..0x12 and 0x14..0xFE; verified identical KANAOKA and KANACHS handlers',
          subsequentVoiceStarts: 0,
          crossBranchesOrCallsOrTitles: 0,
          nativeMessageHandler: 'KANAOKA.EXE 0x41B330',
          nativeControlDispatch: 'KANAOKA.EXE 0x41BDC2, jump table 0x41C584',
          nativeClearControl: 'control 3 -> 0x41BEB4 -> 0x41C6B0',
          nativeLineAdvanceControl: 'control 6 -> 0x41BEDE -> 0x41C910',
        },
      });
    }
    pending = [];
  };
  for (const alignment of route.textAlignments) {
    if (alignment.instructionIndex >= boundary) break;
    if (alignment.kind !== 'message' || !alignment.jaText) { finish(); continue; }
    const jpControls = proof(alignment, japaneseDocument, japaneseBytecode);
    const cnControls = proof(alignment, chineseDocument, chineseBytecode);
    if (!jpControls || !cnControls) { finish(); continue; }
    if (pending.length) {
      const previous = pending.at(-1).alignment;
      const hasVoice = alignment.jaSpeakers?.length || alignment.zhSpeakers?.length;
      if (hasVoice
        || !safeInstructionGap(previous.instructionIndex, alignment.instructionIndex, japaneseDocument, japaneseBytecode)
        || !safeInstructionGap(previous.instructionIndex, alignment.instructionIndex, chineseDocument, chineseBytecode)) finish();
    }
    pending.push({ alignment, jpControls, cnControls });
  }
  finish();
  return groups;
}

export function attachKanaPresentationGroups(events, groups) {
  const byEventId = new Map();
  for (const group of groups) {
    group.sourceEventIds.forEach((eventId, position) => {
      if (byEventId.has(eventId)) throw new TypeError(`KANA event ${eventId} appears in multiple presentation groups`);
      byEventId.set(eventId, {
        schema: 'ikura-presentation-group/v1',
        id: group.id,
        displayJoinMode: group.display_join_mode,
        position,
        sourceEventIds: group.sourceEventIds,
        visibleEventIdsByLocale: group.visibleEventIdsByLocale,
        firstVisibleEventIdByLocale: group.firstVisibleEventIdByLocale,
        speaker: group.speaker,
      });
    });
  }
  const ids = new Set(events.map((event) => event.eventId));
  for (const eventId of byEventId.keys()) if (!ids.has(eventId)) throw new TypeError(`Missing KANA presentation member ${eventId}`);
  return events.map((event) => {
    const presentationGroup = byEventId.get(event.eventId);
    return presentationGroup ? {
      ...event, source: { ...event.source, presentationGroup },
    } : event;
  });
}
