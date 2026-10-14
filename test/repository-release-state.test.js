import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPublishedRepository } from '../tools/cloudflare/repository-state.mjs';
const revision='a'.repeat(40);
const values={
  'branch --show-current':'main',
  'remote get-url origin':'https://github.com/HiiragiNemu/universal-adv-reader.git',
  'status --porcelain --untracked-files=normal':'',
  'rev-parse HEAD':revision,
  'ls-remote --exit-code origin refs/heads/main':revision+'\trefs/heads/main',
};
const runner=(changes={},calls=[]) => (command,args,options)=>{
  assert.equal(command,'git');assert.ok(options.timeout<=60000);calls.push(args.join(' '));
  return {status:0,stdout:{...values,...changes}[args.join(' ')]};
};
test('publication requires clean main already matching the dedicated remote without performing Git writes',()=>{
  const calls=[],result=assertPublishedRepository('.',runner({},calls));
  assert.equal(result.revision,revision);assert.equal(result.clean,true);assert.equal(result.remoteMatches,true);
  assert.deepEqual(calls,Object.keys(values));
});
test('dirty state, wrong branch and wrong repository fail before querying remote refs',()=>{
  for(const change of [{'branch --show-current':'other'},{'remote get-url origin':'https://github.com/other/project.git'},{'status --porcelain --untracked-files=normal':' M README.md'}]){
    const calls=[];assert.throws(()=>assertPublishedRepository('.',runner(change,calls)));assert(!calls.some(s=>s.startsWith('ls-remote')));
  }
});
test('stale remote, missing refs and Git command failures cannot be accepted as current publication',()=>{
  for(const remote of ['b'.repeat(40)+'\trefs/heads/main','',revision+'\trefs/heads/main\n'+'b'.repeat(40)+'\trefs/heads/other'])assert.throws(()=>assertPublishedRepository('.',runner({'ls-remote --exit-code origin refs/heads/main':remote})));
  assert.throws(()=>assertPublishedRepository('.',()=>({status:1,stdout:''})));
});
