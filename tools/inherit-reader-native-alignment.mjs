import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'apps/classic-reader');
const evidence = path.join(root, 'reports/verification/reader-inheritance-20261012/atom09');
const candidate = path.join(root, 'work/reader-inheritance-20261012/native-alignment-candidate');
const manifestPath = path.join(evidence, 'manifest.json');
if (fs.existsSync(manifestPath)) throw Error('Retain existing atom09 baseline');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = file => fs.readFileSync(path.join(app, file), 'utf8').replaceAll('\r\n', '\n');
function replace(text, before, after) {
  if (!text.includes(before) || text.indexOf(before) !== text.lastIndexOf(before)) throw Error(`Anchor changed: ${before.slice(0, 100)}`);
  return text.replace(before, after);
}
const changes = new Map([['lib/legacy-vn-alignment.ts', fs.readFileSync(path.join(candidate, 'lib/legacy-vn-alignment.ts'), 'utf8')]]);
let routing = source('lib/legacy-vn-voice-routing.ts');
routing = replace(routing, "type RouteEvent = {\n", `type RouteChoice = { choiceId: string; nextEventId: string; label: Partial<Record<LegacyVoiceLocale, string>> };
type RouteEvent = {
  choices?: RouteChoice[];
`);
routing = replace(routing, 'type RouteSection = {\n', 'type RouteSection = {\n  sectionId?: string;\n');
routing = replace(routing, '      return {\n        events: section.events.map', '      return {\n        ...(typeof section.sectionId === \'string\' ? { sectionId: section.sectionId } : {}),\n        events: section.events.map');
routing = replace(routing, '            ...(textLineIndex ? { textLineIndex } : {}),', `            ...(textLineIndex ? { textLineIndex } : {}),
            ...(Array.isArray(event.choices) ? { choices: event.choices.map(choice => {
              if (!isRecord(choice) || !isRecord(choice.label)) throw Error('原作选项结构无效');
              return { choiceId: asString(choice.choiceId), nextEventId: asString(choice.nextEventId),
                label: Object.fromEntries(Object.entries(choice.label).filter(([locale, label]) => isVoiceLocale(locale) && typeof label === 'string')) };
            }) } : {}),`);
changes.set('lib/legacy-vn-voice-routing.ts', routing);
let page = source('app/reader/[id]/page.tsx');
page = replace(page, "import { voicePlaybackController } from '@/lib/audio/voice-player';", `import { voicePlaybackController } from '@/lib/audio/voice-player';
import { buildSharedNativeAlignment, mergeNativeAlignedRows, mergeNativeVoiceSlots, mergeNativeVoiceCues,
  seedNativeEditableLines, applyNativeEditedLines, importNativeEditableLines } from '@/lib/legacy-vn-alignment';`);
const start = page.indexOf('  if (!cnSlot) return jpSlot ?? null;'), end = page.indexOf('\n};', start);
if (start < 0 || end < start) throw Error('Missing active slot helper');
page = page.slice(0, start) + '  return mergeNativeVoiceSlots(cnSlot, jpSlot);' + page.slice(end);
const cuesStart = page.indexOf('  const source = mode === \'cn\'', page.indexOf('const activeLegacyVoiceCues'));
const cuesEnd = page.indexOf('\n};', cuesStart);
page = page.slice(0, cuesStart) + `  return mode === 'cn' ? cnCues : mode === 'jp' ? jpCues : mergeNativeVoiceCues(cnCues, jpCues);` + page.slice(cuesEnd);
page = replace(page, '  const cnVoiceSlots = isEditMode', `  const nativeAlignmentState = useMemo(() => {
    if (!legacyVoiceRoute || (cnEventLines.length === 0 && jpEventLines.length === 0)) return { rows: null, error: '' };
    try { return { rows: buildSharedNativeAlignment(legacyVoiceRoute, cnEventLines, jpEventLines), error: '' }; }
    catch (error) { return { rows: [], error: error instanceof Error ? error.message : '原作事件对应失败' }; }
  }, [legacyVoiceRoute, cnEventLines, jpEventLines]);
  const nativePresentationState = useMemo(() => {
    if (nativeAlignmentState.rows === null) return { rows: null, error: nativeAlignmentState.error };
    try { return { rows: isEditMode ? (editedCnLines.length > 0
      ? applyNativeEditedLines(nativeAlignmentState.rows, editedCnLines) : nativeAlignmentState.rows)
      : mergeNativeAlignedRows(nativeAlignmentState.rows), error: nativeAlignmentState.error }; }
    catch (error) { return { rows: [], error: error instanceof Error ? error.message : '编辑事件对应失败' }; }
  }, [nativeAlignmentState, isEditMode, editedCnLines]);
  const cnVoiceSlots = nativePresentationState.rows !== null
    ? nativePresentationState.rows.map(row => row.cnSlot) : isEditMode`);
