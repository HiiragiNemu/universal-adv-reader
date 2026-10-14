export const STORY_SCHEMA = 'adv-story/v1';
export const CATALOG_SCHEMA = 'adv-catalog/v1';
export const MEDIA_SCHEMA = 'adv-media/v1';
export const APP_MANIFEST_SCHEMA = 'adv-app-manifest/v1';

export const EVENT_KINDS = Object.freeze(['line', 'choice', 'action', 'end']);
export const MEDIA_KINDS = Object.freeze(['voice', 'bgm', 'sfx', 'image', 'video']);
export const CUE_TIMINGS = Object.freeze(['utterance', 'scene']);

const SIMPLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/u;
const PATH_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:/%\-]{0,255}$/u;
const LOCALE_RE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;

export class ContractError extends Error {
  constructor(path, reason) {
    super(`${path}: ${reason}`);
    this.name = 'ContractError';
    this.path = path;
  }
}

const fail = (path, reason) => {
  throw new ContractError(path, reason);
};

const asRecord = (value, path) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'must be an object');
  }
  return value;
};

const asArray = (value, path, { min = 0, max = 100_000 } = {}) => {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    fail(path, `must be an array with ${min}..${max} entries`);
  }
  return value;
};

const asString = (value, path, { min = 1, max = 200_000 } = {}) => {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    fail(path, `must be a string with ${min}..${max} characters`);
  }
  const forbiddenControl = [...value].find((character) =>
    /\p{Cc}/u.test(character) && character !== '\n' && character !== '\t');
  if (forbiddenControl) fail(path, 'contains a forbidden control character');
  return value;
};

const asSimpleId = (value, path) => {
  const text = asString(value, path, { max: 192 });
  if (!SIMPLE_ID_RE.test(text)) fail(path, 'has an invalid identifier shape');
  return text;
};

const asPathId = (value, path) => {
  const text = asString(value, path, { max: 256 });
  if (!PATH_ID_RE.test(text) || text.includes('//') || text.split('/').includes('..')) {
    fail(path, 'has an invalid path identifier shape');
  }
  return text;
};

const assertUnique = (values, path) => {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) fail(path, `contains duplicate ${JSON.stringify(value)}`);
    seen.add(value);
  }
};

export function validateLocalized(value, path = 'localized') {
  const record = asRecord(value, path);
  const entries = Object.entries(record);
  if (entries.length === 0 || entries.length > 32) fail(path, 'must contain 1..32 locales');
  for (const [locale, text] of entries) {
    if (!LOCALE_RE.test(locale)) fail(`${path}.${locale}`, 'has an invalid locale');
    asString(text, `${path}.${locale}`, { min: 0 });
  }
  return record;
}

function validateCue(value, path) {
  const cue = asRecord(value, path);
  asPathId(cue.cueId, `${path}.cueId`);
  if (!MEDIA_KINDS.includes(cue.kind)) fail(`${path}.kind`, 'is not a supported media kind');
  if (!CUE_TIMINGS.includes(cue.timing)) fail(`${path}.timing`, 'is not a supported timing');
  if (cue.mediaId !== undefined) asPathId(cue.mediaId, `${path}.mediaId`);
  if (cue.resolverId !== undefined) asSimpleId(cue.resolverId, `${path}.resolverId`);
  if (cue.stopEventId !== undefined) asSimpleId(cue.stopEventId, `${path}.stopEventId`);
  if (cue.raw !== undefined) asRecord(cue.raw, `${path}.raw`);
  return cue;
}

