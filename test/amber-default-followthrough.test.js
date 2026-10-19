import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import { loadingAppearanceBootstrap } from '../apps/classic-reader/lib/loading-appearance-bootstrap.ts';

const preferencesUrl = new URL('../apps/classic-reader/lib/reader-display-preferences.ts', import.meta.url);
const storageKey = 'magi-reader-display-preferences-v1';
let moduleId = 0;
const freshPreferences = () => import(`${preferencesUrl.href}?amber-default-test=${moduleId++}`);

const bootstrap = (localStorage) => {
  const root = { dataset: {}, classList: { toggle() {} } };
  vm.runInNewContext(loadingAppearanceBootstrap, {
    localStorage,
    document: { documentElement: root },
  });
  return root.dataset;
};

const withBrowser = async (localStorage, run) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const browser = Object.assign(new EventTarget(), { localStorage });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser });
  try {
    await run(await freshPreferences(), browser);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
};

const scenarios = [
  ['no stored preferences', null, 'amber', true],
  ['empty storage value', '', 'amber', true],
  ['empty object', '{}', 'amber', true],
  ['JSON null', 'null', 'amber', true],
  ['array instead of preferences', '[]', 'amber', true],
  ['primitive instead of preferences', '"green"', 'amber', true],
  ['corrupt JSON', '{broken', 'amber', true],
  ['null phosphor', '{"nightPhosphor":null}', 'amber', true],
  ['empty phosphor', '{"nightPhosphor":""}', 'amber', true],
  ['invalid phosphor', '{"nightPhosphor":"blue"}', 'amber', true],
  ['non-string phosphor', '{"nightPhosphor":true}', 'amber', true],
  ['explicit green', '{"nightPhosphor":"green"}', 'green', false],
  ['explicit amber', '{"nightPhosphor":"amber"}', 'amber', true],
  ['green pixel-font opt-in', '{"nightPhosphor":"green","nightGreenPixelFontEnabled":true}', 'green', true],
  ['amber pixel-font opt-out', '{"nightPhosphor":"amber","nightPixelFontEnabled":false}', 'amber', false],
  ['default amber uses amber font preference', '{"nightPixelFontEnabled":false,"nightGreenPixelFontEnabled":true}', 'amber', false],
];

for (const [label, snapshot, expectedPhosphor, expectedPixelFont] of scenarios) {
  test(`night bootstrap and hydrated preference agree: ${label}`, async () => {
    const writes = [];
    const storage = {
      getItem: (key) => key === 'magi_theme' ? 'dark' : key === storageKey ? snapshot : null,
      setItem: (...args) => writes.push(args),
    };
    const initial = bootstrap(storage);
    await withBrowser(storage, async (preferences) => {
      const hydrated = preferences.parseReaderDisplayPreferences(preferences.getReaderDisplayPreferencesSnapshot());
      assert.equal(initial.loadingTheme, 'dark');
      assert.equal(initial.loadingPhosphor, expectedPhosphor);
      assert.equal(initial.nightPhosphor, expectedPhosphor);
      assert.equal(hydrated.nightPhosphor, expectedPhosphor);
      assert.equal(initial.screenPixelFont, String(expectedPixelFont));
      assert.equal(initial.nightPixelFont, String(expectedPixelFont));
      assert.equal(preferences.activeNightPixelFontEnabled(hydrated), expectedPixelFont);
      assert.equal(hydrated.fontSizePx, 15);
      assert.equal(hydrated.textWidthPx, 1024);
      assert.equal(hydrated.fontControlOpen, true);
      assert.equal(hydrated.showLineBreaks, true);
      assert.equal(hydrated.nameColorsEnabled, true);
      assert.equal(hydrated.showVoiceButtons, true);
      assert.equal(hydrated.rulerEnabled, 'auto');
      assert.deepEqual(writes, [], 'first paint and hydration only read storage');
    });
  });
}

test('server defaults change only the phosphor and preserve existing font defaults', async () => {
  const preferences = await freshPreferences();
  assert.deepEqual(preferences.parseReaderDisplayPreferences(preferences.getReaderDisplayPreferencesServerSnapshot()), {
    textWidthPx: 1024,
    fontSizePx: 15,
    fontControlOpen: true,
    showLineBreaks: true,
    showVoiceButtons: true,
    nameColorsEnabled: true,
    nightPhosphor: 'amber',
    nightPixelFontEnabled: true,
    nightGreenPixelFontEnabled: false,
    rulerEnabled: 'auto',
  });
});

