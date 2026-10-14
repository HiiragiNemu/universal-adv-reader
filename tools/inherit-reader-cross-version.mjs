import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appPrefix = 'apps/classic-reader/';
const evidence = path.join(root, 'reports/verification/reader-inheritance-20261012/atom10');
const candidate = path.join(root, 'work/reader-inheritance-20261012/cross-version-candidate');
const manifestPath = path.join(evidence, 'manifest.json');
if (fs.existsSync(manifestPath)) throw Error('Retain atom10 baseline');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = file => fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n');
const replace = (text, before, after) => {
  if (!text.includes(before) || text.indexOf(before) !== text.lastIndexOf(before)) throw Error('Anchor changed: ' + before.slice(0, 100));
  return text.replace(before, after);
};
const changes = new Map([[appPrefix + 'lib/legacy-vn-correspondence.ts', fs.readFileSync(path.join(candidate, 'lib/legacy-vn-correspondence.ts'), 'utf8')]]);
const data = 'public/data/legacy-vn/narcissu-3rd';
const sidecars = fs.readdirSync(path.join(candidate, data)).filter(name => name.endsWith('.alignment.json'));
if (sidecars.length !== 81) throw Error('Expected all81 cross-version sidecars');
for (const name of sidecars) changes.set(appPrefix + data + '/' + name, fs.readFileSync(path.join(candidate, data, name), 'utf8'));
let routing = source(appPrefix + 'lib/legacy-vn-voice-routing.ts');
routing = replace(routing, 'export type LegacyVoiceCue = {', 'export type LegacyVoiceCue = {\n  occurrenceId?: string;');
routing = replace(routing, 'export type LegacyVoiceRouteDocument = {', 'export type LegacyVoiceRouteDocument = {\n  documentSha256?: string;');
changes.set(appPrefix + 'lib/legacy-vn-voice-routing.ts', routing);
let alignment = source(appPrefix + 'lib/legacy-vn-alignment.ts');
alignment = replace(alignment, 'export type NativeAlignedRow = AlignedStoryLine & {', "export type NativeAlignedRow = AlignedStoryLine & {\n  pairing?: 'verified' | 'unpaired-cn' | 'unpaired-jp';");
alignment = replace(alignment, '  const key = (cue: LegacyVoiceCue) => JSON.stringify([cue.eventId, cue.cueId, cue.mediaId, cue.url]);', `  const key = (cue: LegacyVoiceCue) => JSON.stringify(cue.occurrenceId
    ? ['native-instruction', cue.occurrenceId, cue.mediaId, cue.url]
    : [cue.eventId, cue.cueId, cue.mediaId, cue.url]);`);
alignment = replace(alignment, '        nativeKeys: [...previous.nativeKeys, ...row.nativeKeys],', '        nativeKeys: [...previous.nativeKeys, ...row.nativeKeys],\n        pairing: previous.pairing === row.pairing ? row.pairing : undefined,');
alignment = replace(alignment, 'cnSlot: row.cnSlot ?? row.jpSlot', 'cnSlot: row.cnSlot ?? (row.pairing ? null : row.jpSlot)');
changes.set(appPrefix + 'lib/legacy-vn-alignment.ts', alignment);
let page = source(appPrefix + 'app/reader/[id]/page.tsx');
page = replace(page, "import { voicePlaybackController } from '@/lib/audio/voice-player';", `import { voicePlaybackController } from '@/lib/audio/voice-player';
import { loadNativeCorrespondence, hashNativeText, buildParallelNativeAlignment, applyNativeCueAliases,
  unpairedNativeCorrespondence, type NativeCorrespondence } from '@/lib/legacy-vn-correspondence';`);
page = replace(page, "  const [legacyVoiceRouteLoading, setLegacyVoiceRouteLoading] = useState(false);", `  const [legacyVoiceRouteLoading, setLegacyVoiceRouteLoading] = useState(false);
  const [nativeCorrespondenceState, setNativeCorrespondenceState] = useState<{
    route: LegacyVoiceRouteDocument | null; cnRaw: string; jpRaw: string;
    data: NativeCorrespondence | null; error: string; loading: boolean;
  }>({ route: null, cnRaw: '', jpRaw: '', data: null, error: '', loading: false });`);
