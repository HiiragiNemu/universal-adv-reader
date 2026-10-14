export const normalizedOfficialTitle = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
};

export const resolveOfficialChapterTitle = (
  stories: ReadonlyArray<{ official_tw_chapter_title?: string }>,
  fallback: string,
): string => {
  const titles = [...new Set(
    stories
      .map(story => normalizedOfficialTitle(story.official_tw_chapter_title))
      .filter((value): value is string => Boolean(value)),
  )];
  return titles.length === 1 ? titles[0] : fallback;
};

export const resolveOfficialSectionTitle = (
  titles: readonly string[] | undefined,
  sectionNumber: string | number | undefined,
  fallback: string,
  identity?: {
    displayTitles?: Readonly<Record<string, string>>;
    sourceName?: string;
    sources?: readonly string[];
    branch?: string;
  },
): string => {
  const displaySource = normalizedOfficialTitle(identity?.sourceName)?.replace(/\.json$/i, '');
  const displayTitle = displaySource && identity?.displayTitles
    ? normalizedOfficialTitle(identity.displayTitles[displaySource])
    : undefined;
  if (displayTitle) return identity?.branch ? `${displayTitle} · 分支${identity.branch}` : displayTitle;
  if (identity?.branch) return fallback;
  // An explicit source list is authoritative. Never use a subset's renumbered
  // Section ordinal when its source is missing or ambiguous in that list.
  if (identity?.sources !== undefined) {
    const sourceId = (value: unknown): string | undefined =>
      normalizedOfficialTitle(value)?.replace(/\.json$/i, '');
    const source = sourceId(identity.sourceName);
    const sources = identity.sources;
    if (!source || !Array.isArray(sources) || sources.length !== titles?.length) {
      return fallback;
    }
    const matches = sources
      .map((value, index) => sourceId(value) === source ? index : -1)
      .filter(index => index >= 0);
    return matches.length === 1
      ? normalizedOfficialTitle(titles?.[matches[0]]) ?? fallback
      : fallback;
  }
  const numeric = Number(sectionNumber);
  if (!Number.isInteger(numeric) || numeric < 1) return fallback;
  return normalizedOfficialTitle(titles?.[numeric - 1]) ?? fallback;
};
