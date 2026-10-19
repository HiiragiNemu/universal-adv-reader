import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_READER_PREFERENCES,
  parseReaderPreferences,
  saveReaderPreferences,
} from '../packages/core/src/preferences.js';

test('voice controls default visible and retain all-slot expansion mode', () => {
  assert.equal(DEFAULT_READER_PREFERENCES.voicePanelExpanded, true);
  assert.equal(DEFAULT_READER_PREFERENCES.voiceSlotMode, 'all');
  assert.deepEqual(parseReaderPreferences('{bad json'), { ...DEFAULT_READER_PREFERENCES });

  assert.equal(parseReaderPreferences({}).voicePanelExpanded, true);
  assert.equal(parseReaderPreferences({voicePanelExpanded:false}).voicePanelExpanded, false);
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
