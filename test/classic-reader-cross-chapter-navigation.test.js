import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { classicApp, classicModules } from '../test-support/classic-module-loader.js';

const publicRoot = process.env.ADV_CLASSIC_PUBLIC_ROOT ?? path.join(classicApp, 'public');
const stories = JSON.parse(fs.readFileSync(path.join(publicRoot, 'story_index.json'), 'utf8'));
const source = stories.find(story => story.source_identity === 'narcissu-3rd/nar3_06');
const target = stories.find(story => story.source_identity === 'narcissu-3rd/nar3_07');
assert.ok(source && target);
const { parseStoryIndex } = classicModules().load('lib/story-index.ts');
const relation = {
  id: 'iris-cn06-to-jp07',
  source_locale: 'zh-CN', source_event_ids: ['mjo-51e0'],
  target_story_id: target.id, target_locale: 'ja-JP', target_event_id: 'mjo-c5',
  message_cn: '这一段中文对应日文下一章的开头。',
  message_jp: 'この中国語部分は次章の日本語冒頭に対応します。',
};

test('cross-chapter navigation retains original story identities, text paths and source event ids', () => {
  const before = structuredClone(source);
  const entry = { ...source, cross_chapter_relations: [relation] };
  const parsed = parseStoryIndex([entry, target]);
  assert.deepEqual(parsed[0].cross_chapter_relations, [relation]);
  assert.equal(parsed[0].source_identity, before.source_identity);
  assert.equal(parsed[0].source_archive_identity, before.source_archive_identity);
  assert.equal(parsed[0].path_cn, before.path_cn);
  assert.equal(parsed[0].path_jp, before.path_jp);
  assert.deepEqual(parsed[0].sections, before.sections);
  assert.deepEqual(source, before);
});

test('cross-chapter metadata rejects unsafe routes, duplicate ids, invalid locales, invalid events and empty messages', () => {
  for (const change of [
    { id: '../relation' }, { source_locale: 'en' }, { target_locale: 'zh' },
    { target_story_id: '../reader/other' }, { target_story_id: 'https://example.invalid' },
    { target_story_id: 'other-safe-id' }, { target_event_id: '../mjo-1' },
    { source_event_ids: [] }, { source_event_ids: ['mjo-51e0', 'mjo-51e0'] },
    { source_event_ids: ['mjo-51e0', 4] }, { source_event_ids: ['mjo-51e0', ''] },
    { message_cn: '' }, { message_jp: '  ' }, { message_cn: 'text\u0000' },
    { message_jp: 'x'.repeat(2049) },
  ]) {
    assert.throws(() => parseStoryIndex([{ ...source,
      cross_chapter_relations: [{ ...relation, ...change }],
    }]), /cross_chapter_relations/u);
  }
  assert.throws(() => parseStoryIndex([{ ...source,
    cross_chapter_relations: [relation, { ...relation }],
  }]), /cross_chapter_relations/u);
  assert.throws(() => parseStoryIndex([{ ...source,
    cross_chapter_relations: { ...relation },
  }]), /cross_chapter_relations/u);
});
