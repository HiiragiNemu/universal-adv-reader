import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { classicApp, classicModules, React, renderToStaticMarkup } from '../test-support/classic-module-loader.js';

const require = createRequire(path.join(classicApp, 'package.json'));
const iconLibrary = require('lucide-react');
const icons = Object.fromEntries(['Book', 'Calendar', 'ChevronDown', 'ChevronRight', 'ChevronUp', 'FileText', 'Folder', 'Layers', 'User', 'X'].map(name => [name, iconLibrary[name]]));
const Link = ({ prefetch: _prefetch, children, ...props }) => React.createElement('a', props, children);
const publicRoot = process.env.ADV_CLASSIC_PUBLIC_ROOT ?? path.join(classicApp, 'public');
const stories = JSON.parse(fs.readFileSync(path.join(publicRoot, 'story_index.json'), 'utf8'));
const selectedAdapterStories = JSON.parse(fs.readFileSync(path.join(publicRoot,
  'data/legacy-vn/manifests/reader-adapter.json'), 'utf8')).stories
  .filter(story => story.resource?.reader?.decision === 'include');
const legacySectionFixture = stories.find(story => story.source_identity === 'narcissu-himeko/himeko_atogaki');
assert.ok(legacySectionFixture, 'the known native afterword route is required by the legacy-anchor fixture');
const themes = ['light', 'paper', 'green', 'dark', 'frost'];
const isNightTheme = theme => ['dark', 'frost'].includes(theme);
function common(theme) {
  const modules = classicModules(theme);
  return { modules, bindings: { ...React, ...icons, Link, isNightTheme,
    useGlobal: () => ({ theme, lastCategory: 'main_story', nameColorsEnabled: true, setLastCategory() {} }),
    ...modules.load('app/config/dictionary.ts'), ...modules.load('app/config/character-romaji.generated.ts'),
    ...modules.load('lib/generic-story-label.ts'), ...modules.load('lib/native-story-navigation.ts'), ...modules.load('lib/translation-visual-state.ts'),
    ...modules.load('lib/group-source-progress.ts'), ...modules.load('lib/source-progress-metrics.ts'), ...modules.load('lib/reader-name-chip.ts'),
    ...modules.load('lib/story-parser.ts'), ...modules.load('lib/official-tw-titles.ts'),
    ...modules.load('lib/category-order.ts'), ...modules.load('lib/sidebar-width.ts'),
  } };
}
function folderModule(theme, hooks = {}) {
  const { modules, bindings } = common(theme);
  return modules.fragments('app/page.tsx', ['EXEDRA_CATEGORIES', 'EXEDRA_CATEGORY_SET', 'NATURAL_COLLATOR',
    'isExedraCategory', 'isDayArchiveTheme', 'getDisplayLabel', 'storyProgress', 'translationProgressStatus',
    'storySourceVisualStatus', 'groupSourceVisualStatus', 'FolderCard'], { ...bindings, ...hooks });
}
function sidebarModule(theme, extras = {}) {
  const { modules, bindings } = common(theme);
  return modules.fragments('components/Sidebar.tsx', ['READER_SIDEBAR_COMPACT_DEFAULT', 'FROST_SIDEBAR_WIDTH_STORAGE_KEY',
    'SIDEBAR_WIDTH_SCOPE_RESTORE_KEY', 'subscribeSectionAnchor', 'sectionAnchorSnapshot', 'CATEGORY_CONFIG',
    'EXEDRA_CATEGORIES', 'NATURAL_COLLATOR', 'storyPercent', 'displayLabel', 'displayFolder', 'Sidebar'], {
    ...bindings, useRouter: () => ({ prefetch() {} }), useDialog: () => React.useRef(null),
    MadeInMagiusLogo: () => React.createElement('span', null, 'logo fixture'), ...extras,
  });
}
function descendants(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(descendants);
  return [node, ...descendants(node.props?.children)];
}

test('every selected native story route and label renders in the formal shared five-theme folder cards', () => {
  const before = JSON.stringify(stories);
  const grouped = Map.groupBy(stories, story => `${story.category}/${story.folder}`);
  assert.deepEqual(stories.filter(story=>story.source_format!=='supplemental-text/v1').map(story => story.source_identity).sort(),
    selectedAdapterStories.map(story => story.readerIdentity ?? story.canonicalStoryId).sort(),
    'the catalog must match the current explicit reader selection, including newly recovered scripts');
  assert.equal(new Set(stories.map(story => story.id)).size, stories.length);
  assert.deepEqual([...new Set(stories.map(story => story.category))].sort(),
    ['main_story', 'event_story', 'character_story', 'supplement_story'].sort());
  for (const theme of themes) {
    const { FolderCard } = folderModule(theme);
    for (const [key, items] of grouped) {
      const html = renderToStaticMarkup(React.createElement(FolderCard, { theme, group: {
        key, category: items[0].category, folderName: items[0].folder, items, totalCn: items.length,
        matchSnippets: { [items[0].id]: 'matching fixture opens the real folder' },
      } }));
      for (const story of items) {
        assert.ok(html.includes(`/reader/${story.id}`), `${theme} ${story.id}`);
        assert.ok(html.includes(`data-source-identity="${story.source_identity}"`));
      }
      assert.match(html, /data-completion-percent=/);
      assert.match(html, /data-translation-coverage-percent=/);
      assert.match(html, /magi-home-folder-tree/);
    }
  }
  assert.equal(JSON.stringify(stories), before);
});

