import { resolve, sep } from 'node:path';

export type LegacyCorpusByteRange = {
  end: number;
  length: number;
  start: number;
};

const AUDIO_EXTENSION_PATTERN = /\.(?:flac|mp3|ogg|wav)$/iu;
const WINDOWS_UNSAFE_SEGMENT_PATTERN = /[<>:"/\\|?*\u0000-\u001f\u007f]/u;

export function resolveLegacyCorpusAudioPath(
  corpusRoot: string,
  segments: string[],
): string {
  if (segments.length < 2 || segments.length > 64) {
    throw new TypeError('Invalid legacy corpus path depth');
  }
  for (const segment of segments) {
    if (
      !segment
      || segment === '.'
      || segment === '..'
      || segment.length > 255
      || WINDOWS_UNSAFE_SEGMENT_PATTERN.test(segment)
    ) {
      throw new TypeError('Invalid legacy corpus path segment');
    }
  }
  const root = resolve(corpusRoot);
  const candidate = resolve(root, ...segments);
  if (!candidate.startsWith(`${root}${sep}`) || !AUDIO_EXTENSION_PATTERN.test(candidate)) {
    throw new TypeError('Invalid legacy corpus audio path');
  }
  return candidate;
}

export function parseLegacyCorpusByteRange(
  value: string | null,
  size: number,
): LegacyCorpusByteRange | null {
  if (!value) return null;
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new RangeError('Invalid legacy corpus object size');
  }
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim());
  if (!match || (!match[1] && !match[2])) {
    throw new RangeError('Invalid legacy corpus Range request');
  }

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw new RangeError('Invalid legacy corpus suffix range');
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (
      !Number.isSafeInteger(start)
      || !Number.isSafeInteger(end)
      || start < 0
      || start >= size
      || end < start
    ) {
      throw new RangeError('Legacy corpus Range is outside the object');
    }
    end = Math.min(end, size - 1);
  }
  return { start, end, length: end - start + 1 };
}

export function legacyCorpusAudioContentType(pathname: string): string {
  const extension = pathname.slice(pathname.lastIndexOf('.')).toLocaleLowerCase();
  if (extension === '.flac') return 'audio/flac';
  if (extension === '.mp3') return 'audio/mpeg';
  if (extension === '.ogg') return 'audio/ogg';
  if (extension === '.wav') return 'audio/wav';
  throw new TypeError('Unsupported legacy corpus audio type');
}
