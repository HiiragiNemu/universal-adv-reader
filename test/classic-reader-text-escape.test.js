import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { classicApp, classicModules } from '../test-support/classic-module-loader.js';

const publicRoot = process.env.ADV_CLASSIC_PUBLIC_ROOT ?? path.join(classicApp, 'public');
const { parseStoryContent, serializeStoryLine } = classicModules().load('lib/story-parser.ts');
const parse = text => parseStoryContent(text, { mergeConsecutiveTextLines: false }).lines;
const body = text => parse(text).filter(line => !line.isHeader);

test('plain TXT backslashes, literal newline sequences and actual line breaks round-trip in one decoding pass', () => {
  const values = [
    '普通文字',
    '第一行\n第二行',
    '第一行\r\n第二行\r第三行',
    '字面\\n不应变成换行',
    '一个\\斜杠，两个\\\\斜杠',
    '组合\\\\\\n仍保持原字符',
    '末尾\\',
    'C:\\Games\\n10\\EV21.ISF',
  ];
  for (const text of values) {
    const encoded = serializeStoryLine({ speaker: '旁白', text });
    assert.equal(encoded.split('\n').length, 1);
    const decoded = body(encoded);
    assert.equal(decoded.length, 1);
    assert.equal(decoded[0].text, text.replace(/\r\n?/gu, '\n'));
    assert.equal(serializeStoryLine(decoded[0]), encoded);
  }
});

test('choice labels use the same escape dialect without changing native targets', () => {
  const choiceLabel = '第一行\n保留字面\\n和末尾\\';
  const line = {
    speaker: '选项', text: choiceLabel, isChoice: true,
    choiceLabel, choiceTargetId: 'native-case-7',
  };
  const encoded = serializeStoryLine(line);
  assert.equal(encoded.split('\n').length, 1);
  const decoded = body(encoded)[0];
  assert.equal(decoded.choiceLabel, choiceLabel);
  assert.equal(decoded.text, '【' + choiceLabel + '】');
  assert.equal(decoded.choiceTargetId, 'native-case-7');
});

test('legacy headers, narration, unknown escapes, newlines and speaker blocks retain their existing behavior', () => {
  const text = [
    '--- Start: legacy.txt Section 2 ---',
    '旁白：第一行\\n第二行',
    '旁白: 路径 C:\\Games\\KANA，未知\\q与末尾\\',
    '选择者: 接续',
    'Choice: 【原选项】 -> group_7',
  ].join('\n');
  const parsed = parse(text);
  assert.equal(parsed[0].headerId, 'sec-legacy-2');
  assert.equal(parsed[1].speaker, '旁白');
  assert.equal(parsed[1].text, '第一行\n第二行');
  assert.equal(parsed[2].text, '路径 C:\\Games\\KANA，未知\\q与末尾\\');
  assert.equal(parsed[4].choiceLabel, '原选项');
  assert.equal(parsed[4].choiceTargetId, '7');
  const merged = parseStoryContent(text).lines;
  assert.equal(merged.length, 4);
  assert.equal(merged[1].text, parsed[1].text + '\n' + parsed[2].text);
});

test('Scene0 and structured JSON keep their format-specific newline and text rules', () => {
  const scene0 = '@S0\t' + JSON.stringify({
    kind: 'narration', speaker: '旁白', text: '第一行\n第二行', command: 'narration',
  });
  const scene = parse(scene0)[0];
  assert.equal(scene.sourceFormat, 'scene0-text');
  assert.equal(scene.text, '第一行\n第二行');
  assert.equal(parse(serializeStoryLine(scene))[0].text, scene.text);

  const json = JSON.stringify([{ speaker: '名前', text: '实际\n字面\\n均保留' }]);
  assert.equal(parse(json)[0].text, '实际\n字面\\n均保留');
  const magireco = JSON.stringify({ story: { group_1: [
    { nameLeft: '人物', textLeft: '第一行@第二行' },
    { select: [{ textSelect: '选择[br]第二行', group: 'group_2' }] },
  ] } });
  const rows = body(magireco);
  assert.equal(rows[0].text, '第一行\n第二行');
  assert.equal(rows[1].choiceLabel, '选择\n第二行');
});

const exactNativeCases = [
  {
    canonical: 'narcissu-zero/nar4_09', firstCandidateCharacters: 6722,
    exactText: '那是，为了否定我……\\为了否定迄今为止我们的全部而哭泣……',
  },
  {
    canonical: 'narcissu-zero/nar4_ep', firstCandidateCharacters: 4430,
    exactText: '春天温暖的阳光、和屋顶上吹拂的强风。\\她长长的整齐的直发飘动着。',
  },
  {
    canonical: 'narcissu-3rd/nar2_02', firstCandidateCharacters: 5222,
    exactText: '安宁病房。\\n一般也称作　「宁缓医疗病房」。',
  },
  {
    canonical: 'narcissu-3rd/nar3_07', firstCandidateCharacters: 9415,
    exactText: '突然被问到的公主殿下不可思议的抬起头。\\但是我还是继续说道。',
  },
];
for (const fixture of exactNativeCases) test(fixture.canonical + ' preserves the exact native text and source character count', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(publicRoot, 'data/legacy-vn/manifest.json'), 'utf8'));
  const entry = manifest.entries.find(value => value.canonicalStoryId === fixture.canonical);
  assert.ok(entry);
  // The source parser can legitimately move a restored name from body to the
  // speaker field. This escape test compares against current pre-serialization
  // native characters, while retaining the original failure count as evidence.
  const nativeCharacters = entry.contentCharacters['zh-CN'];
  assert.ok(Number.isInteger(nativeCharacters) && nativeCharacters > 0);
  const raw = fs.readFileSync(path.join(publicRoot, entry.pathCn), 'utf8');
  const rows = body(raw);
  assert.ok(rows.some(line => line.text === fixture.exactText));
  const characters = rows.reduce((total, line) =>
    total + [...(line.choiceLabel || line.text).replace(/\s/gu, '')].length, 0);
  assert.equal(characters, nativeCharacters);
  const serialized = rows.map(serializeStoryLine).join('\n');
  assert.deepEqual(body(serialized).map(line => ({
    speaker: line.speaker, text: line.text,
    choiceLabel: line.choiceLabel, choiceTargetId: line.choiceTargetId,
  })), rows.map(line => ({
    speaker: line.speaker, text: line.text,
    choiceLabel: line.choiceLabel, choiceTargetId: line.choiceTargetId,
  })));
});
