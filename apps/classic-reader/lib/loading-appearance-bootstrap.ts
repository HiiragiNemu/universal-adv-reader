// Parser-time display preferences. Do not defer this behind the Next runtime:
// that would reveal the server's paper fallback while its JS is downloading.
// Only validated display values reach data attributes; storage is read-only.
export const loadingAppearanceBootstrap = `(() => {
  const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const parse = (value) => { try { return JSON.parse(value || '{}') || {}; } catch { return {}; } };
  const saved = read('magi_theme');
  const theme = ['paper', 'light', 'green', 'dark', 'frost'].includes(saved) ? saved : 'paper';
  const preferences = parse(read('magi-reader-display-preferences-v1'));
  const effects = parse(read('magi-screen-effects-v1'));
  const root = document.documentElement;
  const ios = typeof navigator !== 'undefined' && /AppleWebKit/.test(navigator.userAgent) &&
    (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  root.dataset.iosFlat = String(ios);
  root.dataset.loadingTheme = theme;
  root.dataset.loadingPhosphor = preferences.nightPhosphor === 'amber' ? 'amber' : 'green';
  root.dataset.loadingScanlines = theme === 'dark' || effects[theme]?.scanlines === true ? 'on' : 'off';
  const night = theme === 'dark';
  const selected = effects[theme] || {};
  const flag = (key) => selected[key] === true;
  const nightPixel = preferences.nightPhosphor === 'amber'
    ? preferences.nightPixelFontEnabled !== false : preferences.nightGreenPixelFontEnabled === true;
  root.dataset.readerTheme = theme;
  root.dataset.nightPhosphor = root.dataset.loadingPhosphor;
  root.dataset.screenCurvature = String(!ios && (night || flag('curvature')));
  root.dataset.screenScanlines = String(night || flag('scanlines'));
  root.dataset.screenNoise = String(night || flag('noise'));
  root.dataset.screenRegistration = String(night || (typeof selected.registration === 'boolean' ? selected.registration : ['light', 'paper', 'green', 'frost'].includes(theme)));
  root.dataset.screenGlassDamage = String(selected.glassDamage === true);
  root.dataset.screenPixelFont = String(night ? nightPixel : flag('pixelFont'));
  root.dataset.nightPixelFont = root.dataset.screenPixelFont;
  root.dataset.nameColors = String(preferences.nameColorsEnabled !== false);
  root.classList.toggle('dark', night || theme === 'frost');
  // Keep the themed background, but never expose a clean logo while its
  // material images/filter inputs are still in flight. This starts before Next.
  if (typeof Image === 'undefined') return;
  const key = [theme, root.dataset.screenCurvature, root.dataset.screenNoise, root.dataset.screenPixelFont, root.dataset.screenGlassDamage].join(':');
  root.dataset.loadingAssetsKey = key;
  root.dataset.loadingAssets = 'pending';
  const urls = [];
  if (root.dataset.screenCurvature === 'true') urls.push('/textures/magi-tube-lens-512.png');
  if (root.dataset.screenNoise === 'true') urls.push('/textures/stories-untold/NoiseAndGrain.png', '/textures/magi-lofi-grain.png');
  if (night) urls.push('/textures/stories-untold/PixelOverlay_RGB_16.png');
  if (['light', 'paper', 'green'].includes(theme)) urls.push('/textures/paper-fibres-4192.svg');
  if (theme === 'frost') {
    urls.push('/textures/magi-lofi-grain.png', '/textures/frost-phosphor-ink-mask.svg', '/textures/stories-untold/DirtHighContrast.png', '/textures/stories-untold/2k_BG_Texture.png');
    if (root.dataset.screenGlassDamage !== 'false') urls.push('/textures/frost-glass-scratches.png');
  }
  const images = [];
  const load = async (url) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const image = new Image(); images.push(image); image.src = url;
      let timer;
      try {
        const decoded = (async () => { await image.decode(); })();
        if (typeof setTimeout === 'function') {
          await Promise.race([decoded, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(url)), 15000); })]);
        } else await decoded;
        return;
      }
      catch { if (attempt === 1) throw new Error(url); }
      finally { if (timer !== undefined) clearTimeout(timer); }
    }
  };
  // The blocking stylesheets precede this script. Waiting for DOMContentLoaded
  // would also wait for deferred app chunks, defeating the early loader.
  // The wordmark is SVG; ASCII loading status uses a local monospace face.
  // Optional full CJK fonts belong to the reading-page readiness gate only.
  Promise.all([...new Set(urls)].map(load)).then(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (root.dataset.loadingAssetsKey === key) root.dataset.loadingAssets = 'ready';
    }));
  }).catch(error => {
    if (root.dataset.loadingAssetsKey !== key) return;
    root.dataset.loadingAssets = 'error';
    root.dataset.loadingFailedAsset = error.message;
  });
})();`;
