/** Isolate filter definitions from their own filtered SourceGraphic. Only the
 * SVG graph is cloned, never live content. Bound EVERY primitive to the same
 * CSS-pixel viewport; DPR and optical strengths remain the browser's originals. */
export function boundViewportFilter(filter: SVGFilterElement, width: number, height: number) {
  if (!(width > 0 && height > 0)) return;
  filter.setAttribute('filterUnits', 'userSpaceOnUse');
  filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
  for (const node of [filter, ...Array.from(filter.children)]) {
    node.setAttribute('x', '0'); node.setAttribute('y', '0');
    node.setAttribute('width', String(width)); node.setAttribute('height', String(height));
  }
}

export function mountViewportFilter(root: HTMLElement, source: SVGFilterElement, property: string) {
  const ns = 'http://www.w3.org/2000/svg';
  const host = document.createElementNS(ns, 'svg');
  host.setAttribute('width', '0'); host.setAttribute('height', '0');
  host.setAttribute('aria-hidden', 'true'); host.dataset.viewportFilter = source.id;
  host.style.cssText = 'position:absolute;pointer-events:none;overflow:hidden';
  const defs = document.createElementNS(ns, 'defs'); host.appendChild(defs);
  const filter = source.cloneNode(true) as SVGFilterElement;
  filter.id = `${source.id}-viewport`;
  defs.appendChild(filter); document.body.appendChild(host);
  const previous = root.style.getPropertyValue(property);
  const resize = () => {
    // Include an Android decoded-mask successor, if present. Its feImage extent
    // is maintained separately by the cache and must not be rounded or cropped.
    for (const child of Array.from(defs.children)) {
      const image = child.id.includes('-cached-') ? child.firstElementChild : null;
      const extent = image && [image.getAttribute('width'), image.getAttribute('height')];
      boundViewportFilter(child as SVGFilterElement, root.clientWidth, root.clientHeight);
      if (image && extent) {
        image.setAttribute('width', extent[0]!); image.setAttribute('height', extent[1]!);
      }
    }
  };
  resize();
  root.style.setProperty(property, `url(#${filter.id})`);
  const observer = new ResizeObserver(resize); observer.observe(root);
  return { filter, dispose: () => {
    observer.disconnect();
    if (root.style.getPropertyValue(property).includes(filter.id)) {
      if (previous) root.style.setProperty(property, previous); else root.style.removeProperty(property);
    }
    host.remove();
  } };
}
