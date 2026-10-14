import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'apps/classic-reader');
const evidence = path.join(root, 'reports/verification/reader-inheritance-20261012/atom06');
const manifestPath = path.join(evidence, 'manifest.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (fs.existsSync(manifestPath)) throw Error('Retain existing atom06 baseline; inspect its checkpoint.');
fs.mkdirSync(evidence, { recursive: true });
const tests = spawnSync(process.execPath, ['--test', 'test/classic-reader-edit-surface.test.js'], { cwd: root, encoding: 'utf8' });
fs.writeFileSync(path.join(evidence, 'baseline-commands.json'), JSON.stringify([{ command: 'node --test test/classic-reader-edit-surface.test.js', cwd: root,
  exitStatus: tests.status, stdout: tests.stdout, stderr: tests.stderr }], null, 2));
if (tests.status !== 1) throw Error('Expected the documented baseline regressions, inspect actual output.');
const changes = [
  ['components/StoryText.tsx', '? <span key={key} className="text-transparent">{value}</span>',
    '? <span key={key} className="text-transparent" data-line-break-spacer="true" style={{ visibility: \'hidden\' }}>{value}</span>'],
  ['app/reader/[id]/page.tsx', 'editedLines[editIndex]?.speaker\n                  || translatedSpeaker(',
    'editedLines[editIndex]?.speaker\n                  ?? translatedSpeaker('],
];
const entries = [];
for (const [file, before, after] of changes) {
  const target = path.join(app, file), baseline = fs.readFileSync(target);
  const newline = baseline.includes(Buffer.from('\r\n')) ? '\r\n' : '\n';
  const normalized = baseline.toString().replaceAll('\r\n', '\n');
  if (!normalized.includes(before) || normalized.indexOf(before) !== normalized.lastIndexOf(before)) throw Error(`Exact anchor changed: ${file}`);
  const modified = Buffer.from(normalized.replace(before, after).replaceAll('\n', newline));
  for (const [folder, bytes] of [['baseline', baseline], ['modified', modified]]) {
    const destination = path.join(evidence, folder, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, bytes);
  }
  entries.push({ file, existed: true, baselineSha256: hash(baseline), modifiedSha256: hash(modified),
    source: '56309ca742130e36d8d10fdb4f72de2a04cda02a: same marker spacer/nullish field semantics; native story controls retained' });
}
fs.writeFileSync(manifestPath, JSON.stringify({ schema: 1, root, app, entries }, null, 2));
for (const entry of entries) {
  const target = path.join(app, entry.file);
  if (hash(fs.readFileSync(target)) !== entry.baselineSha256) throw Error(`Concurrent edit: ${entry.file}`);
}
for (const entry of entries) {
  const target = path.join(app, entry.file);
  fs.copyFileSync(path.join(evidence, 'modified', entry.file), target);
  if (hash(fs.readFileSync(target)) !== entry.modifiedSha256) throw Error(`Write verification failed: ${entry.file}`);
}
console.log('APPLIED_AND_REOPENED atom06: hidden marker spacers + intentional empty speaker preserved');
