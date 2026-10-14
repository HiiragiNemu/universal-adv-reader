'use client';

import type { ReactNode } from 'react';

/** V3 was rejected on physical iPhone: stable optics but severely worse scroll
 * latency. Keep the boundary transparent, including already-open trial URLs.
 * The rejected implementation/evidence is preserved in the delivery checkpoint.
 */
export default function IOSViewportHost({ children }: { children: ReactNode }) {
  return children;
}
