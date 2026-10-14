// Precomputed from the original 512 x 512 RGBA lens, without resampling.
// Home and Reader reuse the same decoded image; navigation does not rebuild it.
export const TUBE_LENS_URL = '/textures/magi-tube-lens-512.png';
export const subscribeTubeViewport = (notify: () => void) => {
  const mobile = window.matchMedia('(max-width: 767px)');
  mobile.addEventListener('change', notify);
  return () => mobile.removeEventListener('change', notify);
};
export const getTubeScale = () => window.matchMedia('(max-width: 767px)').matches ? 38 : 50;
export const getServerTubeScale = () => 50;
