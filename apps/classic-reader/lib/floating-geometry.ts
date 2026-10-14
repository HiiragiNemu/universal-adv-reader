export type FloatingPoint = { x: number; y: number };
export type FloatingBounds = { left: number; top: number; width: number; height: number };
export type FloatingSize = { width: number; height: number };

/** A deliberate user drag is not bounded by the viewport. */
export function moveFloatingPoint(origin: FloatingPoint, delta: FloatingPoint): FloatingPoint {
  return { x: origin.x + delta.x, y: origin.y + delta.y };
}

/** SE resizing keeps the top-left corner fixed, including when it is off-screen. */
export function resizeFloatingSize(size: FloatingSize, delta: FloatingPoint, bounds: FloatingBounds): FloatingSize {
  const maxWidth = Math.max(1, bounds.width);
  const maxHeight = Math.max(1, bounds.height);
  return {
    width: Math.min(maxWidth, Math.max(Math.min(240, maxWidth), size.width + delta.x)),
    height: Math.min(maxHeight, Math.max(Math.min(160, maxHeight), size.height + delta.y)),
  };
}

export function clampFloatingPoint(point: FloatingPoint, width: number, height: number, bounds: FloatingBounds, margin = 16): FloatingPoint {
  const xEdge = Math.min(margin, Math.max(0, (bounds.width - width) / 2));
  const yEdge = Math.min(margin, Math.max(0, (bounds.height - height) / 2));
  return {
    x: Math.max(bounds.left + xEdge, Math.min(point.x, bounds.left + bounds.width - width - xEdge)),
    y: Math.max(bounds.top + yEdge, Math.min(point.y, bounds.top + bounds.height - height - yEdge)),
  };
}

/** Convert the visible viewport into the filtered display's local coordinates. */
export function floatingBounds(node: HTMLElement): FloatingBounds {
  const root = node.closest<HTMLElement>('#magi-reader-display,#magi-home-display');
  const rect = root?.getBoundingClientRect();
  const viewport = window.visualViewport;
  return {
    left: Math.max(0, (viewport?.offsetLeft ?? 0) - (rect?.left ?? 0)),
    top: Math.max(0, (viewport?.offsetTop ?? 0) - (rect?.top ?? 0)),
    width: Math.min(root?.clientWidth || window.innerWidth, viewport?.width ?? window.innerWidth),
    height: Math.min(root?.clientHeight || window.innerHeight, viewport?.height ?? window.innerHeight),
  };
}
