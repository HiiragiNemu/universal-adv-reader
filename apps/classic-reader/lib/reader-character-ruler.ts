export type CharacterTick = { count: number; x: number; active: boolean; major: boolean };

// Use measured glyph boundaries inside the cell, then continue the scale to
// the cell edge. The active endpoint never moves to an estimated grid position.
export function buildCharacterTicks(boundaries: number[], width: number, advance: number): CharacterTick[] {
  if (!(width > 0) || !(advance > 0)) return [];
  const ticks: CharacterTick[] = [{ count: 0, x: 0, active: false, major: false }];
  for (const [index, x] of boundaries.entries()) {
    if (!Number.isFinite(x) || x < 0 || x > width + 1) continue;
    const count = index + 1;
    ticks.push({ count, x: Math.min(width, x), active: count === boundaries.length,
      major: count === 1 || count % 5 === 0 });
  }
  const end = ticks[ticks.length - 1];
  for (let count = end.count + 1, x = end.x + advance; x <= width + .1; count++, x += advance) {
    ticks.push({ count, x, active: false, major: count === 1 || count % 5 === 0 });
  }
  return ticks;
}

export function measureRulerLine(element: HTMLElement, targetY: number) {
  const cell = element.closest<HTMLElement>('[data-reader-text-cell]') || element;
  const box = cell.getBoundingClientRect();
  const style = getComputedStyle(cell);
  const left = box.left + (parseFloat(style.paddingLeft) || 0);
  const width = box.width - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement?.closest('rt, rp, [aria-hidden="true"]')
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const range = document.createRange();
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const boundaries: number[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    range.selectNodeContents(node);
    if (!Array.from(range.getClientRects()).some(r => r.top <= targetY && r.bottom > targetY)) continue;
    const segments = Array.from(segmenter.segment(node.textContent || ''));
    const rectAt = (index: number) => {
      const part = segments[index];
      range.setStart(node, part.index); range.setEnd(node, part.index + part.segment.length);
      return range.getBoundingClientRect();
    };
    let low = 0, high = segments.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (rectAt(mid).bottom <= targetY) low = mid + 1; else high = mid;
    }
    for (let index = low; index < segments.length; index++) {
      const rect = rectAt(index);
      if (rect.top > targetY) break;
      if (rect.width > 0 && rect.bottom > targetY && !/[\r\n]/.test(segments[index].segment)) {
        boundaries.push(rect.right - left);
      }
    }
  }
  // An em is the continuation unit for CJK; Latin/ruby/punctuation inside the
  // actual line retain their measured advances rather than an average width.
  const ink = getComputedStyle(element);
  const advance = (parseFloat(ink.fontSize) || 16) + (parseFloat(ink.letterSpacing) || 0);
  return { left, width, count: boundaries.length,
    endpoint: boundaries.at(-1) ?? 0, ticks: buildCharacterTicks(boundaries, width, advance) };
}

/** A native vertical scroll moves a printed line, not its glyph advances.
 * Keep only the current CN/JP line; layout, font and content changes invalidate
 * the cache. Coordinates stay in document space, with no estimated glyph grid. */
export function createRulerLineCache(measure = measureRulerLine) {
  type Measurement = ReturnType<typeof measureRulerLine>;
  const lines = new Map<string, { element: HTMLElement; offset: number; width: number;
    left: number; result: Measurement }>();
  return {
    clear() { lines.clear(); },
    read(slot: 'cn' | 'jp', element: HTMLElement, offset: number,
      paper: { top: number; left: number; width: number }): Measurement {
      const saved = lines.get(slot);
      if (saved && saved.element === element && saved.offset === offset && saved.width === paper.width) {
        return saved.left === paper.left ? saved.result
          : { ...saved.result, left: saved.result.left + paper.left - saved.left };
      }
      const result = measure(element, offset + paper.top);
      lines.set(slot, { element, offset, width: paper.width, left: paper.left, result });
      return result;
    },
  };
}
