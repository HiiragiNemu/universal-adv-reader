import { TUBE_LENS_URL } from './tube-lens';
import type { ScreenEffects } from './screen-effects';

const grain = '/textures/magi-lofi-grain.png';
const noise = '/textures/stories-untold/NoiseAndGrain.png';
const decoded = new Map<string, { image: HTMLImageElement; promise: Promise<void> }>();

export class DisplayAssetError extends Error {
  readonly url: string;
  constructor(url: string, cause: unknown) {
    super(`Display asset ${url}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'DisplayAssetError';
    this.url = url;
  }
}

export function displayAssetUrls(theme: string, effects: Pick<ScreenEffects, 'curvature' | 'noise'> & Partial<Pick<ScreenEffects, 'glassDamage'>>): string[] {
  const urls = effects.curvature ? [TUBE_LENS_URL] : [];
  if (effects.noise) urls.push(noise, grain);
  if (theme === 'dark') urls.push('/textures/stories-untold/PixelOverlay_RGB_16.png');
  if (['light', 'paper', 'green'].includes(theme)) urls.push('/textures/paper-fibres-4192.svg');
  if (theme === 'frost') {
    urls.push(grain, '/textures/frost-phosphor-ink-mask.svg',
      '/textures/stories-untold/DirtHighContrast.png', '/textures/stories-untold/2k_BG_Texture.png');
    if (effects.glassDamage === true) urls.push('/textures/frost-glass-scratches.png');
  }
  return [...new Set(urls)];
}

// Cache decoded, unmodified source images, not a reduced-resolution screenshot.
export function prepareDisplayAssets(urls: string[]) {
  return Promise.all(urls.map(url => {
    let entry = decoded.get(url);
    if (!entry) {
      const pending = { image: new Image(), promise: Promise.resolve() };
      pending.promise = (async () => {
        // A single interrupted request must not permanently latch the startup
        // cover. Retry only this original asset, never reduce or omit effects.
        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt > 0) {
            await new Promise(resolve => setTimeout(resolve, 200));
            pending.image = new Image();
          }
          try {
            pending.image.src = url;
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              await Promise.race([pending.image.decode(), new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('Texture request timed out')), 15000);
              })]);
            } finally { clearTimeout(timer); }
            return;
          } catch (error) {
            if (attempt === 1) throw new DisplayAssetError(url, error);
          }
        }
      })().catch(error => {
        if (decoded.get(url) === pending) decoded.delete(url);
        throw error;
      });
      entry = pending;
      decoded.set(url, entry);
    }
    return entry.promise;
  }));
}
