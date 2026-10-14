'use client';

import { useId, useLayoutEffect, useRef } from 'react';
import ScanlineSurface from './ScanlineSurface';
import type { ScreenEffects } from '@/lib/screen-effects';
import '@/app/night-display-surface.css';
import { NightTubeFilter } from '@/components/TubeOpticalFilters';
import { mountViewportFilter } from '@/lib/viewport-filter';
import type { RegistrationProfile } from '@/lib/scene-registration';

/** Preserved night CRT optics, isolated from optional day/frost effects. */
export default function NightDisplaySurface({ effects, map, scale, profile, cold = false }: {
  effects: ScreenEffects; map?: string; scale: number; profile?: RegistrationProfile; cold?: boolean;
}) {
  const id = `magi-tube-${useId()}`;
  const marker = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    const root = marker.current?.closest<HTMLElement>('#magi-home-display,#magi-reader-display,.magi-review-theme,.magi-loading-screen');
    if (!root) return;
    const source = marker.current?.querySelector('filter');
    if (!source) return;
    return mountViewportFilter(root, source, '--magi-active-tube-filter').dispose;
  }, [id, map, scale, profile]);
  return <>
    <svg ref={marker} className="magi-night-lens" aria-hidden="true" width="0" height="0">
      <defs>{map && <NightTubeFilter id={id} map={map} scale={scale} profile={profile} />}</defs>
    </svg>
    {/* Night retains its original phosphor texture, not the newer full-screen
        multiply stripes that visibly ruled every bright button. */}
    {effects.noise && <span className={cold ? "magi-reader-tube-phosphor" : "magi-night-phosphor"} aria-hidden="true" />}
    {effects.noise && <span className={cold ? "magi-reader-tube-grain" : "magi-night-grain"} aria-hidden="true" />}
    {cold && effects.scanlines && <ScanlineSurface />}
    <div className={cold ? "magi-night-surface magi-reader-tube-surface" : "magi-night-surface"} data-lens-ready={map && effects.curvature ? 'true' : undefined} aria-hidden="true" />
    {effects.curvature && <div className="magi-screen-bezel" aria-hidden="true" />}
  </>;
}
