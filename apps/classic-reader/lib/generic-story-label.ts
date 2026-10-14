/** Display titles come from the native corpus. Route IDs remain separate. */
type NativeStoryTitle = { id: string; title?: string; title_cn?: string; title_jp?: string; filename_cn?: string; filename_jp?: string };
export function genericStoryLabel(story: NativeStoryTitle): string {
  const title = [story.title_cn, story.title, story.title_jp].find(value => typeof value === 'string' && value.trim());
  if (title) return title.trim();
  return (story.filename_cn || story.filename_jp || story.id).replace(/(_cn|_jp)?\.(?:txt|json)$/i, '');
}
