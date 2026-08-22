import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_READER_PREFERENCES,
  parseReaderPreferences,
  saveReaderPreferences,
} from '../packages/core/src/preferences.js';

test('voice controls default collapsed but retain all-slot expansion mode', () => {
  assert.equal(DEFAULT_READER_PREFERENCES.voicePanelExpanded, false);
  assert.equal(DEFAULT_READER_PREFERENCES.voiceSlotMode, 'all');
  assert.deepEqual(parseReaderPreferences('{bad json'), { ...DEFAULT_READER_PREFERENCES });

  const writes = [];
  const normalized = saveReaderPreferences({
    voicePanelExpanded: true,
    voiceSlotMode: 'all',
    primaryLocale: 'zh-CN',
    secondaryLocale: 'ja-JP',
    localeMode: 'parallel',
  }, {
    setItem(key, value) { writes.push({ key, value }); },
  });
  assert.equal(normalized.voicePanelExpanded, true);
  assert.equal(writes.length, 1);
});
