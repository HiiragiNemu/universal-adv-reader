/** One static painted surface; no per-line nodes, resize listener or filters. */
export default function ScanlineSurface({ variant = 'optional' }: { variant?: 'night' | 'optional' }) {
  return <span className="magi-screen-scanlines" data-scanline-profile={variant} aria-hidden="true" />;
}
