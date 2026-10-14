'use client';

import type { ReactNode } from 'react';

/** Physical iPhone rejected the header-only foreignObject trial on Sept 20:
 * controls still bypass the viewport filter. Old URLs/storage must not revive
 * it. Keep this boundary transparent, like the withdrawn full-viewport V3. */
export default function IOSHeaderSurface({ children }: { children: ReactNode; layer: number }) {
  return children;
}