test('native displayed titles are separate from exact route identifiers and never rewritten with other-game terminology', () => {
  const { genericStoryLabel } = classicModules().load('lib/generic-story-label.ts');
  assert.equal(genericStoryLabel({ id: 'native-id', title_cn: '后记', title: 'あとがき' }), '后记');
  assert.equal(genericStoryLabel({ id: 'native-id', title_cn: ' ', title_jp: '物語' }), '物語');
  assert.equal(genericStoryLabel({ id: 'native-id', filename_cn: 'EV494_cn.txt' }), 'EV494');
  assert.equal(genericStoryLabel({ id: 'native-id', title: '美由里／日之本' }), '美由里／日之本');
  for (const theme of themes) {
    const { displayLabel } = sidebarModule(theme);
    for (const story of stories) assert.equal(displayLabel({ ...story, nav_title_cn: undefined }), genericStoryLabel(story));
  }
});

test('enriched section metadata preserves every legacy story anchor and keeps branch/source identity distinct', () => {
  const modules = classicModules();
  const current = modules.load('lib/story-parser.ts');
  const baseline = modules.compile(fs.readFileSync(path.join(classicApp, '../../test-support/fixtures/directory/story-parser.ts'), 'utf8'), path.join(classicApp, 'lib/story-parser.ts'));
  let count = 0;
  for (const story of stories) for (const section of story.sections) {
    const old = baseline.storySectionDetails(section), next = current.storySectionDetails(section);
    assert.equal(next.anchorId, old.anchorId); assert.equal(next.label, old.label); count++;
  }
  assert.ok(count >= stories.length);
  const branch = current.storySectionDetails('EV00 Section 1 - Branch 2');
  assert.equal(branch.sourceName, 'EV00'); assert.equal(branch.sectionNumber, '1'); assert.equal(branch.branch, '2');
});

test('actual sidebar selects first section without a hash and emits exact native title links in all themes', () => {
  const story = { ...legacySectionFixture, native_sections: undefined, sections: ['himeko_atogaki Section 1', 'himeko_atogaki Section 2 - Branch 3'] };
  for (const theme of themes) {
    const { Sidebar } = sidebarModule(theme);
    const html = renderToStaticMarkup(React.createElement(Sidebar, { stories: [story], currentId: story.id, isOpen: true, onClose() {} }));
    assert.match(html, /aria-current="page"/);
    assert.match(html, /data-section-anchor="sec-himeko_atogaki-1" aria-current="location"/);
    assert.match(html, />Narcissu10周年<\/span>/);
    assert.doesNotMatch(html, /Narcissu 10th Anniversary Anthology Project/);
    assert.ok(html.includes(`title="后记 · ${story.id}"`));
    assert.ok(html.includes(`#sec-himeko_atogaki-2-branch-3`));
  }
});

test('actual sidebar section actions use hash reveal, including reselecting a target on another page', () => {
  const fakeWindow = { location: { hash: '#sec-himeko_atogaki-1' }, dispatchEvent: event => dispatched.push(event.type), addEventListener() {}, removeEventListener() {} };
  const dispatched = [], closed = [];
  const { Sidebar } = sidebarModule('frost', {
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: value => ({ current: value }), useMemo: callback => callback(), useCallback: callback => callback, useEffect() {},
    useSyncExternalStore: (_subscribe, read) => read(), useDialog: () => ({ current: null }),
    window: fakeWindow, HashChangeEvent: class { constructor(type) { this.type = type; } },
  });
  const story = { ...legacySectionFixture, native_sections: undefined, sections: ['himeko_atogaki Section 1', 'himeko_atogaki Section 2'] };
  const tree = Sidebar({ stories: [story], currentId: story.id, isOpen: true, onClose: () => closed.push(true) });
  const links = descendants(tree).filter(node => node.props?.['data-section-anchor']);
  assert.equal(links.length, 2);
  let prevented = 0;
  links[0].props.onClick({ preventDefault() { prevented++; } });
  assert.deepEqual(dispatched, ['hashchange']);
  links[1].props.onClick({ preventDefault() { prevented++; } });
  assert.equal(fakeWindow.location.hash, 'sec-himeko_atogaki-2');
  assert.equal(prevented, 2); assert.equal(closed.length, 2);
});

