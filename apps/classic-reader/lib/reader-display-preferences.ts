export type ReaderDisplayPreferences = {
  textWidthPx: number;
  fontSizePx: number;
  fontControlOpen: boolean;
  showLineBreaks: boolean;
  showVoiceButtons: boolean;
  nameColorsEnabled: boolean;
  nightPhosphor: 'green' | 'amber';
  nightPixelFontEnabled: boolean;
  nightGreenPixelFontEnabled: boolean;
  rulerEnabled: boolean | 'auto';
};

export const READER_TEXT_WIDTH_MIN = 320;
export const READER_TEXT_WIDTH_MAX = 1280;
export const READER_TEXT_WIDTH_STEP = 32;
export const DEFAULT_READER_TEXT_WIDTH = 1024;
export const READER_FONT_SIZE_MIN = 12;
export const READER_FONT_SIZE_MAX = 22;
export const DEFAULT_READER_FONT_SIZE = 15;
export const READER_DISPLAY_PREFERENCES_STORAGE_KEY =
  'magi-reader-display-preferences-v1';

const CHANGE_EVENT = 'magi-reader-display-preferences-change';
const DEFAULT_PREFERENCES: ReaderDisplayPreferences = {
  textWidthPx: DEFAULT_READER_TEXT_WIDTH,
  fontSizePx: DEFAULT_READER_FONT_SIZE,
  fontControlOpen: true,
  showLineBreaks: true,
  showVoiceButtons: true,
  nameColorsEnabled: true,
  nightPhosphor: 'green',
  nightPixelFontEnabled: true,
  nightGreenPixelFontEnabled: false,
  rulerEnabled: 'auto',
};
const DEFAULT_SNAPSHOT = JSON.stringify(DEFAULT_PREFERENCES);
let volatileSnapshot = DEFAULT_SNAPSHOT;

const normalizeTextWidth = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(numeric)) return DEFAULT_READER_TEXT_WIDTH;
  const bounded = Math.min(
    READER_TEXT_WIDTH_MAX,
    Math.max(READER_TEXT_WIDTH_MIN, numeric),
  );
  return Math.min(
    READER_TEXT_WIDTH_MAX,
    READER_TEXT_WIDTH_MIN +
      Math.round(
        (bounded - READER_TEXT_WIDTH_MIN) / READER_TEXT_WIDTH_STEP,
      ) *
        READER_TEXT_WIDTH_STEP,
  );
};

const normalizeFontSize = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(numeric)) return DEFAULT_READER_FONT_SIZE;
  return Math.round(
    Math.min(READER_FONT_SIZE_MAX, Math.max(READER_FONT_SIZE_MIN, numeric)),
  );
};

export const parseReaderDisplayPreferences = (
  snapshot: string | null,
): ReaderDisplayPreferences => {
  if (!snapshot) return { ...DEFAULT_PREFERENCES };
  try {
    const value: unknown = JSON.parse(snapshot);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ...DEFAULT_PREFERENCES };
    }
    const record = value as Record<string, unknown>;
    return {
      textWidthPx: normalizeTextWidth(record.textWidthPx),
      fontSizePx: normalizeFontSize(record.fontSizePx),
      fontControlOpen: record.fontControlOpen !== false,
      showLineBreaks:
        typeof record.showLineBreaks === 'boolean'
          ? record.showLineBreaks
          : DEFAULT_PREFERENCES.showLineBreaks,
      nameColorsEnabled: record.nameColorsEnabled !== false,
      showVoiceButtons: record.showVoiceButtons !== false,
      nightPhosphor: record.nightPhosphor === 'amber' ? 'amber' : 'green',
      nightPixelFontEnabled: record.nightPixelFontEnabled !== false,
      nightGreenPixelFontEnabled: record.nightGreenPixelFontEnabled === true,
      rulerEnabled:
        record.rulerEnabled === true || record.rulerEnabled === false
          ? record.rulerEnabled
          : 'auto',
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
};

const serializeReaderDisplayPreferences = (
  preferences: ReaderDisplayPreferences,
): string =>
  JSON.stringify({
    textWidthPx: normalizeTextWidth(preferences.textWidthPx),
    fontSizePx: normalizeFontSize(preferences.fontSizePx),
    fontControlOpen: preferences.fontControlOpen !== false,
    showLineBreaks: preferences.showLineBreaks !== false,
    nameColorsEnabled: preferences.nameColorsEnabled !== false,
    showVoiceButtons: preferences.showVoiceButtons !== false,
    nightPhosphor: preferences.nightPhosphor === 'amber' ? 'amber' : 'green',
    nightPixelFontEnabled: preferences.nightPixelFontEnabled !== false,
    nightGreenPixelFontEnabled: preferences.nightGreenPixelFontEnabled === true,
    rulerEnabled:
      preferences.rulerEnabled === true || preferences.rulerEnabled === false
        ? preferences.rulerEnabled
        : 'auto',
  } satisfies ReaderDisplayPreferences);

export const getReaderDisplayPreferencesSnapshot = (): string => {
  if (typeof window === 'undefined') return volatileSnapshot;
  try {
    const stored = window.localStorage.getItem(
      READER_DISPLAY_PREFERENCES_STORAGE_KEY,
    );
    if (stored === null) return volatileSnapshot;
    volatileSnapshot = serializeReaderDisplayPreferences(
      parseReaderDisplayPreferences(stored),
    );
    return volatileSnapshot;
  } catch {
    return volatileSnapshot;
  }
};

export const getReaderDisplayPreferencesServerSnapshot = (): string =>
  DEFAULT_SNAPSHOT;

export const subscribeReaderDisplayPreferences = (
  onStoreChange: () => void,
): (() => void) => {
  if (typeof window === 'undefined') return () => {};

  const onStorage = (event: StorageEvent) => {
    if (
      event.key === READER_DISPLAY_PREFERENCES_STORAGE_KEY ||
      event.key === null
    ) {
      volatileSnapshot =
        event.key === null || event.newValue === null
          ? DEFAULT_SNAPSHOT
          : serializeReaderDisplayPreferences(
              parseReaderDisplayPreferences(event.newValue),
            );
      onStoreChange();
    }
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
};

export const updateReaderDisplayPreferences = (
  update: Partial<ReaderDisplayPreferences>,
): void => {
  const current = parseReaderDisplayPreferences(
    getReaderDisplayPreferencesSnapshot(),
  );
  volatileSnapshot = serializeReaderDisplayPreferences({
    ...current,
    ...update,
  });
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      READER_DISPLAY_PREFERENCES_STORAGE_KEY,
      volatileSnapshot,
    );
  } catch {
    // The in-memory snapshot keeps the setting usable when storage is blocked.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
};

export const activeNightPixelFontEnabled = (preferences: ReaderDisplayPreferences): boolean =>
  preferences.nightPhosphor === 'green' ? preferences.nightGreenPixelFontEnabled : preferences.nightPixelFontEnabled;

/** The reading overlay is independent of the always-available font-size control. */
export const isReaderRulerEnabled = (
  preferences: ReaderDisplayPreferences,
  theme: string,
): boolean => preferences.rulerEnabled === 'auto'
  ? theme === 'frost'
  : preferences.rulerEnabled;
