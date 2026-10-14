type ScopeRoot = Pick<HTMLElement, 'dataset'>;
const owners = new WeakMap<ScopeRoot, number>();

/** Explicit route ownership avoids a document-wide :has() scope check for
 * every retained Reader rule and every Home element in WebKit. */
export function acquireReaderStyleScope(root: ScopeRoot) {
  owners.set(root, (owners.get(root) ?? 0) + 1);
  root.dataset.readerStyleScope = 'true';
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (owners.get(root) ?? 1) - 1;
    if (remaining > 0) owners.set(root, remaining);
    else {
      owners.delete(root);
      delete root.dataset.readerStyleScope;
    }
  };
}