test('formal folder actions retain independent folder and episode expansion with real section links', () => {
  const states = []; let cursor = 0;
  const { FolderCard } = folderModule('frost', {
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
    useId: () => 'fixture-folder',
  });
  const story = { ...legacySectionFixture, native_sections: undefined, sections: ['himeko_atogaki Section 1', 'himeko_atogaki Section 2 - Branch 3'] };
  const group = { key: 'himeko', category: story.category, folderName: story.folder, items: [story], totalCn: 1 };
  const render = () => { cursor = 0; return FolderCard({ group, theme: 'frost' }); };
  let tree = render();
  assert.equal(descendants(tree).filter(node => node.type === Link).length, 0);
  const folderButton = descendants(tree).find(node => node.type === 'button');
  folderButton.props.onClick(); tree = render();
  assert.equal(descendants(tree).filter(node => node.type === Link).length, 1);
  const episodeButton = descendants(tree).find(node => node.props?.className?.includes('magi-home-story-toggle'));
  assert.ok(episodeButton); episodeButton.props.onClick({ preventDefault() {}, stopPropagation() {} }); tree = render();
  const links = descendants(tree).filter(node => node.type === Link).map(node => node.props.href);
  assert.ok(links.some(href => href.startsWith(`/reader/${story.id}`) && href.endsWith('#sec-himeko_atogaki-2-branch-3')));
});

test('source completion distinguishes pending translation coverage from reviewed work', () => {
  const { groupSourceProgressForStories, groupSourceCompletionPercent } = classicModules().load('lib/group-source-progress.ts');
  const list = [{ has_cn: true, percent: 100 }, { has_cn: true, percent: 100, source_unverified: true }, { has_cn: true, percent: 50, source_unverified: true, human_verified: true }];
  const before = JSON.stringify(list), progress = groupSourceProgressForStories(list);
  assert.equal(progress.eligibleChapters, 3); assert.equal(progress.pendingChapters, 1);
  assert.equal(groupSourceCompletionPercent(list), 50);
  assert.equal(JSON.stringify(list), before);
});

test('real category connector JSX preserves desktop/mobile theme shapes and keyboard/click activation', () => {
  for (const theme of themes) for (const mobile of [false, true]) {
    const { modules, bindings } = common(theme);
    const lines = [0, 1, 2, 3].map(optionIndex => ({ category: 'main_story', optionIndex, slotIndex: 0,
      x1: 10, y1: 20, x2: 150, y2: 25 + optionIndex * 40, anchorIndex: 1, distance: 150, slope: .2 }));
    let stateIndex = 0;
    const states = [mobile ? null : 'main_story', { top: 0, left: 0, width: 300, height: 220, menuLeft: 180, menuWidth: 120 },
      { overlayCategory: 'main_story', width: 300, height: 220, lines }, { width: 300, height: 220, sourceLines: lines }];
    const { CategoryNav, emptyCategorySourceFilterProgress } = modules.fragments('app/page.tsx', [
      'CATEGORY_CONFIG', 'MAX_CONNECTED_CATEGORIES', 'CATEGORY_ANCHOR_INDEX_BY_SLOT', 'CATEGORY_SOURCE_FILTERS',
      'ALL_SOURCE_CONNECTION', 'emptyCategorySourceFilterCounts', 'emptyCategorySourceFilterProgress',
      'categorySourceProgressPercent', 'categorySourceProgressText', 'pointInsideRect', 'categoryNavVisible',
      'isDayArchiveTheme', 'CategoryNav',
    ], { ...bindings,
      useState: () => [states[stateIndex++], () => {}], useRef: initial => ({ current: initial }),
      useMemo: callback => callback(), useCallback: callback => callback, useEffect() {},
    });
    const actions = [];
    const tree = CategoryNav({ categories: ['main_story'], activeCategory: 'main_story', selectedCategories: new Set(['main_story']),
      sourceConnections: new Map([['main_story', new Set(['all'])]]), sourceFilterCounts: { main_story: { all: 1, 'with-cn': 1, 'without-cn': 0, 'needs-review': 1 } },
      sourceFilterProgress: { main_story: emptyCategorySourceFilterProgress(true) }, searchActive: false, theme, mobile,
      mobileSourceRailOpen: true, mobileLayout: 'graph', onSelect() {}, onToggleCategory() {}, onSelectSourceFilter() {},
      onToggleSourceFilter: (category, filter) => actions.push([category, filter]),
    });
    const nodes = descendants(tree);
    const paths = nodes.filter(node => node.type === 'path' && node.props['data-connector-shape']);
    assert.equal(paths.length, 4);
    for (const node of paths) {
      assert.equal(node.props['data-connector-shape'], theme === 'frost' ? 'curved' : 'straight');
      assert.match(node.props.d, theme === 'frost' ? / C / : / L /);
    }
    assert.equal(paths[0].props['data-selected'], 'true'); assert.equal(paths[2].props['data-enabled'], 'false');
    const hit = nodes.find(node => node.type === 'path' && node.props.role === 'button');
    assert.ok(hit); hit.props.onClick();
    let prevented = false; hit.props.onKeyDown({ key: 'Enter', preventDefault() { prevented = true; } });
    assert.deepEqual(actions, [['main_story', 'all'], ['main_story', 'all']]); assert.equal(prevented, true);
  }
});

