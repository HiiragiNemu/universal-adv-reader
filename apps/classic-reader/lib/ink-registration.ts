import type { CSSProperties } from 'react';

const named: Record<string,string> = { red:'#ff0000',blue:'#0000ff',yellow:'#ffff00',black:'#000000',white:'#ffffff',green:'#008000',lime:'#00ff00',cyan:'#00ffff',aqua:'#00ffff',magenta:'#ff00ff',fuchsia:'#ff00ff',purple:'#800080',rebeccapurple:'#663399',orange:'#ffa500',pink:'#ffc0cb',gold:'#ffd700',gray:'#808080',grey:'#808080',silver:'#c0c0c0',navy:'#000080',teal:'#008080',olive:'#808000',maroon:'#800000' };

/** A restrained design palette, not a claim of a particular game's shader.
 * Continuous hue interpolation avoids one red shadow being reused for every
 * speaker. The original glyph color and alpha are never changed. */
export function inkRegistrationStyle(color: string | undefined): CSSProperties | undefined {
  if (!color) return undefined;
  let hex = (named[color.toLowerCase()] || color).replace(/^#/, '');
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map(c=>c+c).join('');
  if (!/^[\da-f]{6}([\da-f]{2})?$/i.test(hex)) return undefined;
  const [r,g,b] = [0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255);
  const alpha = hex.length === 8 ? parseInt(hex.slice(6),16)/255 : 1;
  const high=Math.max(r,g,b),low=Math.min(r,g,b),delta=high-low;
  let hue = delta===0 ? 0 : high===r ? ((g-b)/delta)%6 : high===g ? (b-r)/delta+2 : (r-g)/delta+4;
  hue=(hue*60+360)%360;
  const anchors=[[185,225],[25,195],[55,185],[140,260],[185,300],[235,345],[185,225]];
  const i=Math.floor(hue/60),t=(hue%60)/60;
  const blend=(a:number,b:number)=>Math.round((a+((b-a+540)%360-180)*t+360)%360);
  const [lead,trail]=delta<.08 ? [190,0] : [blend(anchors[i][0],anchors[i+1][0]),blend(anchors[i][1],anchors[i+1][1])];
  // The user's amber reference gives yellow source ink a separated orange-red
  // echo, not the cyan trail in the general hue interpolation. Preserve the
  // day lead/trail and the original fill; only the night text-shadow changes.
  const yellow = delta >= .08 && hue >= 40 && hue <= 70;
  const yellowShadow = `clamp(.05px,calc(.12em - .89px),1.65px) 0 0 rgb(20 10 12 / ${alpha}), clamp(.08px,calc(.27em - 2px),3.6px) .007em .007em rgb(255 65 13 / ${.91*alpha}), -.012em 0 .007em rgb(255 250 211 / ${.333*alpha}), 0 0 .16em rgb(255 167 45 / ${.208*alpha})`;
  // Restore NIGHT_CHANNEL_V5's independent white/blue signal. It is not the
  // yellow/red path and must not be recoloured by a second scene RGB split.
  const whiteShadow = `clamp(.08px,calc(.15em - 1.1px),1.8px) 0 .012em rgb(38 141 255 / ${alpha}), clamp(-.6px,calc(.4px - .06em),-.04px) 0 .014em rgb(103 255 235 / ${.72*alpha}), 0 0 .1em rgb(234 255 255 / ${53/255*alpha})`;
  return { '--magi-ink-lead':`hsl(${lead} 72% 76% / ${.58*alpha})`,
    '--magi-ink-trail':`hsl(${trail} 70% 66% / ${.46*alpha})`,
    '--magi-ink-shadow': yellow ? yellowShadow : delta < .08 ? whiteShadow : `-.045em 0 .018em hsl(${lead} 72% 76% / ${.58*alpha}), .095em .007em .012em hsl(${trail} 85% 60% / ${.72*alpha})`,
    '--magi-ink-halo':`hsl(${hue.toFixed(1)} 22% 90% / ${.32*alpha})` } as CSSProperties;
}
