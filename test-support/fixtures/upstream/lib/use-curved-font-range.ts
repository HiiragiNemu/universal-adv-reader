'use client';
import { useEffect, useRef } from 'react';
import { lensSourcePoint } from '@/lib/curved-range';
import { updateReaderDisplayPreferences } from '@/lib/reader-display-preferences';

export function useCurvedFontRange() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let pointer: number | null = null;
    const source = (event: PointerEvent, input: HTMLInputElement) => {
      const root = input.closest<HTMLElement>('#magi-reader-display')!;
      return /magi-(?:reader|night)-tube-curve/.test(getComputedStyle(root).filter)
        ? lensSourcePoint(event.clientX, event.clientY, root.getBoundingClientRect(), matchMedia('(max-width: 767px)').matches ? 38 : 50)
        : { x: event.clientX, y: event.clientY };
    };
    const change = (event: PointerEvent, start = false) => {
      const input = ref.current;
      if (!input || (start && event.pointerType === 'mouse' && event.button !== 0)) return;
      if (start && event.target instanceof Element
        && event.target.closest('.magi-floating-window,[role="dialog"]')) return;
      if (!start && event.pointerId !== pointer) return;
      const rect = input.getBoundingClientRect(), point = source(event, input);
      if (!rect.width || !rect.height) return;
      if (start && (point.x < rect.left - 4 || point.x > rect.right + 4
        || point.y < rect.top - 10 || point.y > rect.bottom + 10)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (start) { pointer = event.pointerId; input.focus({ preventScroll: true }); input.setPointerCapture(event.pointerId); }
      const progress = Math.max(0,Math.min(1,(point.x - rect.left - 8) / Math.max(1,rect.width - 16)));
      const min = Number(input.min), max = Number(input.max);
      updateReaderDisplayPreferences({ fontSizePx: Math.round(min + progress * (max - min)) });
    };
    const down = (e: PointerEvent) => change(e,true);
    const move = (e: PointerEvent) => change(e);
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      if (ref.current?.hasPointerCapture(e.pointerId)) ref.current.releasePointerCapture(e.pointerId);
      pointer = null;
    };
    window.addEventListener('pointerdown',down,{capture:true,passive:false});
    window.addEventListener('pointermove',move,{capture:true,passive:false});
    window.addEventListener('pointerup',end,true); window.addEventListener('pointercancel',end,true);
    return () => {
      window.removeEventListener('pointerdown',down,true); window.removeEventListener('pointermove',move,true);
      window.removeEventListener('pointerup',end,true); window.removeEventListener('pointercancel',end,true);
    };
  },[]);
  return ref;
}
