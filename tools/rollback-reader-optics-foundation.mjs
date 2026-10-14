import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const atom = process.argv.find(value => value.startsWith('--atom='))?.slice(7) ?? 'atom01';
if (!['atom01', 'atom02', 'atom03', 'atom04', 'atom05', 'atom06', 'atom07', 'atom08', 'atom09', 'atom10', 'atom11', 'atom12', 'atom13', 'atom14', 'atom15', 'atom16', 'atom17', 'atom18', 'atom19', 'atom20', 'atom21'].includes(atom)) throw Error('Unknown recorded atom');
const evidence = path.join(root, 'reports/verification/reader-inheritance-20261012', atom);
const manifest = JSON.parse(readFileSync(path.join(evidence, 'manifest.json'), 'utf8'));
const rehearsal = process.argv.includes('--rehearse');
if (!rehearsal && !process.argv.includes('--apply')) throw Error('Use --rehearse for a scoped fixture, or --apply to restore only this atom.');
const appTarget = manifest.target === 'root' || ['atom02', 'atom04'].includes(atom) ? root : path.join(root, 'apps/classic-reader');
const target = rehearsal ? path.join(root, `work/reader-inheritance-20261012/rollback-${atom}`) : appTarget;
const files = manifest.entries.map(entry => {
  const filename = path.resolve(target, entry.file);
  if (!filename.startsWith(`${target}${path.sep}`)) throw Error('Rollback path escapes its exact target');
  const modified = readFileSync(path.join(evidence, 'modified', entry.file));
  const baseline = entry.existed ? readFileSync(path.join(evidence, 'baseline', entry.file)) : null;
  if (rehearsal) {
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, modified);
  }
  if (!existsSync(filename) || !readFileSync(filename).equals(modified)) throw Error(`Preserve later changes; rollback stopped: ${entry.file}`);
  return { ...entry, filename, baseline };
});
for (const item of files) {
  if (item.existed) writeFileSync(item.filename, item.baseline);
  else unlinkSync(item.filename);
}
const results = files.map(item => ({ file: item.file, restored: item.existed ? readFileSync(item.filename).equals(item.baseline) : !existsSync(item.filename) }));
if (!results.every(item => item.restored)) throw Error('Rollback verification failed');
const record = { mode: rehearsal ? 'rehearsal-scoped-fixture' : 'apply-project', target, results, passed: true };
writeFileSync(path.join(evidence, rehearsal ? 'rollback-rehearsal.json' : 'rollback-applied.json'), JSON.stringify(record, null, 2));
console.log(JSON.stringify(record));
