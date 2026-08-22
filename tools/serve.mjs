import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpusRoot = path.resolve(
  process.env.ADV_CORPUS_REPOSITORY
    ?? path.resolve(repositoryRoot, '..', 'narcissu-kana-research'),
);
const host = process.env.HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.PORT ?? '4173', 10);

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.ogg', 'audio/ogg'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.wav', 'audio/wav'],
  ['.webp', 'image/webp'],
]);

const parseRange = (value, size) => {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value ?? '');
  if (!match) return null;
  let start = match[1] ? Number.parseInt(match[1], 10) : null;
  let end = match[2] ? Number.parseInt(match[2], 10) : null;
  if (start === null && end !== null) {
    start = Math.max(0, size - end);
    end = size - 1;
  } else {
    start ??= 0;
    end ??= size - 1;
  }
  if (start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
};

const sendText = (response, statusCode, body, headers = {}) => {
  const payload = Buffer.from(body);
  response.writeHead(statusCode, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': payload.byteLength,
    ...headers,
  });
  response.end(payload);
};

const server = createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) {
      sendText(response, 405, 'Method Not Allowed', { allow: 'GET, HEAD' });
      return;
    }

    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? host}`);
    if (requestUrl.pathname === '/') {
      response.writeHead(302, { location: '/apps/web/' });
      response.end();
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(requestUrl.pathname);
    } catch {
      sendText(response, 400, 'Bad Request');
      return;
    }
    if (pathname.endsWith('/')) pathname += 'index.html';

    const corpusRequest = pathname.startsWith('/corpus/');
    const activeRoot = corpusRequest ? corpusRoot : repositoryRoot;
    const mountedPath = corpusRequest ? pathname.slice('/corpus'.length) : pathname;
    const candidate = path.resolve(activeRoot, `.${mountedPath}`);
    const rootPrefix = `${activeRoot}${path.sep}`;
    if (candidate !== activeRoot && !candidate.startsWith(rootPrefix)) {
      sendText(response, 403, 'Forbidden');
      return;
    }

    let details;
    try {
      details = await stat(candidate);
    } catch {
      sendText(response, 404, 'Not Found');
      return;
    }
    if (!details.isFile()) {
      sendText(response, 404, 'Not Found');
      return;
    }

    const range = parseRange(request.headers.range, details.size);
    if (request.headers.range && !range) {
      sendText(response, 416, 'Range Not Satisfiable', {
        'content-range': `bytes */${details.size}`,
      });
      return;
    }
    const statusCode = range ? 206 : 200;
    const contentLength = range ? range.end - range.start + 1 : details.size;
    response.writeHead(statusCode, {
      'content-type': contentTypes.get(path.extname(candidate).toLowerCase())
        ?? 'application/octet-stream',
      'content-length': contentLength,
      'accept-ranges': 'bytes',
      ...(range ? { 'content-range': `bytes ${range.start}-${range.end}/${details.size}` } : {}),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(candidate, range ?? undefined).pipe(response);
  } catch (error) {
    sendText(response, 500, error instanceof Error ? error.message : String(error));
  }
});

server.listen(port, host, () => {
  console.log(`READY http://${host}:${port}/apps/web/`);
  console.log(existsSync(corpusRoot)
    ? `CORPUS read-only ${corpusRoot}`
    : `CORPUS missing ${corpusRoot}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
