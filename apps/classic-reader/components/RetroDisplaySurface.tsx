'use client';
import { useLayoutEffect, useId, useRef, useSyncExternalStore } from 'react';
import '@/app/frost-translation-status.css';
import '@/app/frost-phosphor-ink.css';
import '@/app/frost-glass-surface.css';
import '@/app/frost-curved-edge.css';
import '@/app/frost-control-light.css';
import '@/app/screen-effects.css';
import '@/app/theme-source-badges.css';
import '@/app/theme-ranges.css';
import '@/app/night-interaction-contrast.css';
import '@/app/frost-sidebar-spacing.css';
import '@/app/sidebar-active-path.css';
import '@/app/reader-widget-spacing.css';
import '@/app/paper-source-exposure.css';
import '@/app/font-range-light.css';
import { useScreenEffects } from '@/lib/use-screen-effects';
import ScanlineSurface from '@/components/ScanlineSurface';
import NightDisplaySurface from '@/components/NightDisplaySurface';
import { useGlobal } from '@/app/providers';
import { SceneRegistrationDefinitions } from '@/components/SceneRegistration';
import { DayTubeFilter } from '@/components/TubeOpticalFilters';
import OpticalScrollbars from '@/components/OpticalScrollbars';
import { TUBE_LENS_URL, subscribeTubeViewport, getTubeScale, getServerTubeScale } from '@/lib/tube-lens';
import DisplayReadiness from '@/components/DisplayReadiness';
import IOSOpticalPipeline from '@/components/IOSOpticalPipeline';
import { mountViewportFilter } from '@/lib/viewport-filter';
import { startCachedGlassMask, GLASS_REFRACTION_MATRIX, GLASS_REFRACTION_SCALE } from '@/lib/cached-glass-mask';

