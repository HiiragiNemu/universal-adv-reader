"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { usePathname } from 'next/navigation';
import DisplayStartupCover from '@/components/DisplayStartupCover';
import LoadingAssetReadiness from '@/components/LoadingAssetReadiness';
import { useIOSWebKit } from '@/lib/use-ios-webkit';

import { initializeExedraFonts } from "@/lib/exedra-fonts";
import { initializeReaderFonts } from "@/lib/reader-fonts";
import {
  activeNightPixelFontEnabled,
  getReaderDisplayPreferencesServerSnapshot,
  getReaderDisplayPreferencesSnapshot,
  parseReaderDisplayPreferences,
  subscribeReaderDisplayPreferences,
  updateReaderDisplayPreferences,
} from '@/lib/reader-display-preferences';

export type Theme = 'light' | 'dark' | 'paper' | 'green' | 'frost';

export const isNightTheme = (theme: string): boolean =>
  theme === 'dark' || theme === 'frost';

interface GlobalState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  lastCategory: string;
  setLastCategory: (c: string) => void;
  nameColorsEnabled: boolean;
  nightPhosphor: 'green' | 'amber';
  setNightPhosphor: (value: 'green' | 'amber') => void;
  nightPixelFontEnabled: boolean;
  setNightPixelFontEnabled: (enabled: boolean) => void;
  setNameColorsEnabled: (enabled: boolean) => void;
}

const GlobalContext = createContext<GlobalState | undefined>(undefined);

const THEME_KEY = 'magi_theme';
const CATEGORY_KEY = 'magi_cat';
const THEME_EVENT = 'magi-reader-theme-change';
const CATEGORY_EVENT = 'magi-reader-category-change';
const VALID_THEMES = new Set<Theme>(['light', 'dark', 'paper', 'green', 'frost']);
let volatileTheme: Theme = 'paper';
let volatileCategory = 'event_story';

const subscribeToSetting = (
  storageKey: string,
  eventName: string,
  callback: () => void,
): (() => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey) callback();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(eventName, callback);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(eventName, callback);
  };
};

const readTheme = (): Theme => {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored && VALID_THEMES.has(stored as Theme)) return stored as Theme;
  } catch {
    // The in-memory value still keeps the interface usable when storage is blocked.
  }
  return volatileTheme;
};

const readCategory = (): string => {
  try {
    return localStorage.getItem(CATEGORY_KEY)?.trim() || volatileCategory;
  } catch {
    return volatileCategory;
  }
};

const subscribeTheme = (callback: () => void) =>
  subscribeToSetting(THEME_KEY, THEME_EVENT, callback);
const subscribeCategory = (callback: () => void) =>
  subscribeToSetting(CATEGORY_KEY, CATEGORY_EVENT, callback);
const serverTheme = (): Theme => 'paper';
const serverCategory = (): string => 'event_story';
const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;
const readNameColorsEnabled = () =>
  parseReaderDisplayPreferences(getReaderDisplayPreferencesSnapshot()).nameColorsEnabled;
const serverNameColorsEnabled = () =>
  parseReaderDisplayPreferences(getReaderDisplayPreferencesServerSnapshot()).nameColorsEnabled;
const setNameColorsEnabled = (enabled: boolean) =>
  updateReaderDisplayPreferences({ nameColorsEnabled: enabled });

const readNightPhosphor = () => parseReaderDisplayPreferences(getReaderDisplayPreferencesSnapshot()).nightPhosphor;
const serverNightPhosphor = () => parseReaderDisplayPreferences(getReaderDisplayPreferencesServerSnapshot()).nightPhosphor;
const setNightPhosphor = (nightPhosphor: 'green' | 'amber') => updateReaderDisplayPreferences({ nightPhosphor });

const readNightPixelFont = () => {
  const p = parseReaderDisplayPreferences(getReaderDisplayPreferencesSnapshot());
  return activeNightPixelFontEnabled(p);
};
const serverNightPixelFont = () => activeNightPixelFontEnabled(parseReaderDisplayPreferences(getReaderDisplayPreferencesServerSnapshot()));
const setNightPixelFontEnabled = (enabled: boolean) => {
  const p = parseReaderDisplayPreferences(getReaderDisplayPreferencesSnapshot());
  updateReaderDisplayPreferences(p.nightPhosphor === 'green'
    ? { nightGreenPixelFontEnabled: enabled } : { nightPixelFontEnabled: enabled });
};

import { useScreenEffects } from '@/lib/use-screen-effects';

