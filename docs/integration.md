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

No archive bytes are copied into this Reader repository. Local development mounts the resource repository read-only at `/corpus/`; production may provide the same URL contract with a static origin or CDN.

## Engine adapters

Current:

```text
majiro-production-v1 + adv-story/majiro-v1
  normalized Narcissu Majiro stories with vn-mjo-reader-script/v1 provenance
```

Planned as a distinct boundary:

```text
ikura-production-v1 + adv-story/ikura-v1
  KANA script conversion
```

Registering an adapter ID or source format before its exact implementation is present makes loading fail closed.

## UI shell migration

The UI shell catalog is served from `/apps/web/.well-known/ui-shells.json`. `classic` is inherited, stable, and default. `next` is experimental and declares `requiresManualAcceptance: true`. Both shells use `ui-shell/1.0.0`; `?ui=next` is non-persistent, auto-promotion is disabled, and changing the default requires a separately recorded human acceptance.
