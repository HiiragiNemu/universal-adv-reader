'use client';

import { useLayoutEffect, useRef } from 'react';
import { usesIOSOptics } from '@/lib/ios-optics';
import { startIOSOpticsDiagnostics } from '@/lib/ios-optics-diagnostics';

/** iOS uses one native flat optical pass. Never install SVG displacement or
 * registration graphs around asynchronously scrolling content on this path. */
export default function IOSOpticalPipeline({ theme }: {
  theme: string; curvature: boolean; registration: boolean; scale: number; profile: string;
}) {
  const marker = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!usesIOSOptics(navigator)) return;
    const root = marker.current?.closest<HTMLElement>('#magi-home-display,#magi-reader-display,.magi-review-theme');
    if (!root) return;
    root.dataset.iosOptics = 'flat';
    const stopDiagnostics = startIOSOpticsDiagnostics(root);
    return () => { stopDiagnostics(); delete root.dataset.iosOptics; };
  }, [theme]);
  return <span ref={marker} hidden aria-hidden="true" />;
}
