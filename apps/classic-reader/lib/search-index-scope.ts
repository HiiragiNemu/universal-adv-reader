export type SearchIndexScope = 'generic';

export type SearchIndexChunk = {
  bytes: number;
  sha256: string;
};

type SearchIndexManifestV1 = {
  version: 1;
  sha256: string;
  bytes: number;
  entries: number;
  object_key: string;
  story_index_sha256: string;
};

type SearchIndexManifestV2 = Omit<SearchIndexManifestV1, 'version'> & {
  version: 2;
  chunk_bytes: number;
  chunks: SearchIndexChunk[];
};

export type SearchIndexManifest = SearchIndexManifestV1 | SearchIndexManifestV2;

export type SearchIndexSource = Pick<
  SearchIndexManifestV1,
  'sha256' | 'bytes' | 'entries'
> & {
  url?: string;
  chunk_base_url?: string;
  version: 1 | 2;
  chunk_bytes?: number;
  chunks?: SearchIndexChunk[];
};

export const SEARCH_INDEX_SCOPE_CONFIG: Record<
  SearchIndexScope,
  { label: string; manifestUrl: string; objectKeyPrefix: string }
> = {
  generic: { label: 'Narcissu / KANA · 全部剧情', manifestUrl: '/search_index_manifest.generic.json', objectKeyPrefix: 'search/generic' },
};

export const isSearchIndexManifest = (
  value: unknown,
  scope: SearchIndexScope,
): value is SearchIndexManifest => {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Record<string, unknown>;
  const sha256 =
    typeof manifest.sha256 === 'string' ? manifest.sha256.toLowerCase() : '';
  const { objectKeyPrefix } = SEARCH_INDEX_SCOPE_CONFIG[scope];
  const commonValid =
    manifest.version === 2 &&
    /^[a-f0-9]{64}$/.test(sha256) &&
    Number.isSafeInteger(manifest.bytes) &&
    Number(manifest.bytes) > 0 &&
    Number(manifest.bytes) <= 256 * 1024 * 1024 &&
    Number.isSafeInteger(manifest.entries) &&
    Number(manifest.entries) > 0 &&
    Number(manifest.entries) <= 1_000_000 &&
    typeof manifest.object_key === 'string' &&
    manifest.object_key === `${objectKeyPrefix}/${sha256}.json` &&
    typeof manifest.story_index_sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(manifest.story_index_sha256);
  if (!commonValid) return false;

  const chunkBytes = Number(manifest.chunk_bytes);
  const chunks = manifest.chunks;
  if (
    chunkBytes !== 1024 * 1024 ||
    !Array.isArray(chunks) ||
    chunks.length === 0 ||
    chunks.length > 4096 ||
    chunks.length !== Math.ceil(Number(manifest.bytes) / chunkBytes)
  ) {
    return false;
  }
  let total = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk || typeof chunk !== 'object') return false;
    const item = chunk as Record<string, unknown>;
    const itemBytes = Number(item.bytes);
    const finalChunk = index === chunks.length - 1;
    if (
      !Number.isSafeInteger(itemBytes) ||
      itemBytes <= 0 ||
      itemBytes > chunkBytes ||
      (!finalChunk && itemBytes !== chunkBytes) ||
      typeof item.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(item.sha256)
    ) {
      return false;
    }
    total += itemBytes;
    if (!Number.isSafeInteger(total) || total > Number(manifest.bytes)) {
      return false;
    }
  }
  return total === Number(manifest.bytes);
};

const sourceFromManifest = (
  manifest: SearchIndexManifest,
  location: { url?: string; chunk_base_url?: string },
): SearchIndexSource => ({
  ...location,
  version: manifest.version,
  sha256: manifest.sha256,
  bytes: manifest.bytes,
  entries: manifest.entries,
  ...(manifest.version === 2
    ? {
        chunk_bytes: manifest.chunk_bytes,
        chunks: manifest.chunks,
      }
    : {}),
});

const retryPause = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  signal.throwIfAborted();
  const aborted = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, milliseconds);
  signal.addEventListener('abort', aborted, { once: true });
});

// Only transient transport/server failures retry. Invalid or mismatched manifests
// still fail closed, and leaving the page cancels requests and backoff immediately.
const fetchSearchManifest = async (url: string, signal: AbortSignal, fetchManifest: typeof fetch): Promise<unknown> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    signal.throwIfAborted();
    try {
      const response = await fetchManifest(url, {
        cache: 'no-store', credentials: 'same-origin',
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
      });
      if (!response.ok) {
        await response.body?.cancel();
        const transient = response.status === 408 || response.status === 429 || response.status >= 500;
        if (transient && attempt < 2) { await retryPause(250 * (attempt + 1), signal); continue; }
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      signal.throwIfAborted();
      const transient = error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError');
      if (!transient || attempt === 2) throw error;
      await retryPause(250 * (attempt + 1), signal);
    }
  }
  throw new Error('搜索索引清单读取失败');
};

export const getSearchIndexSources = async (
  signal: AbortSignal,
  storyIndexSha256: string,
  scope: SearchIndexScope,
  fetchManifest: typeof fetch = fetch,
): Promise<SearchIndexSource[]> => {
  const config = SEARCH_INDEX_SCOPE_CONFIG[scope];
  const manifest = await fetchSearchManifest(config.manifestUrl, signal, fetchManifest);
  if (!isSearchIndexManifest(manifest, scope)) {
    throw new Error(`搜索索引清单格式不正确：${scope}`);
  }
  if (manifest.story_index_sha256 !== storyIndexSha256) {
    throw new Error(`搜索索引与当前剧情目录不匹配：${scope}`);
  }

  const sources: SearchIndexSource[] = [];
  if (manifest.version === 2) {
    sources.push(
      sourceFromManifest(manifest, {
        chunk_base_url: `/search-chunks/${scope}/${manifest.sha256}/`,
      }),
    );
  }
  return sources;
};
