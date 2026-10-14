import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'apps/classic-reader');
const evidence = path.join(root, 'reports/verification/reader-inheritance-20261012/atom05');
const sourceRepo = 'D:/magia/MyProducts/magi-reader';
const commit = '56309ca742130e36d8d10fdb4f72de2a04cda02a';
const source = file => execFileSync('git', ['-C', sourceRepo, 'show', `${commit}:website/${file}`]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestPath = path.join(evidence, 'manifest.json');
if (process.argv.includes('--apply')) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const entry of manifest.entries) {
    const target = path.join(app, entry.file);
    if (entry.existed ? !fs.existsSync(target) || hash(fs.readFileSync(target)) !== entry.baselineSha256 : fs.existsSync(target)) {
      throw Error(`Preserve concurrent change: ${entry.file}`);
    }
    if (hash(fs.readFileSync(path.join(evidence, 'modified', entry.file))) !== entry.modifiedSha256) throw Error(`Candidate drift: ${entry.file}`);
  }
  for (const entry of manifest.entries) {
    const target = path.join(app, entry.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(evidence, 'modified', entry.file), target);
    if (hash(fs.readFileSync(target)) !== entry.modifiedSha256) throw Error(`Write verification: ${entry.file}`);
  }
  console.log(`APPLIED_AND_REOPENED ${manifest.entries.length} viewport/statistics files`);
  process.exit(0);
}
if (fs.existsSync(manifestPath)) throw Error('Resume the existing atom; do not replace its baseline.');
const files = [
  'components/ReaderFilmViewport.tsx', 'components/MaterialFrameLabel.tsx',
  'lib/reader-character-ruler.ts', 'lib/reader-character-ruler.test.ts',
  'lib/ruler-surface-css.ts', 'app/reader/reader-rulers.css',
];
const selected = new Map(files.map(file => [file, source(file)]));
const pageFile = 'app/reader/[id]/page.tsx';
const original = fs.readFileSync(path.join(app, pageFile));
const newline = original.includes(Buffer.from('\r\n')) ? '\r\n' : '\n';
let page = original.toString().replaceAll('\r\n', '\n');
const pinned = source(pageFile).toString().replaceAll('\r\n', '\n');
function between(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw Error(`Missing region ${start} … ${end}`);
  return text.slice(a, b);
}
function replace(before, after) {
  if (!page.includes(before) || page.indexOf(before) !== page.lastIndexOf(before)) throw Error(`Nonunique page anchor: ${before.slice(0, 110)}`);
  page = page.replace(before, after);
}
replace("type FilmRulerMark = " + between(page, 'type FilmRulerMark = ', 'type LoadedSource = ').slice('type FilmRulerMark = '.length),
  between(pinned, 'type TextTotals = ', 'type LoadedSource = '));
replace("import ReaderStyleScope from '@/components/ReaderStyleScope';", "import ReaderStyleScope from '@/components/ReaderStyleScope';\nimport ReaderFilmViewport, { type FilmRulerMark } from '@/components/ReaderFilmViewport';\nimport MaterialFrameLabel from '@/components/MaterialFrameLabel';");
replace('  const fontSize = readerDisplayPreferences.fontSizePx;', '  const readingRulerEnabled = isReaderRulerEnabled(readerDisplayPreferences, theme);\n  const fontSize = readerDisplayPreferences.fontSizePx;');
replace('  const deferredSearchQuery = useDeferredValue(searchQuery);\n', '');
replace("  const [searchQuery, setSearchQuery] = useState('');", "  const [searchQuery, setSearchQuery] = useState('');\n  const deferredSearchQuery = useDeferredValue(searchQuery);");
replace(between(page, '  const [visiblePage, setVisiblePage]', '  const readerDocumentRef ='),
  between(pinned, '  const [visiblePage, setVisiblePage]', '  const readerDocumentRef ='));
