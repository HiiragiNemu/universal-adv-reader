import type { CSSProperties } from 'react';
import { inkRegistrationStyle } from './ink-registration.ts';

const relativeLuminance = (rgb: number[]) => rgb
  .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);

/** Scale all RGB channels equally: retain the hue, darken the actual glyph. */
export function dayNameInk(color: string): string {
  const hex = color.replace(/^#/, '');
  const full = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex;
  if (!/^[\da-f]{6}$/i.test(full)) return color;
  const rgb = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255);
  if (relativeLuminance(rgb) <= 0.1) return color;
  let low = 0, high = 1;
  for (let i = 0; i < 16; i++) {
    const scale = (low + high) / 2;
    if (relativeLuminance(rgb.map(v => v * scale)) > 0.1) high = scale;
    else low = scale;
  }
  return '#' + rgb.map(v => Math.floor(v * low * 255).toString(16).padStart(2, '0')).join('');
}

/** Global off leaves no paint. The surface selects the appropriate glyph ink. */
export function readerNameChip(color: string | undefined, enabled: boolean): CSSProperties | undefined {
  if (!enabled || !color) return undefined;
  return { color, '--magi-name-day-ink': dayNameInk(color), ...inkRegistrationStyle(color) } as CSSProperties;
}