page = replace(page, '  const jpVoiceSlots = isEditMode', `  const jpVoiceSlots = nativePresentationState.rows !== null
    ? nativePresentationState.rows.map(row => row.jpSlot) : isEditMode`);
page = replace(page, '    () => alignStoryLines(displayedCnLines, displayedJpLines),\n    [displayedCnLines, displayedJpLines],', '    () => nativePresentationState.rows ?? alignStoryLines(displayedCnLines, displayedJpLines),\n    [nativePresentationState.rows, displayedCnLines, displayedJpLines],');
page = replace(page, '    legacyVoiceRouteError || legacyVoiceSlotState.error;', '    legacyVoiceRouteError || legacyVoiceSlotState.error || nativePresentationState.error;');
page = replace(page, '    const next = seedEditableLines(cnEventLines, jpEventLines, seed);', `    if (currentStory?.source_identity && (!legacyVoiceRoute || nativeAlignmentState.error)) {
      setEditMessage(nativeAlignmentState.error || '原作事件索引准备中，请稍后进入编辑'); return false;
    }
    const next = nativeAlignmentState.rows !== null
      ? seedNativeEditableLines(nativeAlignmentState.rows, seed)
      : seedEditableLines(cnEventLines, jpEventLines, seed);`);
page = replace(page, "      setEditMessage('当前剧情没有可编辑的文本。');\n      return;", "      setEditMessage('当前剧情没有可编辑的文本。');\n      return false;");
page = replace(page, "    setEditMessage('');\n  };\n\n  const toggleEditMode", "    setEditMessage('');\n    return true;\n  };\n\n  const toggleEditMode");
page = replace(page, "    if (editedCnLines.length === 0) initializeEditing('current');", "    if (editedCnLines.length === 0 && !initializeEditing('current')) return;");
page = replace(page, "      if (parsed.lines.length === 0) throw new Error('文件中没有可编辑的剧情文本。');", `      if (parsed.lines.length === 0) throw new Error('文件中没有可编辑的剧情文本。');
      if (nativeAlignmentState.rows !== null) {
        if (nativeAlignmentState.error) throw Error(nativeAlignmentState.error);
        if (parsed.format !== 'plain-text') throw Error('原作 TXT 导入需要逐事件文本；原生结构补丁使用独立格式');
        const next = importNativeEditableLines(nativeAlignmentState.rows, parsed.lines);
        setEditedCnLines(next);
        setMode(jpEventLines.length > 0 ? 'split' : 'cn');
        setEditMessage('已按原作事件键载入逐事件 TXT；标题与分支目标保持不变');
        return;
      }`);
page = replace(page, '            {voicePanelExpanded && !loadError && <div className="mb-4">', `            {nativePresentationState.error && <p role="alert" className="mb-4 text-sm text-red-600">{nativePresentationState.error}</p>}
            {voicePanelExpanded && !loadError && <div className="mb-4">`);
page = page.replaceAll('data-reader-row-index={index}', `data-reader-row-index={index}
        data-native-event-keys={'nativeKeys' in row ? JSON.stringify(row.nativeKeys) : undefined}`);
changes.set('app/reader/[id]/page.tsx', page);
const entries = [];
for (const [file, text] of changes) {
  const target = path.join(app, file), existed = fs.existsSync(target), baseline = existed ? fs.readFileSync(target) : null;
  const newline = baseline?.includes(Buffer.from('\r\n')) ? '\r\n' : '\n';
  const modified = Buffer.from(text.replaceAll('\r\n', '\n').replaceAll('\n', newline));
  for (const [folder, bytes] of [['baseline', baseline], ['modified', modified]]) {
    if (!bytes) continue;
    const target = path.join(evidence, folder, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
  }
  entries.push({ file, existed, baselineSha256: baseline ? hash(baseline) : null, modifiedSha256: hash(modified),
    source: 'Explicit native variant/event/choice anchors; joint formal speaker merging instead of independent zip; persistent native editing keys' });
}
fs.writeFileSync(manifestPath, JSON.stringify({ schema: 1, root, app, entries }, null, 2));
for (const entry of entries) {
  const target = path.join(app, entry.file);
  if (entry.existed ? hash(fs.readFileSync(target)) !== entry.baselineSha256 : fs.existsSync(target)) throw Error('Concurrent edit: ' + entry.file);
}
for (const entry of entries) {
  const target = path.join(app, entry.file); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(evidence, 'modified', entry.file), target);
  if (hash(fs.readFileSync(target)) !== entry.modifiedSha256) throw Error('Reopen mismatch');
}
console.log('APPLIED_AND_REOPENED atom09: native event/choice alignment + editing keys');
