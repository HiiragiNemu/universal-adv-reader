export const PREFERENCES_KEY = 'universal-adv-reader:preferences:v1';

export const DEFAULT_READER_PREFERENCES = Object.freeze({
  localeMode: 'parallel',
  primaryLocale: 'zh-CN',
  secondaryLocale: 'ja-JP',
  voicePanelExpanded: false,
  voiceSlotMode: 'all',
});

const localeModes = new Set(['primary', 'parallel']);
const voiceSlotModes = new Set(['all', 'declared']);
const locale = (value, fallback) =>
  typeof value === 'string' && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(value)
    ? value
    : fallback;

export function parseReaderPreferences(value) {
  let input = value;
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch {
      input = null;
    }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ...DEFAULT_READER_PREFERENCES };
  }
  return {
    localeMode: localeModes.has(input.localeMode)
      ? input.localeMode
      : DEFAULT_READER_PREFERENCES.localeMode,
    primaryLocale: locale(input.primaryLocale, DEFAULT_READER_PREFERENCES.primaryLocale),
    secondaryLocale: locale(input.secondaryLocale, DEFAULT_READER_PREFERENCES.secondaryLocale),
    voicePanelExpanded: input.voicePanelExpanded === true,
    voiceSlotMode: voiceSlotModes.has(input.voiceSlotMode)
      ? input.voiceSlotMode
      : DEFAULT_READER_PREFERENCES.voiceSlotMode,
  };
}

export function loadReaderPreferences(storage = globalThis.localStorage) {
  try {
    return parseReaderPreferences(storage?.getItem(PREFERENCES_KEY));
  } catch {
    return { ...DEFAULT_READER_PREFERENCES };
  }
}

export function saveReaderPreferences(preferences, storage = globalThis.localStorage) {
  const normalized = parseReaderPreferences(preferences);
  try {
    storage?.setItem(PREFERENCES_KEY, JSON.stringify(normalized));
  } catch {
    // Volatile state remains usable when storage is blocked.
  }
  return normalized;
}
