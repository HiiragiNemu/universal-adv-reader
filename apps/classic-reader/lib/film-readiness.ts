/** Wait for the mounted surface, not a detached preload of the same URL. */
export function waitForFilmSurface(root: HTMLElement): Promise<void> {
  if (root.dataset.filmReady === 'true') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = () => {
      if (root.dataset.filmReady !== 'true') return;
      clearTimeout(timer); root.removeEventListener('magi-film-ready', finish); resolve();
    };
    const timer = setTimeout(() => {
      root.removeEventListener('magi-film-ready', finish);
      reject(new Error('Mounted glass surface did not finish decoding'));
    }, 20000);
    root.addEventListener('magi-film-ready', finish);
    finish();
  });
}
