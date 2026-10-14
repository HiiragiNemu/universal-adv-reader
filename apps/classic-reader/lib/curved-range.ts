export function lensSourcePoint(x: number, y: number, box: { left: number; top: number; width: number; height: number }, scale: number) {
  const nx = (x - box.left) / box.width * 2 - 1;
  const ny = (y - box.top) / box.height * 2 - 1;
  const radius = nx * nx + ny * ny;
  // Same sRGB displacement field as ReaderTubeSurface, including its neutral
  // 128/255 offset. This maps a visible pixel back to its unwarped input hit.
  return { x: x + scale * ((128 + nx * radius * 45) / 255 - .5),
    y: y + scale * ((128 + ny * radius * 45) / 255 - .5) };
}
