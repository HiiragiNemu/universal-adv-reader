import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseMajiroInstructions } from '../packages/adapters/src/majiro-native-content.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resource = 'D:/PROGETTO/narcissu-kana-research';
const output = path.join(root, 'reports/verification/content-repair-20261013/narcissu10/exclusion-audit.json');
const read = async relative => JSON.parse(await fs.readFile(path.join(resource, relative), 'utf8'));
const hash = text => createHash('sha256').update(text).digest('hex');
const normalized = text => String(text ?? '').normalize('NFKC').replace(/\s/gu, '');
const basename = value => path.posix.basename(String(value).replaceAll('\\', '/')).replace(/\.mjo$/iu, '').normalize('NFKC').toLowerCase();
const manifest = await read('manifests/generated/reader-adapter.json');
const stories = manifest.stories.filter(story => story.gameId.startsWith('narcissu-') && story.gameId !== 'narcissu-3rd');
const byName = new Map(stories.map(story => [story.gameId + '/' + basename(story.displayTitle), story.canonicalStoryId]));
const byId = new Map(manifest.stories.map(story => [story.canonicalStoryId, story]));
const documents = new Map();
async function document(variant) {
  if (!documents.has(variant.id)) documents.set(variant.id, await read(variant.references.script));
  return documents.get(variant.id);
}
function preferred(story) { return story.variants.find(variant => variant.id === story.preferredVariantId); }
function japanese(story) {
  return story.variants.find(variant => variant.sourceLocale === 'ja-JP' && variant.id.includes('original-ja-jp'))
    ?? story.variants.find(variant => variant.sourceLocale === 'ja-JP') ?? preferred(story);
}
const calls = [], literalReferences = [], failures = [], versions = [];
for (const story of stories) {
  for (const variant of story.variants) {
    const plainPath = variant.references.plainObject;
    if (!plainPath) continue;
    const plain = await fs.readFile(path.join(resource, plainPath));
    const instructions = parseMajiroInstructions(plain).filter(instruction => instruction.opcode !== 0x83A);
    const script = await document(variant);
    const sourceSegments = new Map(script.textEvents.flatMap(event => event.segments.map(segment => [segment.codeOffset, segment.rawHex])));
    for (const instruction of instructions) if (instruction.opcode === 0x840 && sourceSegments.get(instruction.codeOffset) !== instruction.stringRawHex)
      failures.push({ storyId: story.canonicalStoryId, variantId: variant.id, codeOffset: instruction.codeOffset, error: 'native-text-operand-not-in-script' });
    versions.push({ storyId: story.canonicalStoryId, variantId: variant.id, plainPath, plainSha256: hash(plain),
      textEvents: script.textEvents.length, nativeTextOperands: instructions.filter(instruction => instruction.opcode === 0x840).length,
      nativeInstructionCount: instructions.length });
    for (let index = 0; index < instructions.length; index++) {
      const instruction = instructions[index];
      if (instruction.opcode !== 0x801 || !instruction.string) continue;
      const target = byName.get(story.gameId + '/' + basename(instruction.string));
      if (!target) continue;
      literalReferences.push({ from: story.canonicalStoryId, to: target, variantId: variant.id,
        sourcePlain: plainPath, stringCodeOffset: instruction.codeOffset, rawName: instruction.string,
        followingInstructions: instructions.slice(index + 1, index + 9).map(next => ({ codeOffset: next.codeOffset, opcode: next.opcode, hex: next.hex })) });
      // Only direct stack-argument corridors are proved here. Native menus can
      // return a stored script literal and invoke it in the caller; retain every
      // exact-name literal separately instead of miscalling this scan exhaustive.
      const corridor = [];
      for (let at = index + 1; at < Math.min(instructions.length, index + 8); at++) {
        const next = instructions[at]; corridor.push(next);
        if ([0x834, 0x835, 0x80F, 0x810].includes(next.opcode)) {
          calls.push({ from: story.canonicalStoryId, to: target, variantId: variant.id,
            sourcePlain: plainPath, stringCodeOffset: instruction.codeOffset, rawName: instruction.string,
            callCodeOffset: next.codeOffset, callHex: next.hex, immediate: at === index + 1 });
          break;
        }
        if (![0x800, 0x801, 0x802, 0x803].includes(next.opcode)) break;
      }
    }
  }
}
const outgoing = new Map();
for (const call of literalReferences) {
  const targets = outgoing.get(call.from) ?? new Set(); targets.add(call.to); outgoing.set(call.from, targets);
}
const reachable = new Set(stories.filter(story => ['start', 'menu'].includes(basename(story.displayTitle))).map(story => story.canonicalStoryId));
const pending = [...reachable];
while (pending.length) for (const target of outgoing.get(pending.pop()) ?? []) if (!reachable.has(target)) { reachable.add(target); pending.push(target); }
const units = new Map();
for (const story of manifest.stories.filter(story => story.gameId.startsWith('narcissu-'))) {
  const variant = japanese(story), script = await document(variant);
  units.set(story.canonicalStoryId, script.textEvents.map(event => normalized(event.text)).filter(Boolean));
}
const included = stories.filter(story => story.resource.reader.decision === 'include');
const allIncluded = manifest.stories.filter(story => story.gameId.startsWith('narcissu-') && story.resource.reader.decision === 'include');
const includedSets = allIncluded.map(story => ({ storyId: story.canonicalStoryId, gameId: story.gameId, units: new Set(units.get(story.canonicalStoryId)) }));
const globalIncluded = new Set(allIncluded.flatMap(story => units.get(story.canonicalStoryId)));
const totalChars = list => list.reduce((sum, value) => sum + value.length, 0);
const excluded = [];
for (const story of stories.filter(story => story.resource.reader.decision === 'exclude')) {
  const list = units.get(story.canonicalStoryId), long = list.filter(text => text.length >= 10), denominator = totalChars(long);
  const bestMatches = includedSets.map(candidate => ({ storyId: candidate.storyId, sameGame: candidate.gameId === story.gameId,
    matchedUnits: list.filter(text => candidate.units.has(text)).length,
    matchedLongCharacters: totalChars(long.filter(text => candidate.units.has(text))) }))
    .sort((a,b) => b.matchedLongCharacters - a.matchedLongCharacters).slice(0, 3);
  const script = await document(japanese(story));
  excluded.push({ storyId: story.canonicalStoryId, oldReason: story.resource.reader.reasonCode,
    sourceJapaneseVariant: japanese(story).id, textEventCount: list.length, longTextCharacters: denominator,
    textSha256: hash(JSON.stringify(list)), allVersionNativeTextOperands: versions.filter(version => version.storyId === story.canonicalStoryId).map(version => ({ variantId: version.variantId, count: version.nativeTextOperands })),
    sameTextCopies: manifest.stories.filter(other => other.canonicalStoryId !== story.canonicalStoryId && units.has(other.canonicalStoryId)
      && JSON.stringify(units.get(other.canonicalStoryId)) === JSON.stringify(list)).map(other => other.canonicalStoryId),
    exactLongCharactersPresentInIncluded: totalChars(long.filter(text => globalIncluded.has(text))),
    reachableFromStartOrMenuNativeLiteralGraph: reachable.has(story.canonicalStoryId),
    nativeIncomingLiteralReferences: literalReferences.filter(call => call.to === story.canonicalStoryId),
    nativeIncomingCalls: calls.filter(call => call.to === story.canonicalStoryId), bestIncludedMatches: bestMatches,
    openingSample: script.textEvents.slice(0, 6).map(event => event.text),
    closingSample: script.textEvents.slice(-3).map(event => event.text) });
}
const comparisons = [];
for (const [whole, parts] of [
  ['narcissu-iris/novel', Array.from({length:9}, (_,i) => 'narcissu-iris/nar3_' + String(i).padStart(2,'0'))],
  ['narcissu-zero/4novel', [...Array.from({length:10}, (_,i) => 'narcissu-zero/nar4_' + String(i+1).padStart(2,'0')), 'narcissu-zero/nar4_ep']],
  ['narcissu-one-two/product', ['narcissu-3rd/product']],
]) {
  const original = units.get(whole), combined = parts.flatMap(part => units.get(part) ?? []);
  const set = new Set(combined);
  comparisons.push({ whole, parts, wholeUnits: original.length, partUnits: combined.length,
    exactSequence: JSON.stringify(original) === JSON.stringify(combined),
    exactJoinedCharacters: original.join('') === combined.join(''),
    wholeJoinedSha256: hash(original.join('')), partsJoinedSha256: hash(combined.join('')),
    unmatchedWholeUnits: original.filter(text => !set.has(text)) });
}
const report = { schema:'narcissu10-native-exclusion-audit/v1', result: failures.length ? 'FAIL' : 'PASS',
  method:'Re-parse every native plaintext MJO instruction extent; verify all 0x840 text operands against extraction. Record all exact known script-name literals across every archive/patch variant; separately prove immediate ldstr-to-call argument corridors. Start/menu graph treats every exact-name literal as a possible edge, including literals passed via native variables/menu callbacks; dynamic name construction and actual runtime conditions are not resolved. Compare complete normalized Japanese text and exact long-unit coverage against included scripts. Old exclusion reasons are labels under review, never proof.',
  counts:{stories:stories.length, included:included.length, excluded:excluded.length, compiledVariants:versions.length,
    rawTextOperandFailures:failures.length, nativeScriptReferenceOccurrences:literalReferences.length,
    directArgumentCorridorOccurrences:calls.length, reachableStoriesInLiteralGraph:reachable.size,
    includedNarcissuStoriesCompared:allIncluded.length},
  failures, versions, literalReferences, calls, comparisons, excluded };
await fs.mkdir(path.dirname(output),{recursive:true});
await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,counts:report.counts,comparisons:comparisons.map(x=>({...x,unmatchedWholeUnits:x.unmatchedWholeUnits.slice(0,8)}))}));
