'use client';

import type { CSSProperties } from 'react';
import { ReaderFilmSurface } from '@/components/RetroDisplaySurface';
import { DayTubeFilter, NightTubeFilter } from '@/components/TubeOpticalFilters';
import { SceneRegistrationDefinitions } from '@/components/SceneRegistration';
import ScanlineSurface from '@/components/ScanlineSurface';
import { TUBE_LENS_URL } from '@/lib/tube-lens';

export function loadingOpticsStyle(id: string): CSSProperties {
  return Object.fromEntries([
    ...['desktop', 'mobile'].flatMap(viewport => [
      ...['day', 'frost'].flatMap(theme => [false, true].map(registration => [
        `--loading-${viewport}-${theme}-curve-${registration ? 'on' : 'off'}`, `url('#${id}-${viewport}-${theme}-${registration}')`,
      ])),
      ...['green', 'amber'].map(profile => [`--loading-${viewport}-${profile}-curve`, `url('#${id}-${viewport}-${profile}')`]),
    ]),
    ...['day', 'green', 'amber'].map(profile => [`--loading-${profile}-registration`, `url('#${id}-registration-${profile}')`]),
    ['--magi-frost-glass-filter', `url('#${id}-glass')`],
  ]) as CSSProperties;
}

/** All material nodes exist in the server HTML. Parser-time data attributes
 * select their visibility, so hydration never replaces textured paint with a
 * clean fallback. Only the selected filter graph is painted; IDs are per loader.
 * The graphs and material assets are the same ones used by home and Reader. */
export function LoadingDisplaySurface({ id }: { id: string }) {
  return <>
    <svg className="magi-loading-filter-defs" width="0" height="0" aria-hidden="true"><defs>
      {/* Media-selected definitions avoid a 50 -> 38 strength jump on mobile
          hydration. Only the selected graph renders; neither graph mutates. */}
      {(['desktop', 'mobile'] as const).flatMap(viewport => [
        ...(['day', 'frost'] as const).flatMap(theme => [false, true].map(registration =>
          <DayTubeFilter key={`${viewport}-${theme}-${registration}`} id={`${id}-${viewport}-${theme}-${registration}`}
            map={TUBE_LENS_URL} scale={viewport === 'mobile' ? 38 : 50} theme={theme} registration={registration} />)),
        ...(['green', 'amber'] as const).map(profile => <NightTubeFilter key={`${viewport}-${profile}`}
          id={`${id}-${viewport}-${profile}`} map={TUBE_LENS_URL} scale={viewport === 'mobile' ? 38 : 50} profile={profile} />),
      ])}
    </defs></svg>
    {(['day', 'green', 'amber'] as const).map(profile => <SceneRegistrationDefinitions key={profile}
      id={`${id}-registration-${profile}`} profile={profile} />)}
    <ReaderFilmSurface filterId={`${id}-glass`} />
    <ScanlineSurface />
    <span className="magi-reader-tube-phosphor" aria-hidden="true" />
    <span className="magi-reader-tube-grain" aria-hidden="true" />
    <span className="magi-night-phosphor" aria-hidden="true" />
    <span className="magi-night-grain" aria-hidden="true" />
    <div className="magi-night-surface" aria-hidden="true" />
    <div className="magi-reader-tube-surface" aria-hidden="true" />
    <div className="magi-screen-bezel" aria-hidden="true" />
  </>;
}
