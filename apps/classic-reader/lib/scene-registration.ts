export type RegistrationProfile = 'amber' | 'green' | 'day';

/** CSS-pixel offsets of the final raster, independent of font weight or size. */
export const sceneRegistrationProfile = (profile: RegistrationProfile) => ({
  // The scene-wide pass also covers tiny metadata. Larger type gets the
  // additional em-scaled ink rim in CSS, behind (not over) the glyph core.
  distance: .8,
  verticalDistance: .18,
  mix: profile === 'day' ? .76 : .86,
  pale: profile === 'green' ? '#e3fff4' : '#fffcec',
  dark: profile === 'amber' ? '#e85c2c' : profile === 'green' ? '#a0eedf' : '#355c9a',
  paleGain: profile === 'day' ? .24 : .8,
  darkGain: profile === 'day' ? .14 : profile === 'green' ? .34 : .58,
});
