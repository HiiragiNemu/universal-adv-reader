export type ReaderFontBundleId = 'chinese' | 'japanese';
export type ReaderFontPreferences = { chineseEnabled: boolean; japaneseEnabled: boolean };
export type ReaderFontRuntimeSnapshot = {
  preferences: ReaderFontPreferences;
  bundles: Record<ReaderFontBundleId, { status: 'idle' | 'ready' }>;
};

// Separate preference identity: old Magireco download consent is not native font consent.
export const READER_FONT_PREFERENCES_STORAGE_KEY = 'adv-native-game-font-preferences-v1';
const defaults: ReaderFontPreferences = { chineseEnabled: true, japaneseEnabled: true };
export const parseReaderFontPreferences = (raw: string | null): ReaderFontPreferences => {
  if (!raw) return { ...defaults };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...defaults };
    const record = value as Record<string, unknown>;
    return { chineseEnabled: record.chineseEnabled !== false, japaneseEnabled: record.japaneseEnabled !== false };
  } catch { return { ...defaults }; }
};
const snapshotFor = (preferences: ReaderFontPreferences, initialized: boolean): ReaderFontRuntimeSnapshot => ({
  preferences,
  bundles: { chinese: { status: initialized && preferences.chineseEnabled ? 'ready' : 'idle' },
    japanese: { status: initialized && preferences.japaneseEnabled ? 'ready' : 'idle' } },
});
const serverSnapshot = JSON.stringify(snapshotFor(defaults, false));
let preferences = { ...defaults }, snapshot = serverSnapshot, hydrated = false, initialized = false;
const listeners = new Set<() => void>();
export const parseReaderFontRuntimeSnapshot = (raw: string): ReaderFontRuntimeSnapshot => {
  try {
    const value = JSON.parse(raw);
    return snapshotFor(parseReaderFontPreferences(JSON.stringify(value?.preferences)),
      value?.bundles?.chinese?.status === 'ready' || value?.bundles?.japanese?.status === 'ready');
  } catch { return snapshotFor(defaults, false); }
};
const hydrate = () => {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  try { preferences = parseReaderFontPreferences(window.localStorage.getItem(READER_FONT_PREFERENCES_STORAGE_KEY)); } catch { /* Local storage is optional. */ }
  snapshot = JSON.stringify(snapshotFor(preferences, initialized));
};
const apply = () => {
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    // Retire inherited font activation even if the old bundle is still cached.
    delete root.dataset.readerFontChinese;
    delete root.dataset.readerFontJapanese;
    root.dataset.nativeFontChinese = preferences.chineseEnabled ? 'on' : 'off';
    root.dataset.nativeFontJapanese = preferences.japaneseEnabled ? 'on' : 'off';
  }
  snapshot = JSON.stringify(snapshotFor(preferences, initialized));
  for (const notify of listeners) notify();
};
const persist = () => {
  try { window.localStorage.setItem(READER_FONT_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences)); } catch { /* Runtime remains usable. */ }
  apply();
};
export const initializeReaderFonts = async (): Promise<void> => { hydrate(); initialized = true; apply(); };
export const getReaderFontRuntimeSnapshot = (): string => { hydrate(); return snapshot; };
export const getReaderFontRuntimeServerSnapshot = (): string => serverSnapshot;
export const subscribeReaderFontRuntime = (notify: () => void): (() => void) => {
  hydrate(); listeners.add(notify); return () => { listeners.delete(notify); };
};
export const enableReaderFontBundle = async (id: ReaderFontBundleId): Promise<boolean> => {
  hydrate(); initialized = true; preferences = { ...preferences, [id === 'chinese' ? 'chineseEnabled' : 'japaneseEnabled']: true }; persist(); return true;
};
export const disableReaderFontBundle = (id: ReaderFontBundleId): void => {
  hydrate(); preferences = { ...preferences, [id === 'chinese' ? 'chineseEnabled' : 'japaneseEnabled']: false }; persist();
};
export const restoreSystemReaderFonts = (): void => { hydrate(); preferences = { chineseEnabled: false, japaneseEnabled: false }; persist(); };
