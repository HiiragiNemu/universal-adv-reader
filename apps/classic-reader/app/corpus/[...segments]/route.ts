import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

import {
  legacyCorpusAudioContentType,
  parseLegacyCorpusByteRange,
  resolveLegacyCorpusAudioPath,
} from '@/lib/legacy-vn-corpus';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const corpusRoot = resolve(
  process.env.ADV_CORPUS_REPOSITORY
    ?? resolve(process.cwd(), '..', '..', '..', 'narcissu-kana-research'),
);

const errorHeaders = {
  'Cache-Control': 'private, no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
};

const errorResponse = (message: string, status: number, size?: number) => {
  const headers = new Headers(errorHeaders);
  if (status === 416 && size !== undefined) {
    headers.set('Content-Range', `bytes */${size}`);
  }
  return Response.json({ error: message }, { status, headers });
};

async function serveLegacyCorpusAudio(
  request: Request,
  context: { params: Promise<{ segments: string[] }> },
  headOnly: boolean,
): Promise<Response> {
  let candidate: string;
  try {
    const { segments } = await context.params;
    candidate = resolveLegacyCorpusAudioPath(corpusRoot, segments);
  } catch {
    return errorResponse('无效的原作语音路径', 400);
  }

  let sourceSize: number;
  let sourcePath: string;
  try {
    const [realRoot, realCandidate] = await Promise.all([
      realpath(corpusRoot),
      realpath(candidate),
    ]);
    if (!realCandidate.startsWith(`${realRoot}${sep}`)) {
      return errorResponse('原作语音路径越界', 400);
    }
    const details = await stat(realCandidate);
    if (!details.isFile()) return errorResponse('原作语音不存在', 404);
    sourceSize = details.size;
    sourcePath = realCandidate;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';
    return errorResponse(
      code === 'ENOENT' ? '原作语音不存在' : '原作语音读取失败',
      code === 'ENOENT' ? 404 : 503,
    );
  }

  let range;
  try {
    range = parseLegacyCorpusByteRange(request.headers.get('range'), sourceSize);
  } catch {
    return errorResponse('无效的语音 Range 请求', 416, sourceSize);
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? sourceSize - 1;
  const length = range?.length ?? sourceSize;
  const headers = new Headers({
    ...errorHeaders,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(length),
    'Content-Type': legacyCorpusAudioContentType(sourcePath),
  });
  if (range) headers.set('Content-Range', `bytes ${start}-${end}/${sourceSize}`);

  if (headOnly) {
    return new Response(null, { status: range ? 206 : 200, headers });
  }
  const body = Readable.toWeb(
    createReadStream(sourcePath, { start, end }),
  ) as ReadableStream<Uint8Array>;
  return new Response(body, { status: range ? 206 : 200, headers });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ segments: string[] }> },
) {
  return serveLegacyCorpusAudio(request, context, false);
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ segments: string[] }> },
) {
  return serveLegacyCorpusAudio(request, context, true);
}
