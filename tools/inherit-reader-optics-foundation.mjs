import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'apps/classic-reader');
const evidence = path.join(root, 'reports/verification/reader-inheritance-20261012/atom01');
const reference = 'D:/magia/MyProducts/magi-reader';
const commit = '56309ca742130e36d8d10fdb4f72de2a04cda02a';
const files = [
  'lib/reader-display-preferences.ts', 'lib/reader-display-preferences.test.ts',
  'lib/screen-effects.ts', 'lib/screen-effects.test.ts',
  'lib/ios-optics.ts', 'lib/use-ios-webkit.ts', 'lib/use-screen-effects.ts',
];
if (existsSync(path.join(evidence, 'manifest.json'))) throw Error('Existing atom checkpoint: inspect it instead of replacing the baseline.');
mkdirSync(evidence, { recursive: true });
const run = (name, args) => {
  const r = spawnSync(process.execPath, args, { cwd: app, encoding: 'utf8', maxBuffer: 12000000 });
  const result = { command: `node ${args.join(' ')}`, cwd: app, exitStatus: r.status, stdout: r.stdout, stderr: r.stderr };
  writeFileSync(path.join(evidence, `${name}.json`), JSON.stringify(result, null, 2));
  return result;
};
const baseline = run('baseline-tests', ['--experimental-strip-types', '--test', 'lib/reader-display-preferences.test.ts', 'lib/legacy-vn-corpus.test.ts', 'lib/legacy-vn-voice-routing.test.ts', 'lib/legacy-vn-voice-routing-corpus.test.ts']);
if (baseline.exitStatus !== 0) throw Error('Baseline test failure: no source writes performed.');
const entries = files.map(file => {
  const destination = path.join(app, file);
  const existed = existsSync(destination);
  const old = existed ? readFileSync(destination) : null;
  const source = execFileSync('git', ['-C', reference, 'show', `${commit}:website/${file}`], { maxBuffer: 12000000 });
  for (const [folder, bytes] of [['baseline', old], ['modified', source]]) {
    if (bytes === null) continue;
    const output = path.join(evidence, folder, file);
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, bytes);
  }
  return { file, existed, baselineBytes: old?.length ?? null, modifiedBytes: source.length };
});
writeFileSync(path.join(evidence, 'manifest.json'), JSON.stringify({ schema: 1, root, app, commit, reference, entries }, null, 2));
for (const entry of entries) {
  const target = path.join(app, entry.file);
  if (entry.existed && !readFileSync(target).equals(readFileSync(path.join(evidence, 'baseline', entry.file)))) throw Error(`Concurrent edit: ${entry.file}`);
  if (!entry.existed && existsSync(target)) throw Error(`Concurrent new file: ${entry.file}`);
  writeFileSync(target, readFileSync(path.join(evidence, 'modified', entry.file)));
}
const diff = spawnSync('git', ['-c', 'core.autocrlf=false', 'diff', '--no-index', '--no-ext-diff', '--', 'baseline', 'modified'], { cwd: evidence, encoding: 'utf8', maxBuffer: 12000000 });
if (![0, 1].includes(diff.status)) throw Error(diff.stderr || 'Diff generation failed');
writeFileSync(path.join(evidence, 'changes.patch'), diff.stdout);
const modified = run('modified-tests', ['--experimental-strip-types', '--test', 'lib/reader-display-preferences.test.ts', 'lib/screen-effects.test.ts', 'lib/legacy-vn-corpus.test.ts', 'lib/legacy-vn-voice-routing.test.ts', 'lib/legacy-vn-voice-routing-corpus.test.ts']);
const typecheck = run('modified-typecheck', ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false']);
const parity = entries.map(entry => ({ file: entry.file, exactPinnedSource: readFileSync(path.join(app, entry.file)).equals(readFileSync(path.join(evidence, 'modified', entry.file))) }));
writeFileSync(path.join(evidence, 'verification.json'), JSON.stringify({ baseline, modified, typecheck, parity, integrated: 'Shared preference runtime inherited; route optical rendering and settings integration pending', userAccepted: false }, null, 2));
console.log(JSON.stringify({ baselineExit: baseline.exitStatus, modifiedExit: modified.exitStatus, files: entries.length, exactSource: parity.every(x => x.exactPinnedSource), evidence }));
if (modified.exitStatus !== 0) process.exitCode = 1;
