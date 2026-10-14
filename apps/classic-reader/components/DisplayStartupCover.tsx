'use client';

import { useSyncExternalStore } from 'react';
import LoadingScreen from '@/components/LoadingScreen';

// Observe the routed surface, not the cover itself. Once published, unmount the
// entire loader (materials, filter definitions, image decoders and observers).
const subscribe = (notify: () => void) => {
  const scope = document.querySelector('.magi-site-font-scope');
  if (!scope) return () => {};
  const observer = new MutationObserver(notify);
  observer.observe(scope, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-optics-ready'] });
  return () => observer.disconnect();
};
const alreadyCovered = () => !!document.querySelector('.magi-site-font-scope :is([data-optics-ready="true"],.magi-loading-screen,.magi-review-theme)');
const serverCovered = () => false;

export default function DisplayStartupCover() {
  const covered = useSyncExternalStore(subscribe, alreadyCovered, serverCovered);
  if (covered) return null;
  return <div className="magi-display-startup-cover">
    <LoadingScreen />
    <div className="magi-display-startup-error" role="alert">
      显示素材加载失败，请重试。
      <button type="button" onClick={() => window.location.reload()}>重新加载</button>
    </div>
  </div>;
}
