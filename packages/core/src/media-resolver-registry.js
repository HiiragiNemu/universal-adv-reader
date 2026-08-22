import { validateMediaManifest } from '../../contracts/src/index.js';

export class MediaResolverError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MediaResolverError';
  }
}

const unresolved = (cue, reason, resolverId = null) => Object.freeze({
  status: 'unresolved',
  cueId: cue.cueId,
  kind: cue.kind,
  resolverId,
  reason,
});

export class MediaResolverRegistry {
  #resolvers = new Map();

  register(resolver) {
    if (
      !resolver
      || typeof resolver.id !== 'string'
      || typeof resolver.resolve !== 'function'
      || !Array.isArray(resolver.kinds)
    ) {
      throw new MediaResolverError('resolver contract is invalid');
    }
    if (this.#resolvers.has(resolver.id)) {
      throw new MediaResolverError(`resolver ${resolver.id} is already registered`);
    }
    this.#resolvers.set(resolver.id, Object.freeze({
      ...resolver,
      kinds: Object.freeze([...resolver.kinds]),
    }));
    return () => this.#resolvers.delete(resolver.id);
  }

  get(id) {
    return this.#resolvers.get(id) ?? null;
  }

  async resolve(cue, context = {}) {
    if (!cue || typeof cue !== 'object' || typeof cue.cueId !== 'string') {
      throw new MediaResolverError('cue is invalid');
    }
    const resolverId = cue.resolverId ?? context.defaultResolverId;
    if (!resolverId) return unresolved(cue, 'no resolver was declared');
    const resolver = this.#resolvers.get(resolverId);
    if (!resolver) return unresolved(cue, `resolver ${resolverId} is not installed`, resolverId);
    if (!resolver.kinds.includes(cue.kind)) {
      return unresolved(cue, `resolver ${resolverId} does not support ${cue.kind}`, resolverId);
    }
    if (!cue.mediaId) return unresolved(cue, 'cue has no mediaId', resolverId);
    try {
      const result = await resolver.resolve(cue, context);
      if (!result) return unresolved(cue, 'mediaId was not found', resolverId);
      return Object.freeze({
        status: 'resolved',
        cueId: cue.cueId,
        kind: cue.kind,
        resolverId,
        mediaId: cue.mediaId,
        url: result.url,
        mimeType: result.mimeType ?? null,
        metadata: Object.freeze({ ...(result.metadata ?? {}) }),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return unresolved(cue, detail, resolverId);
    }
  }
}

const safeResolvedUrl = (value, baseUrl) => {
  const url = new URL(value, baseUrl);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new MediaResolverError(`unsupported media URL protocol ${url.protocol}`);
  }
  return url.href;
};

export function createManifestMediaResolver(manifest, { baseUrl }) {
  validateMediaManifest(manifest);
  const entries = new Map(manifest.entries.map((entry) => [entry.mediaId, entry]));
  return {
    id: manifest.resolverId,
    kinds: ['voice', 'bgm', 'sfx', 'image', 'video'],
    async resolve(cue) {
      const entry = entries.get(cue.mediaId);
      if (!entry) return null;
      if (entry.role !== cue.kind) {
        throw new MediaResolverError(
          `media ${entry.mediaId} is ${entry.role}, not requested ${cue.kind}`,
        );
      }
      return {
        url: safeResolvedUrl(entry.url, baseUrl),
        mimeType: entry.mimeType,
        metadata: { role: entry.role, revision: manifest.revision },
      };
    },
  };
}
