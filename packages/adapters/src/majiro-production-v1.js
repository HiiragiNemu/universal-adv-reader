import { validateStoryDocument } from '../../contracts/src/index.js';

export const MAJIRO_PRODUCTION_ADAPTER_ID = 'majiro-production-v1';
export const MAJIRO_PRODUCTION_SOURCE_FORMAT = 'adv-story/majiro-v1';

export function createMajiroProductionAdapter() {
  return Object.freeze({
    id: MAJIRO_PRODUCTION_ADAPTER_ID,
    sourceFormats: Object.freeze([MAJIRO_PRODUCTION_SOURCE_FORMAT]),
    async load({ storyEntry, io }) {
      if (typeof io?.fetchJson !== 'function') {
        throw new TypeError(`${MAJIRO_PRODUCTION_ADAPTER_ID} requires io.fetchJson`);
      }
      const story = validateStoryDocument(await io.fetchJson(storyEntry.source));
      if (story.provenance?.engine !== 'majiro') {
        throw new TypeError('Majiro production story must declare provenance.engine="majiro"');
      }
      if (story.provenance?.sourceSchema !== 'vn-mjo-reader-script/v1') {
        throw new TypeError('Majiro production story must declare its exact source schema');
      }
      return story;
    },
  });
}
