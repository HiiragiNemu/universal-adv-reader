export const GENERIC_CATEGORIES = ['main_story', 'event_story', 'character_story', 'supplement_story'] as const;
export const isGenericCategory = (value: string): boolean => (GENERIC_CATEGORIES as readonly string[]).includes(value);
export const genericCategory = (value: string): string => isGenericCategory(value) ? value : 'main_story';
export function genericSearchTitle(story: { id: string; folder: string; title?: string; title_cn?: string; title_jp?: string; filename_cn?: string; filename_jp?: string; nav_title_cn?: string; nav_title_jp?: string; native_sections?: Array<{ title_cn: string; title_jp: string }> }, includeJapanese: boolean): string {
  return [story.id, story.folder, story.title_cn || story.title, story.filename_cn, story.nav_title_cn,
    ...(story.native_sections ?? []).map(section => section.title_cn),
    ...(includeJapanese ? [story.title_jp, story.filename_jp, story.nav_title_jp,
      ...(story.native_sections ?? []).map(section => section.title_jp)] : [])].filter(Boolean).join(' ');
}
