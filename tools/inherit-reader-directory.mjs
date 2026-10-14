import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'apps/classic-reader');
const dir = path.join(root, 'reports/verification/reader-inheritance-20261012/atom07');
const commit = '56309ca742130e36d8d10fdb4f72de2a04cda02a';
const sourceRepo = 'D:/magia/MyProducts/magi-reader';
const source = file => execFileSync('git', ['-C', sourceRepo, 'show', `${commit}:website/${file}`], { maxBuffer: 4000000 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ts = createRequire(path.join(app, 'package.json'))('typescript');
const manifestPath = path.join(dir, 'manifest.json');
if (process.argv.includes('--apply')) {
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const e of m.entries) {
    const target = path.join(app, e.file);
    if (e.existed ? !fs.existsSync(target) || hash(fs.readFileSync(target)) !== e.baselineSha256 : fs.existsSync(target)) throw Error(`Preserve concurrent change: ${e.file}`);
    if (hash(fs.readFileSync(path.join(dir, 'modified', e.file))) !== e.modifiedSha256) throw Error(`Candidate changed: ${e.file}`);
  }
  for (const e of m.entries) {
    const target = path.join(app, e.file); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(dir, 'modified', e.file), target);
    if (hash(fs.readFileSync(target)) !== e.modifiedSha256) throw Error(`Write mismatch: ${e.file}`);
  }
  console.log(`APPLIED_AND_REOPENED ${m.entries.length} directory files`); process.exit(0);
}
if (fs.existsSync(manifestPath)) throw Error('Resume existing atom07 instead of replacing its baseline.');
const normalized = bytes => bytes.toString().replaceAll('\r\n', '\n');
function nodeText(code, name) {
  const ast = ts.createSourceFile('source.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = ast.statements.find(node => node.name?.text === name || ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(ast) === name));
  if (!node) throw Error(`Missing declaration ${name}`);
  return node.getText(ast);
}
function once(text, before, after) {
  if (!text.includes(before) || text.indexOf(before) !== text.lastIndexOf(before)) throw Error(`Nonunique anchor ${before.slice(0, 100)}`);
  return text.replace(before, after);
}
function between(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw Error(`Missing region ${start}`);
  return text.slice(a, b);
}
const selected = new Map();
for (const file of ['lib/translation-visual-state.ts', 'lib/group-source-progress.ts', 'lib/reader-name-chip.ts', 'lib/ink-registration.ts', 'lib/official-tw-titles.ts']) selected.set(file, source(file));
function preserveEndings(file, text) {
  const old = fs.readFileSync(path.join(app, file));
  selected.set(file, Buffer.from(text.replaceAll('\n', old.includes(Buffer.from('\r\n')) ? '\r\n' : '\n')));
}
const pageFile = 'app/page.tsx';
const oldPage = normalized(fs.readFileSync(path.join(app, pageFile))), pinnedPage = normalized(source(pageFile));
let page = oldPage;
for (const name of ['FolderCard', 'CategoryNav', 'Home']) {
  let next = nodeText(pinnedPage, name);
  if (name === 'FolderCard') {
    // These source-only supplement routes have no corresponding native corpus.
    // Keep the complete directory mechanics, without injecting other games.
    next = once(next, '          <StorySupplementTabs stories={group.items} />\n', '');
    next = next.replace('canonicalizeReaderDisplayText(group.folderName)', 'group.folderName').replace('canonicalizeReaderDisplayText(label)', 'label');
    next = once(next, '                        href={storyHref}', '                        href={storyHref}\n                        title={`${label} · ${story.id}`}\n                        data-source-identity={story.source_identity}');
  }
  page = once(page, nodeText(page, name), next);
}
page = once(page, "import ClassicHome from '@/components/ClassicHome';\n", '');
page = once(page, nodeText(page, 'groupSourceProgressForStories'), '');
page = once(page, nodeText(page, 'getDisplayLabel'), 'const getDisplayLabel = genericStoryLabel;');
page = once(page, "import { categoryOrder } from '@/lib/category-order';", [
  "import { categoryOrder } from '@/lib/category-order';",
  "import { genericStoryLabel } from '@/lib/generic-story-label';",
  "import { translationVisualState, groupTranslationVisualState, translationVisualStyle } from '@/lib/translation-visual-state';",
  "import { groupSourceProgressForStories, groupSourceCompletionPercent, storySourceCompletionPercent } from '@/lib/group-source-progress';",
  "import { readerNameChip } from '@/lib/reader-name-chip';",
  "import { resolveOfficialSectionTitle } from '@/lib/official-tw-titles';",
].join('\n'));
page = once(page, 'const DEFAULT_CATEGORY:', nodeText(pinnedPage, 'categoryNavVisible') + '\n\nconst DEFAULT_CATEGORY:');
page = once(page, '      <div className="magi-scene-content">', between(pinnedPage, '      {/* Both category layouts', '      <div className="magi-scene-content">') + '      <div className="magi-scene-content">');
preserveEndings(pageFile, page);

const sidebarFile = 'components/Sidebar.tsx';
const oldSidebar = normalized(fs.readFileSync(path.join(app, sidebarFile)));
let sidebar = normalized(source(sidebarFile));
sidebar = once(sidebar, "import StorySupplementTabs from '@/components/StorySupplementTabs';", "import { genericStoryLabel } from '@/lib/generic-story-label';");
sidebar = once(sidebar, nodeText(sidebar, 'CATEGORY_CONFIG'), nodeText(oldSidebar, 'CATEGORY_CONFIG'));
sidebar = once(sidebar, nodeText(sidebar, 'displayLabel'), 'const displayLabel = genericStoryLabel;');
sidebar = once(sidebar, "  currentSupplement?: 'selection_dialogue' | 'story_summary';\n", '');
sidebar = once(sidebar, '  currentSupplement,\n', '');
sidebar = once(sidebar, 'story.id === currentId && !currentSupplement', 'story.id === currentId');
sidebar = once(sidebar, '                          {folderOpen && <StorySupplementTabs stories={items} active={items.some(item => item.id === currentId) ? currentSupplement : null} onNavigate={onClose} />}\n', '');
sidebar = once(sidebar, '  title?: string;', '  title?: string;\n  title_cn?: string;\n  title_jp?: string;');
sidebar = once(sidebar, '                                      href={storyHref}', '                                      href={storyHref}\n                                      data-source-identity={story.source_identity}');
sidebar = once(sidebar, '                                      title={label}', '                                      title={`${label} · ${story.id}`}');
preserveEndings(sidebarFile, sidebar);

const parserFile = 'lib/story-parser.ts';
let parser = normalized(fs.readFileSync(path.join(app, parserFile)));
const pinnedParser = normalized(source(parserFile));
for (const name of ['StorySectionDetails', 'storySectionDetails']) parser = once(parser, nodeText(parser, name), nodeText(pinnedParser, name));
preserveEndings(parserFile, parser);
selected.set('lib/generic-story-label.ts', Buffer.from(`/** Display titles come from the native corpus. Route IDs remain separate. */
type NativeStoryTitle = { id: string; title?: string; title_cn?: string; title_jp?: string; filename_cn?: string; filename_jp?: string };
export function genericStoryLabel(story: NativeStoryTitle): string {
  const title = [story.title_cn, story.title, story.title_jp].find(value => typeof value === 'string' && value.trim());
  if (title) return title.trim();
  return (story.filename_cn || story.filename_jp || story.id).replace(/(_cn|_jp)?\\.(?:txt|json)$/i, '');
}
`));
fs.mkdirSync(dir, { recursive: true });
const baseline = [];
for (const [cwd, args] of [[root, ['--test', 'test/*.test.js']], [app, ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false']]]) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 6000000 });
  baseline.push({ command: `node ${args.join(' ')}`, cwd, exitStatus: result.status, stdout: result.stdout, stderr: result.stderr });
}
fs.writeFileSync(path.join(dir, 'baseline-commands.json'), JSON.stringify(baseline, null, 2));
if (baseline.some(x => x.exitStatus !== 0)) throw Error('Baseline gate changed');
const entries = [];
for (const [file, bytes] of selected) {
  const target = path.join(app, file), existed = fs.existsSync(target), old = existed ? fs.readFileSync(target) : null;
  for (const [kind, content] of [['baseline', old], ['modified', bytes]]) {
    if (content === null) continue; const output = path.join(dir, kind, file);
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, content);
  }
  entries.push({ file, existed, baselineSha256: old ? hash(old) : null, modifiedSha256: hash(bytes),
    source: file === 'lib/generic-story-label.ts' ? 'native corpus display title adaptation' : `${commit}:website/${file}` });
}
fs.writeFileSync(manifestPath, JSON.stringify({ schema: 1, root, app, sourceRepo, commit, entries,
  adaptations: ['Only pinned FolderCard/CategoryNav/Home regions replace current home; retained local data/search and import mechanisms',
    'Five themes share the formal home scene; historical ClassicHome stays on disk but is not routed',
    'No upstream supplemental-text imports or terminology substitutions; generic category labels and stable identities retained',
    'Parser enrichment only adds sourceName/sectionNumber/branch to section descriptors; anchors and events unchanged'],
}, null, 2));
console.log(`PREPARED ${entries.length} scoped directory files`);
