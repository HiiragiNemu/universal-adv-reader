export const BRIDGE_REVISION = 'adv-app-bridge-1';
export const LOCATION_PARAMETERS = Object.freeze([
  'canonicalStoryId',
  'variantId',
  'sectionId',
  'eventId',
  'storyRevision',
  'catalogRevision',
  'bridgeRevision',
]);

const PATH_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/u;
const SIMPLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/u;
const pathKeys = new Set(['canonicalStoryId', 'variantId']);

const validValue = (key, value) => {
  if (typeof value !== 'string' || value.length === 0) return false;
  return pathKeys.has(key) ? PATH_ID_RE.test(value) : SIMPLE_ID_RE.test(value);
};

export function parseStoryDeepLink(input, expected = {}) {
  const url = input instanceof URL ? new URL(input.href) : new URL(input, 'https://reader.invalid');
  const canonicalStoryId = url.searchParams.get('canonicalStoryId');
  if (!canonicalStoryId) return null;
  const location = {};
  for (const key of LOCATION_PARAMETERS) {
    const value = url.searchParams.get(key);
    if (value === null) continue;
    if (!validValue(key, value)) throw new TypeError(`invalid deep-link parameter ${key}`);
    location[key] = value;
  }
  const revision = {
    bridge: location.bridgeRevision === undefined || expected.bridgeRevision === undefined
      ? 'unknown'
      : location.bridgeRevision === expected.bridgeRevision ? 'exact' : 'mismatch',
    story: location.storyRevision === undefined || expected.storyRevision === undefined
      ? 'unknown'
      : location.storyRevision === expected.storyRevision ? 'exact' : 'mismatch',
    catalog: location.catalogRevision === undefined || expected.catalogRevision === undefined
      ? 'unknown'
      : location.catalogRevision === expected.catalogRevision ? 'exact' : 'mismatch',
  };
  return { location, revision };
}

export function buildStoryDeepLink(input, location, revisions = {}) {
  const url = input instanceof URL ? new URL(input.href) : new URL(input, 'https://reader.invalid');
  const values = {
    ...location,
    storyRevision: revisions.storyRevision ?? location.storyRevision,
    catalogRevision: revisions.catalogRevision ?? location.catalogRevision,
    bridgeRevision: revisions.bridgeRevision ?? location.bridgeRevision ?? BRIDGE_REVISION,
  };
  for (const key of LOCATION_PARAMETERS) {
    const value = values[key];
    if (value === undefined || value === null || value === '') {
      url.searchParams.delete(key);
      continue;
    }
    if (!validValue(key, value)) throw new TypeError(`invalid deep-link parameter ${key}`);
    url.searchParams.set(key, value);
  }
  return url;
}

export function canSynchronizeExactEvent(revision) {
  return revision.bridge !== 'mismatch'
    && revision.story !== 'mismatch'
    && revision.catalog !== 'mismatch';
}
