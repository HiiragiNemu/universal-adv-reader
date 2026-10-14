'use client';
import { useSyncExternalStore } from 'react';
import { useIOSWebKit } from './use-ios-webkit';
import { getScreenEffectsSnapshot, getScreenEffectsServerSnapshot, subscribeScreenEffects, resolveScreenEffects } from './screen-effects';
import { getReaderDisplayPreferencesSnapshot, getReaderDisplayPreferencesServerSnapshot,
  subscribeReaderDisplayPreferences, parseReaderDisplayPreferences, activeNightPixelFontEnabled } from './reader-display-preferences';
export function useScreenEffects(theme: string) {
  const iosWebKit = useIOSWebKit();
  const snapshot = useSyncExternalStore(subscribeScreenEffects, getScreenEffectsSnapshot, getScreenEffectsServerSnapshot);
  const display = useSyncExternalStore(subscribeReaderDisplayPreferences, getReaderDisplayPreferencesSnapshot, getReaderDisplayPreferencesServerSnapshot);
  return resolveScreenEffects(snapshot, theme, activeNightPixelFontEnabled(parseReaderDisplayPreferences(display)), iosWebKit);
}
