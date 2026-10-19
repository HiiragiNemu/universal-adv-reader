'use client';

import type { ReactNode } from 'react';
import { useGlobal, isNightTheme } from '@/app/providers';
import IOSViewportHost from '@/components/IOSViewportHost';
import { ReaderFilmSurface, ReaderTubeSurface } from '@/components/RetroDisplaySurface';

/** Reuse the inherited catalog viewport contract on these mutually exclusive
 * routes. Its existing ID/class selectors own lens, readiness and scrolling;
 * shared optical code and the actual catalog/reader routes stay unchanged. */
export default function GenericReviewSurface({ children }: { children: ReactNode }) {
  const { theme } = useGlobal();
  return <IOSViewportHost>
    <div id="magi-home-display" data-generic-review-surface="shared"
      data-theme={isNightTheme(theme) ? 'dark' : theme} data-theme-variant={theme}
      className={`magi-review-theme magi-home-shell magi-home-${theme}-root ${theme === 'frost' ? 'magi-home-dark-root' : ''} flex h-screen h-[100dvh] overflow-hidden`}>
      {theme === 'frost' && <ReaderFilmSurface />}
      <ReaderTubeSurface theme={theme} />
      <div className="magi-scene-content">
        <div data-generic-review-scroll tabIndex={0} role="region" aria-label="校对与帮助页面滚动区"
          className="magi-home-story-scroll h-full w-full min-h-0 min-w-0 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  </IOSViewportHost>;
}
