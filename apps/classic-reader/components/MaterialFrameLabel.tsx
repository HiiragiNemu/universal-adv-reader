/** Local 4192 study. Frame identifiers describe the real current story/page. */
export default function MaterialFrameLabel({ theme, story, page, pages, direction, sequence }: {
  theme: string; story: string; page: number; pages: number;
  direction: 'next' | 'prev' | null; sequence: number;
}) {
  if (theme === 'dark') return null;
  const film = theme === 'frost';
  return <div className="magi-material-ledger" data-material={film ? 'film' : 'paper'}>
    <span>{film ? 'MF · ARCHIVE' : 'ARCHIVE · DOCUMENT'} <b>{story}</b></span>
    <span>{film ? 'FRAME' : 'FOLIO'} {String(page + 1).padStart(3, '0')} / {String(pages).padStart(3, '0')}</span>
    {film && direction && <i key={sequence} className="magi-material-film-gate" data-direction={direction} aria-hidden="true" />}
  </div>;
}
