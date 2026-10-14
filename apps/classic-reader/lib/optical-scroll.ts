/** Invert the existing SVG lens for a source-space point. The lens moves paint,
 * not native hit boxes; interactive rails must use these visible coordinates. */
export function opticalPoint(x: number, y: number, width: number, height: number, scale: number) {
  let px = x, py = y;
  for (let i = 0; i < 12; i++) {
    const nx = px / width * 2 - 1, ny = py / height * 2 - 1;
    const radial = nx * nx + ny * ny;
    px = x - scale * (0.5 / 255 + nx * radial * 45 / 255);
    py = y - scale * (0.5 / 255 + ny * radial * 45 / 255);
  }
  return { x: px, y: py };
}

export function scrollThumb(viewport: number, content: number, track: number, scroll: number) {
  const maximum = Math.max(0, content - viewport);
  const length = Math.min(track, Math.max(32, track * viewport / Math.max(viewport, content)));
  const travel = track - length;
  return { maximum, length, travel, start: maximum ? Math.min(maximum, Math.max(0, scroll)) / maximum * travel : 0 };
}
