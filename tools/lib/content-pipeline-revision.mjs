import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

// A source manifest revision alone cannot identify a corrected parser or
// chapter catalog. Bind derived data to the exact generators used to build it.
export async function computeContentPipelineRevision(repositoryRoot) {
  const files = [
    'tools/materialize-classic-reader-data.mjs',
    'tools/build-native-correspondence.py',
    'tools/lib/majiro_native_group_bridge.py',
    'tools/lib/source_bound_bilingual_review.py',
    'tools/data/narcissu3-bilingual-review.json',
    'tools/data/nard01-bilingual-review.json',
    'tools/build-native-edit-sources.mjs',
    'tools/build-generic-search-index.mjs',
    'tools/generate-classic-story-ids.mjs',
    'tools/lib/content-pipeline-revision.mjs',
    'tools/lib/content-selection-corrections.mjs',
    'tools/lib/narcissu10-exclusion-corrections.mjs',
    'tools/lib/narcissu3-product-navigation.mjs',
    'tools/lib/narcissu3-chapter-relations.mjs',
    'tools/read-native-reader-revision.mjs',
    'apps/classic-reader/lib/story-parser.ts',
    'apps/classic-reader/lib/legacy-vn-voice-routing.ts',
    'apps/classic-reader/lib/legacy-vn-alignment.ts',
    'apps/classic-reader/lib/legacy-vn-correspondence.ts',
    'apps/classic-reader/lib/native-translation-patch.ts',
    'apps/classic-reader/lib/native-reader-revision.ts',
  ];
  for (const relativeRoot of ['packages/adapters/src', 'tools/lib']) {
    const entries = await readdir(path.join(repositoryRoot, relativeRoot), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (relativeRoot === 'packages/adapters/src'
        || /^(?:kana-|native-story-).*\.(?:mjs|js)$/u.test(entry.name)) {
        files.push(relativeRoot + '/' + entry.name);
      }
    }
  }
  const digest = createHash('sha256');
  for (const relative of [...new Set(files)].sort()) {
    digest.update(relative).update('\0');
    digest.update(await readFile(path.join(repositoryRoot, relative)));
    digest.update('\0');
  }
  return 'sha256-' + digest.digest('hex');
}