test('explicit green and other saved choices survive an unrelated preference update', async () => {
  let saved = JSON.stringify({
    nightPhosphor: 'green', nightPixelFontEnabled: false, nightGreenPixelFontEnabled: true,
    fontSizePx: 18, textWidthPx: 896, showLineBreaks: false,
  });
  const storage = {
    getItem: (key) => key === storageKey ? saved : key === 'magi_theme' ? 'dark' : null,
    setItem: (_key, value) => { saved = value; },
  };
  await withBrowser(storage, async (preferences) => {
    preferences.updateReaderDisplayPreferences({ nameColorsEnabled: false });
    const persisted = JSON.parse(saved);
    assert.equal(persisted.nightPhosphor, 'green');
    assert.equal(persisted.fontSizePx, 18);
    assert.equal(persisted.textWidthPx, 896);
    assert.equal(persisted.showLineBreaks, false);
    assert.equal(persisted.nightPixelFontEnabled, false);
    assert.equal(persisted.nightGreenPixelFontEnabled, true);
    assert.equal(bootstrap(storage).nightPhosphor, 'green');
  });
});

test('serialized updates normalize missing or invalid phosphor to amber and retain both explicit choices', async () => {
  let saved = null;
  const storage = {
    getItem: () => saved,
    setItem: (_key, value) => { saved = value; },
  };
  await withBrowser(storage, async (preferences) => {
    for (const [value, expected] of [[undefined, 'amber'], [null, 'amber'], ['', 'amber'], ['blue', 'amber'], ['green', 'green'], ['amber', 'amber']]) {
      preferences.updateReaderDisplayPreferences({ nightPhosphor: value });
      assert.equal(JSON.parse(saved).nightPhosphor, expected);
      assert.equal(preferences.parseReaderDisplayPreferences(preferences.getReaderDisplayPreferencesSnapshot()).nightPhosphor, expected);
    }
  });
});

for (const blockedRead of [false, true]) {
  test(`storage failure retains amber defaults and volatile color changes (read blocked: ${blockedRead})`, async () => {
    const storage = {
      getItem: (key) => {
        if (key === 'magi_theme') return 'dark';
        if (blockedRead) throw new Error('storage read blocked');
        return null;
      },
      setItem: () => { throw new Error('storage write blocked'); },
    };
    const initial = bootstrap(storage);
    await withBrowser(storage, async (preferences) => {
      const read = () => preferences.parseReaderDisplayPreferences(preferences.getReaderDisplayPreferencesSnapshot());
      assert.equal(initial.loadingPhosphor, 'amber');
      assert.equal(initial.screenPixelFont, 'true');
      assert.equal(read().nightPhosphor, 'amber');
      preferences.updateReaderDisplayPreferences({ nightPhosphor: 'green' });
      assert.equal(read().nightPhosphor, 'green');
      preferences.updateReaderDisplayPreferences({ fontSizePx: 18 });
      assert.equal(read().nightPhosphor, 'green');
      preferences.updateReaderDisplayPreferences({ nightPhosphor: 'amber' });
      assert.equal(read().nightPhosphor, 'amber');
      assert.equal(read().fontSizePx, 18);
    });
  });
}

test('clearing stored preferences restores amber rather than the previous green choice', async () => {
  let saved = '{"nightPhosphor":"green"}';
  const storage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
  await withBrowser(storage, async (preferences, browser) => {
    const read = () => preferences.parseReaderDisplayPreferences(preferences.getReaderDisplayPreferencesSnapshot());
    const unsubscribe = preferences.subscribeReaderDisplayPreferences(() => {});
    try {
      assert.equal(read().nightPhosphor, 'green');
      saved = null;
      browser.dispatchEvent(Object.assign(new Event('storage'), { key: storageKey, newValue: null }));
      assert.equal(read().nightPhosphor, 'amber');
    } finally {
      unsubscribe();
    }
  });
});