test('all five themes route through the formal shared home and shared gradient definitions', () => {
  const file = fs.readFileSync(path.join(classicApp, 'app/page.tsx'), 'utf8');
  assert.doesNotMatch(file, /import ClassicHome/);
  assert.match(file, /export default function Home\(\)\s*\{\s*return <FrostHome \/>;/);
  assert.match(file, /data-frost-source-paint-servers="shared"/);
  assert.match(file, /data-connector-shape=\{theme === 'frost' \? 'curved' : 'straight'\}/);
  assert.match(file, /<LocalStoryPicker theme=\{theme\}/);
  assert.doesNotMatch(file, /StorySupplementTabs|OtherTextCatalog|canonicalizeReaderDisplayText/);
  assert.equal((file.match(/<ReaderTubeSurface theme=\{theme\}/g) ?? []).length, 1);
});


test('formal five-theme navigation exposes all native KANA chapter titles and exact anchors instead of one placeholder episode', () => {
  const base = stories.find(story => story.source_identity === 'kana-okaeri/ev21');
  const plan = JSON.parse(fs.readFileSync(path.join(classicApp,
    '../../test-support/fixtures/native/kana-chapter-plan.json'), 'utf8'))
    .scripts.find(script => script.scriptId === 'EV21');
  const story = {
    ...base,
    native_sections: plan.sections.map(section => ({
      id: section.sectionId, anchorId: section.sectionId,
      title_cn: section.title['zh-CN'], title_jp: section.title['ja-JP'],
      ordinal: section.order,
    })),
  };
  for (const theme of themes) {
    const { Sidebar } = sidebarModule(theme);
    const sidebarHtml = renderToStaticMarkup(React.createElement(Sidebar, {
      stories: [story], currentId: story.id, isOpen: true, onClose() {},
    }));
    for (const section of story.native_sections) {
      assert.ok(sidebarHtml.includes('data-section-anchor="' + section.anchorId + '"'));
      assert.ok(sidebarHtml.includes(section.title_cn));
    }
    assert.ok(sidebarHtml.includes('7 节'));

    const states = []; let cursor = 0;
    const { FolderCard } = folderModule(theme, {
      useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
        return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
      },
      useId: () => 'native-folder',
    });
    const group = { key: 'native-childhood', category: story.category, folderName: '少年期', items: [story], totalCn: 1 };
    const render = () => { cursor = 0; return FolderCard({ group, theme }); };
    let tree = render();
    descendants(tree).find(node => node.type === 'button').props.onClick();
    tree = render();
    descendants(tree).find(node => node.props?.className?.includes('magi-home-story-toggle')).props.onClick();
    tree = render();
    const links = descendants(tree).filter(node => node.props?.['data-section-anchor']);
    assert.equal(links.length, 7);
    for (const [index, section] of story.native_sections.entries()) {
      assert.equal(links[index].props['data-section-anchor'], section.anchorId);
      assert.ok(links[index].props.href.endsWith('#' + section.anchorId));
    }
  }
});

test('original Chinese is reviewed and only the supplemented paragraphs stay pending in every theme', () => {
  for (const theme of themes) {
    const { FolderCard } = folderModule(theme);
    for (const pending of [0,1,100]) {
      const story={...stories[0],has_cn:true,percent:100,progress_rows:100,chinese_rows:100,reviewed_rows:100-pending,pending_review_rows:pending,human_verified:pending===0,source_unverified:pending>0};
      const html=renderToStaticMarkup(React.createElement(FolderCard,{theme,group:{key:'policy',category:story.category,folderName:story.folder,items:[story],totalCn:1}}));
      assert.ok(html.includes(`data-completion-percent="${100-pending}"`));
      assert.match(html,/data-translation-coverage-percent="100"/);
      assert.equal(/class="[^"]*magi-home-status-badge-unverified/.test(html),pending>0);
      if(!pending)assert.match(html,/已校对/);
    }
  }
});
