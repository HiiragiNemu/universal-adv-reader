'use client';

import { useCallback, useEffect, useState, type RefObject } from 'react';
import { createRulerLineCache, measureRulerLine, type CharacterTick } from '@/lib/reader-character-ruler';
import { createPortal } from 'react-dom';
import rulerStyles from '@/lib/ruler-surface-css';
import '@/app/reader/reader-rulers.css';

export type FilmRulerMark = {
  language: 'cn' | 'jp'; rowIndex: number; displayIndex: number;
  offsetPx: number; major: boolean;
};
type Rail = { language: 'cn' | 'jp'; left: number; width: number; lineLeft: number;
  row: number; line: number; count: number; endpoint: number; ticks: CharacterTick[] };

// Scroll updates only this overlay, not the chapter's dialogue/voice controls.
export default function ReaderFilmViewport({ readerRef, marks, theme, direction, sequence }: {
  readerRef: RefObject<HTMLDivElement | null>; marks: FilmRulerMark[];
  theme: string; direction: 'next' | 'prev' | null; sequence: number;
}) {
  const [surface, setSurface] = useState<ShadowRoot | null>(null);
  const attachSurface = useCallback((host: HTMLElement | null) => {
    if (host) setSurface(host.shadowRoot ?? host.attachShadow({ mode: 'open' }));
  }, []);
  const [state, setState] = useState({ left: 0, top: 0, width: 0, height: 0,
    docTop: 0, stacked: false, rails: [] as Rail[] });
  useEffect(() => {
    const doc = readerRef.current, main = doc?.closest('main');
    if (!doc || !main) return;
    const lineCache = createRulerLineCache();
    let request = 0, disposed = false;
    let hover: { row: number; y: number } | null = null;
    const rows = new Map(Array.from(doc.querySelectorAll<HTMLElement>('[data-reader-row-index]'))
      .map(row => [Number(row.dataset.readerRowIndex), row]));
    const measure = () => {
      const view = main.getBoundingClientRect(), paper = doc.getBoundingClientRect();
      const docTop = paper.top - view.top;
      const rails: Rail[] = [];
      const selection = document.getSelection();
      const selectedRow = selection && !selection.isCollapsed
        ? selection.anchorNode?.parentElement?.closest<HTMLElement>('[data-reader-row-index]') : null;
      const selectedRect = selectedRow && doc.contains(selectedRow) && selection?.rangeCount
        ? selection.getRangeAt(0).getClientRects()[0] : null;
      const target = selectedRect ? { row: Number(selectedRow!.dataset.readerRowIndex),
        y: (selectedRect.top + selectedRect.bottom) / 2 } : hover;
      for (const language of ['cn', 'jp'] as const) {
        const languageMarks = marks.filter(mark => mark.language === language);
        const hovered = target && languageMarks.filter(mark => mark.rowIndex === target.row);
        const candidates = hovered && hovered.length ? hovered : languageMarks;
        const targetY = target && hovered && hovered.length ? target.y : view.top + 36;
        const active = candidates.reduce<FilmRulerMark | undefined>((nearest, mark) => {
          const y = mark.offsetPx + paper.top;
          // Prefer the first fully visible printed line on scroll; a pointer
          // chooses the nearest physical line independently in each language.
          const distance = target && hovered && hovered.length ? Math.abs(y - targetY)
            : y >= targetY ? y - targetY : (targetY - y) + view.height;
          if (!nearest) return mark;
          const oldY = nearest.offsetPx + paper.top;
          const oldDistance = target && hovered && hovered.length ? Math.abs(oldY - targetY)
            : oldY >= targetY ? oldY - targetY : (targetY - oldY) + view.height;
          return distance < oldDistance ? mark : nearest;
        }, undefined);
        if (!active) continue;
        const text = rows.get(active.rowIndex)?.querySelector<HTMLElement>(`[data-reader-text-content="${language}"]`);
        if (!text || !text.getClientRects().length) continue;
        const measured = lineCache ? lineCache.read(language, text, active.offsetPx, paper)
          : measureRulerLine(text, active.offsetPx + paper.top);
        if (measured.width <= 0 || !measured.count) continue;
        const pane = text.closest<HTMLElement>('[lang]')?.getBoundingClientRect();
        rails.push({ language, ...measured, left: measured.left - view.left,
          lineLeft: (pane?.left ?? measured.left - 30) - view.left,
          row: active.rowIndex, line: active.displayIndex });
      }
      // Read the actual responsive layout, not the width of a short text line.
      const pair = doc.querySelector<HTMLElement>('.magi-bilingual-pair');
      const bilingual = pair?.querySelector(':scope > [lang="zh-Hans"]') && pair?.querySelector(':scope > [lang="ja"]');
      const stacked = Boolean(bilingual && getComputedStyle(pair!).flexDirection === 'column');
      if (rails[0]) rails[0].lineLeft = Math.max(4, paper.left - view.left + 4);
      if (stacked && rails[1]) rails[1].lineLeft = Math.min(view.width - 35, paper.right - view.left - 35);
      const next = { left: view.left, top: view.top, width: view.width, height: view.height, docTop, stacked, rails };
      setState(old => JSON.stringify(old) === JSON.stringify(next) ? old : next);
    };
    const schedule = () => { if (!disposed) { cancelAnimationFrame(request); request = requestAnimationFrame(measure); } };
    const invalidate = () => { lineCache?.clear(); schedule(); };
    const scroll = () => { hover = null; schedule(); };
    const pointer = (event: PointerEvent) => {
      const row = (event.target as Element)?.closest?.<HTMLElement>('[data-reader-row-index]');
      if (!row) return;
      hover = { row: Number(row.dataset.readerRowIndex), y: event.clientY }; schedule();
    };
    const leave = () => { hover = null; schedule(); };
    const observer = new ResizeObserver(invalidate);
    observer.observe(doc); observer.observe(main);
    const mutation = lineCache ? new MutationObserver(invalidate) : null;
    mutation?.observe(doc, { childList: true, characterData: true, attributes: true, subtree: true });
    // Font switches live above the document. They may change glyph advances
    // without resizing this particular line or changing its printed-line mark.
    mutation?.observe(document.documentElement, { attributes: true,
      attributeFilter: ['data-screen-pixel-font', 'data-night-pixel-font', 'data-native-font-chinese', 'data-native-font-japanese'] });
    main.addEventListener('scroll', scroll, { passive: true });
    doc.addEventListener('pointermove', pointer, { passive: true });
    doc.addEventListener('pointerdown', pointer, { passive: true });
    doc.addEventListener('pointerleave', leave);
    window.addEventListener('resize', invalidate);
    document.addEventListener('selectionchange', schedule);
    document.fonts.addEventListener('loadingdone', invalidate);
    document.fonts.ready.then(invalidate); schedule();
    return () => {
      disposed = true; cancelAnimationFrame(request); observer.disconnect(); mutation?.disconnect(); lineCache?.clear();
      main.removeEventListener('scroll', scroll); doc.removeEventListener('pointermove', pointer);
      doc.removeEventListener('pointerdown', pointer); doc.removeEventListener('pointerleave', leave);
      window.removeEventListener('resize', invalidate); document.removeEventListener('selectionchange', schedule);
      document.fonts.removeEventListener('loadingdone', invalidate);
    };
  }, [readerRef, marks, theme, direction, sequence]);
  if (!state.width) return null;
  return <aside ref={attachSurface} className="magi-reader-film-viewport" aria-hidden="true" data-ruler-layout={state.stacked ? 'stacked' : 'columns'}
    data-transport-sequence={direction ? sequence : undefined} data-transport-direction={direction || undefined}
    style={{ left: state.left, top: state.top, width: state.width, height: state.height }}>
    {surface && createPortal(<><style>{rulerStyles}</style>{state.rails.map(rail => <span key={rail.language}>
      {(state.stacked ? [rail.language === 'cn' ? 'top' : 'bottom'] : ['top', 'bottom']).map(edge =>
        <span key={edge} className={`magi-reader-view-columns magi-reader-view-columns--${edge}`}
          data-ruler-language={rail.language} data-ruler-source-row={rail.row} data-active-count={rail.count}
          data-endpoint={rail.endpoint} style={{ left: rail.left, width: rail.width }}>
          <small className="magi-reader-ruler-language">{rail.language.toUpperCase()}</small>
          {rail.ticks.map(tick => <i key={tick.count} data-major={tick.major} data-column={tick.count}
            data-active={tick.active} style={{ left: tick.x }}>
            {(tick.active || (tick.major && Math.abs(tick.x - rail.endpoint) > 18)) && <b>{tick.count}</b>}
          </i>)}
        </span>)}
      <span className="magi-reader-view-lines" data-ruler-language={rail.language} style={{ left: rail.lineLeft }}>
        <small className="magi-reader-ruler-language">{rail.language.toUpperCase()}</small>
        {marks.filter(mark => mark.language === rail.language && mark.offsetPx + state.docTop >= 30
          && mark.offsetPx + state.docTop < state.height - 30).map(mark =>
          <i key={mark.displayIndex} data-major={mark.major} data-line={mark.displayIndex}
            data-active={mark.displayIndex === rail.line} style={{ top: mark.offsetPx + state.docTop }}>
            {(mark.major || mark.displayIndex === rail.line) && <b>{mark.displayIndex}</b>}
          </i>)}
      </span>
    </span>)}</>, surface)}
  </aside>;
}
