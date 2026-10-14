'use client';

import { useLayoutEffect, useRef } from 'react';
import type { ScreenEffects } from '@/lib/screen-effects';
import { DisplayAssetError, displayAssetUrls, prepareDisplayAssets } from '@/lib/display-assets';
import { prepareDisplayFonts } from '@/lib/display-font-readiness';
import { waitForFilmSurface } from '@/lib/film-readiness';
import { displayPublicationKey, rememberDisplayPublication, canPublishWarmDisplay } from '@/lib/display-publication';

/** Publish one complete optical scene rather than flat UI, then lens, then glass.
 * Route cleanup cancels publication; it never leaves an extra material layer. */
export default function DisplayReadiness({ theme, effects }: { theme: string; effects: ScreenEffects }) {
  const marker = useRef<HTMLSpanElement>(null);
  const publishedTheme = useRef<string | null>(null);
  const { curvature, noise, pixelFont, glassDamage } = effects;
  useLayoutEffect(() => {
    const root = marker.current?.closest<HTMLElement>('#magi-home-display,#magi-reader-display');
    if (!root) return;
    let cancelled = false;
    let frame = 0;
    const initialScene = publishedTheme.current !== theme;
    const publicationKey = displayPublicationKey(theme, { curvature, noise, pixelFont, glassDamage });
    if (initialScene && canPublishWarmDisplay(publicationKey, theme === 'frost' && glassDamage, document.fonts.status)) {
      // Re-entering the same already-decoded display is not a cold start. In a
      // layout effect this publishes before paint, without a loader flash or
      // two artificial full-screen repaint frames on Safari.
      root.dataset.opticsReady = 'true';
      publishedTheme.current = theme;
      root.inert = false;
      return;
    }
    if (initialScene) root.dataset.opticsReady = 'false';
    delete root.dataset.opticsError;
    delete root.dataset.opticsFailedAsset;
    if (initialScene) root.inert = true;
    void Promise.all([
      prepareDisplayAssets(displayAssetUrls(theme, { curvature, noise, glassDamage })),
      prepareDisplayFonts(pixelFont),
      ...(theme === 'frost' && glassDamage ? [waitForFilmSurface(root)] : []),
    ]).then(() => {
      if (cancelled) return;
      // External-store hydration and viewport-dependent layout finish before
      // publication. No arbitrary timeout and no steady-state animation loop.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          if (cancelled) return;
          root.dataset.opticsReady = 'true';
          rememberDisplayPublication(publicationKey);
          publishedTheme.current = theme;
          root.inert = false;
        });
      });
    }).catch(error => {
      if (cancelled) return;
      // An optional live setting must never replace an already readable page
      // with the startup cover or discard focus in the settings window.
      if (initialScene) root.dataset.opticsError = 'true';
      if (error instanceof DisplayAssetError) root.dataset.opticsFailedAsset = error.url;
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      delete root.dataset.opticsError;
      delete root.dataset.opticsFailedAsset;
      root.inert = false;
    };
  }, [theme, curvature, noise, pixelFont, glassDamage]);
  return <span ref={marker} hidden data-display-readiness="owned" />;
}
