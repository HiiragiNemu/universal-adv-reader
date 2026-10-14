/** Independent read-only scan of freshly reconstructed N3 native CN variants. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildResearchCatalog, createResearchReaderAdapter } from '../packages/adapters/src/research-reader-v1.js';
import { NARCISSU_SPEAKER_ZH, parseMajiroInstructions } from '../packages/adapters/src/majiro-native-content.js';
import { readEffectiveReaderManifests } from './lib/content-selection-corrections.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resourceRoot = path.resolve(root, '../narcissu-kana-research');
const output = path.join(root, 'reports/verification/content-repair-20261013/narcissu3/speaker-prefix-native-audit.json');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHashes = new Map();
const sourcePath = url => path.join(resourceRoot, ...decodeURIComponent(url.replace(/^\/corpus\//u, '')).split('/'));
async function bytes(url) {
  const file = sourcePath(url), data = await readFile(file);
  sourceHashes.set(path.relative(resourceRoot, file).replaceAll('\\', '/'), sha(data));
  return data;
}
const io = { fetchJson: async url => JSON.parse((await bytes(url)).toString('utf8')),
  fetchBinary: async url => new Uint8Array(await bytes(url)) };
const { readerManifest } = await readEffectiveReaderManifests(resourceRoot);
const catalog = buildResearchCatalog(readerManifest), adapter = createResearchReaderAdapter();
const events = variant => variant.sections.flatMap(section => section.events);
const gb = new TextDecoder('gb18030', { fatal: true });
const fromHex = hex => Uint8Array.from(hex.match(/../gu) ?? [], byte => parseInt(byte, 16));
const clean = text => String(text ?? '').trim().normalize('NFKC');
const known = new Set([...Object.keys(NARCISSU_SPEAKER_ZH), ...Object.values(NARCISSU_SPEAKER_ZH)].map(clean));
const counts = { stories: 0, chineseVariants: 0, chineseBodies: 0, namedBodies: 0,
  sourceByteQuotePrefixRepairs: 0, nativeVoiceQuotePrefixRepairs: 0, inlineDelimiterRepairs: 0,
  cp932NativeRoleSlotRepairs: 0 };
const repairs = [], names = new Map(), bodies = [];
for (const corpus of catalog.corpora) for (const entry of corpus.stories) {
  if (!entry.canonicalStoryId.startsWith('narcissu-3rd/')) continue;
  const story = await adapter.load({ corpus, storyEntry: entry, io });
  counts.stories++;
  const jpNativeNames = new Map();
  for (const variant of story.variants.filter(v => v.sourceVariant.sourceLocale === 'ja-JP')) {
    for (const event of events(variant)) {
      const raw = event.source?.nativeUnit?.speakerRaw;
      if (!raw) continue;
      known.add(clean(raw.decodedText ?? raw.text));
      if (raw.method === 'native-name-slot') jpNativeNames.set(raw.rawHex, raw.decodedText ?? raw.text);
      try { known.add(clean(gb.decode(fromHex(raw.rawHex)))); } catch { /* CP932 may not be valid GB. */ }
    }
  }
  for (const variant of story.variants.filter(v => v.sourceVariant.sourceLocale === 'zh-CN')) {
    counts.chineseVariants++;
    const original = entry.sourceStory.variants.find(v => v.id === variant.variantId);
    const nativeInstructions = parseMajiroInstructions(await bytes('/corpus/' + original.references.plainObject)).filter(i => i.opcode !== 0x83a);
    for (const event of events(variant).filter(e => e.kind === 'line')) {
      const text = event.text?.['zh-CN'] ?? '', label = event.speaker?.['zh-CN'] ?? '';
      const unit = event.source.nativeUnit, raw = unit.speakerRaw;
      const item = { storyId: entry.canonicalStoryId, variantId: variant.variantId, eventId: event.eventId,
        speaker: label, text, scriptPath: event.source.scriptPath, rawSpeaker: raw };
      counts.chineseBodies++;
      if (label) {
        counts.namedBodies++;
        known.add(clean(label));
        if (!names.has(label)) names.set(label, { label, count: 0, examples: [] });
        const name = names.get(label); name.count++;
        if (name.examples.length < 3) name.examples.push(item);
      }
      if (raw?.method === 'native-inline-name-delimiter' && raw.delimiter === '@') counts.inlineDelimiterRepairs++;
      if (unit.speakerPrefixProof) {
        counts.nativeVoiceQuotePrefixRepairs++;
        repairs.push({ ...item, proof: unit.speakerPrefixProof, textParts: unit.textParts });
      }
      if (raw?.proof === 'same-story-native-JP-name-bytes-before-dialogue-quote') {
        counts.sourceByteQuotePrefixRepairs++;
        const first = unit.textParts[0];
        assert.equal(jpNativeNames.get(raw.rawHex), raw.decodedText);
        assert.ok(first.rawHex.startsWith(raw.rawHex));
        assert.ok([gb.decode(fromHex(raw.rawHex)), raw.decodedText].includes(raw.text));
        assert.ok(first.rawText.startsWith(raw.text));
        assert.equal(first.rawText.slice(raw.text.length), first.text);
        assert.match(first.text, /^[「『]/u);
        assert.ok(first.rawHex.slice(raw.rawHex.length).startsWith(first.text[0] === '「' ? '8175' : '8177'));
        repairs.push({ ...item, proof: raw.proof, textParts: unit.textParts });
      }
      if (raw?.method === 'native-name-slot' && !jpNativeNames.has(raw.rawHex)
        && raw.text !== raw.decodedText && NARCISSU_SPEAKER_ZH[raw.decodedText] === label) {
        counts.cp932NativeRoleSlotRepairs++;
        assert.equal(new TextDecoder('shift_jis', { fatal: true }).decode(fromHex(raw.rawHex)), raw.decodedText);
        const at = nativeInstructions.findIndex(i => i.codeOffset === raw.codeOffset);
        assert.ok(at >= 0);
        assert.equal(nativeInstructions[at].opcode, 0x840);
        assert.equal(nativeInstructions[at].stringRawHex, raw.rawHex);
        assert.equal(nativeInstructions[at + 1]?.opcode, 0x840);
        repairs.push({ ...item, proof: 'strict-CP932-native-name-slot-and-known-role-label',
          followingBodyInstruction: nativeInstructions[at + 1], textParts: unit.textParts });
      }
      bodies.push(item);
    }
  }
}
known.delete('');
const knownPrefixResidual = bodies.filter(item => {
  const match = item.text.match(/^\s*([^\n「『]{1,32})[「『]/u);
  return match && known.has(clean(match[1]));
});
const corruptedPrefixResidual = bodies.filter(item => /^(?:僠僒僩|僇僘傾僉|奀棡)[「『@]/u.test(item.text));
const delimiterResidual = bodies.filter(item => item.text.includes('@'));
const japaneseNameResidual = [...names.values()].filter(item => /[ぁ-ヿ]/u.test(item.label));
const glyphNameResidual = [...names.values()].filter(item => /\ufffd|[\uE000-\uF8FF]/u.test(item.label));
const unlocalizedLabelResidual = [...names.values()].filter(item => NARCISSU_SPEAKER_ZH[item.label] && NARCISSU_SPEAKER_ZH[item.label] !== item.label);
const report = { schema: 'narcissu3-fresh-native-speaker-prefix-audit/v1', counts,
  coverage: 'All effective N3 story sources freshly reconstructed through current adapter; every native CN variant, independent of published reader projections.',
  sourceHashes: Object.fromEntries(sourceHashes), names: [...names.values()].sort((a,b) => b.count-a.count), repairs,
  knownPrefixResidual, corruptedPrefixResidual, delimiterResidual, japaneseNameResidual, glyphNameResidual, unlocalizedLabelResidual };
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, counts,
  residuals: Object.fromEntries(['knownPrefixResidual', 'corruptedPrefixResidual', 'delimiterResidual', 'japaneseNameResidual', 'glyphNameResidual', 'unlocalizedLabelResidual'].map(key => [key, report[key].length])),
  knownPrefixExamples: knownPrefixResidual.slice(0, 12), japaneseNameResidual }));