function validateEvent(value, path) {
  const event = asRecord(value, path);
  asSimpleId(event.eventId, `${path}.eventId`);
  if (!EVENT_KINDS.includes(event.kind)) fail(`${path}.kind`, 'is not a supported event kind');
  if (event.speaker !== undefined) validateLocalized(event.speaker, `${path}.speaker`);
  if (event.text !== undefined) validateLocalized(event.text, `${path}.text`);
  if (event.nextEventId !== undefined) asSimpleId(event.nextEventId, `${path}.nextEventId`);
  if (event.source !== undefined) asRecord(event.source, `${path}.source`);

  const cues = event.cues === undefined ? [] : asArray(event.cues, `${path}.cues`, { max: 1024 });
  cues.forEach((cue, index) => validateCue(cue, `${path}.cues[${index}]`));
  assertUnique(cues.map((cue) => cue.cueId), `${path}.cues`);

  if (event.kind === 'line' && event.text === undefined) fail(path, 'line event requires text');
  if (event.kind === 'choice') {
    const choices = asArray(event.choices, `${path}.choices`, { min: 1, max: 1024 });
    choices.forEach((value, index) => {
      const choicePath = `${path}.choices[${index}]`;
      const choice = asRecord(value, choicePath);
      asSimpleId(choice.choiceId, `${choicePath}.choiceId`);
      validateLocalized(choice.label, `${choicePath}.label`);
      asSimpleId(choice.nextEventId, `${choicePath}.nextEventId`);
      const choiceCues = choice.cues === undefined
        ? []
        : asArray(choice.cues, `${choicePath}.cues`, { max: 128 });
      choiceCues.forEach((cue, cueIndex) => validateCue(cue, `${choicePath}.cues[${cueIndex}]`));
    });
    assertUnique(choices.map((choice) => choice.choiceId), `${path}.choices`);
  } else if (event.choices !== undefined) {
    fail(`${path}.choices`, 'is only valid on a choice event');
  }
  if (event.kind === 'end' && event.nextEventId !== undefined) {
    fail(`${path}.nextEventId`, 'end event cannot have a default edge');
  }
  return event;
}

export function validateStoryDocument(value) {
  const story = asRecord(value, 'story');
  if (story.schema !== STORY_SCHEMA) fail('story.schema', `must equal ${STORY_SCHEMA}`);
  asSimpleId(story.corpusId, 'story.corpusId');
  asPathId(story.canonicalStoryId, 'story.canonicalStoryId');
  asSimpleId(story.adapterId, 'story.adapterId');
  asSimpleId(story.revision, 'story.revision');
  asString(story.title, 'story.title', { max: 512 });

  const variants = asArray(story.variants, 'story.variants', { min: 1, max: 512 });
  assertUnique(variants.map((variant) => asRecord(variant, 'story.variant').variantId), 'story.variants');

  for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
    const path = `story.variants[${variantIndex}]`;
    const variant = asRecord(variants[variantIndex], path);
    asPathId(variant.variantId, `${path}.variantId`);
    const locales = asArray(variant.locales, `${path}.locales`, { min: 1, max: 32 });
    locales.forEach((locale, index) => {
      if (typeof locale !== 'string' || !LOCALE_RE.test(locale)) {
        fail(`${path}.locales[${index}]`, 'has an invalid locale');
      }
    });
    assertUnique(locales, `${path}.locales`);

    const sections = asArray(variant.sections, `${path}.sections`, { min: 1, max: 10_000 });
    assertUnique(sections.map((section) => asRecord(section, `${path}.section`).sectionId), `${path}.sections`);
    for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
      const sectionPath = `${path}.sections[${sectionIndex}]`;
      const section = asRecord(sections[sectionIndex], sectionPath);
      asSimpleId(section.sectionId, `${sectionPath}.sectionId`);
      validateLocalized(section.title, `${sectionPath}.title`);
      asSimpleId(section.entryEventId, `${sectionPath}.entryEventId`);
      const events = asArray(section.events, `${sectionPath}.events`, { min: 1, max: 1_000_000 });
      events.forEach((event, index) => validateEvent(event, `${sectionPath}.events[${index}]`));
      assertUnique(events.map((event) => event.eventId), `${sectionPath}.events`);
      const eventIds = new Set(events.map((event) => event.eventId));
      if (!eventIds.has(section.entryEventId)) fail(`${sectionPath}.entryEventId`, 'does not resolve');
      for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
        const event = events[eventIndex];
        const eventPath = `${sectionPath}.events[${eventIndex}]`;
        if (event.nextEventId !== undefined && !eventIds.has(event.nextEventId)) {
          fail(`${eventPath}.nextEventId`, 'does not resolve inside the section');
        }
        for (let choiceIndex = 0; choiceIndex < (event.choices ?? []).length; choiceIndex += 1) {
          if (!eventIds.has(event.choices[choiceIndex].nextEventId)) {
            fail(`${eventPath}.choices[${choiceIndex}].nextEventId`, 'does not resolve inside the section');
          }
        }
        for (let cueIndex = 0; cueIndex < (event.cues ?? []).length; cueIndex += 1) {
          const cue = event.cues[cueIndex];
          if (cue.stopEventId !== undefined && !eventIds.has(cue.stopEventId)) {
            fail(`${eventPath}.cues[${cueIndex}].stopEventId`, 'does not resolve inside the section');
          }
        }
      }
    }
  }
  return story;
}

