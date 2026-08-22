import { validateStoryDocument } from '../../contracts/src/index.js';

export class AdapterRegistryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdapterRegistryError';
  }
}

const validAdapter = (adapter) =>
  adapter
  && typeof adapter === 'object'
  && typeof adapter.id === 'string'
  && Array.isArray(adapter.sourceFormats)
  && adapter.sourceFormats.length > 0
  && typeof adapter.load === 'function';

export class AdapterRegistry {
  #adapters = new Map();

  register(adapter) {
    if (!validAdapter(adapter)) throw new AdapterRegistryError('adapter contract is invalid');
    if (this.#adapters.has(adapter.id)) {
      throw new AdapterRegistryError(`adapter ${adapter.id} is already registered`);
    }
    this.#adapters.set(adapter.id, Object.freeze({
      ...adapter,
      sourceFormats: Object.freeze([...adapter.sourceFormats]),
    }));
    return () => this.#adapters.delete(adapter.id);
  }

  has(adapterId) {
    return this.#adapters.has(adapterId);
  }

  get(adapterId) {
    return this.#adapters.get(adapterId) ?? null;
  }

  list() {
    return [...this.#adapters.values()];
  }

  async loadStory(corpus, storyEntry, io) {
    if (!corpus || typeof corpus !== 'object') {
      throw new AdapterRegistryError('corpus record is missing');
    }
    const adapter = this.#adapters.get(corpus.adapterId);
    if (!adapter) {
      throw new AdapterRegistryError(
        `declared adapter ${JSON.stringify(corpus.adapterId)} is not installed`,
      );
    }
    if (!adapter.sourceFormats.includes(corpus.sourceFormat)) {
      throw new AdapterRegistryError(
        `adapter ${adapter.id} does not accept source format ${JSON.stringify(corpus.sourceFormat)}`,
      );
    }

    let story;
    try {
      story = await adapter.load({ corpus, storyEntry, io });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new AdapterRegistryError(`adapter ${adapter.id} failed: ${detail}`);
    }
    validateStoryDocument(story);
    if (story.adapterId !== adapter.id) {
      throw new AdapterRegistryError(
        `loaded story declares ${story.adapterId}, expected exact adapter ${adapter.id}`,
      );
    }
    if (story.corpusId !== corpus.corpusId) {
      throw new AdapterRegistryError(
        `loaded story corpus ${story.corpusId} differs from ${corpus.corpusId}`,
      );
    }
    if (story.canonicalStoryId !== storyEntry.canonicalStoryId) {
      throw new AdapterRegistryError(
        `loaded story ID ${story.canonicalStoryId} differs from catalog ${storyEntry.canonicalStoryId}`,
      );
    }
    return story;
  }
}
