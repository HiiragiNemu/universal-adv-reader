# Architecture

## Repository boundary

```text
universal-adv-reader
  owns: Reader UI, AdvIR, navigation, voice controls, media resolution, bridge
  imports at runtime: prepared manifests and normalized story documents

narcissu-kana-research
  owns: original archives, extracted files, reverse-engineering evidence,
        engine-specific conversion and reproducible source manifests
```

The Reader never scans game directories and never guesses an engine from bytes. A corpus manifest must declare `adapterId` and `sourceFormat`; the adapter registry resolves that exact pair or stops.

## Layers

```text
apps/web
  Reader shell: catalog/sidebar, locale modes, timeline, choices, media controls

packages/contracts
  AdvIR and manifest validation

packages/core
  AdapterRegistry -> StoryDocument
  ReaderSession -> stable route state
  MediaResolverRegistry -> browser-ready URL or explicit unresolved result

packages/bridge
  canonical deep links
  MessagePort provider and lifecycle

packages/adapters
  one adapter per declared source format
```

## Stable identity

A visible position is never represented only by a line number.

```text
canonicalStoryId
+ variantId
+ sectionId
+ eventId
+ storyRevision
+ catalogRevision
```

Ordinals are display metadata. The bridge emits the stable location and may include an ordinal for progress bars.

## AdvIR event model

A section is a directed graph. Every event has a stable `eventId` and one of:

- `line`: multilingual speaker/text tracks;
- `choice`: every option and its target event;
- `action`: image, voice, BGM, SFX or video cues without required text;
- `end`: explicit route termination.

`nextEventId` is the default edge. Choice options contain named edges. Runtime validation checks that every edge resolves inside the section.

Media is never stored as an inferred URL on a line. A cue carries a raw `cueId`, role, timing and optional `mediaId`/`resolverId`. A resolver returns either a checked media record or an explicit unresolved result.

## Voice controls

Every story exposes one `语音路由` disclosure, even when its mapped voice count is zero. When expanded:

- a resolved cue can be played;
- an unresolved raw cue stays visible with its reason;
- a text event without a cue still receives a visible `待建立语音路由` slot.

This keeps the transcript compact while preserving an entry point for every story and every text event. Playback uses one primary voice channel; a new voice stops the old one, page suspension pauses it, and disposal releases it.

## Adapter rules

1. Select only the manifest-declared `adapterId`.
2. Validate `sourceFormat` before loading.
3. Never try another adapter after a parse error.
4. Preserve unknown source fields in adapter evidence, not by silently dropping them.
5. Produce stable event IDs before media binding.
6. Report unsupported features explicitly.

The initial `adv-ir-v1` adapter accepts already-normalized fixtures. Majiro and IKURA adapters are intentionally deferred until the Reader and bridge baseline passes.

## Bridge roles

The web app publishes these roles:

- `standalone-app`
- `plugin-host`
- `proxy-target`
- `action-provider`

The first integration surface is a deep link. Embedded mode uses a versioned `MessagePort` handshake with an explicit parent-origin allowlist. Supported actions are `story.open`, `story.getLocation`, `voice.play`, `lifecycle.suspend`, `lifecycle.resume`, and `lifecycle.dispose`.
