export type ScreenEffects = { curvature: boolean; scanlines: boolean; noise: boolean; pixelFont: boolean; balloons: boolean; registration: boolean; glassDamage: boolean };
export const SCREEN_EFFECTS_KEY = 'magi-screen-effects-v1';
export const SCREEN_EFFECTS_EVENT = 'magi-screen-effects-change';
const themes = ['light', 'paper', 'green', 'dark', 'frost'];
const keys = ['curvature', 'scanlines', 'noise', 'pixelFont', 'balloons', 'registration', 'glassDamage'] as const;
type Settings = Record<string, Partial<ScreenEffects>>;
export function parseScreenEffects(snapshot: string | null): Settings {
  try {
    const value: unknown = JSON.parse(snapshot || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result: Settings = {};
    for (const theme of themes) {
      const entry = (value as Record<string, unknown>)[theme];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      result[theme] = Object.fromEntries(keys.filter(key => typeof (entry as Record<string, unknown>)[key] === 'boolean')
        .map(key => [key, (entry as Record<string, unknown>)[key]]));
    }
    const shared = (value as Record<string, unknown>).global;
    if (shared && typeof shared === 'object' && typeof (shared as Record<string, unknown>).balloons === 'boolean') {
      result.global = { balloons: (shared as { balloons: boolean }).balloons };
    }
    return result;
  } catch { return {}; }
}
export function resolveScreenEffects(snapshot: string | null, theme: string, nightPixelFont: boolean, iosWebKit = false): ScreenEffects {
  const settings = parseScreenEffects(snapshot);
  const effects = { curvature: theme === 'dark', scanlines: theme === 'dark', noise: theme === 'dark',
    pixelFont: theme === 'dark' && nightPixelFont, balloons: false, registration: ['light', 'paper', 'green', 'frost'].includes(theme), glassDamage: false, ...settings[theme] };
  // Temporarily retired by user request: saved opt-in must not run the effect.
  effects.balloons = false;
  // Night retains separate amber/green choices; a stale generic field must
  // never take precedence over the currently selected phosphor's font switch.
  if (theme === 'dark') {
    effects.curvature = effects.scanlines = effects.noise = true;
    effects.registration = true;
    effects.pixelFont = nightPixelFont;
  }
  // Device capability is applied last, including night's forced defaults.
  // Do not overwrite the saved choice used on Android and desktop.
  if (iosWebKit) effects.curvature = false;
  return effects;
}
let volatile = '{}';
export const getScreenEffectsServerSnapshot = () => '{}';
export function getScreenEffectsSnapshot() {
  try { return typeof window === 'undefined' ? volatile : window.localStorage.getItem(SCREEN_EFFECTS_KEY) || volatile; }
  catch { return volatile; }
}
export function subscribeScreenEffects(notify: () => void) {
  if (typeof window === 'undefined') return () => {};
  const storage = (event: StorageEvent) => { if (!event.key || event.key === SCREEN_EFFECTS_KEY) { volatile = event.newValue || '{}'; notify(); } };
  window.addEventListener('storage', storage); window.addEventListener(SCREEN_EFFECTS_EVENT, notify);
  return () => { window.removeEventListener('storage', storage); window.removeEventListener(SCREEN_EFFECTS_EVENT, notify); };
}
export function updateScreenEffects(theme: string, update: Partial<ScreenEffects>) {
  if (!themes.includes(theme)) return;
  const current = parseScreenEffects(getScreenEffectsSnapshot());
  const { balloons, ...optics } = update;
  volatile = JSON.stringify(parseScreenEffects(JSON.stringify({ ...current,
    [theme]: { ...current[theme], ...optics },
    global: { balloons: typeof balloons === 'boolean' ? balloons : resolveScreenEffects(JSON.stringify(current), theme, false).balloons },
  })));
  try { window.localStorage.setItem(SCREEN_EFFECTS_KEY, volatile); } catch { /* Keep the in-memory selection. */ }
  window.dispatchEvent(new Event(SCREEN_EFFECTS_EVENT));
}