export function validateCatalog(value) {
  const catalog = asRecord(value, 'catalog');
  if (catalog.schema !== CATALOG_SCHEMA) fail('catalog.schema', `must equal ${CATALOG_SCHEMA}`);
  asSimpleId(catalog.revision, 'catalog.revision');
  const corpora = asArray(catalog.corpora, 'catalog.corpora', { min: 1, max: 10_000 });
  assertUnique(corpora.map((corpus) => asRecord(corpus, 'catalog.corpus').corpusId), 'catalog.corpora');
  const storyIds = [];
  corpora.forEach((value, corpusIndex) => {
    const path = `catalog.corpora[${corpusIndex}]`;
    const corpus = asRecord(value, path);
    asSimpleId(corpus.corpusId, `${path}.corpusId`);
    asString(corpus.title, `${path}.title`, { max: 512 });
    asSimpleId(corpus.adapterId, `${path}.adapterId`);
    asString(corpus.sourceFormat, `${path}.sourceFormat`, { max: 128 });
    const features = asArray(corpus.features, `${path}.features`, { max: 128 });
    features.forEach((feature, index) => asSimpleId(feature, `${path}.features[${index}]`));
    assertUnique(features, `${path}.features`);
    const stories = asArray(corpus.stories, `${path}.stories`, { min: 1, max: 1_000_000 });
    stories.forEach((value, storyIndex) => {
      const storyPath = `${path}.stories[${storyIndex}]`;
      const story = asRecord(value, storyPath);
      storyIds.push(asPathId(story.canonicalStoryId, `${storyPath}.canonicalStoryId`));
      asString(story.title, `${storyPath}.title`, { max: 512 });
      if (story.folderId !== undefined) asSimpleId(story.folderId, `${storyPath}.folderId`);
      if (story.folderTitle !== undefined) asString(story.folderTitle, `${storyPath}.folderTitle`, { max: 512 });
      asString(story.source, `${storyPath}.source`, { max: 2048 });
      asString(story.mediaManifest, `${storyPath}.mediaManifest`, { max: 2048 });
      asPathId(story.preferredVariantId, `${storyPath}.preferredVariantId`);
    });
  });
  assertUnique(storyIds, 'catalog stories');
  return catalog;
}

export function validateMediaManifest(value) {
  const manifest = asRecord(value, 'media');
  if (manifest.schema !== MEDIA_SCHEMA) fail('media.schema', `must equal ${MEDIA_SCHEMA}`);
  asSimpleId(manifest.revision, 'media.revision');
  asSimpleId(manifest.resolverId, 'media.resolverId');
  const entries = asArray(manifest.entries, 'media.entries', { max: 2_000_000 });
  entries.forEach((value, index) => {
    const path = `media.entries[${index}]`;
    const entry = asRecord(value, path);
    asPathId(entry.mediaId, `${path}.mediaId`);
    if (!MEDIA_KINDS.includes(entry.role)) fail(`${path}.role`, 'is not a supported media role');
    asString(entry.url, `${path}.url`, { max: 4096 });
    if (entry.mimeType !== undefined) asString(entry.mimeType, `${path}.mimeType`, { max: 256 });
  });
  assertUnique(entries.map((entry) => entry.mediaId), 'media.entries');
  return manifest;
}

export function localizedText(record, locale, fallbacks = []) {
  if (!record || typeof record !== 'object') return '';
  for (const candidate of [locale, ...fallbacks]) {
    const text = record[candidate];
    if (typeof text === 'string') return text;
  }
  const first = Object.values(record).find((value) => typeof value === 'string');
  return typeof first === 'string' ? first : '';
}

export function allStoryEvents(story) {
  validateStoryDocument(story);
  return story.variants.flatMap((variant) =>
    variant.sections.flatMap((section) => section.events),
  );
}