page = replace(page, '        return parseLegacyVoiceRouteDocument(value, sourceIdentity);', '        return { ...parseLegacyVoiceRouteDocument(value, sourceIdentity), documentSha256: await hashNativeText(raw) };');
page = replace(page, '  const displayedCnLines =', `  useEffect(() => {
    const route = legacyVoiceRoute, cnRaw = cnSource?.raw ?? '', jpRaw = jpSource?.raw ?? '';
    const binding = { route, cnRaw, jpRaw };
    if (!route || route.chineseVariantId === route.japaneseVariantId || !cnSource || !jpSource) {
      setNativeCorrespondenceState({ ...binding, data: null, error: '', loading: false }); return;
    }
    const controller = new AbortController();
    setNativeCorrespondenceState({ ...binding, data: null, error: '', loading: true });
    void loadNativeCorrespondence(route, cnRaw, jpRaw, controller.signal)
      .then(data => { if (!controller.signal.aborted) setNativeCorrespondenceState({ ...binding, data, error: '', loading: false }); })
      .catch(error => { if (!controller.signal.aborted) setNativeCorrespondenceState({ ...binding, data: null,
        error: error instanceof Error ? error.message : '原作跨版本对应读取失败', loading: false }); });
    return () => controller.abort();
  }, [legacyVoiceRoute, cnSource, jpSource]);
  const currentNativeCorrespondence = nativeCorrespondenceState.route === legacyVoiceRoute
    && nativeCorrespondenceState.cnRaw === cnSource?.raw && nativeCorrespondenceState.jpRaw === jpSource?.raw
    ? nativeCorrespondenceState.data : null;

  const displayedCnLines =`);
page = replace(page, "    if (!legacyVoiceRoute || (cnEventLines.length === 0 && jpEventLines.length === 0)) return { rows: null, error: '' };\n    try { return { rows: buildSharedNativeAlignment(legacyVoiceRoute, cnEventLines, jpEventLines), error: '' }; }", `    if (!legacyVoiceRoute) return { rows: currentLegacyVoiceRoutePath ? [] : null, error: '' };
    if (cnEventLines.length === 0 && jpEventLines.length === 0) return { rows: [], error: '' };
    try {
      const shared = buildSharedNativeAlignment(legacyVoiceRoute, cnEventLines, jpEventLines);
      if (shared !== null) return { rows: shared, error: '' };
      if (!currentNativeCorrespondence && !nativeCorrespondenceState.error) return { rows: [], error: '' };
      return { rows: buildParallelNativeAlignment(legacyVoiceRoute, cnEventLines, jpEventLines,
        currentNativeCorrespondence ?? unpairedNativeCorrespondence(legacyVoiceRoute)), error: nativeCorrespondenceState.error };
    }`);
page = replace(page, '  }, [legacyVoiceRoute, cnEventLines, jpEventLines]);\n  const nativePresentationState', '  }, [legacyVoiceRoute, cnEventLines, jpEventLines, currentNativeCorrespondence, nativeCorrespondenceState.error, currentLegacyVoiceRoutePath]);\n  const nativePresentationState');
page = replace(page, `    try { return { rows: isEditMode ? (editedCnLines.length > 0
      ? applyNativeEditedLines(nativeAlignmentState.rows, editedCnLines) : nativeAlignmentState.rows)
      : mergeNativeAlignedRows(nativeAlignmentState.rows), error: nativeAlignmentState.error }; }`, `    try {
      const rows = isEditMode ? (editedCnLines.length > 0
        ? applyNativeEditedLines(nativeAlignmentState.rows, editedCnLines) : nativeAlignmentState.rows)
        : mergeNativeAlignedRows(nativeAlignmentState.rows);
      return { rows: mode === 'split' || isEditMode ? rows : rows.filter(row => mode === 'cn' ? row.cn : row.jp), error: nativeAlignmentState.error };
    }`);
page = replace(page, '  }, [nativeAlignmentState, isEditMode, editedCnLines]);', '  }, [nativeAlignmentState, isEditMode, editedCnLines, mode]);');
page = replace(page, '      legacyVoiceSlotState.cn.detachedCues,\n      legacyVoiceSlotState.jp.detachedCues,', "      applyNativeCueAliases(legacyVoiceSlotState.cn.detachedCues, 'cn', currentNativeCorrespondence),\n      applyNativeCueAliases(legacyVoiceSlotState.jp.detachedCues, 'jp', currentNativeCorrespondence),");
page = replace(page, '[legacyVoiceSlotState.cn.detachedCues, legacyVoiceSlotState.jp.detachedCues, mode],', '[legacyVoiceSlotState.cn.detachedCues, legacyVoiceSlotState.jp.detachedCues, mode, currentNativeCorrespondence],');
page = replace(page, '    if (!legacyVoiceRoute || effectiveLegacyVoiceError) return [];', '    if (!legacyVoiceRoute || effectiveLegacyVoiceError || nativePresentationState.rows?.length === 0) return [];');
page = replace(page, '[legacyVoiceRoute, effectiveLegacyVoiceError, mode, cnVoiceSlots, jpVoiceSlots]);', '[legacyVoiceRoute, effectiveLegacyVoiceError, mode, cnVoiceSlots, jpVoiceSlots, nativePresentationState.rows]);');
page = replace(page, '    return { total, sections, rows };\n  }, [renderList]);', `    // Hiding opposite-only rows in single-language mode is a display filter,
    // not a smaller source denominator for whole-story/section statistics.
    if (nativeAlignmentState.rows && !isEditMode && mode !== 'split') {
      Object.assign(total, emptyTextTotals());
      const fullSections = new Map<string | undefined, TextTotals>();
      let fullSection: TextTotals | undefined;
      for (const row of nativeAlignmentState.rows) {
        if (row.cn?.isHeader || row.jp?.isHeader) {
          fullSection = emptyTextTotals(); fullSections.set((row.cn ?? row.jp)?.headerId, fullSection); continue;
        }
        const stats = sourceTextTotals(row);
        for (const target of fullSection ? [total, fullSection] : [total]) {
          for (const key of Object.keys(stats) as (keyof TextTotals)[]) target[key] += stats[key];
        }
      }
      renderList.forEach((row, index) => {
        if (row.cn?.isHeader || row.jp?.isHeader) sections.set(index, fullSections.get((row.cn ?? row.jp)?.headerId) ?? emptyTextTotals());
      });
    }
    return { total, sections, rows };
  }, [renderList, nativeAlignmentState.rows, isEditMode, mode]);`);
