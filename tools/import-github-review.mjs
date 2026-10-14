import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ADV_GITHUB_REPOSITORY, ADV_GITHUB_URL, parseGithubNativeReviewBody } from '../apps/classic-reader/lib/github-native-review.ts';
import { createNativeReviewStore } from './native-review-store.mjs';

/** Only read a fixed repository issue. Imported text can never execute commands,
 * approve a revision, mutate GitHub, or install content. The existing native store
 * verifies all source hashes, editable fields and before-values before saving. */
export async function importGithubReview({ number, readIssue, store, patchFileText = null }) {
  if (!Number.isSafeInteger(number) || number < 1) throw Error('需要正整数 Issue 编号');
  const issue = await readIssue(number);
  if (issue.number !== number || issue.url !== `${ADV_GITHUB_URL}/issues/${number}`
    || typeof issue.id !== 'string' || !/^[A-Za-z0-9_=-]{1,100}$/.test(issue.id)
    || issue.state !== 'OPEN' || typeof issue.updatedAt !== 'string'
    || !Number.isFinite(Date.parse(issue.updatedAt))
    || typeof issue.author?.login !== 'string' || !/^[A-Za-z0-9-]{1,39}(?:\[bot\])?$/.test(issue.author.login)) throw Error('GitHub Issue 身份、状态或所属仓库不匹配');
  let patch;
  if (patchFileText !== null) {
    if (typeof patchFileText !== 'string' || patchFileText.length > 5_000_000) throw Error('本机补丁文件超过大小限制');
    patch = JSON.parse(patchFileText);
  } else patch = parseGithubNativeReviewBody(issue.body);
  const patchSha256 = createHash('sha256').update(JSON.stringify(patch)).digest('hex');
  const requestId = createHash('sha256').update(JSON.stringify([issue.id, issue.updatedAt, patchSha256, patchFileText !== null])).digest('hex');
  const note = `GitHub Issue: ${issue.url}\nGitHub author: ${issue.author.login}\nUpdated: ${issue.updatedAt}\nPatch SHA-256: ${patchSha256}\n来源：${patchFileText === null ? '读取 Issue 正文中的原生补丁' : '站长显式选择的本机附件；需人工核对附件与 Issue 的对应关系'}。尚未批准、安装或发布。`;
  const record = await store.submit({ requestId, patch, author: `GitHub:${issue.author.login}`, note });
  return { schema: 'adv-github-review-import/v1', issueUrl: issue.url, issueUpdatedAt: issue.updatedAt, githubAuthor: issue.author.login,
    patchSha256, recordId: record.id, status: record.status, currentRecordVersion: record.version,
    attachmentVerifiedByApi: false, githubWritePerformed: false, approvalPerformed: false, installationPerformed: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const usage = '用法：node tools/import-github-review.mjs --issue 123 [--patch 本机补丁.json]';
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--issue', '--patch'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw Error(usage);
    options[args[i]] = args[i + 1];
  }
  if (!/^\d+$/.test(options['--issue'] || '')) throw Error(usage);
  const readIssue = async number => JSON.parse(execFileSync('gh', ['issue', 'view', String(number), '--repo', ADV_GITHUB_REPOSITORY,
    '--json', 'id,number,url,body,state,author,updatedAt'], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 60000, env: { ...process.env, GH_PROMPT_DISABLED: '1' } }));
  let patchFileText = null;
  if (options['--patch']) {
    const filename = path.resolve(options['--patch']), stat = await fs.stat(filename);
    if (!stat.isFile() || stat.size > 5_000_000) throw Error('本机补丁必须为不超过 5 MB 的普通 JSON 文件');
    patchFileText = await fs.readFile(filename, 'utf8');
  }
  const result = await importGithubReview({ number: Number(options['--issue']), readIssue, store: createNativeReviewStore(), patchFileText });
  console.log(JSON.stringify(result, null, 2));
  console.log('请在本机 /review/submissions 页面核对投稿；本命令不执行批准、安装或发布。');
}