replace('  const firstStoryHeaderIndex = useMemo(', between(pinned, '  const textStatistics = useMemo(', '  const firstStoryHeaderIndex = useMemo(') + '  const firstStoryHeaderIndex = useMemo(');
const effectStart = '  useEffect(() => {\n    const readerDocument = readerDocumentRef.current;';
replace(between(page, effectStart, '  const editedLineIndices = useMemo('), between(pinned, effectStart, '  const editedLineIndices = useMemo('));
replace(between(page, '  const changeVisiblePage = useCallback(', '  useEffect(() => {\n    if (pageCount <= 1) return;'), between(pinned, '  const changeVisiblePage = useCallback(', '  useEffect(() => {\n    if (pageCount <= 1) return;'));
replace("data-reading-ruler={isReaderRulerEnabled(readerDisplayPreferences, theme) ? 'on' : 'off'}", "data-reading-ruler={readingRulerEnabled ? 'on' : 'off'}");
replace('          <div\n            ref={readerDocumentRef}', between(pinned, '          {readingRulerEnabled && <ReaderFilmViewport', '          <div\n            ref={readerDocumentRef}') + '          <div\n            ref={readerDocumentRef}');
replace('min-w-0 rounded-lg pb-32 transition-all duration-500 ease-in-out', 'min-w-0 rounded-lg pb-32');
replace(between(page, '            <aside\n              className="magi-reader-film-calibration"', '            {loadError && ('), between(pinned, '            {!loadError && <MaterialFrameLabel', '            {loadError && ('));
replace('                  query={deferredSearchQuery}', '                  query={deferredSearchQuery}\n                  lineCounts={lineCounts[index]}\n                  textStats={textStatistics.rows.get(index)}\n                  sectionStats={textStatistics.sections.get(index)}');
replace('  query: string;\n  normalizedQuery: string;', '  query: string;\n  lineCounts?: MeasuredRow;\n  textStats?: TextTotals;\n  sectionStats?: TextTotals;\n  normalizedQuery: string;');
replace('  query,\n  normalizedQuery,', '  query,\n  lineCounts,\n  textStats,\n  sectionStats,\n  normalizedQuery,');
replace('        {isBranch ? (', '        {sectionStats && <SourceStatistics stats={sectionStats} label="本节" />}\n        {isBranch ? (');
replace('        className="my-3 flex justify-center"\n      >', '        className="magi-reader-choice-row my-3 flex justify-center"\n      >\n        {textStats && <SourceStatistics stats={textStats} label="选项" />}');
replace('            👆 {choice.choiceLabel || choice.text}', '            <span aria-hidden="true">▸ </span><span data-reader-text-content={choice === row.jp ? \'jp\' : \'cn\'}>{choice.choiceLabel || choice.text}</span>');
replace('      className={`group flex transition-colors', '      data-lines-cn={lineCounts?.cn}\n      data-lines-jp={lineCounts?.jp}\n      className={`group relative flex transition-colors');
replace("      {mode !== 'jp' && (", between(pinned, '      {lineCounts && <span className="magi-reader-row-metrics"', "      {mode !== 'jp' && (") + "      {mode !== 'jp' && (");
for (const language of ['cn', 'jp']) {
  const start = `                <StoryText\n                  text={row.${language}.text}`;
  const block = between(page, start, '              </div>');
  replace(block, `                <span data-reader-text-content="${language}">\n${block}                </span>\n`);
}
selected.set(pageFile, Buffer.from(page.replaceAll('\n', newline)));
fs.mkdirSync(evidence, { recursive: true });
const baselineCommands = [
  { cwd: root, args: ['--test', 'test/*.test.js'] },
  { cwd: app, args: ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false'] },
];
const baseline = baselineCommands.map(item => {
  const result = spawnSync(process.execPath, item.args, { cwd: item.cwd, encoding: 'utf8', maxBuffer: 8000000 });
  return { command: `node ${item.args.join(' ')}`, cwd: item.cwd, exitStatus: result.status, stdout: result.stdout, stderr: result.stderr };
});
fs.writeFileSync(path.join(evidence, 'baseline-commands.json'), JSON.stringify(baseline, null, 2));
if (baseline.some(item => item.exitStatus !== 0)) throw Error('Baseline gate changed; inspect before applying.');
const entries = [];
for (const [file, bytes] of selected) {
  const target = path.join(app, file), existed = fs.existsSync(target);
  const old = existed ? fs.readFileSync(target) : null;
  for (const [kind, content] of [['baseline', old], ['modified', bytes]]) {
    if (content === null) continue;
    const output = path.join(evidence, kind, file);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, content);
  }
  entries.push({ file, existed, baselineSha256: old ? hash(old) : null, modifiedSha256: hash(bytes), source: file === pageFile ? 'retained generic reader + pinned ruler/statistics/page-turn regions' : `${commit}:website/${file}` });
}
fs.writeFileSync(manifestPath, JSON.stringify({ schema: 1, root, app, commit, sourceRepo, entries }, null, 2));
console.log(`PREPARED ${entries.length} files; baseline root tests and full typecheck pass`);
