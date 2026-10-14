import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { classicApp, classicModules, React, renderToStaticMarkup, readerRowFragments, rowProps } from '../test-support/classic-module-loader.js';

const pageFile = 'app/reader/[id]/page.tsx';

test('real ruler measures graphemes and proportional glyphs, excluding ruby annotations and arrows', () => {
  const modules = classicModules();
  const code = fs.readFileSync(path.join(classicApp, 'lib/reader-character-ruler.ts'), 'utf8');
  const cell = { getBoundingClientRect: () => ({ left: 100, width: 220 }) };
  const nodes = [
    { textContent: 'A，👩‍💻B', parentElement: { closest: () => null } },
    { textContent: 'ruby', parentElement: { closest: () => ({ tagName: 'RT' }) } },
    { textContent: '↵', parentElement: { closest: () => ({ ariaHidden: true }) } },
  ];
  const element = { closest: () => cell };
  const positions = new Map([[0, { right: 119, top: 10, bottom: 30, width: 9 }],
    [1, { right: 126, top: 10, bottom: 30, width: 7 }],
    [2, { right: 146, top: 10, bottom: 30, width: 20 }],
    [7, { right: 122, top: 30, bottom: 50, width: 12 }]]);
  let start = 0;
  const document = {
    createTreeWalker(_element, _what, filter) {
      let index = 0;
      return { nextNode() { while (index < nodes.length) { const node = nodes[index++]; if (filter.acceptNode(node) === 1) return node; } return null; } };
    },
    createRange() { return { selectNodeContents() {}, getClientRects: () => [{ top: 10, bottom: 50 }],
      setStart(_node, offset) { start = offset; }, setEnd() {}, getBoundingClientRect: () => positions.get(start) }; },
  };
  const { measureRulerLine } = modules.compile(code, path.join(classicApp, 'lib/reader-character-ruler.ts'), {
    document, NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    getComputedStyle: node => node === cell ? { paddingLeft: '10px', paddingRight: '10px' } : { fontSize: '20px', letterSpacing: '1px' },
  });
  const first = measureRulerLine(element, 20);
  assert.equal(first.left, 110); assert.equal(first.width, 200); assert.equal(first.count, 3);
  assert.equal(first.endpoint, 36);
  assert.deepEqual(first.ticks.slice(0, 4).map(tick => tick.x), [0, 9, 16, 36]);
  assert.equal(first.ticks[4].x, 57);
  const second = measureRulerLine(element, 40);
  assert.equal(second.count, 1); assert.equal(second.endpoint, 12);
});

test('glyph cache reuses scroll measurements, separates languages, and invalidates changed content or width', () => {
  const { createRulerLineCache } = classicModules().load('lib/reader-character-ruler.ts');
  let calls = 0;
  const counted = createRulerLineCache((_element, y) => { calls++; return { left: 120, width: 200, count: 3, endpoint: y, ticks: [] }; });
  const cn = {}, jp = {}, paper = { top: 20, left: 100, width: 400 };
  const first = counted.read('cn', cn, 50, paper);
  assert.strictEqual(counted.read('cn', cn, 50, { ...paper, top: -100 }), first);
  assert.equal(calls, 1);
  assert.equal(counted.read('cn', cn, 50, { ...paper, left: 110 }).left, 130);
  assert.equal(calls, 1);
  counted.read('jp', jp, 50, paper); assert.equal(calls, 2);
  counted.read('cn', cn, 50, { ...paper, width: 300 }); assert.equal(calls, 3);
  counted.clear(); counted.read('cn', cn, 50, paper); assert.equal(calls, 4);
});

test('real printed-line grouping excludes hidden markers/ruby and coalesces mixed-height ink', () => {
  const nodes = [
    { textContent: '中文', parentElement: { closest: () => null }, rects: [{ top: 10, bottom: 30, width: 30, height: 20 }] },
    { textContent: 'A', parentElement: { closest: () => null }, rects: [{ top: 15, bottom: 28, width: 8, height: 13 }] },
    { textContent: '第二行', parentElement: { closest: () => null }, rects: [{ top: 40, bottom: 60, width: 45, height: 20 }] },
    { textContent: 'ルビ', parentElement: { closest: () => ({}) }, rects: [{ top: 0, bottom: 9, width: 10, height: 9 }] },
    { textContent: '↵', parentElement: { closest: () => ({}) }, rects: [{ top: 31, bottom: 35, width: 10, height: 4 }] },
  ];
  let selected;
  const document = {
    createTreeWalker(_element, _what, filter) { let index = 0; const visible = nodes.filter(node => filter.acceptNode(node) === 1); return { nextNode: () => visible[index++] }; },
    createRange: () => ({ selectNodeContents(node) { selected = node; }, getClientRects: () => selected.rects }),
  };
  const { measurePrintedText } = classicModules().fragments(pageFile, ['measurePrintedText'], { document, NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 } });
  assert.deepEqual(measurePrintedText({}), { characters: 6, lines: [{ top: 10, bottom: 30 }, { top: 40, bottom: 60 }] });
  assert.deepEqual(measurePrintedText(null), { characters: 0, lines: [] });
});

