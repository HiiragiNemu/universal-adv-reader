import { sceneRegistrationProfile, type RegistrationProfile } from '@/lib/scene-registration';
import '@/app/scene-registration.css';

/** One rendered-scene pass, including plain text, inputs, SVG and CSS edges.
 * Day/green RGB splitting leaves flat areas unchanged. Chroma rims handle both
 * bright phosphor on dark glass and its inverse without repainting whole glyphs.
 * Amber's pale ink is clipped inside a yellow stroke, opposite the red echo.
 * Neutral white bypasses the warm-key rims and retains its source colour.
 */
export function SceneRegistrationPass({ input = 'SourceGraphic', result, profile }: {
  input?: string; result: string; profile: RegistrationProfile;
}) {
  const p = sceneRegistrationProfile(profile);
  const amber = profile === 'amber';
  const n = (name: string) => `${result}-${name}`;
  return <>
    {/* Amber already has independent yellow/red and white/blue ink signals.
        A second RGB split would recolour both, defeating those contracts. */}
    {amber ? <feOffset in={input} dx="0" dy="0" result={n('registered')} /> : <>
    <feColorMatrix in={input} values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 1" result={n('red')} />
    <feOffset in={n('red')} dx={-p.distance * .65} dy={-p.verticalDistance} result={n('red-shift')} />
    <feColorMatrix in={input} values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 0 1" result={n('green')} />
    <feColorMatrix in={input} values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 0 1" result={n('blue')} />
    <feOffset in={n('blue')} dx={p.distance} dy={p.verticalDistance} result={n('blue-shift')} />
    <feComposite in={n('red-shift')} in2={n('green')} operator="arithmetic" k2="1" k3="1" result={n('rg')} />
    <feComposite in={n('rg')} in2={n('blue-shift')} operator="arithmetic" k2="1" k3="1" result={n('rgb')} />
    {/* Sum straight RGB, then restore alpha ONCE. Adding three premultiplied
        alpha channels made translucent day surfaces turn opaque/dark. */}
    <feComposite in={n('rgb')} in2={input} operator="in" result={n('rgb-alpha')} />
    <feComposite in={n('rgb-alpha')} in2={input} operator="arithmetic" k2={p.mix} k3={1 - p.mix} result={n('registered')} />
    </>}
    {amber ? <>
      {/* Both tests must match: yellow, not the orange-red echo, green ink or
          neutral white. Keying the red echo as yellow repainted it white. */}
      <feColorMatrix in={input} values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1 0 -1 0 0" result={n('yellow-red')} />
      <feColorMatrix in={input} values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  -1 2 -1 0 0" result={n('yellow-green')} />
      <feComposite in={n('yellow-red')} in2={n('yellow-green')} operator="in" result={n('yellow-key')} />
      <feComponentTransfer in={n('yellow-key')} result={n('warm-key')}><feFuncA type="linear" slope="5" /></feComponentTransfer>
    </> : <feColorMatrix in={input} values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  .5 .5 -1 0 0" result={n('warm-key')} />}
    <feOffset in={n('warm-key')} dx={amber ? p.distance : -p.distance} result={n('warm-shift')} />
    <feComposite in={n('warm-key')} in2={n('warm-shift')} operator="arithmetic" k2="1" k3="-1" result={n('pale-edge')} />
    {/* Amber: K - shiftRight(K) is the LEFT INSIDE of the source stroke.
        Never move that mask outside again. Other profiles retain their optics. */}
    {!amber && <feOffset in={n('pale-edge')} dx={p.distance} result={n('pale-echo')} />}
    <feComponentTransfer in={n(amber ? 'pale-edge' : 'pale-echo')} result={n('pale-mask')}>
      <feFuncA type="linear" slope="2" />
    </feComponentTransfer>
    <feComposite in={n('warm-shift')} in2={n('warm-key')} operator="arithmetic" k2="1" k3="-1" result={n('inverse-edge')} />
    <feFlood floodColor={p.pale} floodOpacity={p.paleGain} result={n('pale')} />
    <feComposite in={n('pale')} in2={n('pale-mask')} operator="in" result={n('pale-rim')} />
    {!amber && <>
      <feFlood floodColor={p.dark} floodOpacity={p.darkGain} result={n('inverse')} />
      <feComposite in={n('inverse')} in2={n('inverse-edge')} operator="in" result={n('inverse-rim')} />
    </>}
    <feMerge result={n('fringed')}>
      <feMergeNode in={n('registered')} />
      {!amber && <><feMergeNode in={n('pale-rim')} /><feMergeNode in={n('inverse-rim')} /></>}
    </feMerge>
    {/* Inverse ink needs a dark core: channel echoes must never wash out thin
        black strokes on a bright plate. Gate by the surrounding luminance, so
        ordinary dark backgrounds still retain their coloured light fringes. */}
    <feColorMatrix in={input} values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  .2126 .7152 .0722 0 0" result={n('luma')} />
    <feGaussianBlur in={n('luma')} stdDeviation="5" result={n('surround')} />
    <feComponentTransfer in={n('surround')} result={n('plate')}>
      <feFuncA type="linear" slope="5" intercept="-2" />
    </feComponentTransfer>
    <feComponentTransfer in={n('luma')} result={n('dark-ink')}>
      <feFuncA type="linear" slope="-5" intercept="1.5" />
    </feComponentTransfer>
    <feComposite in={n('dark-ink')} in2={n('plate')} operator="in" result={n('core-mask')} />
    <feComposite in={input} in2={n('core-mask')} operator="in" result={n('core-signal')} />
    <feComponentTransfer in={n('core-signal')} result={n('original-core')}>
      <feFuncA type="linear" slope=".88" />
    </feComponentTransfer>
    {amber && <>
      {/* The opposite difference also finds the left side of inverse ink.
          Gate it to dark glyphs on bright plates, not the exterior of yellow
          glyphs on dark glass. Paint AFTER core restoration, not underneath. */}
      <feComposite in={n('inverse-edge')} in2={n('core-mask')} operator="in" result={n('inverse-inset')} />
      <feComposite in={n('pale')} in2={n('inverse-inset')} operator="in" result={n('inverse-pale')} />
    </>}
    <feMerge result={result} data-scene-registration={profile}>
      <feMergeNode in={n('fringed')} /><feMergeNode in={n('original-core')} />
      {amber && <><feMergeNode in={n('pale-rim')} /><feMergeNode in={n('inverse-pale')} /></>}
    </feMerge>
  </>;
}

export function SceneRegistrationDefinitions({ profile, id = 'magi-scene-registration', softness = 0 }: { profile: RegistrationProfile; id?: string; softness?: number }) {
  return <svg className="magi-scene-registration-defs" width="0" height="0" aria-hidden="true">
    <defs><filter id={id} x="-1%" y="-1%" width="102%" height="102%" colorInterpolationFilters="sRGB">
      <SceneRegistrationPass profile={profile} result="flat-registration" />
      {/* Day softness belongs to the existing scene pass, not each label. */}
      {softness > 0 && <feGaussianBlur in="flat-registration" stdDeviation={softness} />}
    </filter></defs>
  </svg>;
}
