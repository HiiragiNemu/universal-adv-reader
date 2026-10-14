type WindowRect = { left: number; top: number; right: number; bottom: number };

/** Clip only the transparent scrollbar hit layer. Window overlaps are a union,
 * not even-odd holes (which would re-enable clicks under two overlapping tools).
 * The separately painted scrollbar and screen optics remain unchanged. */
export function scrollbarHitClip(width: number, height: number, windows: WindowRect[]): string | undefined {
  const covered = windows.map(rect => ({
    left: Math.max(0, rect.left), top: Math.max(0, rect.top),
    right: Math.min(width, rect.right), bottom: Math.min(height, rect.bottom),
  })).filter(rect => rect.left < rect.right && rect.top < rect.bottom);
  if (!covered.length) return undefined;
  const edges = [...new Set([0, width, ...covered.flatMap(rect => [rect.left, rect.right])])].sort((a, b) => a - b);
  const paths: string[] = [];
  for (let i = 1; i < edges.length; i++) {
    const left = edges[i - 1], right = edges[i];
    const intervals = covered.filter(rect => rect.left < right && rect.right > left).sort((a, b) => a.top - b.top);
    let top = 0;
    const add = (bottom: number) => paths.push(`M${left},${top}H${right}V${bottom}H${left}Z`);
    for (const rect of intervals) {
      if (rect.top > top) add(rect.top);
      top = Math.max(top, rect.bottom);
    }
    if (top < height) add(height);
  }
  return paths.join(' ') || 'M0,0H0V0H0Z';
}
