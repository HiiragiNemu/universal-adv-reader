/**
 * Faithful local Reader corrections backed by original KANA ISC/ISF evidence.
 * This module changes a copied route projection only; archives remain intact.
 */
export const KANA_CHINESE_CONTENT_CORRECTIONS = Object.freeze([Object.freeze({
  id: 'kana-ev49b-1176-missing-narration',
  scriptId: 'EV49B',
  canonicalStoryId: 'kana-okaeri/ev49b',
  instructionIndex: 1176,
  opcode: 0x2B,
  kind: 'message',
  jaOffset: 14236,
  zhOffset: 15258,
  expectedJapaneseText: '　以前に約束したことだった。',
  originalChineseText: '　',
  correctedChineseText: '　这是之前约定好的事。',
  reason: 'The original Chinese message operand contains only an ideographic space; its Japanese counterpart is a complete narration sentence.',
  evidence: Object.freeze({
    chineseMember: 'archive/raw/kana/ISC.unpacked/EV49B.ISF',
    chineseMemberSha256: 'bbe67ff3cd5923b12b921becf5e2824dacaf951aa5946a2b7741bdde63c26a0f',
    japaneseMember: 'archive/raw/kana/ISF.unpacked/EV49B.ISF',
    japaneseMemberSha256: '1db405574fb95d2859575bc3000ca178e71954a520d14379e824a70135122d7c',
    routePath: 'manifests/generated/kana-route-diff/scripts/EV49B.json',
    originalRouteSha256: '6fc178c2e1d75eda941d37f1afa8d5e7924a3cbc8fa91486588da4a577db2b76',
  }),
})]);

export function applyKanaChineseContentCorrections(route) {
  const applicable = KANA_CHINESE_CONTENT_CORRECTIONS.filter((fix) => fix.scriptId === route.scriptId);
  if (!applicable.length) return { route, appliedCorrections: [] };
  let alignments = [...route.textAlignments];
  const appliedCorrections = [];
  for (const fix of applicable) {
    const matches = alignments.map((item, index) => ({ item, index }))
      .filter(({ item }) => item.instructionIndex === fix.instructionIndex);
    if (matches.length !== 1) {
      throw new TypeError(`${fix.id}: expected exactly one source instruction, found ${matches.length}`);
    }
    const { item, index } = matches[0];
    const structuralMatch = item.opcode === fix.opcode && item.kind === fix.kind
      && item.jaOffset === fix.jaOffset && item.zhOffset === fix.zhOffset
      && item.jaText === fix.expectedJapaneseText;
    const alreadyApplied = item.zhText === fix.correctedChineseText
      && item.readerContentCorrection?.id === fix.id;
    if (!structuralMatch || (!alreadyApplied && item.zhText !== fix.originalChineseText)) {
      throw new TypeError(`${fix.id}: source changed; refusing to overwrite a different Chinese or Japanese message`);
    }
    if (alreadyApplied) continue;
    const receipt = {
      id: fix.id,
      locale: 'zh-CN',
      originalText: fix.originalChineseText,
      correctedText: fix.correctedChineseText,
      sourceJapaneseText: fix.expectedJapaneseText,
      evidence: fix.evidence,
    };
    alignments[index] = { ...item, zhText: fix.correctedChineseText, readerContentCorrection: receipt };
    appliedCorrections.push(receipt);
  }
  return { route: { ...route, textAlignments: alignments }, appliedCorrections };
}