export function GlobalProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Only adopted optical routes own the startup gate. Historical utility pages
  // without a display-readiness marker must remain reachable during migration.
  const opticalRoute = pathname === '/' || pathname === '/apps/web' || pathname === '/apps/web/'
    || pathname.startsWith('/reader/') || pathname.startsWith('/review/') || pathname === '/proofreading/status';
  const iosWebKit = useIOSWebKit();
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
  const nightPixelFontEnabled = useSyncExternalStore(subscribeReaderDisplayPreferences, readNightPixelFont, serverNightPixelFont);
  const nightPhosphor = useSyncExternalStore(subscribeReaderDisplayPreferences, readNightPhosphor, serverNightPhosphor);
  const nameColorsEnabled = useSyncExternalStore(
    subscribeReaderDisplayPreferences,
    readNameColorsEnabled,
    serverNameColorsEnabled,
  );
  const theme = useSyncExternalStore(
    subscribeTheme,
    readTheme,
    serverTheme,
  );
  const screenEffects = useScreenEffects(theme);
  const lastCategory = useSyncExternalStore(
    subscribeCategory,
    readCategory,
    serverCategory,
  );

  const setTheme = (t: Theme) => {
    if (!VALID_THEMES.has(t)) return;
    volatileTheme = t;
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      // Fall back to the in-memory value above.
    }
    window.dispatchEvent(new Event(THEME_EVENT));
  };

  const setLastCategoryWrapper = (c: string) => {
    const category = c.trim() || 'main_story';
    volatileCategory = category;
    try {
      localStorage.setItem(CATEGORY_KEY, category);
    } catch {
      // Fall back to the in-memory value above.
    }
    window.dispatchEvent(new Event(CATEGORY_EVENT));
  };

  useLayoutEffect(() => {
    if (!hydrated) return;
    document.documentElement.dataset.iosFlat = String(iosWebKit);
    document.documentElement.classList.toggle('dark', isNightTheme(theme));
    document.documentElement.dataset.readerTheme = theme;
    document.documentElement.dataset.loadingTheme = theme;
    document.documentElement.dataset.loadingPhosphor = nightPhosphor;
    document.documentElement.dataset.loadingScanlines = screenEffects.scanlines ? 'on' : 'off';
    document.documentElement.dataset.nightPhosphor = nightPhosphor;
    document.documentElement.dataset.nightPixelFont = String(screenEffects.pixelFont);
    document.documentElement.dataset.screenPixelFont = String(screenEffects.pixelFont);
    document.documentElement.dataset.screenCurvature = String(screenEffects.curvature);
    document.documentElement.dataset.screenScanlines = String(screenEffects.scanlines);
    document.documentElement.dataset.screenNoise = String(screenEffects.noise);
    document.documentElement.dataset.screenRegistration = String(screenEffects.registration);
    document.documentElement.dataset.screenGlassDamage = String(screenEffects.glassDamage);
    document.documentElement.dataset.nameColors = String(nameColorsEnabled);
  }, [hydrated, iosWebKit, theme, nightPhosphor, nameColorsEnabled, screenEffects.pixelFont, screenEffects.curvature, screenEffects.scanlines, screenEffects.noise, screenEffects.registration, screenEffects.glassDamage]);

  useEffect(() => {
    void initializeReaderFonts();
    void initializeExedraFonts();
  }, []);

  return (
    <GlobalContext.Provider value={{ theme, setTheme, lastCategory, setLastCategory: setLastCategoryWrapper, nameColorsEnabled, setNameColorsEnabled, nightPhosphor, setNightPhosphor, nightPixelFontEnabled, setNightPixelFontEnabled }}>
      <LoadingAssetReadiness />
      
      {/* Keep the original night/cold backdrop outside the optical scene. */}
      {isNightTheme(theme) && <div className="magi-app-backdrop" aria-hidden="true" />}

      {/* 2. 内容层 */}
      <div className={`magi-site-font-scope min-h-screen transition-colors duration-300 relative z-0 bg-transparent
        ${isNightTheme(theme) ? 'text-gray-200' : ''}
        ${theme === 'light' ? 'text-gray-900' : ''}
        ${theme === 'paper' ? 'text-[#4a3b2a]' : ''}
        ${theme === 'green' ? 'text-[#1b5e20]' : ''}
      `}>
        {/* Day grain must blend with the actual day field, not a transparent
            isolated viewport. Move the one backdrop; do not duplicate it. */}
        {!isNightTheme(theme) && <div className="magi-app-backdrop" aria-hidden="true" />}
        {children}
      </div>

      {opticalRoute && <DisplayStartupCover />}
      
    </GlobalContext.Provider>
  );
}

export const useGlobal = () => {
  const context = useContext(GlobalContext);
  if (!context) throw new Error("useGlobal must be used within GlobalProvider");
  return context;
};
