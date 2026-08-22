import { validateStoryDocument } from '../../contracts/src/index.js';

export function createAdvIrAdapter() {
  return Object.freeze({
    id: 'adv-ir-v1',
    sourceFormats: Object.freeze(['adv-story/v1']),
    async load({ storyEntry, io }) {
      if (typeof io?.fetchJson !== 'function') {
        throw new TypeError('adv-ir-v1 requires io.fetchJson');
      }
      const story = await io.fetchJson(storyEntry.source);
      return validateStoryDocument(story);
    },
  });
}
