'use client';

import { useLayoutEffect } from 'react';
import { displayAssetUrls, prepareDisplayAssets } from '@/lib/display-assets';

/** Continue the parser-time readiness gate for later theme/setting changes.
 * One observer for every loader, not a new material stack per route. */
export default function LoadingAssetReadiness() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    let generation = 0, frame = 0, stopped = false, pendingKey = '';
    const refresh = () => {
      const { readerTheme = 'paper', screenCurvature, screenNoise, screenPixelFont, screenGlassDamage } = root.dataset;
      const key = [readerTheme, screenCurvature, screenNoise, screenPixelFont, screenGlassDamage].join(':');
      if (key === pendingKey || (root.dataset.loadingAssetsKey === key && root.dataset.loadingAssets === 'ready')) return;
      pendingKey = key;
      const token = ++generation;
      cancelAnimationFrame(frame);
      root.dataset.loadingAssetsKey = key;
      root.dataset.loadingAssets = 'pending';
      delete root.dataset.loadingFailedAsset;
      void Promise.all([
        prepareDisplayAssets(displayAssetUrls(readerTheme, { curvature: screenCurvature === 'true', noise: screenNoise === 'true', glassDamage: screenGlassDamage === 'true' })),
      ]).then(() => {
        if (stopped || token !== generation) return;
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() => {
            if (!stopped && token === generation) root.dataset.loadingAssets = 'ready';
          });
        });
      }).catch(error => {
        if (stopped || token !== generation) return;
        root.dataset.loadingAssets = 'error';
        root.dataset.loadingFailedAsset = error instanceof Error ? error.message : String(error);
      });
    };
    const observer = new MutationObserver(refresh);
    observer.observe(root, { attributes: true, attributeFilter: ['data-reader-theme', 'data-screen-curvature', 'data-screen-noise', 'data-screen-pixel-font', 'data-screen-glass-damage'] });
    refresh();
    return () => { stopped = true; generation++; observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  return null;
}
