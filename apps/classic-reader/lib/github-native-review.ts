import type { NativeTranslationPatch } from './native-translation-patch.ts';

export const ADV_GITHUB_REPOSITORY = 'HiiragiNemu/universal-adv-reader';
export const ADV_GITHUB_URL = `https://github.com/${ADV_GITHUB_REPOSITORY}`;
const start = '<!-- universal-adv-native-patch:v1 -->';
const end = '<!-- /universal-adv-native-patch:v1 -->';

/** A draft is not a submitted issue. GitHub performs login and final confirmation. */
export function githubNativeReviewDraft(patch: NativeTranslationPatch) {
  if (patch.schema !== 'native-reader-translation-patch/v1' || patch.locale !== 'zh-CN'
    || !/^[a-f0-9]{64}$/.test(patch.sourceSha256) || !patch.storyId || patch.storyId.length > 200
    || !Array.isArray(patch.changes) || !patch.changes.length) throw Error('原生补丁格式或来源无效');
  const serialized = JSON.stringify(patch, null, 2);
  const title = `[文本修订] ${patch.storyId.replace(/[\r\n]/g, ' ').slice(0, 140)}`;
  const introduction = '请说明修改依据，并检查下方补丁。提交后内容公开；提交不等于批准或安装。\n\n';
  const body = introduction + start + '\n```json\n' + serialized + '\n```\n' + end;
  const makeUrl = (text: string) => `${ADV_GITHUB_URL}/issues/new?${new URLSearchParams({ title, body: text })}`;
  const url = makeUrl(body);
  const inline = url.length <= 6000;
  return {
    url: inline ? url : makeUrl(introduction + '补丁已导出为 universal-adv-revision.json。请将该文件附在本 Issue，或将文件内容粘贴到下面的 JSON 代码块；不要把本地文件路径当作附件。\n\n' + start + '\n```json\n\n```\n' + end),
    inline, serialized,
  };
}

/** Parse only an explicit JSON patch block; Markdown is never executed. */
export function parseGithubNativeReviewBody(body: string): NativeTranslationPatch {
  if (typeof body !== 'string' || body.length > 200_000) throw Error('Issue 正文过大或格式无效');
  const a = body.indexOf(start), b = body.indexOf(end);
  if (a < 0 || b <= a || body.indexOf(start, a + start.length) >= 0 || body.indexOf(end, b + end.length) >= 0) throw Error('需要且只允许一个原生补丁区块');
  const block = body.slice(a + start.length, b).trim();
  const match = block.match(/^```json\r?\n([\s\S]*?)\r?\n```$/);
  if (!match) throw Error('原生补丁区块必须是 JSON 代码块');
  const patch: unknown = JSON.parse(match[1]);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Error('补丁不是对象');
  const data = patch as NativeTranslationPatch;
  // The local native review store additionally validates every binding, source
  // hash, before-value, target field and current revision before accepting it.
  if (data.schema !== 'native-reader-translation-patch/v1' || data.locale !== 'zh-CN'
    || !Array.isArray(data.changes) || !data.changes.length || data.changes.length > 5000
    || typeof data.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.sourceSha256)) throw Error('原生补丁类型无效或没有修改');
  return data;
}
