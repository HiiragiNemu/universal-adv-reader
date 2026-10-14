import { spawnSync } from 'node:child_process';

/** Publish only a clean main already present in the dedicated public repository.
 * Read remote refs; never commit, push, change branches or trigger a workflow. */
export function assertPublishedRepository(root, run = spawnSync) {
  const git = args => {
    const result = run('git', args, { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
    if (result.status !== 0 || result.error) throw Error('Git release preflight failed: ' + args.join(' '));
    return result.stdout.trim();
  };
  const branch = git(['branch', '--show-current']);
  if (branch !== 'main') throw Error('Publish only the existing main branch');
  const remote = git(['remote', 'get-url', 'origin']);
  if (!['https://github.com/HiiragiNemu/universal-adv-reader.git', 'https://github.com/HiiragiNemu/universal-adv-reader', 'git@github.com:HiiragiNemu/universal-adv-reader.git'].includes(remote)) throw Error('Unexpected publication repository');
  if (git(['status', '--porcelain', '--untracked-files=normal'])) throw Error('Commit and push reviewed changes before publication; working tree is not clean');
  const revision = git(['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40}$/.test(revision)) throw Error('Invalid source revision');
  const remoteRef = git(['ls-remote', '--exit-code', 'origin', 'refs/heads/main']);
  const records = remoteRef.split(/\r?\n/).map(line => line.split(/\s+/));
  if (records.length !== 1 || records[0][0] !== revision || records[0][1] !== 'refs/heads/main') throw Error('Remote main differs from local HEAD; synchronize before publication');
  return { repository: 'HiiragiNemu/universal-adv-reader', branch, revision, clean: true, remoteMatches: true };
}
