const commonHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Expose-Headers': 'ETag, Content-Length, Content-Range, Accept-Ranges',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

export function parseRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) throw new RangeError('Invalid range');
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) throw new RangeError('Invalid suffix');
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw new RangeError('Out of range');
    end = Math.min(end, size - 1);
  }
  return { offset: start, length: end - start + 1, end };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...commonHeaders, 'Access-Control-Allow-Headers': 'Range, If-None-Match, If-Range' } });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { ...commonHeaders, Allow: 'GET, HEAD, OPTIONS', 'Cache-Control': 'no-store' } });
    const match = /^\/([a-f0-9]{64})\.wav$/.exec(url.pathname);
    if (!match || url.search) return new Response('Not found', { status: 404, headers: { ...commonHeaders, 'Cache-Control': 'no-store' } });
    const key = match[1] + '.wav';
    try {
      const object = await env.MEDIA.head(key);
      if (!object) return new Response('Not found', { status: 404, headers: { ...commonHeaders, 'Cache-Control': 'no-store' } });
      const etag = '"' + match[1] + '"';
      const headers = new Headers({ ...commonHeaders, 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', ETag: etag, 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Length': String(object.size) });
      if (request.headers.get('if-none-match')?.split(',').some(value => value.trim() === etag || value.trim() === '*')) return new Response(null, { status: 304, headers });
      let range;
      try {
        const ifRange = request.headers.get('if-range');
        range = parseRange(!ifRange || ifRange === etag ? request.headers.get('range') : null, object.size);
      } catch {
        headers.set('Content-Range', 'bytes */' + object.size);
        headers.delete('Content-Length'); headers.set('Cache-Control', 'no-store');
        return new Response(null, { status: 416, headers });
      }
      if (range) {
        headers.set('Content-Range', `bytes ${range.offset}-${range.end}/${object.size}`);
        headers.set('Content-Length', String(range.length));
      }
      if (request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers });
      const data = await env.MEDIA.get(key, range ? { range: { offset: range.offset, length: range.length } } : undefined);
      if (!data) return new Response('Not found', { status: 404, headers: { ...commonHeaders, 'Cache-Control': 'no-store' } });
      return new Response(data.body, { status: range ? 206 : 200, headers });
    } catch {
      return new Response('Media temporarily unavailable', { status: 503, headers: { ...commonHeaders, 'Cache-Control': 'no-store', 'Retry-After': '30' } });
    }
  },
};
