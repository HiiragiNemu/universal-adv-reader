# Local native Reader revisions

Run commands in `D:/PROGETTO/universal-adv-reader`. No remote, credential,
original game binary, MagiReader checkout or resource repository is written.

1. Download the native translation patch from the actual reader editor.
2. Stage a revision in a new data-artifact directory:

   ```powershell
   node D:/PROGETTO/universal-adv-reader/tools/stage-native-reader-revision.mjs --patch D:/PROGETTO/universal-adv-reader/work/translation.patch.json --output D:/PROGETTO/universal-adv-reader/work/translation-revision-001
   ```

3. Inspect `stage.json`, the original/parent ADV and source snapshots in
   `history/`, the versioned ADV, native TXT and generated search in `public/`.
   The stage contains derived data, not another checkout or implementation.
4. Install that local revision explicitly:

   ```powershell
   node D:/PROGETTO/universal-adv-reader/tools/stage-native-reader-revision.mjs --stage D:/PROGETTO/universal-adv-reader/work/translation-revision-001
   ```

5. Reload the reader/home to consume the new registry and search manifest.
   New editor patches bind the current revision, not the original baseline.
   Old-version patches are rejected; there is no automatic rebase.
6. Restore the previous local revision (latest-first if multiple were installed):

   ```powershell
   node D:/PROGETTO/universal-adv-reader/tools/stage-native-reader-revision.mjs --rollback D:/PROGETTO/universal-adv-reader/work/translation-revision-001
   ```

## Consumption and invariants

- Original CN/JP TXT, route documents and source sidecars remain immutable.
  Their hashes bind every revision. The active registry is
  `apps/classic-reader/public/native-reader-revisions.json`; immutable archives
  live under `apps/classic-reader/public/native-reader-revisions/`.
- The native event-key projection overlays only explicit Chinese fields on the
  existing alignment. An added Chinese line on a Japanese-only event does not
  replace a separate existing Chinese compiled variant. Unresolved native
  cross-version correspondences remain unresolved.
- Reading, edit initialization, subsequent patch import/export and search use
  the revised fields. An explicit empty speaker stays empty; it is not the
  legacy TXT serializer's narrator fallback. IKURA names derive from its message
  prefix, including newly named narrator messages.
- The “修订 CN” download is UTF-8 `native-reader-text/v1`: a header followed by
  JSON lines containing native keys, targets and exact text/name values. Embedded
  newlines/tabs and empty values round-trip through JSON. It is not legacy
  plain-text syntax and is not a patch import. Original CN/JP downloads remain
  separately available.
- A revision ADV document retains branches, media, source references and other
  locales. Its revision and provenance identify the parent and patch. This is
  **not a recompiled Majiro/IKURA game binary**.
- Search regeneration consumes the same keyed revision, preserves all 200
  visible stories (67/81/52), and stores new content-addressed chunks. The full
  materializer creates native source bindings before search and leaves revision
  archives outside its recreated `data/legacy-vn` tree. Source-version mismatch
  rejects an incompatible revision rather than silently applying it elsewhere.
- Install verifies original, stage and mutable-pointer hashes before writes.
  Immutable artifacts are installed first; the two index pointers last. Rollback
  verifies the current pointers, restores their exact previous bytes, and retains
  immutable revision history. A later/concurrent edit stops the operation.
- Tests use isolated data fixtures; their sample translations are not installed
  in active public content. Technical/HTTP checks do not constitute browser,
  audible playback or human translation acceptance. Remote submission remains
  unconfigured; no production credentials are reused.
