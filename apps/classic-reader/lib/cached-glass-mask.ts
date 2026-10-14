/** Cache only the static scratch mask on Chromium. The live scene,
 * refraction offset, lens, emission and every optical strength stay unchanged. */
export const usesCachedGlassMask = (userAgent: string) => /(?:Chrome|Chromium|Edg)\//.test(userAgent);

// SVG displacement samples at x + scale * (R - .5), y + scale * (G - .5).
// Luminance-mask alpha selects a +1.5 / -.6 px refracted image without cutting
// transparent holes in the original scene. Outside scratches, R = G = .5.
export const GLASS_REFRACTION_SCALE = 4;
export const GLASS_REFRACTION_MATRIX = '0 0 0 -.375 .5  0 0 0 .15 .5  0 0 0 0 .5  0 0 0 0 1';

export function glassMaskSize(width: number, height: number, dpr: number) {
  if (![width, height, dpr].every(n => Number.isFinite(n) && n > 0)) return null;
  // Pad only the last partial device pixel, never round DPR or stretch the
  // viewport to an integer pixel count. feImage uses that same padded extent.
  return { width, height, dpr, pixelWidth: Math.ceil(width * dpr), pixelHeight: Math.ceil(height * dpr) };
}
type Size = NonNullable<ReturnType<typeof glassMaskSize>>;

/** Preserve the original texture's normalized coordinates during chrome resize.
 * The old native-resolution mask stays usable until the replacement is decoded. */
export function glassMaskExtent(previous: Size, next: Size) {
  return {
    width: previous.pixelWidth / previous.dpr * next.width / previous.width,
    height: previous.pixelHeight / previous.dpr * next.height / previous.height,
  };
}

export function glassMaskSvg(size: Size, imageData: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size.pixelWidth}" height="${size.pixelHeight}" viewBox="0 0 ${size.pixelWidth / size.dpr} ${size.pixelHeight / size.dpr}"><defs><filter id="mask" filterUnits="userSpaceOnUse" x="0" y="0" width="${size.width}" height="${size.height}" color-interpolation-filters="sRGB"><feImage href="${imageData}" x="0" y="0" width="${size.width}" height="${size.height}" preserveAspectRatio="none" result="scratchMap"/><feColorMatrix in="scratchMap" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  .2126 .7152 .0722 0 0" result="scratchMask"/><feMorphology in="scratchMask" operator="dilate" radius=".6"/></filter></defs><rect width="${size.width}" height="${size.height}" filter="url(#mask)"/></svg>`;
}

async function renderMask(size: Size, data: string) {
  const svgUrl = URL.createObjectURL(new Blob([glassMaskSvg(size, data)], { type: 'image/svg+xml' }));
  let pngUrl = '';
  const canvas = document.createElement('canvas');
  try {
    const svg = new Image(); svg.src = svgUrl; await svg.decode();
    canvas.width = size.pixelWidth; canvas.height = size.pixelHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Glass mask canvas unavailable');
    context.drawImage(svg, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob =>
      blob ? resolve(blob) : reject(new Error('Glass mask raster failed')), 'image/png'));
    pngUrl = URL.createObjectURL(png);
    const image = new Image(); image.src = pngUrl; await image.decode();
    return { url: pngUrl, image };
  } catch (error) {
    if (pngUrl) URL.revokeObjectURL(pngUrl);
    throw error;
  } finally {
    URL.revokeObjectURL(svgUrl);
    canvas.width = canvas.height = 0;
  }
}

/** One active native-resolution mask per mounted surface, no scroll/pointer work.
 * Keep that mask throughout browser-chrome resize; swap only after the new
 * native-resolution mask is decoded. Never reintroduce live morphology while
 * scrolling. Generations prevent stale decodes from replacing the active mask. */
export function startCachedGlassMask(root: HTMLElement, original: SVGFilterElement, ready: () => void = () => {}) {
  if (!usesCachedGlassMask(navigator.userAgent)) { ready(); return () => {}; }
  const property = '--magi-frost-glass-filter';
  const base = root.style.getPropertyValue(property);
  let stopped = false, generation = 0, timer = 0;
  let sizeKey = '', clone: SVGFilterElement | null = null;
  let resource: Awaited<ReturnType<typeof renderMask>> | null = null;
  let resourceSize: Size | null = null;
  const abort = new AbortController();
  const source = fetch('/textures/frost-glass-scratches.png', { signal: abort.signal })
    .then(response => { if (!response.ok) throw new Error('Glass source fetch failed'); return response.blob(); })
    .then(blob => new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
    }));
  // Fetch can reject while the initial resize is still settling.
  void source.catch(() => {});
  const restore = () => {
    if (clone && root.style.getPropertyValue(property) === `url(#${clone.id})`)
      root.style.setProperty(property, base);
    clone?.remove(); clone = null;
    if (resource) URL.revokeObjectURL(resource.url);
    resource = null; resourceSize = null;
    delete root.dataset.glassMaskCache;
  };
  const prepare = async (size: Size, token: number) => {
    try {
      const data = await source;
      if (stopped || token !== generation) return;
      const next = await renderMask(size, data);
      if (stopped || token !== generation) { URL.revokeObjectURL(next.url); return; }
      const cached = original.cloneNode(true) as SVGFilterElement;
      cached.id = `${original.id}-cached-${token}`;
      cached.children[0].setAttribute('href', next.url);
      cached.children[0].setAttribute('result', 'crackZone');
      cached.children[0].setAttribute('width', String(size.pixelWidth / size.dpr));
      cached.children[0].setAttribute('height', String(size.pixelHeight / size.dpr));
      cached.children[2].remove(); cached.children[1].remove();
      original.parentNode!.appendChild(cached);
      const previousClone = clone, previousResource = resource;
      clone = cached; resource = next; resourceSize = size;
      root.style.setProperty(property, `url(#${cached.id})`);
      root.dataset.glassMaskCache = `${size.pixelWidth}x${size.pixelHeight}`;
      // Publish the ready replacement before releasing its predecessor. A
      // failed/stale raster leaves the last valid graph and image untouched.
      previousClone?.remove();
      if (previousResource) URL.revokeObjectURL(previousResource.url);
      ready();
    } catch {
      // First mount retains the original; resizing retains the last valid mask.
      if (!stopped && token === generation) ready();
    }
  };
  const resize = () => {
    const size = glassMaskSize(root.offsetWidth, root.offsetHeight, window.devicePixelRatio);
    if (!size) {
      sizeKey = ''; generation++; clearTimeout(timer); return;
    }
    const key = `${size.width}:${size.height}:${size.dpr}`;
    if (key === sizeKey) return;
    sizeKey = key; const token = ++generation;
    clearTimeout(timer);
    if (clone && resourceSize) {
      const extent = glassMaskExtent(resourceSize, size);
      clone.children[0].setAttribute('width', String(extent.width));
      clone.children[0].setAttribute('height', String(extent.height));
    }
    // Browser-chrome height animation must not launch a raster job every frame.
    timer = window.setTimeout(() => { void prepare(size, token); }, 120);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(root); window.addEventListener('resize', resize); resize();
  return () => {
    stopped = true; generation++; clearTimeout(timer); abort.abort();
    observer.disconnect(); window.removeEventListener('resize', resize); restore();
  };
}
