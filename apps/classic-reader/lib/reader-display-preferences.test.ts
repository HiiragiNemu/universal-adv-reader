import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_READER_FONT_SIZE,
  DEFAULT_READER_TEXT_WIDTH,
  READER_FONT_SIZE_MAX,
  READER_FONT_SIZE_MIN,
  READER_DISPLAY_PREFERENCES_STORAGE_KEY,
  READER_TEXT_WIDTH_MAX,
  READER_TEXT_WIDTH_MIN,
  getReaderDisplayPreferencesSnapshot,
  getReaderDisplayPreferencesServerSnapshot,
  parseReaderDisplayPreferences,
  subscribeReaderDisplayPreferences,
  updateReaderDisplayPreferences,
} from './reader-display-preferences.ts';

test('reader display preferences default to visible line-break markers', () => {
  assert.deepEqual(parseReaderDisplayPreferences(null), {
    textWidthPx: DEFAULT_READER_TEXT_WIDTH,
    fontSizePx: DEFAULT_READER_FONT_SIZE,
    fontControlOpen: true,
    showLineBreaks: true,
    nameColorsEnabled: true,
    showVoiceButtons: true,
    nightPhosphor: 'amber',
    nightPixelFontEnabled: true,
    nightGreenPixelFontEnabled: false,
    rulerEnabled: 'auto',
  });
  assert.deepEqual(parseReaderDisplayPreferences('{broken'), {
    textWidthPx: DEFAULT_READER_TEXT_WIDTH,
    fontSizePx: DEFAULT_READER_FONT_SIZE,
    fontControlOpen: true,
    showLineBreaks: true,
    nameColorsEnabled: true,
    showVoiceButtons: true,
    nightPhosphor: 'amber',
    nightPixelFontEnabled: true,
    nightGreenPixelFontEnabled: false,
    rulerEnabled: 'auto',
  });
});

test('reader display preferences clamp and snap persisted widths', () => {
  assert.deepEqual(
    parseReaderDisplayPreferences(
      JSON.stringify({ textWidthPx: 100, fontSizePx: 8, showLineBreaks: true }),
    ),
    {
      textWidthPx: READER_TEXT_WIDTH_MIN,
      fontSizePx: READER_FONT_SIZE_MIN,
      fontControlOpen: true,
      showLineBreaks: true,
      nameColorsEnabled: true,
      showVoiceButtons: true,
    nightPhosphor: 'amber',
    nightPixelFontEnabled: true,
    nightGreenPixelFontEnabled: false,
    rulerEnabled: 'auto',
    },
  );
  assert.deepEqual(
    parseReaderDisplayPreferences(
      JSON.stringify({ textWidthPx: 5000, fontSizePx: 99, showLineBreaks: false }),
    ),
    {
      textWidthPx: READER_TEXT_WIDTH_MAX,
      fontSizePx: READER_FONT_SIZE_MAX,
      fontControlOpen: true,
      showLineBreaks: false,
      nameColorsEnabled: true,
      showVoiceButtons: true,
    nightPhosphor: 'amber',
    nightPixelFontEnabled: true,
    nightGreenPixelFontEnabled: false,
    rulerEnabled: 'auto',
    },
  );
  assert.equal(
    parseReaderDisplayPreferences(
      JSON.stringify({ textWidthPx: 783, showLineBreaks: true }),
    ).textWidthPx,
    768,
  );
});

test('legacy or malformed marker choices fall back to the visible default', () => {
  assert.equal(
    parseReaderDisplayPreferences(
      JSON.stringify({ textWidthPx: 768, showLineBreaks: 'true' }),
    ).showLineBreaks,
    true,
  );
  assert.equal(
    parseReaderDisplayPreferences(
      JSON.stringify({ textWidthPx: 768, showLineBreaks: false }),
    ).showLineBreaks,
    false,
  );
});

test('legacy display snapshots gain the default font size without losing choices', () => {
  assert.deepEqual(
    parseReaderDisplayPreferences(
      JSON.stringify({ textWidthPx: 896, showLineBreaks: true }),
    ),
    {
      textWidthPx: 896,
      fontSizePx: DEFAULT_READER_FONT_SIZE,
      fontControlOpen: true,
      showLineBreaks: true,
      nameColorsEnabled: true,
      showVoiceButtons: true,
    nightPhosphor: 'amber',
    nightPixelFontEnabled: true,
    nightGreenPixelFontEnabled: false,
    rulerEnabled: 'auto',
    },
  );
  assert.equal(
    parseReaderDisplayPreferences(
      JSON.stringify({ textWidthPx: 768, fontSizePx: 16.6 }),
    ).fontSizePx,
    17,
  );
  assert.equal(
    parseReaderDisplayPreferences(
      JSON.stringify({ textWidthPx: 768, fontControlOpen: false }),
    ).fontControlOpen,
    false,
  );
});

