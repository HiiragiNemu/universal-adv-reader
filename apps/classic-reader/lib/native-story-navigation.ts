/**
 * Native catalog metadata affects navigation only. Original story ids, paths,
 * text, source-language titles and event identities stay unchanged.
 */
export type NativeStorySection = {
  id: string;
  anchorId: string;
  title_cn: string;
  title_jp: string;
  ordinal: number;
  target_event_id_cn?: string;
  target_event_id_jp?: string;
  inherited_title?: boolean;
  native_title_event?: boolean;
  available_locales?: Array<'zh-CN' | 'ja-JP'>;
};

export type NativeStoryNavigation = {
  native_group_id?: string;
  native_group_order?: number;
  native_story_order?: number;
  nav_title_cn?: string;
  nav_title_jp?: string;
  native_sections?: NativeStorySection[];
};

const collator = new Intl.Collator(['zh-CN', 'ja-JP'], {
  numeric: true,
  sensitivity: 'base',
});
const ordinal = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : Number.MAX_SAFE_INTEGER;

export function nativeNavigationLabel(
  story: NativeStoryNavigation,
  fallback: string,
): string {
  return story.nav_title_cn?.trim() || fallback;
}

export function compareNativeStories(
  left: NativeStoryNavigation & { id: string },
  right: NativeStoryNavigation & { id: string },
): number {
  return ordinal(left.native_story_order) - ordinal(right.native_story_order)
    || collator.compare(left.id, right.id);
}

export function nativeGroupOrder(stories: readonly NativeStoryNavigation[]): number {
  return stories.reduce(
    (current, story) => Math.min(current, ordinal(story.native_group_order)),
    Number.MAX_SAFE_INTEGER,
  );
}

export function nativeSectionLinks(
  story: NativeStoryNavigation,
  sourceLocale?: 'zh-CN' | 'ja-JP',
) {
  return (story.native_sections ?? [])
    .filter(section => !sourceLocale || !section.available_locales
      || section.available_locales.includes(sourceLocale))
    .map(section => ({
      ...section,
      title: sourceLocale === 'ja-JP'
        ? section.title_jp.trim() || section.title_cn.trim()
        : section.title_cn.trim() || section.title_jp.trim(),
    }));
}
