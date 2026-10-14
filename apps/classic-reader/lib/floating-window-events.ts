export const FLOATING_WINDOW_REVEAL = 'magi:reveal-floating-window';

/** An already-open, parked window can be retrieved from its original launcher. */
export function revealFloatingWindow(titleId: string): void {
  window.dispatchEvent(new CustomEvent(FLOATING_WINDOW_REVEAL, { detail: titleId }));
}
