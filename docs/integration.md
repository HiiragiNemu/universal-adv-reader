# Integration contract

## Deep link

The Reader accepts:

```text
/apps/web/?canonicalStoryId=...&variantId=...&sectionId=...&eventId=...
          &storyRevision=...&catalogRevision=...&bridgeRevision=adv-app-bridge-1
```

Unknown parameters are ignored. Invalid stable identifiers are rejected rather than repaired. If a revision differs, the Reader may open the story or section, but exact event synchronization is reported as degraded.

## App manifest

The reference manifest is served from:

```text
/apps/web/.well-known/adv-app.json
```

A deployment may additionally expose the same bytes at `/.well-known/adv-app.json`.

The manifest declares roles, bridge version, deep-link template, lifecycle, adapter IDs and feature selectors. Provider selection must check `adapterIds`, `sourceFormats` and required features in addition to the generic `scenario` kind.

## MessagePort handshake

Parent to iframe:

```js
const channel = new MessageChannel();
iframe.contentWindow.postMessage({
  channel: 'adv-app-bridge',
  version: 1,
  type: 'connect',
  requestId: crypto.randomUUID(),
}, trustedReaderOrigin, [channel.port2]);
```

The Reader verifies `event.origin`, attaches only the transferred port and answers with `connected`. Requests use:

```json
{
  "channel": "adv-app-bridge",
  "version": 1,
  "type": "request",
  "requestId": "...",
  "action": "story.open",
  "payload": {
    "canonicalStoryId": "demo/arrival",
    "sectionId": "prologue",
    "eventId": "line-001"
  }
}
```

Responses echo `requestId`. Location changes are emitted as `story.location` events.

## Resource repository handoff

The future handoff from `narcissu-kana-research` must publish, per corpus:

1. a corpus/catalog record;
2. one declared adapter ID and source format;
3. normalized story documents with every text/choice/branch;
4. media manifests mapping image/audio/video IDs to deployable URLs;
5. unresolved cue records rather than guessed links;
6. a source revision and a reproducible verification report.

No archive bytes are copied into this Reader repository.

## Planned engine adapters

These IDs are reserved only in documentation until evidence-backed implementations exist:

```text
majiro-mjo-v1     Narcissu 10th and Narcissu 3 script conversion
ikura-isf-v1      KANA script conversion
```

Registering either ID in a corpus before its adapter is present makes loading fail closed.