export function ReaderFilmSurface({ filterId }: { filterId?: string } = {}) {
  const { glassDamage } = useScreenEffects('frost');
  const { theme } = useGlobal();
  // Keep the filter in this SVG, including during cached home/Reader navigation.
  const surfaceId = useId();
  const refractionId = filterId ?? `magi-glass-refraction-${surfaceId}`;
  const surface = useRef<HTMLDivElement>(null);
  const glassFilter = useRef<SVGFilterElement>(null);
  const wear = useRef<HTMLImageElement>(null);
  // Only the parser-painted loading chart supplies a filterId: its first frame
  // reads saved choices before React hydrates. Ordinary routes can unmount the
  // disabled effect instead of retaining hidden images, graphs and observers.
  const includeGlass = glassDamage || Boolean(filterId);
  useLayoutEffect(() => {
    const root = surface.current?.closest<HTMLElement>('#magi-home-display,#magi-reader-display,.magi-review-theme,.magi-loading-screen');
    if (!root) return;
    const selected = filterId
      ? document.documentElement.dataset.readerTheme === 'frost'
        && document.documentElement.dataset.screenGlassDamage === 'true'
      : theme === 'frost' && glassDamage;
    if (!selected) {
      root.dataset.glassReady = root.dataset.filmReady = 'true';
      root.dispatchEvent(new Event('magi-film-ready'));
      return () => { delete root.dataset.glassReady; delete root.dataset.filmReady; };
    }
    if (!glassFilter.current) return;
    const viewport = mountViewportFilter(root, glassFilter.current, '--magi-frost-glass-filter');
    root.dataset.glassReady = 'true';
    let cancelled = false, frame = 0;
    let stopMaskCache = () => {};
    root.dataset.filmReady = selected ? 'false' : 'true';
    const publish = () => {
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => {
        if (cancelled) return;
        root.dataset.filmReady = 'true';
        root.dispatchEvent(new Event('magi-film-ready'));
      }); });
    };
    if (selected && wear.current) {
      void wear.current.decode().then(() => {
        if (cancelled) return;
        if (viewport.filter) stopMaskCache = startCachedGlassMask(root, viewport.filter, publish);
        else publish();
      }).catch(() => { if (!cancelled) root.dataset.opticsError = 'true'; });
    } else publish();
    return () => {
      cancelled = true; cancelAnimationFrame(frame); stopMaskCache();
      viewport.dispose();
      delete root.dataset.glassReady; delete root.dataset.filmReady;
    };
  }, [refractionId, filterId, glassDamage, theme]);
  return <>
    {includeGlass && <svg aria-hidden="true" width="0" height="0" className="magi-glass-filter-definitions"><defs>
      <filter ref={glassFilter} id={refractionId} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feImage href="/textures/frost-glass-scratches.png" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="scratchMap" />
        <feColorMatrix in="scratchMap" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  .2126 .7152 .0722 0 0" result="scratchMask" />
        <feMorphology in="scratchMask" operator="dilate" radius=".6" result="crackZone" />
        {/* Sample the live scene once, as the shared tube lens does. The old
            cut/out/merge path made partially masked pixels translucent and
            re-composited the viewport on every scroll. Scratches still shift
            the original scene by +1.5 / -.6 CSS px; clear glass is neutral. */}
        <feColorMatrix in="crackZone" type="matrix" values={GLASS_REFRACTION_MATRIX} result="refractionMap" />
        <feDisplacementMap in="SourceGraphic" in2="refractionMap" scale={GLASS_REFRACTION_SCALE}
          xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </defs></svg>}
    {includeGlass && <div className="magi-glass-refraction" aria-hidden="true" />}
    <div ref={surface} className="magi-reader-film-surface" data-frost-glass="shared" aria-hidden="true">
    <span className="magi-reader-film-grain" />
    <span className="magi-reader-film-glass" />
    <span className="magi-reader-film-smudges" />
    {/* A single editable PNG is shared by desktop/mobile and home/Reader. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {includeGlass && <img ref={wear} className="magi-reader-film-wear" data-glass-wear="shared-file"
      src="/textures/frost-glass-scratches.png" alt="" />}
  </div></>;
}

// One bounded viewport lens, not one filter per row or an entire tall document.
// The original displacement pixels are shared across route mounts.
export function ReaderTubeSurface({ theme = 'dark' }: { theme?: string }) {
  const effects = useScreenEffects(theme);
  const { nightPhosphor } = useGlobal();
  const map = TUBE_LENS_URL;
  const curveScale = useSyncExternalStore(subscribeTubeViewport, getTubeScale, getServerTubeScale);
  if (theme === 'dark' || theme === 'frost') return <>
    <DisplayReadiness theme={theme} effects={effects} />
    <OpticalScrollbars enabled={Boolean(map && effects.curvature)} scale={curveScale} />
    {effects.registration && <SceneRegistrationDefinitions profile={theme === 'frost' ? 'day' : nightPhosphor} />}
    <NightDisplaySurface effects={effects} map={map} scale={curveScale} cold={theme === 'frost'} profile={effects.registration ? (theme === 'frost' ? 'day' : nightPhosphor) : undefined} />
    <IOSOpticalPipeline theme={theme} curvature={effects.curvature} registration={effects.registration} scale={curveScale} profile={theme === 'frost' ? 'day' : nightPhosphor} />
  </>;
  return <>
    <DisplayReadiness theme={theme} effects={effects} />
    <OpticalScrollbars enabled={Boolean(map && effects.curvature)} scale={curveScale} />
    {effects.registration && <SceneRegistrationDefinitions profile="day" softness={.39} />}
    <svg className="magi-reader-tube-lens" aria-hidden="true" width="0" height="0">
      <defs>{map && <DayTubeFilter id="magi-reader-tube-curve" map={map} scale={curveScale} theme={theme} registration={effects.registration} />}</defs>
    </svg>
    {effects.scanlines && <ScanlineSurface />}
    {effects.noise && <span className="magi-reader-tube-phosphor" aria-hidden="true" />}
    {effects.noise && <span className="magi-reader-tube-grain" aria-hidden="true" />}
    <div className="magi-reader-tube-surface" data-lens-ready={map && effects.curvature ? 'true' : undefined} aria-hidden="true">
    </div>
    {effects.curvature && <div className="magi-screen-bezel" aria-hidden="true" />}
    <IOSOpticalPipeline theme={theme} curvature={effects.curvature} registration={effects.registration} scale={curveScale} profile="day" />
  </>;
}


