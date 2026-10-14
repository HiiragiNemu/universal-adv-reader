import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'apps/classic-reader');
const evidence = path.join(root, 'reports/verification/reader-inheritance-20261012/atom08');
const candidate = path.join(root, 'work/reader-inheritance-20261012/voice-sequence-candidate');
const manifestPath = path.join(evidence, 'manifest.json');
if (fs.existsSync(manifestPath)) throw Error('Retain atom08 baseline. Inspect its current checkpoint before another change.');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = file => fs.readFileSync(path.join(app, file), 'utf8').replaceAll('\r\n', '\n');
function replace(text, before, after) {
  if (!text.includes(before) || text.indexOf(before) !== text.lastIndexOf(before)) throw Error(`Anchor changed: ${before.slice(0, 100)}`);
  return text.replace(before, after);
}
const changes = new Map();
for (const file of ['lib/audio/voice-player.ts', 'components/voice/VoiceSequenceControls.tsx']) changes.set(file, fs.readFileSync(path.join(candidate, file), 'utf8'));
let routing = source('lib/legacy-vn-voice-routing.ts');
routing = "import type { VoiceSequenceEntry } from './audio/voice-player.ts';\n" + routing;
routing += `
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
  slots.forEach((slot, rowIndex) => slot?.eventIds.forEach(id => rowByEvent.set(id, rowIndex)));
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
`;
changes.set('lib/legacy-vn-voice-routing.ts', routing);
let button = source('components/voice/VoicePlayButton.tsx');
button = replace(button, "import { isLegacyVnVoiceUrl, parseVoiceCue }", "import { isLegacyVnVoiceUrl }");
button = replace(button, '|| (!parseVoiceCue(cueId) && !isLegacyVnVoiceUrl(sourceUrl))', '|| !isLegacyVnVoiceUrl(sourceUrl)');
button = replace(button, 'const isCurrent = state.cueId === cueId;', 'const isCurrent = state.cueId === cueId && state.sourceUrl === sourceUrl;');
button = replace(button, '    voicePlaybackController.getSnapshot,', `    () => {
      const snapshot = voicePlaybackController.getSnapshot();
      return snapshot.cueId === cueId && snapshot.sourceUrl === sourceUrl
        ? snapshot : voicePlaybackController.getServerSnapshot();
    },`);
button = replace(button, "const isPlaying = isCurrent && state.status === 'playing';", "const isPlaying = isCurrent && (state.status === 'playing' || state.status === 'paused');");
changes.set('components/voice/VoicePlayButton.tsx', button);
let page = source('app/reader/[id]/page.tsx');
page = replace(page, "import { VoicePlayButton } from '@/components/voice/VoicePlayButton';", "import { VoicePlayButton } from '@/components/voice/VoicePlayButton';\nimport { VoiceSequenceControls } from '@/components/voice/VoiceSequenceControls';");
page = replace(page, '  buildLegacyVoiceSlots,', '  buildLegacyVoiceSlots,\n  buildLegacyVoiceSequence,');
page = replace(page, '  const [voicePanelExpanded, setVoicePanelExpanded] = useState(false);', `  const [voicePanelExpanded, setVoicePanelExpanded] = useState(false);
  const activeVoiceRow = useSyncExternalStore(voicePlaybackController.subscribe,
    () => voicePlaybackController.getSnapshot().sequence?.rowIndex ?? -1, () => -1);`);
page = replace(page, '  const textStatistics = useMemo(() => {', `  const legacyVoiceSequence = useMemo(() => {
    if (!legacyVoiceRoute || effectiveLegacyVoiceError) return [];
    return buildLegacyVoiceSequence(legacyVoiceRoute, mode === 'cn' ? 'zh-CN' : 'ja-JP',
      mode === 'cn' ? cnVoiceSlots : jpVoiceSlots);
  }, [legacyVoiceRoute, effectiveLegacyVoiceError, mode, cnVoiceSlots, jpVoiceSlots]);
  const textStatistics = useMemo(() => {`);
page = replace(page, '  const changeVisiblePage = useCallback((page: number) => {', `  // Explicit navigation cancels through stop(); auto-follow below intentionally
  // changes pages without cancelling the run that requested the next subtitle.
  useEffect(() => {
    voicePlaybackController.stop();
    return voicePlaybackController.stop;
  }, [id, mode, isEditMode, storyRowsPerPage, legacyVoiceRoute]);
  const startLegacyVoiceSequence = () => {
    if (loading || legacyVoiceRouteLoading || effectiveLegacyVoiceError || legacyVoiceSequence.length === 0) return;
    setVoicePanelExpanded(true);
    void voicePlaybackController.playSequence(legacyVoiceSequence, entry => {
      if (entry.rowIndex === null) return;
      setVisiblePage(Math.floor(entry.rowIndex / storyRowsPerPage));
      setPendingRowScroll({ rowIndex: entry.rowIndex, highlight: false });
    });
  };

  const changeVisiblePage = useCallback((page: number) => {`);
page = replace(page, '            {voicePanelExpanded && detachedLegacyVoiceCues.length > 0 && !loadError && (', `            {voicePanelExpanded && !loadError && <div className="mb-4">
              <VoiceSequenceControls
                onStart={startLegacyVoiceSequence}
                count={legacyVoiceSequence.length}
                disabled={loading || legacyVoiceRouteLoading || Boolean(effectiveLegacyVoiceError)}
                sourceLabel={mode === 'cn' ? '中文版本原作事件' : mode === 'split' ? '双语模式：日文版本原作事件' : '日文版本原作事件'}
              />
            </div>}
            {voicePanelExpanded && detachedLegacyVoiceCues.length > 0 && !loadError && (`);
page = replace(page, 'focused={currentMatchIndex >= 0 && matchedIndices[currentMatchIndex] === index}', 'focused={activeVoiceRow === index || (currentMatchIndex >= 0 && matchedIndices[currentMatchIndex] === index)}');
changes.set('app/reader/[id]/page.tsx', page);
const entries = [];
for (const [file, text] of changes) {
  const target = path.join(app, file), existed = fs.existsSync(target);
  const baseline = existed ? fs.readFileSync(target) : null;
  const newline = baseline?.includes(Buffer.from('\r\n')) ? '\r\n' : '\n';
  const modified = Buffer.from(text.replaceAll('\r\n', '\n').replaceAll('\n', newline));
  for (const [folder, bytes] of [['baseline', baseline], ['modified', modified]]) {
    if (!bytes) continue;
    const output = path.join(evidence, folder, file);
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, bytes);
  }
  entries.push({ file, existed, baselineSha256: baseline ? hash(baseline) : null, modifiedSha256: hash(modified),
    source: 'Pinned56309ca completion/sequence behavior adapted to native corpus URLs, actual event order, pause and cancellation' });
}
fs.writeFileSync(manifestPath, JSON.stringify({ schema: 1, root, app, entries }, null, 2));
for (const entry of entries) {
  const file = path.join(app, entry.file);
  if (entry.existed ? hash(fs.readFileSync(file)) !== entry.baselineSha256 : fs.existsSync(file)) throw Error(`Concurrent edit: ${entry.file}`);
}
for (const entry of entries) {
  const target = path.join(app, entry.file);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(evidence, 'modified', entry.file), target);
  if (hash(fs.readFileSync(target)) !== entry.modifiedSha256) throw Error(`Reopen mismatch: ${entry.file}`);
}
console.log(`APPLIED_AND_REOPENED atom08: ${entries.length} scoped files`);
