// Static hosting may ignore Range. Keep the original encoded bytes and let the
// browser obtain seek metadata from a bounded local Blob instead of estimating.
export const MAX_SEEKABLE_VOICE_BYTES = 25 * 1024 * 1024;
export async function loadSeekableVoiceBlob(sourceUrl: string, signal: AbortSignal,
  fetcher: typeof fetch = fetch): Promise<Blob | null> {
  if (signal.aborted) return null;
  const response = await fetcher(sourceUrl, { signal, cache: 'force-cache', credentials: 'same-origin' });
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const length = Number(response.headers.get('content-length'));
  if (signal.aborted || response.status !== 200 || !/^(audio\/(ogg|wav|wave|x-wav|mpeg|mp4|webm)|application\/ogg)$/.test(type)
    || (Number.isFinite(length) && length > MAX_SEEKABLE_VOICE_BYTES)) {
    await response.body?.cancel(); return null;
  }
  if (!response.body) return null;
  const reader = response.body.getReader(), parts: ArrayBuffer[] = [];
  let total = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) return null;
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_SEEKABLE_VOICE_BYTES) { await reader.cancel(); return null; }
      parts.push(chunk.value.slice().buffer);
    }
    if (signal.aborted || !total || (length > 0 && !response.headers.get('content-encoding') && total !== length)) return null;
    return new Blob(parts, { type });
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
