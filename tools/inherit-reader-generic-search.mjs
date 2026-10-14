import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildGenericSearchIndex } from './build-generic-search-index.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = 'apps/classic-reader/', dir = path.join(root, 'reports/verification/reader-inheritance-20261012/atom11');
const candidate = path.join(root, 'work/reader-inheritance-20261012/generic-search-candidate');
if (fs.existsSync(path.join(dir, 'manifest.json'))) throw Error('Retain existing atom11 baseline');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n');
const pinned = file => execFileSync('git', ['-C', 'D:/magia/MyProducts/magi-reader', 'show', '56309ca742130e36d8d10fdb4f72de2a04cda02a:website/' + file], { encoding: 'utf8', maxBuffer: 2000000 }).replaceAll('\r\n', '\n');
const replace = (text, before, after) => { if (!text.includes(before) || text.indexOf(before) !== text.lastIndexOf(before)) throw Error('Changed anchor: ' + before.slice(0, 100)); return text.replace(before, after); };
const changes = new Map();
changes.set('tools/build-generic-search-index.mjs', fs.readFileSync(path.join(root, 'tools/build-generic-search-index.mjs')));
changes.set(app + 'lib/generic-search-catalog.ts', `export const GENERIC_CATEGORIES = ['main_story', 'event_story', 'character_story'] as const;
export const isGenericCategory = (value: string): boolean => (GENERIC_CATEGORIES as readonly string[]).includes(value);
export const genericCategory = (value: string): string => isGenericCategory(value) ? value : 'main_story';
export function genericSearchTitle(story: { id: string; folder: string; title?: string; title_cn?: string; title_jp?: string; filename_cn?: string; filename_jp?: string }, includeJapanese: boolean): string {
  return [story.id, story.folder, story.title_cn || story.title, story.filename_cn,
    ...(includeJapanese ? [story.title_jp, story.filename_jp] : [])].filter(Boolean).join(' ');
}
`);
changes.set(app + 'lib/search-worker-client.ts', pinned('lib/search-worker-client.ts'));
let worker = pinned('public/search-worker.js');
worker = replace(worker, '(?:magireco|exedra)', 'generic');
worker = replace(worker, "  if (!sourceUrl && !chunkBaseUrl) return null;", "  // The generic reader has one local chunk source, never an upstream fallback.\n  if (sourceUrl || !chunkBaseUrl) return null;");
changes.set(app + 'public/search-worker.js', worker);
let scope = read(app + 'lib/search-index-scope.ts');
scope = replace(scope, "export type SearchIndexScope = 'magireco' | 'exedra';", "export type SearchIndexScope = 'generic';");
const scopeStart = scope.indexOf('  magireco: {'), scopeEnd = scope.indexOf('export const isSearchIndexManifest');
scope = scope.slice(0, scopeStart) + `  generic: { label: 'Narcissu / KANA · 200 篇', manifestUrl: '/search_index_manifest.generic.json', objectKeyPrefix: 'search/generic' },
};

` + scope.slice(scopeEnd);
scope = replace(scope, "    (manifest.version === 1 || manifest.version === 2) &&", "    manifest.version === 2 &&");
scope = replace(scope, '  if (manifest.version === 1) return true;\n', '');
const remoteStart = scope.indexOf('  sources.push(', scope.indexOf('  sources.push(') + 1);
const remoteEnd = scope.indexOf('  return sources;', remoteStart);
if (remoteStart < 0 || remoteEnd < 0) throw Error('Missing remote source block');
scope = scope.slice(0, remoteStart) + scope.slice(remoteEnd);
changes.set(app + 'lib/search-index-scope.ts', scope);
let page = read(app + 'app/page.tsx'), official = pinned('app/page.tsx');
page = replace(page, "import { normalizeSearchText } from '@/lib/search';", "import { normalizeSearchText } from '@/lib/search';\nimport { createSearchWorkerClient, type SearchWorkerClient } from '@/lib/search-worker-client';\nimport { GENERIC_CATEGORIES, isGenericCategory, genericCategory, genericSearchTitle } from '@/lib/generic-search-catalog';");
page = page.replace("  type SearchIndexScope,\n", '').replace('type StorySystem = SearchIndexScope;\n', '');
page = replace(page, "const DEFAULT_CATEGORY: Record<StorySystem, string> = {\n  magireco: 'main_story',\n  exedra: 'exedra_main',\n};", "const DEFAULT_CATEGORY = 'main_story';");
page = replace(page, "  const { theme, setTheme, lastCategory, setLastCategory } = useGlobal();\n  const storySystem: StorySystem =\n    lastCategory.startsWith('exedra_') ? 'exedra' : 'magireco';", "  const { theme, setTheme, lastCategory: storedCategory, setLastCategory } = useGlobal();\n  const lastCategory = genericCategory(storedCategory);\n  useEffect(() => { if (storedCategory !== lastCategory) setLastCategory(lastCategory); }, [storedCategory, lastCategory, setLastCategory]);");
page = replace(page, "  | { type: 'status'; status: 'loading' | 'ready' }", "  | { type: 'status'; status: 'loading' | 'ready' | 'error' }\n  | { type: 'progress'; loadedBytes: number; totalBytes: number }");
page = replace(page, '  const workerRef = useRef<Worker | null>(null);', `  const workerRef = useRef<SearchWorkerClient | null>(null);
  const searchModeRef = useRef<SearchMode>('title');
  const [searchIndexStatus, setSearchIndexStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [searchIndexProgress, setSearchIndexProgress] = useState(0);
  useEffect(() => {
    if (searchIndexStatus !== 'ready') return;
    const timer = window.setTimeout(() => setSearchIndexStatus('idle'), 1600);
    return () => window.clearTimeout(timer);
  }, [searchIndexStatus]);`);