test('reader display preferences write the normalized choice to localStorage', () => {
  const originalWindow = globalThis.window;
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
      dispatchEvent: () => true,
    },
  });

  try {
    updateReaderDisplayPreferences({
      textWidthPx: 1001,
      fontSizePx: 17,
      fontControlOpen: false,
      showLineBreaks: true,
      nameColorsEnabled: true,
      showVoiceButtons: true,
    nightPhosphor: 'green',
    nightPixelFontEnabled: true,
    nightGreenPixelFontEnabled: false,
    rulerEnabled: 'auto',
    });
    const stored = values.get(READER_DISPLAY_PREFERENCES_STORAGE_KEY);
    assert.ok(stored);
    assert.deepEqual(parseReaderDisplayPreferences(stored), {
      textWidthPx: 992,
      fontSizePx: 17,
      fontControlOpen: false,
      showLineBreaks: true,
      nameColorsEnabled: true,
      showVoiceButtons: true,
    nightPhosphor: 'green',
    nightPixelFontEnabled: true,
    nightGreenPixelFontEnabled: false,
    rulerEnabled: 'auto',
    });
    assert.equal(getReaderDisplayPreferencesSnapshot(), stored);
  } finally {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
    } else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
    }
  }
});

test('name colors preserve the colored default for legacy and malformed choices', () => {
  for (const nameColorsEnabled of [undefined, null, 'false', 0, {}, true]) {
    assert.equal(
      parseReaderDisplayPreferences(JSON.stringify({ nameColorsEnabled })).nameColorsEnabled,
      true,
    );
  }
  assert.equal(
    parseReaderDisplayPreferences('{"nameColorsEnabled":false}').nameColorsEnabled,
    false,
  );
  assert.equal(
    parseReaderDisplayPreferences(getReaderDisplayPreferencesServerSnapshot()).nameColorsEnabled,
    true,
  );
});

test('global name colors persist, notify subscribers and survive unrelated setting changes', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map([[READER_DISPLAY_PREFERENCES_STORAGE_KEY, '{"fontSizePx":18}']]);
  const browser = Object.assign(new EventTarget(), {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser });
  const seen: boolean[] = [];
  const unsubscribe = subscribeReaderDisplayPreferences(() => {
    seen.push(parseReaderDisplayPreferences(getReaderDisplayPreferencesSnapshot()).nameColorsEnabled);
  });
  try {
    updateReaderDisplayPreferences({ nameColorsEnabled: false });
    const saved = values.get(READER_DISPLAY_PREFERENCES_STORAGE_KEY)!;
    assert.equal(parseReaderDisplayPreferences(saved).nameColorsEnabled, false);
    assert.equal(parseReaderDisplayPreferences(saved).fontSizePx, 18);
    updateReaderDisplayPreferences({ textWidthPx: 896 });
    assert.equal(parseReaderDisplayPreferences(getReaderDisplayPreferencesSnapshot()).nameColorsEnabled, false);
    assert.deepEqual(seen, [false, false]);

    // The next page reads persisted storage, not a page-local toggle state.
    assert.equal(parseReaderDisplayPreferences(values.get(READER_DISPLAY_PREFERENCES_STORAGE_KEY)!).nameColorsEnabled, false);
    const remoteValue = JSON.stringify({ nameColorsEnabled: true });
    values.set(READER_DISPLAY_PREFERENCES_STORAGE_KEY, remoteValue);
    browser.dispatchEvent(Object.assign(new Event('storage'), {
      key: READER_DISPLAY_PREFERENCES_STORAGE_KEY,
      newValue: remoteValue,
    }));
    assert.deepEqual(seen, [false, false, true]);

    updateReaderDisplayPreferences({ nameColorsEnabled: false });
    values.clear();
    browser.dispatchEvent(Object.assign(new Event('storage'), { key: null, newValue: null }));
    assert.equal(seen.at(-1), true);
    unsubscribe();
    const count = seen.length;
    updateReaderDisplayPreferences({ nameColorsEnabled: true });
    assert.equal(seen.length, count);
  } finally {
    unsubscribe();
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('global name colors remain usable when browser storage is blocked', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const browser = Object.assign(new EventTarget(), {
    localStorage: {
      getItem: () => { throw new Error('storage blocked'); },
      setItem: () => { throw new Error('storage blocked'); },
    },
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser });
  try {
    updateReaderDisplayPreferences({ nameColorsEnabled: false });
    assert.equal(parseReaderDisplayPreferences(getReaderDisplayPreferencesSnapshot()).nameColorsEnabled, false);
    updateReaderDisplayPreferences({ nameColorsEnabled: true });
    assert.equal(parseReaderDisplayPreferences(getReaderDisplayPreferencesSnapshot()).nameColorsEnabled, true);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('voice button visibility persists independently of playback', () => {
  assert.equal(parseReaderDisplayPreferences(null).showVoiceButtons, true);
  assert.equal(parseReaderDisplayPreferences(JSON.stringify({showVoiceButtons:false})).showVoiceButtons, false);
});
