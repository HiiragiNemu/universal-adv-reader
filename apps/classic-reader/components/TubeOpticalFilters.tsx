import { SceneRegistrationPass } from '@/components/SceneRegistration';
import type { RegistrationProfile } from '@/lib/scene-registration';

type TubeSignalProps = {
  id: string; map: string; scale: number; profile?: RegistrationProfile;
  beamSoftness: number; signalSoftness: number; nearGain: number; wideGain: number; panelBloom?: boolean;
};

// One implementation owns the viewport lens, registration, signal and bloom.
// Theme differences are exposure values, never an independent compositing path.
function TubeSignalFilter({ id, map, scale, profile, beamSoftness, signalSoftness, nearGain, wideGain, panelBloom = false }: TubeSignalProps) {
  const signal = 'SourceGraphic';
  return <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feImage href={map} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="lens" />
        {profile && <SceneRegistrationPass input={signal} profile={profile} result="registeredScene" />}
        <feGaussianBlur in={profile ? 'registeredScene' : signal} stdDeviation={beamSoftness} result="beam" />
        <feDisplacementMap in="beam" in2="lens" scale={scale} xChannelSelector="R" yChannelSelector="G" result="curvedSignal" />
        <feGaussianBlur in="curvedSignal" stdDeviation={signalSoftness} result="tubeSignal" />
        {/* Light is extracted from the rendered phosphor, not an unrelated gradient.
            Two scattering radii let large bright plates illuminate nearby dark glass.
            The untouched sRGB signal remains underneath, preserving text and dark gradients;
            only extracted emission is convolved in linear light. */}
        <feColorMatrix data-tube-bloom="threshold" in="tubeSignal" type="matrix"
          colorInterpolationFilters="linearRGB"
          values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  .29764 1.00128 .10108 0 -.55"
          result="emissionKey" />
        <feComposite colorInterpolationFilters="linearRGB" data-tube-bloom="emission" in="tubeSignal" in2="emissionKey" operator="in" result="phosphorEmission" />
        <feGaussianBlur colorInterpolationFilters="linearRGB" data-tube-bloom="near" in="phosphorEmission" stdDeviation="3.5" result="nearScatter" />
        <feComponentTransfer colorInterpolationFilters="linearRGB" data-tube-bloom="near-gain" in="nearScatter" result="nearBloom">
          <feFuncA type="linear" slope={nearGain} />
        </feComponentTransfer>
        <feGaussianBlur colorInterpolationFilters="linearRGB" data-tube-bloom="wide" in="phosphorEmission" stdDeviation="22" result="wideScatter" />
        <feComponentTransfer colorInterpolationFilters="linearRGB" data-tube-bloom="wide-gain" in="wideScatter" result="wideBloom">
          <feFuncA type="linear" slope={wideGain} />
        </feComponentTransfer>
        <feBlend colorInterpolationFilters="sRGB" data-tube-bloom="near-merge" in="tubeSignal" in2="nearBloom" mode="screen" result="litSignal" />
        <feBlend colorInterpolationFilters="sRGB" data-tube-bloom="wide-merge" in="litSignal" in2="wideBloom" mode="screen" result="originalOptics" />
        {/* Broad, low-frequency spill is driven by luminous area. The original
            signal and beam softness stay intact; this does not blur glyphs. */}
        {panelBloom && <>
        <feGaussianBlur colorInterpolationFilters="linearRGB" data-panel-bloom="diffuse" in="phosphorEmission" stdDeviation="48" result="panelScatter" />
        <feComponentTransfer colorInterpolationFilters="linearRGB" in="panelScatter" result="panelBloom">
          <feFuncA type="linear" slope=".38" />
        </feComponentTransfer>
        <feBlend colorInterpolationFilters="sRGB" in="originalOptics" in2="panelBloom" mode="screen" />
        </>}
      </filter>;
}

export function NightTubeFilter({ id, map, scale, profile }: { id: string; map: string; scale: number; profile?: RegistrationProfile }) {
  return <TubeSignalFilter id={id} map={map} scale={scale} profile={profile}
    beamSoftness={.35} signalSoftness={.18} nearGain={.32} wideGain={.36} panelBloom />;
}

export function DayTubeFilter({ id, map, scale, theme, registration }: { id: string; map: string; scale: number; theme: string; registration: boolean }) {
  if (theme === 'frost') return NightTubeFilter({ id, map, scale, profile: registration ? 'day' : undefined });
  return <TubeSignalFilter id={id} map={map} scale={scale} profile={registration ? 'day' : undefined}
    beamSoftness={.35} signalSoftness={.18} nearGain={.04} wideGain={.02} />;
}
