import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'apps/classic-reader');
const atom = process.argv.find(arg => arg.startsWith('--atom='))?.slice(7);
if (!['atom05', 'atom06', 'atom07', 'atom08', 'atom09', 'atom10', 'atom11', 'atom12', 'atom13', 'atom14', 'atom15', 'atom16', 'atom17', 'atom18', 'atom19', 'atom20', 'atom21'].includes(atom)) throw Error('Specify the exact recorded atom');
const dir = path.join(root, 'reports/verification/reader-inheritance-20261012', atom);
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const scopeRoot = manifest.target === 'root' ? root : app;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const results = [];
function run(executable, args, cwd, env) {
  const child = spawnSync(executable, args, { cwd, env: env ?? process.env, encoding: 'utf8', maxBuffer: 12000000 });
  const record = { command: `${executable === process.execPath ? 'node' : executable} ${args.join(' ')}`, cwd,
    exitStatus: child.status, stdout: child.stdout, stderr: child.stderr, error: child.error?.message };
  results.push(record);
  console.log(`${record.exitStatus === 0 ? 'PASS' : 'EXIT ' + record.exitStatus} ${record.command}`);
  return record;
}
for (const entry of manifest.entries) {
  const actual = fs.readFileSync(path.join(scopeRoot, entry.file));
  if (hash(actual) !== entry.modifiedSha256) throw Error(`Active file changed since candidate: ${entry.file}`);
}
run(process.execPath, ['--test', 'test/*.test.js'], root);
run(process.execPath, ['--experimental-strip-types', '--test',
  'lib/reader-character-ruler.test.ts', 'lib/reader-display-preferences.test.ts', 'lib/screen-effects.test.ts',
  'lib/floating-geometry.test.ts', 'lib/viewport-filter.test.ts', 'lib/legacy-vn-corpus.test.ts',
  'lib/legacy-vn-voice-routing.test.ts', 'lib/legacy-vn-voice-routing-corpus.test.ts'], app);
run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false'], app);
if (process.argv.includes('--build')) {
  const proxy = 'http://127.0.0.1:10808';
  run(process.execPath, ['node_modules/next/dist/bin/next', 'build', '--webpack'], app,
    { ...process.env, HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy, NO_PROXY: 'localhost,127.0.0.1,::1', NEXT_TELEMETRY_DISABLED: '1' });
}
fs.writeFileSync(path.join(dir, 'modified-commands.json'), JSON.stringify(results, null, 2));
if (results.some(item => item.exitStatus !== 0)) throw Error('Modified checks failed; literal results recorded.');
const diff = spawnSync('git', ['-c', 'core.autocrlf=false', 'diff', '--binary', '--no-index', 'baseline', 'modified'], { cwd: dir, maxBuffer: 64 * 1024 * 1024 });
if (diff.status !== 1) throw Error(`Expected a nonempty diff, status=${diff.status}: ${diff.stderr}`);
fs.writeFileSync(path.join(dir, 'changes.patch'), diff.stdout);
const replaySuffix = process.argv.find(arg => arg.startsWith('--replay-suffix='))?.slice(16);
if (replaySuffix && !/^[a-z0-9-]+$/.test(replaySuffix)) throw Error('Invalid replay suffix');
const relativeFixture = `work/reader-inheritance-20261012/patch-${atom}${replaySuffix ? `-${replaySuffix}` : ''}`;
const fixture = path.join(root, relativeFixture);
if (fs.existsSync(fixture)) throw Error('Existing patch fixture retained; inspect before replaying again.');
fs.mkdirSync(fixture, { recursive: true });
for (const entry of manifest.entries.filter(item => item.existed)) {
  const target = path.join(fixture, entry.file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(dir, 'baseline', entry.file), target);
}
const replay = run('git', ['-c', 'core.autocrlf=false', 'apply', '--no-index', '-p2', `--directory=${relativeFixture}`, path.join(dir, 'changes.patch')], root);
const replayFiles = manifest.entries.map(entry => ({ file: entry.file,
  exact: fs.existsSync(path.join(fixture, entry.file)) && hash(fs.readFileSync(path.join(fixture, entry.file))) === entry.modifiedSha256 }));
fs.writeFileSync(path.join(dir, 'patch-replay.json'), JSON.stringify({ ...replay, files: replayFiles }, null, 2));
if (replay.exitStatus !== 0 || replayFiles.some(item => !item.exact)) throw Error('Patch replay mismatch');
const rollback = run(process.execPath, ['tools/rollback-reader-optics-foundation.mjs', `--atom=${atom}`, '--rehearse'], root);
if (rollback.exitStatus !== 0) throw Error('Rollback rehearsal failed');
const http = [];
for (const route of ['/apps/web/', '/reader/legacy-narcissu-himeko-himeko_atogaki', '/api/proofreading/config']) {
  const url = `http://127.0.0.1:4176${route}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  const body = await response.text();
  http.push({ input: url, status: response.status, bytes: Buffer.byteLength(body), sha256: hash(body),
    ...(route.endsWith('/config') ? { json: JSON.parse(body) } : { hasClientBootstrap: body.includes('/_next/'), hasLoadingMarkup: /magi-loading/.test(body) }) });
}
fs.writeFileSync(path.join(dir, 'http.json'), JSON.stringify(http, null, 2));
if (http.some(item => item.status !== 200)) throw Error('HTTP gate failed');
const verification = { schema: 1, atom, recordedAt: new Date().toISOString(),
  baselineCommands: path.join(dir, 'baseline-commands.json'), modifiedCommands: path.join(dir, 'modified-commands.json'),
  files: manifest.entries.length, reopenedModifiedFiles: true, patchReplay: replayFiles, rollback: path.join(dir, 'rollback-rehearsal.json'),
  http: path.join(dir, 'http.json'), browserHydration: 'pending; HTTP and React SSR are not hydration or visual acceptance',
  userAccepted: false, deployed: false };
fs.writeFileSync(path.join(dir, 'verification.json'), JSON.stringify(verification, null, 2));
console.log(`VERIFIED ${atom}: ${manifest.entries.length} scoped files, tests, exact replay, rollback, local HTTP`);
