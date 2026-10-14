/** Read-only, opt-in physical-device evidence. Never walk styles during a gesture.
 * No text, input values, story IDs, storage contents or screenshots are sent. */
export function startIOSOpticsDiagnostics(root: HTMLElement) {
  if (process.env.NODE_ENV !== 'development' ||
      new URLSearchParams(location.search).get('opticsDebug') !== '1') return () => {};
  let timer = 0;
  let reports = 0;
  let scrollEvents = 0;
  let viewportEvents = 0;
  let stopped = false;
  const started = Date.now();
  const label = (el: Element) => `${el.tagName.toLowerCase()}#${el.id}.${Array.from(el.classList).join('.')}`.slice(0, 220);
  const snapshot = (reason: string) => {
    if (stopped || reports >= 6) return;
    reports++;
    const candidates = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
    const layers = candidates.flatMap(el => {
      const style = getComputedStyle(el);
      if (style.display === 'none') return [];
      const scrollable = /(auto|scroll)/.test(style.overflowY + style.overflowX);
      if (el !== root && !scrollable && style.filter === 'none' &&
          style.backdropFilter === 'none' && style.transform === 'none' &&
          style.willChange === 'auto' && !['fixed', 'sticky'].includes(style.position)) return [];
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return [];
      return [{ element: label(el), rect: rect.toJSON(), filter: style.filter,
        backdrop: style.backdropFilter, transform: style.transform, position: style.position,
        overflow: [style.overflowX, style.overflowY], willChange: style.willChange,
        contain: style.contain, visibility: style.contentVisibility, scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }];
    }).slice(0, 90);
    const v = visualViewport;
    void fetch('/api/dev-optics', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 'ios-trace-1', started, at: Date.now(), reason,
        platform: navigator.platform, userAgent: navigator.userAgent, dpr: devicePixelRatio,
        route: root.id === 'magi-home-display' ? 'home' : 'reader',
        theme: document.documentElement.dataset.readerTheme, pipeline: root.dataset.iosOptics,
        host: root.closest('[data-ios-viewport-host]')?.getAttribute('data-ios-viewport-host') ?? 'html',
        ready: root.dataset.opticsReady, scrollEvents, viewportEvents,
        window: { width: innerWidth, height: innerHeight, scrollX, scrollY },
        viewport: v && { width: v.width, height: v.height, top: v.offsetTop, left: v.offsetLeft, scale: v.scale },
        layers }), keepalive: true }).catch(() => {});
  };
  const schedule = (reason: string) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => snapshot(reason), 1500);
  };
  const onScroll = () => { scrollEvents++; schedule('scroll-settled'); };
  const onViewport = () => { viewportEvents++; schedule('viewport-settled'); };
  root.addEventListener('scroll', onScroll, { capture: true, passive: true });
  visualViewport?.addEventListener('resize', onViewport, { passive: true });
  visualViewport?.addEventListener('scroll', onViewport, { passive: true });
  schedule('mounted');
  return () => {
    stopped = true;
    clearTimeout(timer);
    root.removeEventListener('scroll', onScroll, true);
    visualViewport?.removeEventListener('resize', onViewport);
    visualViewport?.removeEventListener('scroll', onViewport);
  };
}
