'use client';

import { useGlobal } from '@/app/providers';
import { ReaderFilmSurface, ReaderTubeSurface } from '@/components/RetroDisplaySurface';
import '../home-optical-refinements.css';
import './review-theme.css';

// The global provider persists through navigation from home and Reader.
// Review pages never initialize or overwrite the selected theme.
export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  const { theme } = useGlobal();
  return (
    <div className="magi-review-theme" data-reader-theme={theme}>
      {theme === 'frost' && <ReaderFilmSurface />}
      {theme === 'dark' && <ReaderTubeSurface />}
      <div className="magi-review-content">{children}</div>
    </div>
  );
}
