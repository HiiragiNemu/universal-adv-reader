import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('nard01 keeps four AI correspondences and independent unverified native buffers',()=>{
  const result=spawnSync('python',['-X','utf8','-B','test/nard01_source_bound_review_test.py'],{
    cwd:root,encoding:'utf8',timeout:30000,env:{...process.env,PYTHONIOENCODING:'utf-8'},
  });
  assert.equal(result.status,0,result.stderr||result.stdout||String(result.error));
  assert.match(result.stderr,/Ran 21 tests/);
});
