# Classic-only UI boundary

The current user-assigned UI implementation is the retained `apps/classic-reader`
Classic inheritance, confirmed by the 2026-08-23 source-inheritance evidence and
the 2026-10-12 continuation. It is not a newly introduced UI architecture.

`apps/web` and `tools/serve.mjs` remain preserved historical regression fixtures.
The old statement naming only `apps/web` predates the retained Classic app.
The rejected experimental/Next *UI design* is not revived; the existing Classic
implementation already uses the Next.js framework.

Run the current UI with `npm run serve:classic` (loopback port 4176 by default).
Reader source authority is commit
`56309ca742130e36d8d10fdb4f72de2a04cda02a`, accessed through `git show`, not dirty
reference files. Resource manifests and media stay read-only in the research
repository. Local UI work does not authorize a remote publication.

Full continuation scope is GEN-01 through GEN-16 in
`reports/verification/reader-inheritance-20261012/ledger.json`.
Implementation, tests, integration, local operation and user acceptance remain
separate. A successful build or HTTP response is not visual acceptance.