test('actual row JSX exposes both measured text spans and physical line totals in five themes and layouts', () => {
  for (const theme of ['light', 'paper', 'green', 'dark', 'frost']) {
    const { StoryRow } = readerRowFragments(theme);
    for (const bilingualLayout of ['side-by-side', 'stacked']) {
      for (const mode of ['cn', 'jp', 'split']) {
        const html = renderToStaticMarkup(React.createElement(StoryRow, { ...rowProps, theme, bilingualLayout, mode,
          row: { cn: { speaker: '优', text: '第一行\n第二行' }, jp: { speaker: '優', text: '<r=ゆう>優</r>です' } },
          lineCounts: { cn: 2, jp: 1, cnChars: 6, jpChars: 3 },
          textStats: { cn: 6, jp: 3, cnSourceLines: 2, jpSourceLines: 1 },
        }));
        assert.equal(html.includes('data-reader-text-content="cn"'), mode !== 'jp');
        assert.equal(html.includes('data-reader-text-content="jp"'), mode !== 'cn');
        assert.match(html, /data-lines-cn="2"/); assert.match(html, /data-lines-jp="1"/);
        assert.match(html, /TOTAL 9/); assert.match(html, /data-line-count="2"/);
        if (mode !== 'cn') assert.match(html, /<ruby\b[^>]*>/);
      }
    }
  }
});

test('whole/section source statistics distinguish text units from rendered lines without altering generic events', () => {
  const { sourceTextTotals, textStatistics } = classicModules().fragments(pageFile,
    ['emptyTextTotals', 'readableSourceText', 'sourceTextTotals', 'textStatistics'], {
      useMemo: callback => callback(),
      nativeAlignmentState: { rows: null }, isEditMode: false, mode: 'split',
      renderList: [{ cn: { isHeader: true, text: '章节' } },
        { cn: { text: '<red>中文</red>\n甲' }, jp: { text: '<r=かな>仮名</r>' } },
        { cn: { choiceLabel: '前进', text: '【前进】' }, jp: { choiceLabel: '進む', text: '【進む】' } }],
    });
  assert.deepEqual(textStatistics.total, { cn: 5, jp: 4, cnSourceLines: 3, jpSourceLines: 2 });
  assert.deepEqual(textStatistics.sections.get(0), textStatistics.total);
  assert.deepEqual(sourceTextTotals({ cn: { text: '' } }), { cn: 0, jp: 0, cnSourceLines: 0, jpSourceLines: 0 });
});

test('real page-turn callback clamps endpoints, stops voice before moving and clears pending timers', () => {
  const actions = [], timer = { current: 4 };
  const { changeVisiblePage } = classicModules().fragments(pageFile, ['changeVisiblePage'], {
    useCallback: callback => callback, pageCount: 4, storyRowsPerPage: 120, visiblePage: 1,
    voicePlaybackController: { stop() { actions.push('stop'); } }, pageTurnResetRef: timer,
    window: { clearTimeout(id) { actions.push(['clear', id]); }, setTimeout(callback, delay) { actions.push(['timer', delay]); return 5; } },
    setPageTurnDirection(value) { actions.push(['direction', value]); },
    setPageTurnSequence(updater) { actions.push(['sequence', updater(2)]); },
    setVisiblePage(value) { actions.push(['page', value]); },
    setPendingRowScroll(value) { actions.push(['scroll', value]); },
  });
  changeVisiblePage(1); assert.equal(actions.length, 0);
  changeVisiblePage(99);
  assert.deepEqual(actions, ['stop', ['clear', 4], ['direction', 'next'], ['sequence', 3], ['timer', 680], ['page', 3], ['scroll', { rowIndex: 360, highlight: false }]]);
  actions.length = 0; changeVisiblePage(-10);
  assert.ok(actions.some(value => value[0] === 'direction' && value[1] === 'prev'));
  assert.ok(actions.some(value => value[0] === 'page' && value[1] === 0));
});

test('page wires the preference-gated viewport and keeps sampled canvas/percentage rulers retired', () => {
  const page = fs.readFileSync(path.join(classicApp, pageFile), 'utf8');
  assert.match(page, /readingRulerEnabled && <ReaderFilmViewport/);
  assert.match(page, /data-reading-ruler=\{readingRulerEnabled/);
  assert.match(page, /marks=\{filmRulerMarks\}/);
  assert.doesNotMatch(page, /filmCharacterMarks|measureText\('測'\)|topPercent|magi-reader-film-calibration/);
  assert.match(page, /prefers-reduced-motion: reduce/);
  const viewport = fs.readFileSync(path.join(classicApp, 'components/ReaderFilmViewport.tsx'), 'utf8');
  assert.match(viewport, /attachShadow/); assert.match(viewport, /createRulerLineCache/);
  assert.match(viewport, /removeEventListener\('scroll'/);
});
