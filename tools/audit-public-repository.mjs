import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Read-only publication inventory. Never prints file contents or secret values.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const list = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split('\0').filter(Boolean);
const files = [...new Set([...list('ls-files', '-z'), ...list('ls-files', '--others', '--exclude-standard', '-z')])];
const groups = new Map();
const large = [], privatePaths = [], missing = [];
for (const name of files) {
  const stat = await fs.lstat(path.join(root, name)).catch(() => null);
  if (!stat) { missing.push(name); continue; }
  if (!stat.isFile()) continue;
  const group = name.split('/').slice(0, 3).join('/');
  const row = groups.get(group) || { files: 0, bytes: 0 };
  row.files++; row.bytes += stat.size; groups.set(group, row);
  if (stat.size > 5 * 1024 * 1024) large.push({ path: name, bytes: stat.size });
  if (/(^|\/)(\.env(?:\..*)?|\.dev\.vars(?:\..*)?|\.wrangler|browser-profile[^/]*|__pycache__)(\/|$)|\.(pem|pfx|key)$/i.test(name)) privatePaths.push(name);
}
const report = { schema: 'adv-repository-inventory/v1', generatedAt: new Date().toISOString(), files: files.length, groups: [...groups.entries()].map(([group, value]) => ({ group, ...value })).sort((a,b) => b.bytes-a.bytes), large: large.sort((a,b)=>b.bytes-a.bytes), privatePaths, missing };
const output = path.join(root, 'work/repository-publication/inventory.json');
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, groups: report.groups.slice(0,25), large: report.large.slice(0,20), missingCount: missing.length, missing: undefined }, null, 2));
