"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Minus, Square, X } from 'lucide-react';

import { isNightTheme } from '@/app/providers';
import { clampFloatingPoint, floatingBounds, moveFloatingPoint, resizeFloatingSize, type FloatingSize } from '@/lib/floating-geometry';
import { FLOATING_WINDOW_REVEAL } from '@/lib/floating-window-events';

type FloatingWindowProps = {
  isOpen: boolean;
  onClose: () => void;
  theme: string;
  title: string;
  titleId: string;
  systemLabel: string;
  children: ReactNode;
  footer?: ReactNode;
  initialOffset?: { x: number; y: number };
  className?: string;
  bodyClassName?: string;
};

/**
 * A deliberately modeless child window. It never renders a full-page backdrop,
 * never traps focus and therefore leaves the Reader usable while one or more
 * tool windows remain open.
 */
export default function FloatingWindow({
  isOpen,
  onClose,
  theme,
  title,
  titleId,
  systemLabel,
  children,
  footer,
  initialOffset = { x: 48, y: 36 },
  className = '',
  bodyClassName = '',
}: FloatingWindowProps) {
  const windowRef = useRef<HTMLElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const userPositioned = useRef(false);
  const [offset, setOffset] = useState(initialOffset);
  const [size, setSize] = useState<FloatingSize | null>(null);
  const [zIndex, setZIndex] = useState(70);
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => () => cleanupRef.current?.(), []);

  const raise = useCallback(() => {
    const next = Number(document.documentElement.dataset.magiWindowZ || '70') + 1;
    document.documentElement.dataset.magiWindowZ = String(next);
    setZIndex(next);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const node = windowRef.current;
    if (!node) return;
    userPositioned.current = false;
    let frame = 0;
    const constrain = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        // Initial placement/retrieval only. Content changes, rotation, theme
        // changes and minimizing must never undo a deliberate off-stage drag.
        if (userPositioned.current) return;
        const rect = node.getBoundingClientRect();
        setOffset(current => {
          const next = clampFloatingPoint(current, rect.width, rect.height, floatingBounds(node), 0);
          return next.x === current.x && next.y === current.y ? current : next;
        });
      });
    };
    const observer = new ResizeObserver(constrain);
    observer.observe(node);
    window.addEventListener('resize', constrain);
    window.visualViewport?.addEventListener('resize', constrain);
    window.visualViewport?.addEventListener('scroll', constrain);
    const reveal = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== titleId) return;
      cleanupRef.current?.();
      userPositioned.current = false;
      setIsCompact(false);
      // A viewport may have shrunk while this window was parked.
      const bounds = floatingBounds(node);
      setSize(current => current ? resizeFloatingSize(current, { x: 0, y: 0 }, bounds) : null);
      raise();
      constrain();
    };
    window.addEventListener(FLOATING_WINDOW_REVEAL, reveal);
    constrain();
    return () => {
      cleanupRef.current?.();
      observer.disconnect();
      window.removeEventListener('resize', constrain);
      window.visualViewport?.removeEventListener('resize', constrain);
      window.visualViewport?.removeEventListener('scroll', constrain);
      window.removeEventListener(FLOATING_WINDOW_REVEAL, reveal);
      window.cancelAnimationFrame(frame);
    };
  }, [isOpen, raise, titleId]);

  const startDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      (event.pointerType === 'mouse' && event.button !== 0)
      || (event.target as HTMLElement).closest('button, a, input')
    ) return;
    const node = windowRef.current;
    if (!node) return;
    event.preventDefault();
    raise();
    cleanupRef.current?.();
    userPositioned.current = true;
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);
    const origin = { x: event.clientX, y: event.clientY, left: offset.x, top: offset.y };
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      setOffset(moveFloatingPoint({ x: origin.left, y: origin.top }, {
        x: moveEvent.clientX - origin.x, y: moveEvent.clientY - origin.y,
      }));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      handle.removeEventListener('lostpointercapture', stop);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      cleanupRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
    handle.addEventListener('lostpointercapture', stop, { once: true });
    cleanupRef.current = stop;
  }, [raise, offset]);

  const startResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const node = windowRef.current;
    if (!node) return;
    event.preventDefault();
    event.stopPropagation();
    raise();
    cleanupRef.current?.();
    userPositioned.current = true;
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);
    const rect = node.getBoundingClientRect();
    const origin = { x: event.clientX, y: event.clientY };
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      setSize(resizeFloatingSize(rect, {
        x: moveEvent.clientX - origin.x, y: moveEvent.clientY - origin.y,
      }, floatingBounds(node)));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      handle.removeEventListener('lostpointercapture', stop);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      cleanupRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
    handle.addEventListener('lostpointercapture', stop, { once: true });
    cleanupRef.current = stop;
  }, [raise]);

  if (!isOpen) return null;

  const style = {
    '--magi-window-x': `${offset.x}px`,
    '--magi-window-y': `${offset.y}px`,
    ...(size ? { '--magi-window-width': `${size.width}px`, '--magi-window-height': `${size.height}px` } : {}),
    zIndex,
  } as CSSProperties;
  const surfaceTheme = isNightTheme(theme) ? 'dark' : theme;
  const palette = surfaceTheme === 'paper'
    ? 'magi-floating-window-paper'
    : surfaceTheme === 'light'
      ? 'magi-floating-window-light'
      : `magi-floating-window-${surfaceTheme}`;
  const bodyId = `${titleId}-body`;

  const closeWindow = () => {
    setIsCompact(false);
    onClose();
  };

  return (
    <section
      ref={windowRef}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-modeless="true"
      data-theme={surfaceTheme}
      data-reader-theme={theme}
      data-window-state={isCompact ? 'compact' : 'open'}
      data-user-sized={size ? 'true' : undefined}
      className={`magi-floating-window ${palette} ${className}`}
      style={style}
      onPointerDown={raise}
    >
      <div className="magi-floating-window-titlebar" onPointerDown={startDrag}>
        <div className="min-w-0">
          <div className="magi-floating-window-system-label">{systemLabel}</div>
          <h2 id={titleId} className="magi-floating-window-title">{title}</h2>
        </div>
        <div className="magi-retro-window-controls">
          <button
            type="button"
            aria-label={`${isCompact ? '还原' : '缩小'}${title}`}
            aria-controls={bodyId}
            aria-pressed={isCompact}
            title={isCompact ? '还原窗口' : '缩小窗口'}
            onClick={() => setIsCompact((current) => !current)}
            className="magi-retro-window-minimize"
          >
            {isCompact
              ? <Square aria-hidden="true" size={12} strokeWidth={2.2} />
              : <Minus aria-hidden="true" size={17} strokeWidth={2.6} />}
          </button>
          <button
            type="button"
            aria-label={`关闭${title}`}
            title="关闭"
            onClick={closeWindow}
            className="magi-retro-window-close"
          >
            <X aria-hidden="true" size={18} strokeWidth={2.4} />
          </button>
        </div>
      </div>
      <div id={bodyId} className={`magi-floating-window-body ${bodyClassName}`}>
        {children}
      </div>
      {footer && <div className="magi-floating-window-footer">{footer}</div>}
      {!isCompact && <button
        type="button"
        className="magi-floating-window-resize"
        aria-label={`调整${title}大小`}
        title="拖动调整大小；方向键微调，Shift 加速"
        onPointerDown={startResize}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          const node = windowRef.current;
          if (!node) return;
          event.preventDefault();
          userPositioned.current = true;
          const step = event.shiftKey ? 10 : 1;
          setSize(resizeFloatingSize(node.getBoundingClientRect(), {
            x: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
            y: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0,
          }, floatingBounds(node)));
        }}
      ><span aria-hidden="true">◢</span></button>}
    </section>
  );
}
