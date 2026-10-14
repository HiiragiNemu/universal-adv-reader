type BrowserIdentity = { userAgent: string; platform: string; maxTouchPoints: number };

/** Include iOS Chrome and desktop-mode iPad, but leave Android and desktop alone. */
export function usesIOSOptics(browser: BrowserIdentity): boolean {
  return /AppleWebKit/.test(browser.userAgent) &&
    (/iPhone|iPad|iPod/.test(browser.userAgent) ||
      (browser.platform === 'MacIntel' && browser.maxTouchPoints > 1));
}

/** Split at the existing signal/light boundary. Do not change any optical value.
 * WebKit's combined reference graph can magnify/crop the viewport at this depth.
 * Two bounded passes preserve registration, beam, displacement and all scatter
 * radii, while giving the light pass a fresh viewport-sized SourceGraphic.
 */
export function splitOpticalFilter(original: SVGFilterElement, prefix: string) {
  const split = Array.from(original.children).findIndex(node => node.getAttribute('result') === 'emissionKey');
  if (split < 1) return null;
  const signal = original.cloneNode(true) as SVGFilterElement;
  const light = original.cloneNode(true) as SVGFilterElement;
  signal.id = `${prefix}-signal`;
  light.id = `${prefix}-light`;
  Array.from(signal.children).slice(split).forEach(node => node.remove());
  Array.from(light.children).slice(0, split).forEach(node => node.remove());
  light.querySelectorAll('[in],[in2]').forEach(node => {
    for (const attribute of ['in', 'in2']) {
      if (node.getAttribute(attribute) === 'tubeSignal') node.setAttribute(attribute, 'SourceGraphic');
    }
  });
  return { signal, light };
}
