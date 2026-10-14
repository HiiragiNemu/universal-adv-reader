import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deriveKanaPresentationGroups } from './lib/kana-presentation-groups.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resource = process.env.ADV_CORPUS_REPOSITORY ?? 'D:/PROGETTO/narcissu-kana-research';
const output = path.join(root, 'reports/verification/content-repair-20261013/kana/presentation-groups.json');
const readJson = async (relative) => JSON.parse(await readFile(path.join(resource, relative), 'utf8'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const plan = JSON.parse(await readFile(path.join(root, 'reports/verification/content-repair-20261013/kana/chapter-plan.json'), 'utf8'));
const records = [];
const proofs = [];
for (const script of plan.scripts) {
  const routePath = `manifests/generated/kana-route-diff/scripts/${script.scriptId}.json`;
  const routeBytes = await readFile(path.join(resource, routePath));
  const route = JSON.parse(routeBytes);
  const japaneseDocument = await readJson(`archive/derived/ikura-scripts/ISF.unpacked/${script.scriptId}.script.json`);
  const chineseDocument = await readJson(`archive/derived/ikura-scripts/ISC.unpacked/${script.scriptId}.script.json`);
  const japaneseBytecode = await readFile(path.join(resource, 'archive/derived/ikura-scripts', japaneseDocument.bytecode));
  const chineseBytecode = await readFile(path.join(resource, 'archive/derived/ikura-scripts', chineseDocument.bytecode));
  const groups = deriveKanaPresentationGroups({ route, japaneseDocument, japaneseBytecode, chineseDocument, chineseBytecode });
  if (!groups.length) continue;
  records.push(...groups);
  proofs.push({
    scriptId: script.scriptId, routePath, routeSha256: sha(routeBytes),
    japaneseBytecodeSha256: sha(japaneseBytecode), chineseBytecodeSha256: sha(chineseBytecode),
    groupCount: groups.length,
  });
}
const report = {
  schema: 'kana-native-presentation-groups/v1',
  result: 'PASS',
  counts: {
    sourceScripts: plan.scripts.length,
    scriptsWithContinuousMessageGroups: proofs.length,
    presentationGroups: records.length,
    nativeMessageInstructions: records.reduce((sum, group) => sum + group.sourceEventIds.length, 0),
    visibleJapaneseFragments: records.reduce((sum, group) => sum + group.visibleEventIdsByLocale['ja-JP'].length, 0),
    visibleChineseFragments: records.reduce((sum, group) => sum + group.visibleEventIdsByLocale['zh-CN'].length, 0),
  },
  sources: proofs,
  groups: records,
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ result: report.result, counts: report.counts, output }, null, 2));
