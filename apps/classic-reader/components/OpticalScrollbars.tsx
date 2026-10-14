'use client';

import { useEffect, useLayoutEffect, useId, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { opticalPoint, scrollThumb } from '@/lib/optical-scroll';
import { scrollbarHitClip } from '@/lib/scrollbar-occlusion';
import '@/app/optical-scrollbars.css';

type Rail = { target: HTMLElement; host: HTMLElement; content: Element | null; viewport: number; contentHeight: number;
  id: string; label: string; x: number; y: number; height: number;
  root: { left: number; top: number; width: number; height: number }; scale: number; color: string };
const selectors = '.magi-reader-main,[data-sidebar-scroll-container],.magi-home-catalog,.magi-home-category-nav';
const sameRails = (a: Rail[], b: Rail[]) => a.length === b.length && a.every((rail, i) => {
  const next = b[i];
  return rail.target === next.target && rail.host === next.host && rail.id === next.id
    && rail.content === next.content && rail.viewport === next.viewport && rail.contentHeight === next.contentHeight
    && rail.x === next.x && rail.y === next.y && rail.height === next.height
    && rail.scale === next.scale && rail.color === next.color
    && rail.root.left === next.root.left && rail.root.top === next.root.top
    && rail.root.width === next.root.width && rail.root.height === next.root.height;
});

/** Real DOM/SVG rails outside the paint-only lens. Native scrolling, wheel,
 * touch, selection and pagination remain on the existing scroll containers. */
export default function OpticalScrollbars({ enabled, scale }: { enabled: boolean; scale: number }) {
  const marker = useRef<HTMLSpanElement>(null);
  const id = useId();
  const [rails, setRails] = useState<Rail[]>([]);
  const [hitClip, setHitClip] = useState<string>();
  useEffect(() => {
    const root = marker.current?.closest<HTMLElement>('#magi-home-display,#magi-reader-display');
    if (!root || !enabled) return;
    let frame = 0;
    const owned = new Map<HTMLElement, { id: string | null; child: Element | null }>();
    const toolWindows = new Set<HTMLElement>();
    const resize = new ResizeObserver(() => schedule());
    const update = () => {
      frame = 0;
      const bounds = root.getBoundingClientRect();
      const windows = [...root.querySelectorAll<HTMLElement>('.magi-floating-window')];
      for (const node of toolWindows) {
        if (windows.includes(node)) continue;
        resize.unobserve(node); toolWindows.delete(node);
      }
      windowMoves.disconnect();
      for (const node of windows) {
        if (!toolWindows.has(node)) { resize.observe(node); toolWindows.add(node); }
        // Only tool transforms need attribute observation, never the document
        // or the thumb's per-scroll SVG updates.
        windowMoves.observe(node, { attributes: true, attributeFilter: ['style'] });
      }
      setHitClip(scrollbarHitClip(window.innerWidth, window.innerHeight, windows.map(node => node.getBoundingClientRect())));
      const result: Rail[] = [];
      const targets = [...root.querySelectorAll<HTMLElement>(selectors)];
      for (const [target, previous] of owned) {
        if (targets.includes(target)) continue;
        resize.unobserve(target);
        if (previous.child) resize.unobserve(previous.child);
        target.classList.remove('magi-optical-scroll-owned');
        if (previous.id === null) target.removeAttribute('id');
        owned.delete(target);
      }
      targets.forEach((target, index) => {
        if (!owned.has(target)) {
          owned.set(target, { id: target.getAttribute('id'), child: null });
          if (!target.id) target.id = `optical-scroll-${id}-${index}`;
          resize.observe(target);
        }
        const observed = owned.get(target)!;
        if (observed.child !== target.firstElementChild) {
          if (observed.child) resize.unobserve(observed.child);
          observed.child = target.firstElementChild;
          if (observed.child) resize.observe(observed.child);
        }
        const r = target.getBoundingClientRect();
        const visible = r.width > 0 && r.height > 40 && target.scrollHeight > target.clientHeight + 1;
        target.classList.toggle('magi-optical-scroll-owned', visible);
        if (!visible) return;
        const style = getComputedStyle(target);
        // Resolve the palette in CSS at paint time, not as a JS snapshot. A
        // phosphor switch changes color even when no rail geometry changes.
        const color = `var(--magi-optical-scroll-color, var(--magi-reader-scroll-thumb, var(--home-scroll-thumb, ${style.color})))`;
        result.push({ target, host: root, content: target.firstElementChild, viewport: target.clientHeight,
          contentHeight: target.scrollHeight, id: target.id, label: target.matches('.magi-reader-main') ? '正文滚动条'
          : target.matches('.magi-home-catalog') ? '剧情目录滚动条' : '侧栏滚动条',
        root: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
        x: r.right - bounds.left - 5, y: r.top - bounds.top + 12, height: r.height - 24,
        scale: scale * bounds.width / root.offsetWidth, color });
      });
      setRails(previous => sameRails(previous, result) ? previous : result);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const windowMoves = new MutationObserver(schedule);
    resize.observe(root);
    const mutation = new MutationObserver(schedule);
    mutation.observe(root, { childList: true, subtree: true });
    // A native scroll changes one thumb, not the viewport/rail geometry. Avoid
    // querying every scroller and committing a React tree on every scroll frame.
    // Only a scroll of an ancestor of another rail can move that rail's bounds.
    const ancestorScroll = (event: Event) => {
      const scroller = event.target;
      if (!(scroller instanceof HTMLElement)) return;
      if ([...owned.keys()].some(target => target !== scroller && scroller.contains(target))) schedule();
    };
    root.addEventListener('scroll', ancestorScroll, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect();
      windowMoves.disconnect();
      root.removeEventListener('scroll', ancestorScroll, true); window.removeEventListener('resize', schedule);
      for (const [target, previous] of owned) {
        target.classList.remove('magi-optical-scroll-owned');
        if (previous.id === null) target.removeAttribute('id');
      }
    };
  }, [enabled, scale, id]);
  return <><span ref={marker} hidden />{enabled && rails.length > 0 && createPortal(
    <div className="magi-optical-scrollbars" style={{ clipPath: hitClip ? `path('${hitClip}')` : undefined }}>
      {rails.map(rail => <ScrollRail key={rail.id} rail={rail} />)}
    </div>, document.body)}</>;
}

function ScrollRail({ rail }: { rail: Rail }) {
  const { target, root, height, scale } = rail;
  const [active, setActive] = useState(false);
  const drag = useRef<{ pointer: number; y: number; top: number } | null>(null);
  const control = useRef<SVGGElement>(null);
  const hitThumb = useRef<SVGPathElement>(null);
  const paintedThumb = useRef<SVGPathElement>(null);
  const thumb = scrollThumb(target.clientHeight, target.scrollHeight, height, target.scrollTop);
  const point = (y: number) => opticalPoint(rail.x, rail.y + y, root.width, root.height, scale);
  const path = (start: number, length: number) => Array.from({ length: 25 }, (_, i) => {
    const p = point(start + length * i / 24); return `${i ? 'L' : 'M'}${p.x},${p.y}`;
  }).join(' ');
  useLayoutEffect(() => {
    let frame = 0;
    const updateThumb = () => {
      frame = 0;
      const next = scrollThumb(target.clientHeight, target.scrollHeight, height, target.scrollTop);
      const points = Array.from({ length: 25 }, (_, i) => {
        const p = opticalPoint(rail.x, rail.y + next.start + next.length * i / 24, root.width, root.height, scale);
        return `${i ? 'L' : 'M'}${p.x},${p.y}`;
      }).join(' ');
      hitThumb.current?.setAttribute('d', points);
      paintedThumb.current?.setAttribute('d', `M${rail.x},${rail.y + next.start} v${next.length}`);
      control.current?.setAttribute('aria-valuemax', String(Math.round(next.maximum)));
      control.current?.setAttribute('aria-valuenow', String(Math.round(target.scrollTop)));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(updateThumb); };
    const resize = new ResizeObserver(schedule);
    resize.observe(target);
    if (target.firstElementChild) resize.observe(target.firstElementChild);
    target.addEventListener('scroll', schedule, { passive: true });
    updateThumb();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); target.removeEventListener('scroll', schedule); };
  }, [rail, target, root, height, scale]);
  const sourceY = (clientY: number) => {
    let low = 0, high = height;
    for (let i = 0; i < 20; i++) { const mid = (low + high) / 2;
      if (point(mid).y + root.top < clientY) low = mid; else high = mid; }
    return (low + high) / 2;
  };
  const end = () => {
    drag.current = null;
  };
  const down = (e: PointerEvent<SVGGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId);
    const y = sourceY(e.clientY);
    const current = scrollThumb(target.clientHeight, target.scrollHeight, height, target.scrollTop);
    if (y < current.start || y > current.start + current.length)
      target.scrollTo({ top: (y - current.length / 2) / Math.max(1, current.travel) * current.maximum, behavior: 'instant' });
    drag.current = { pointer: e.pointerId, y, top: target.scrollTop };
  };
  const move = (e: PointerEvent<SVGGElement>) => {
    const d = drag.current; if (!d || d.pointer !== e.pointerId) return;
    const current = scrollThumb(target.clientHeight, target.scrollHeight, height, target.scrollTop);
    target.scrollTo({ top: d.top + (sourceY(e.clientY) - d.y) / Math.max(1, current.travel) * current.maximum, behavior: 'instant' });
  };
  const keyboard = (e: KeyboardEvent<SVGGElement>) => {
    const maximum = Math.max(0, target.scrollHeight - target.clientHeight);
    const changes: Record<string, number> = { ArrowDown: 48, ArrowUp: -48, PageDown: target.clientHeight * .9,
      PageUp: -target.clientHeight * .9, Home: -maximum, End: maximum };
    if (!(e.key in changes)) return;
    e.preventDefault(); target.scrollBy({ top: changes[e.key], behavior: 'instant' });
  };
  return <><svg width={root.width} height={root.height} style={{ left: root.left, top: root.top }}>
    <g ref={control} role="scrollbar" tabIndex={0} aria-label={rail.label} aria-controls={rail.id} aria-orientation="vertical"
      aria-valuemin={0} aria-valuemax={Math.round(thumb.maximum)} aria-valuenow={Math.round(target.scrollTop)}
      onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
      onKeyDown={keyboard} onWheel={e => target.scrollBy({ top: e.deltaY, behavior: 'instant' })}
      onFocus={() => setActive(true)} onBlur={() => setActive(false)}
      onPointerEnter={() => setActive(true)} onPointerLeave={() => setActive(false)}>
      <path className="magi-optical-scroll-hit" d={path(0, height)} />
      <path ref={hitThumb} className="magi-optical-scroll-thumb-hit" d={path(thumb.start, thumb.length)} />
    </g>
  </svg>{createPortal(<svg className="magi-optical-scroll-paint" aria-hidden="true"
    data-scroll-paint-for={rail.id} data-active={active} width={root.width} height={root.height} style={{ color: rail.color }}>
    {/* Paint in source coordinates under the original grain/beam/registration.
        Only the transparent hit path above uses inverse-lens coordinates. */}
    <path className="magi-optical-scroll-track" d={`M${rail.x},${rail.y} v${height}`} />
    <path ref={paintedThumb} className="magi-optical-scroll-thumb" d={`M${rail.x},${rail.y + thumb.start} v${thumb.length}`} />
  </svg>, rail.host)}</>;
}