page = replace(page, `          .filter((category) =>
            storySystem === 'exedra'
              ? isExedraCategory(category)
              : !category.startsWith('exedra_'),
          ),`, '          .filter(isGenericCategory),');
page = page.replaceAll('DEFAULT_CATEGORY[storySystem]', 'DEFAULT_CATEGORY');
const searchBlockStart = text => text.lastIndexOf('  useEffect(() => {', text.indexOf('    if (!storyIndexSha256) return;'));
const searchBlockEnd = text => text.indexOf('  const normalizedQuery = normalizeSearchText(searchTerm);', searchBlockStart(text));
page = page.slice(0, searchBlockStart(page)) + official.slice(searchBlockStart(official), searchBlockEnd(official)).replaceAll('storySystem', "'generic'").replace("[storyIndexSha256, 'generic']", '[storyIndexSha256]') + page.slice(searchBlockEnd(page));
page = page.replace(/      const storyIsExedra = category\.startsWith\('exedra_'\);\n      if \([\s\S]*?      \}\n/g, '      if (!isGenericCategory(category)) continue;\n');
page = page.replaceAll(', storySystem]', ']').replaceAll('storySystem, ', '');
page = replace(page, "    const sourceStatusKnown = storySystem === 'exedra' || proofreadingStatus !== null;", '    const sourceStatusKnown = proofreadingStatus !== null;');
const titleStart = page.indexOf('      const romanizedTitle = characterRomanizedNameFor(category, story.folder);');
const titleEnd = page.indexOf('      const titleMatch =', titleStart);
page = page.slice(0, titleStart) + '      const titleText = genericSearchTitle(story, searchJp);\n' + page.slice(titleEnd);
page = replace(page, '      const shouldShow = normalizedQuery ? matches : categorySelected;', '      const shouldShow = categorySelected && matches;');
page = replace(page, '      if (\n        !normalizedQuery\n        && !storyMatchesCategorySourceFilters(', '      if (\n        !storyMatchesCategorySourceFilters(');
page = replace(page, '[enrichedStories, lastCategory, normalizedQuery, searchMode, textMatches, onlyNeedsReview, selectedCategories, sourceConnections]', '[enrichedStories, lastCategory, normalizedQuery, searchMode, searchJp, textMatches, onlyNeedsReview, selectedCategories, sourceConnections]');
const switchStart = page.indexOf('  const switchToStorySystem ='), switchEnd = page.indexOf('  const manualClosedCount =', switchStart);
page = page.slice(0, switchStart) + `  const selectAllWorks = () => {
    setSelectedCategories(new Set(GENERIC_CATEGORIES));
    setSourceConnections(new Map(GENERIC_CATEGORIES.map(category => [category, createAllSourceConnection()])));
    setOnlyNeedsReview(false);
    updateSearchTerm('');
  };

` + page.slice(switchEnd);
const buttonStart = page.lastIndexOf('              <button', page.indexOf('onClick={switchStorySystem}'));
const buttonEnd = page.indexOf('              </button>', buttonStart) + '              </button>'.length;
page = page.slice(0, buttonStart) + `              <button
                type="button" onClick={selectAllWorks}
                aria-pressed={GENERIC_CATEGORIES.every(category => selectedCategories.has(category))}
                aria-label="显示全部三部作品"
                className={\`magi-home-story-system-toggle flex items-center px-2.5 py-1 rounded cursor-pointer border text-xs font-bold whitespace-nowrap transition-all \${
                  isNightTheme(theme) ? 'border-blue-800 bg-blue-900/30 text-blue-300 hover:bg-blue-800'
                    : isDayArchiveTheme(theme) ? 'magi-home-light-button'
                    : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                }\`}
              >全部作品</button>` + page.slice(buttonEnd);
