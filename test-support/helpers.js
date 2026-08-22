import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const fixtureJson = async (name) => JSON.parse(await readFile(
  path.join(repositoryRoot, 'apps', 'web', 'data', name),
  'utf8',
));
