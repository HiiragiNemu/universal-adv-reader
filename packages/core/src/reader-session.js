import { validateStoryDocument } from '../../contracts/src/index.js';

export class ReaderRouteError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReaderRouteError';
  }
}

const pickVariant = (story, variantId) => {
  const variant = variantId
    ? story.variants.find((item) => item.variantId === variantId)
    : story.variants[0];
  if (!variant) throw new ReaderRouteError(`variant ${JSON.stringify(variantId)} does not exist`);
  return variant;
};

const pickSection = (variant, sectionId) => {
  const section = sectionId
    ? variant.sections.find((item) => item.sectionId === sectionId)
    : variant.sections[0];
  if (!section) throw new ReaderRouteError(`section ${JSON.stringify(sectionId)} does not exist`);
  return section;
};

export class ReaderSession {
  #story;
  #variant;
  #section;
  #eventMap;
  #currentEventId;
  #history;
  #listeners = new Set();
  #suspended = false;
  #disposed = false;

  constructor(story, location = {}) {
    this.#story = validateStoryDocument(story);
    this.#variant = pickVariant(story, location.variantId);
    this.#section = pickSection(this.#variant, location.sectionId);
    this.#eventMap = new Map(this.#section.events.map((event) => [event.eventId, event]));
    this.#assertStoryLocation(location);
    this.#currentEventId = location.eventId ?? this.#section.entryEventId;
    if (!this.#eventMap.has(this.#currentEventId)) {
      throw new ReaderRouteError(`event ${JSON.stringify(this.#currentEventId)} does not exist`);
    }
    this.#history = [this.#currentEventId];
  }

  #assertLive() {
    if (this.#disposed) throw new ReaderRouteError('reader session is disposed');
  }

  #assertStoryLocation(location) {
    if (
      location.canonicalStoryId !== undefined
      && location.canonicalStoryId !== this.#story.canonicalStoryId
    ) {
      throw new ReaderRouteError('location belongs to a different story');
    }
  }

  #replaceSection(variant, section, eventId) {
    this.#variant = variant;
    this.#section = section;
    this.#eventMap = new Map(section.events.map((event) => [event.eventId, event]));
    const target = eventId ?? section.entryEventId;
    if (!this.#eventMap.has(target)) {
      throw new ReaderRouteError(`event ${JSON.stringify(target)} does not exist`);
    }
    this.#currentEventId = target;
    this.#history = [target];
  }

  #emit() {
    const snapshot = this.snapshot();
    for (const listener of [...this.#listeners]) listener(snapshot);
  }

  subscribe(listener) {
    this.#assertLive();
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  open(location) {
    this.#assertLive();
    this.#assertStoryLocation(location);
    const variant = pickVariant(this.#story, location.variantId ?? this.#variant.variantId);
    const section = pickSection(variant, location.sectionId ?? this.#section.sectionId);
    this.#replaceSection(variant, section, location.eventId);
    this.#emit();
    return this.snapshot();
  }

  goTo(eventId, { replace = false } = {}) {
    this.#assertLive();
    if (!this.#eventMap.has(eventId)) {
      throw new ReaderRouteError(`event ${JSON.stringify(eventId)} does not exist`);
    }
    this.#currentEventId = eventId;
    if (replace) this.#history[this.#history.length - 1] = eventId;
    else this.#history.push(eventId);
    this.#emit();
    return this.snapshot();
  }

  next() {
    this.#assertLive();
    const event = this.currentEvent;
    if (event.kind === 'choice') {
      throw new ReaderRouteError('choice event requires an explicit choiceId');
    }
    if (!event.nextEventId) return false;
    this.goTo(event.nextEventId);
    return true;
  }

  choose(choiceId) {
    this.#assertLive();
    const event = this.currentEvent;
    if (event.kind !== 'choice') throw new ReaderRouteError('current event is not a choice');
    const choice = event.choices.find((item) => item.choiceId === choiceId);
    if (!choice) throw new ReaderRouteError(`choice ${JSON.stringify(choiceId)} does not exist`);
    this.goTo(choice.nextEventId);
    return choice;
  }

  back() {
    this.#assertLive();
    if (this.#history.length <= 1) return false;
    this.#history.pop();
    this.#currentEventId = this.#history[this.#history.length - 1];
    this.#emit();
    return true;
  }

  suspend() {
    this.#assertLive();
    this.#suspended = true;
    this.#emit();
  }

  resume() {
    this.#assertLive();
    this.#suspended = false;
    this.#emit();
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#listeners.clear();
  }

  get currentEvent() {
    return this.#eventMap.get(this.#currentEventId);
  }

  get events() {
    return this.#section.events;
  }

  get variant() {
    return this.#variant;
  }

  get section() {
    return this.#section;
  }

  get story() {
    return this.#story;
  }

  get history() {
    return [...this.#history];
  }

  get location() {
    return {
      canonicalStoryId: this.#story.canonicalStoryId,
      variantId: this.#variant.variantId,
      sectionId: this.#section.sectionId,
      eventId: this.#currentEventId,
      storyRevision: this.#story.revision,
    };
  }

  snapshot() {
    const ordinal = this.#section.events.findIndex((event) => event.eventId === this.#currentEventId);
    return Object.freeze({
      location: Object.freeze(this.location),
      currentEvent: this.currentEvent,
      ordinal,
      total: this.#section.events.length,
      history: Object.freeze([...this.#history]),
      suspended: this.#suspended,
      disposed: this.#disposed,
    });
  }
}

export function voiceRouteSummary(story) {
  validateStoryDocument(story);
  let eligibleEvents = 0;
  let cueEvents = 0;
  let voiceCues = 0;
  for (const variant of story.variants) {
    for (const section of variant.sections) {
      for (const event of section.events) {
        if (event.kind !== 'line') continue;
        eligibleEvents += 1;
        const cues = (event.cues ?? []).filter((cue) => cue.kind === 'voice');
        if (cues.length > 0) cueEvents += 1;
        voiceCues += cues.length;
      }
    }
  }
  return { eligibleEvents, cueEvents, voiceCues, expandableForAllStories: true };
}

export function voiceSlotForEvent(event) {
  if (!event || event.kind !== 'line') return null;
  const cues = (event.cues ?? []).filter((cue) => cue.kind === 'voice');
  return Object.freeze({
    eventId: event.eventId,
    cues: Object.freeze([...cues]),
    status: cues.length > 0 ? 'declared' : 'empty',
    visibleWhenExpanded: true,
  });
}
