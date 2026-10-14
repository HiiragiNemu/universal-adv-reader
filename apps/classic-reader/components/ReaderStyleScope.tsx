'use client';

import { useInsertionEffect } from 'react';
import { acquireReaderStyleScope } from '@/lib/reader-style-scope';

/** Activate the existing Reader rules before any layout measurements/paint.
 * Mounted only with a real Reader scene; portals share the document scope. */
export default function ReaderStyleScope() {
  useInsertionEffect(() => acquireReaderStyleScope(document.documentElement), []);
  return null;
}
