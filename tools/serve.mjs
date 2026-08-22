import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = process.env.HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.PORT ?? '4173', 10);

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.wav', 'audio/wav'],
]);

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

    const candidate = path.resolve(repositoryRoot, `.${pathname}`);
    const rootPrefix = `${repositoryRoot}${path.sep}`;
    if (candidate !== repositoryRoot && !candidate.startsWith(rootPrefix)) {
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

    response.writeHead(200, {
      'content-type': contentTypes.get(path.extname(candidate).toLowerCase())
        ?? 'application/octet-stream',
      'content-length': details.size,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(candidate).pipe(response);
  } catch (error) {
    sendText(response, 500, error instanceof Error ? error.message : String(error));
  }
});

server.listen(port, host, () => {
  console.log(`READY http://${host}:${port}/apps/web/`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