page = replace(page, '            {nativePresentationState.error && <p', `            {nativeCorrespondenceState.loading && <p role="status" className="mb-4 text-xs opacity-60">正在核对原作跨版本事件…</p>}
            {currentNativeCorrespondence && mode === 'split' && (currentNativeCorrespondence.unpaired.cn.length > 0 || currentNativeCorrespondence.unpaired.jp.length > 0) &&
              <p data-native-correspondence-summary="true" className="mb-4 text-xs opacity-60">
                原作事件已对应 {currentNativeCorrespondence.pairs.length}；待核对 CN {currentNativeCorrespondence.unpaired.cn.length} / JP {currentNativeCorrespondence.unpaired.jp.length}。未对应原文分别保留，暂不视为新增或缺译。
              </p>}
            {nativePresentationState.error && <p`);
page = page.replaceAll("data-native-event-keys={'nativeKeys' in row ? JSON.stringify(row.nativeKeys) : undefined}", "data-native-event-keys={'nativeKeys' in row ? JSON.stringify(row.nativeKeys) : undefined}\n        data-native-pairing={'pairing' in row ? String(row.pairing ?? 'same-variant') : undefined}");
changes.set(appPrefix + 'app/reader/[id]/page.tsx', page);
let materializer = source('tools/materialize-classic-reader-data.mjs');
materializer = "import { spawnSync } from 'node:child_process';\n" + materializer;
materializer = replace(materializer, 'console.log(JSON.stringify({\n  result: bundleManifest.result,', `const nativeCorrespondenceBuild = spawnSync('python', ['-B',
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'build-native-correspondence.py'),
  '--output', publicRoot,
  '--report', path.resolve(publicRoot, '../../../reports/verification/native-correspondence-materialization.json')],
  { cwd: path.resolve(publicRoot, '../../..'), encoding: 'utf8' });
if (nativeCorrespondenceBuild.status !== 0) throw Error(nativeCorrespondenceBuild.stderr || 'Native correspondence generation failed');
console.log(nativeCorrespondenceBuild.stdout.trim());

console.log(JSON.stringify({
  result: bundleManifest.result,`);
changes.set('tools/materialize-classic-reader-data.mjs', materializer);
const entries = [];
for (const [file, text] of changes) {
  const target = path.join(root, file), existed = fs.existsSync(target), baseline = existed ? fs.readFileSync(target) : null;
  const newline = baseline?.includes(Buffer.from('\r\n')) ? '\r\n' : '\n';
  const modified = Buffer.from(text.replaceAll('\r\n', '\n').replaceAll('\n', newline));
  for (const [folder, bytes] of [['baseline', baseline], ['modified', modified]]) {
    if (!bytes) continue;
    const destination = path.join(evidence, folder, file); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, bytes);
  }
  entries.push({ file, existed, baselineSha256: baseline ? hash(baseline) : null, modifiedSha256: hash(modified) });
}
fs.writeFileSync(manifestPath, JSON.stringify({ schema: 1, root, target: 'root', entries }, null, 2));
for (const entry of entries) {
  const target = path.join(root, entry.file);
  if (entry.existed ? hash(fs.readFileSync(target)) !== entry.baselineSha256 : fs.existsSync(target)) throw Error('Concurrent edit: ' + entry.file);
}
for (const entry of entries) {
  const target = path.join(root, entry.file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(evidence, 'modified', entry.file), target);
  if (hash(fs.readFileSync(target)) !== entry.modifiedSha256) throw Error('Reopen mismatch');
}
console.log(`APPLIED_AND_REOPENED atom10: ${entries.length} scoped files including81 source-bound sidecars`);