page = page.replaceAll('SEARCH_INDEX_SCOPE_CONFIG[storySystem]', 'SEARCH_INDEX_SCOPE_CONFIG.generic');
page = replace(page, `                          if (storySystem === 'exedra') {
                            switchToStorySystem('magireco');
                            setOnlyNeedsReview(true);
                            return;
                          }
`, '');
page = replace(page, `                        {storySystem === 'exedra'
                          ? '切换到魔法纪录待核验'
                          : onlyNeedsReview
                            ? '显示当前分类全部剧情'
                            : '只看来源待核验剧情'}`, `                        {onlyNeedsReview ? '显示当前分类全部剧情' : '只看来源待核验剧情'}`);
page = replace(page, "        isExedra={storySystem === 'exedra'}", '        isExedra={false}');
page = replace(page, "${storySystem === 'exedra' ? 'magi-exedra-ui-scope' : ''} ", '');
const progressStart = official.indexOf('                {searchIndexStatus !==');
const progressEnd = official.indexOf('                </div>}', progressStart) + '                </div>}'.length;
page = replace(page, '                  onChange={(event) => updateSearchTerm(event.target.value)}\n                />', '                  onChange={(event) => updateSearchTerm(event.target.value)}\n                />\n' + official.slice(progressStart, progressEnd).trimEnd());
if (/storySystem|switchToStorySystem/.test(page)) throw Error('Unconverted game switch remains: ' + page.split('\n').filter(line => /storySystem|switchToStorySystem/.test(line)).join('\n'));
changes.set(app + 'app/page.tsx', page);
// The earlier home stays retained and unmounted; separate its legacy UI type
// from the active index protocol, which now has only the local generic scope.
changes.set(app + 'components/ClassicHome.tsx', read(app + 'components/ClassicHome.tsx')
  .replace('  type SearchIndexScope,\n', '')
  .replace('type StorySystem = SearchIndexScope;', "type StorySystem = 'magireco' | 'exedra';")
  .replace('getSearchIndexSources(controller.signal, storyIndexSha256, storySystem)', "getSearchIndexSources(controller.signal, storyIndexSha256, 'generic')")
  .replace('SEARCH_INDEX_SCOPE_CONFIG[storySystem]', 'SEARCH_INDEX_SCOPE_CONFIG.generic'));
changes.set(app + 'app/layout.tsx', read(app + 'app/layout.tsx').replace("import CategoryLabelNormalizer from '@/components/CategoryLabelNormalizer';\n", '').replace('          <CategoryLabelNormalizer />\n', ''));
let materializer = read('tools/materialize-classic-reader-data.mjs');
materializer = replace(materializer, "import { classicStoryIds } from './generate-classic-story-ids.mjs';", "import { classicStoryIds } from './generate-classic-story-ids.mjs';\nimport { buildGenericSearchIndex } from './build-generic-search-index.mjs';");
materializer = replace(materializer, 'const nativeCorrespondenceBuild = spawnSync(', 'await buildGenericSearchIndex(publicRoot, publicRoot);\n\nconst nativeCorrespondenceBuild = spawnSync(');
changes.set('tools/materialize-classic-reader-data.mjs', materializer);
const generation = await buildGenericSearchIndex(path.join(root, app, 'public'), path.join(candidate, 'public'));
const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
for (const file of walk(path.join(candidate, 'public'))) changes.set(app + 'public/' + path.relative(path.join(candidate, 'public'), file).replaceAll('\\', '/'), fs.readFileSync(file));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const entries = [];
for (const [file, content] of changes) {
  const active = path.join(root, file), existed = file !== 'tools/build-generic-search-index.mjs' && fs.existsSync(active);
  const baseline = existed ? fs.readFileSync(active) : null;
  const modified = Buffer.isBuffer(content) ? content : Buffer.from(baseline && !baseline.includes(Buffer.from('\r\n')) ? content : content.replaceAll('\n', '\r\n'));
  if (baseline) { const dest = path.join(dir, 'baseline', file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, baseline); }
  const dest = path.join(dir, 'modified', file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, modified);
  entries.push({ file, existed, baselineSha256: baseline ? hash(baseline) : null, modifiedSha256: hash(modified) });
}
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schema: 1, atom: 'atom11', target: 'root', sourceCommit: '56309ca742130e36d8d10fdb4f72de2a04cda02a', entries, generation }, null, 2));
for (const entry of entries) {
  const active = path.join(root, entry.file);
  if (entry.existed && hash(fs.readFileSync(active)) !== entry.baselineSha256) throw Error('Preserve concurrent edit: ' + entry.file);
  fs.mkdirSync(path.dirname(active), { recursive: true }); fs.copyFileSync(path.join(dir, 'modified', entry.file), active);
}
console.log(JSON.stringify({ atom: 'atom11', files: entries.length, generation }));
