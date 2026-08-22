import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

export const readJson = async (root, relativePath) => JSON.parse(await readFile(
  path.join(root, relativePath),
  'utf8',
));

export const normalizeText = (value, { trim = false } = {}) => {
  const normalized = String(value ?? '').replace(/\r\n?/gu, '\n');
  return trim ? normalized.trim() : normalized;
};

export const isDialogue = (value) => /^[\s]*[「『（("“]/u.test(value);

export const buildMajiroLogicalGroups = (textEvents) => {
  const groups = [];
  for (let index = 0; index < textEvents.length; index += 1) {
    const current = textEvents[index];
    const next = textEvents[index + 1];
    const speakerPair = next
      && !isDialogue(current.text)
      && !current.text.includes('\n')
      && current.text.length <= 24
      && isDialogue(next.text);
    if (speakerPair) {
      groups.push({
        sourceIndices: [index, index + 1],
        speakerIndex: index,
        textIndex: index + 1,
        startOffset: current.codeOffset,
      });
      index += 1;
    } else {
      groups.push({
        sourceIndices: [index],
        speakerIndex: null,
        textIndex: index,
        startOffset: current.codeOffset,
      });
    }
  }
  return groups;
};

export const basenameWithoutExtension = (value) => {
  const filename = String(value).replaceAll('\\', '/').split('/').at(-1) ?? '';
  const extension = path.posix.extname(filename);
  return extension ? filename.slice(0, -extension.length) : filename;
};

export const safeIdPart = (value) => {
  const output = [...String(value)].map((character) =>
    /[A-Za-z0-9_.-]/u.test(character)
      ? character
      : `x${character.codePointAt(0).toString(16)}`).join('');
  return output || 'asset';
};

export const mimeTypeForPath = (value) => {
  const extension = path.posix.extname(value).toLowerCase();
  return new Map([
    ['.ogg', 'audio/ogg'],
    ['.wav', 'audio/wav'],
    ['.mp3', 'audio/mpeg'],
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.webp', 'image/webp'],
    ['.mpg', 'video/mpeg'],
    ['.mpeg', 'video/mpeg'],
  ]).get(extension) ?? 'application/octet-stream';
};

export const mediaKindForRole = (role) => new Map([
  ['voice', 'voice'],
  ['music', 'bgm'],
  ['sound-effect', 'sfx'],
  ['audio', 'sfx'],
  ['image', 'image'],
  ['video', 'video'],
]).get(role) ?? null;

export class ImportMediaRegistry {
  #entries = new Map();

  constructor({ namespace, resolverId, resourceRoot }) {
    this.namespace = namespace;
    this.resolverId = resolverId;
    this.resourceRoot = resourceRoot;
  }

  get entries() {
    return [...this.#entries.values()].sort((left, right) =>
      left.mediaId.localeCompare(right.mediaId));
  }

  async register({ key, kind, playbackPath }) {
    const mediaId = `${this.namespace}.${kind}.${safeIdPart(key)}`;
    const url = playbackPath.startsWith('archive/')
      ? `/corpus/${playbackPath}`
      : `/corpus/archive/${playbackPath}`;
    const entry = {
      mediaId,
      role: kind,
      url,
      mimeType: mimeTypeForPath(playbackPath),
    };
    const existing = this.#entries.get(mediaId);
    if (existing && existing.url !== entry.url) {
      throw new Error(`media ID collision for ${mediaId}: ${existing.url} vs ${entry.url}`);
    }
    if (!existing) {
      await access(path.join(this.resourceRoot, url.slice('/corpus/'.length)));
      this.#entries.set(mediaId, entry);
    }
    return mediaId;
  }
}

export const lineEventId = (index) => `line-${String(index + 1).padStart(3, '0')}`;

export const parseArguments = (values, defaults = {}) => {
  const result = { ...defaults };
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    const value = values[index + 1];
    if (flag === '--resource' && value) {
      result.resourceRoot = path.resolve(value);
      index += 1;
    } else {
      throw new TypeError(`unknown or incomplete argument: ${flag}`);
    }
  }
  return result;
};
