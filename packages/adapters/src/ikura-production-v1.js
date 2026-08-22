import { validateStoryDocument } from '../../contracts/src/index.js';

export const IKURA_PRODUCTION_ADAPTER_ID = 'ikura-production-v1';
export const IKURA_PRODUCTION_SOURCE_FORMAT = 'adv-story/ikura-v1';

export function createIkuraProductionAdapter() {
  return Object.freeze({
    id: IKURA_PRODUCTION_ADAPTER_ID,
    sourceFormats: Object.freeze([IKURA_PRODUCTION_SOURCE_FORMAT]),
    async load({ storyEntry, io }) {
      if (typeof io?.fetchJson !== 'function') {
        throw new TypeError(`${IKURA_PRODUCTION_ADAPTER_ID} requires io.fetchJson`);
      }
      const story = validateStoryDocument(await io.fetchJson(storyEntry.source));
      if (story.provenance?.engine !== 'ikura') {
        throw new TypeError('IKURA production story must declare provenance.engine="ikura"');
      }
      if (story.provenance?.sourceSchema !== 'vn-ikura-script/v1') {
        throw new TypeError('IKURA production story must declare its exact source schema');
      }
      return story;
    },
  });
}
