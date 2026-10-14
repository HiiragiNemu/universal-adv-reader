import type { ScreenEffects } from './screen-effects';

// Only successful publication can prime a warm route. Glass still has a local
// refraction/mask owner and must pass that owner's readiness on every mount.
const published = new Set<string>();
export function displayPublicationKey(theme: string, effects: Pick<ScreenEffects, 'curvature' | 'noise' | 'pixelFont' | 'glassDamage'>) {
  return [theme, effects.curvature, effects.noise, effects.pixelFont, effects.glassDamage].join(':');
}
export function rememberDisplayPublication(key: string) { published.add(key); }
export function canPublishWarmDisplay(key: string, glassDamage: boolean, fontStatus: string) {
  return !glassDamage && fontStatus === 'loaded' && published.has(key);
}
