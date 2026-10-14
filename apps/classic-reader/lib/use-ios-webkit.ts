'use client';
import { useSyncExternalStore } from 'react';
import { usesIOSOptics } from './ios-optics';

const subscribe = () => () => {};
const clientSnapshot = () => typeof navigator !== 'undefined' && usesIOSOptics(navigator);
const serverSnapshot = () => false;

/** Stable platform capability, not a viewport or touch-only approximation. */
export function useIOSWebKit() {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
