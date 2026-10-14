import assert from 'node:assert/strict';
import test from 'node:test';
import { classicModules, React, renderToStaticMarkup, readerRowFragments, rowProps } from '../test-support/classic-module-loader.js';

test('real markerOnly output reserves glyphs invisibly while arrows and newline characters remain', () => {
  const { LineBreakMarkerText } = classicModules().load('components/StoryText.tsx');
  for (const text of ['第一行\nsecond line\n終', '\n\n', 'no newline', '<color=red>原文</color>\n🧑‍💻']) {
    const html = renderToStaticMarkup(React.createElement(LineBreakMarkerText, { text, markerOnly: true }));
    const spans = [...html.matchAll(/<span([^>]*)>([\s\S]*?)<\/span>/g)];
    const spacers = spans.filter(match => !match[1].includes('data-line-break-marker'));
    assert.ok(spacers.length);
    for (const [, attributes] of spacers) {
      assert.match(attributes, /data-line-break-spacer="true"/);
      assert.match(attributes, /style="visibility:hidden"/);
      assert.doesNotMatch(attributes, /display:none/);
    }
    assert.equal((html.match(/data-line-break-marker="true"/g) ?? []).length, text.split('\n').length - 1);
    assert.equal((html.match(/\n/g) ?? []).length, text.split('\n').length - 1);
    for (const [, attributes, content] of spans.filter(match => match[1].includes('data-line-break-marker'))) {
      assert.match(attributes, /aria-hidden="true"/); assert.doesNotMatch(attributes, /visibility:hidden/); assert.equal(content, '↵');
    }
  }
});

test('marker budget preserves all input characters and line breaks after the 200-arrow cap', () => {
  const { LineBreakMarkerText } = classicModules().load('components/StoryText.tsx');
  const text = Array.from({ length: 205 }, (_, index) => `line${index}`).join('\n');
  const html = renderToStaticMarkup(React.createElement(LineBreakMarkerText, { text, markerOnly: true }));
  assert.equal((html.match(/data-line-break-marker="true"/g) ?? []).length, 200);
  assert.equal(html.replace(/<[^>]*>/g, '').replaceAll('↵', ''), text);
  assert.match(html, /data-line-break-spacer="true" style="visibility:hidden">line200\nline201/);
});

test('normal StoryText keeps actual visible ink and rich ruby instead of inheriting spacer hiding', () => {
  const StoryText = classicModules().load('components/StoryText.tsx').default;
  for (const theme of ['light', 'paper', 'green', 'dark', 'frost']) {
    const html = renderToStaticMarkup(React.createElement(StoryText, { theme, text: '甲\n<r=か>仮</r>', showLineBreaks: true }));
    assert.match(html, /甲/); assert.match(html, /<ruby\b[^>]*>仮/);
    assert.match(html, /data-line-break-marker="true"/);
    assert.doesNotMatch(html, /data-line-break-spacer|visibility:hidden/);
  }
});

function descendants(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(descendants);
  return [node, ...descendants(node.props?.children)];
}

test('actual editable speaker distinguishes a missing field from an intentionally empty value', () => {
  const { StoryRow } = readerRowFragments();
  const row = { cn: { speaker: '优', text: '中文' }, jp: { speaker: '優', text: '原文' } };
  const cases = [{ editedLines: [], expected: '优' },
    { editedLines: [{ text: '修改' }], expected: '优' },
    { editedLines: [{ speaker: '', text: '修改' }], expected: '' },
    { editedLines: [{ speaker: '新名字', text: '修改' }], expected: '新名字' }];
  for (const theme of ['light', 'paper', 'green', 'dark', 'frost']) {
    for (const { editedLines, expected } of cases) {
      const tree = StoryRow({ ...rowProps, row, theme, isEditMode: true, editedLines });
      const input = descendants(tree).find(node => node.type === 'input' && node.props['aria-label'] === '第 3 行角色名');
      assert.ok(input); assert.equal(input.props.value, expected);
      assert.notEqual(input.props.readOnly, true); assert.notEqual(input.props.disabled, true);
    }
  }
});

test('clearing native speaker in actual onChange preserves text and source/audio identity', () => {
  const { StoryRow } = readerRowFragments();
  const original = { speaker: '优', text: '保留正文', eventId: 'kana:EV494:17', sourceId: 'EV494', audioCueId: 'kana-017', durationMs: 1500 };
  let edited = [{ ...original }];
  const makeTree = () => StoryRow({ ...rowProps, row: { cn: original, jp: { ...original, text: '日本語' } }, isEditMode: true,
    editedLines: edited, setEditedLines: updater => { edited = updater(edited); } });
  const input = descendants(makeTree()).find(node => node.type === 'input' && node.props['aria-label'] === '第 3 行角色名');
  input.props.onChange({ target: { value: '' } });
  assert.deepEqual(edited, [{ ...original, speaker: '' }]);
  assert.equal(original.speaker, '优');
  const after = descendants(makeTree()).find(node => node.type === 'input' && node.props['aria-label'] === '第 3 行角色名');
  assert.equal(after.props.value, '');
});

test('real edit row mounts marker-only spacer overlay without duplicating visible textarea ink', () => {
  const { StoryRow } = readerRowFragments();
  const html = renderToStaticMarkup(React.createElement(StoryRow, { ...rowProps, mode: 'cn', isEditMode: true,
    row: { cn: { speaker: '优', text: '旧文' } }, editedLines: [{ speaker: '', text: '第一行\n第二行' }] }));
  assert.match(html, /<textarea[^>]*>第一行\n第二行<\/textarea>/);
  assert.match(html, /data-line-break-overlay="true"/);
  assert.match(html, /data-line-break-spacer="true" style="visibility:hidden">第一行/);
  assert.match(html, /data-line-break-marker="true"/);
});
