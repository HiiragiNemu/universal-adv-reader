import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {repositoryRoot} from '../test-support/helpers.js';
test('real nar2_12, EV462B and EV22 page pipeline preserves events, pairs bodies and labels speakers without duplicating embedded names',()=>{
  const r=spawnSync(process.execPath,['test-support/content-repair-screenshot-probe.mjs',repositoryRoot],{cwd:repositoryRoot,encoding:'utf8'});
  assert.equal(r.status,0,r.stdout+r.stderr);const data=JSON.parse(r.stdout);assert.ok(Object.values(data.checks).every(Boolean));
});
test('whole-body native proof rejects nonblank names, changed instructions and unsupported or entering branch edges',()=>{
  const code=`import importlib.util,sys,json,copy
from pathlib import Path
from unittest.mock import patch
s=importlib.util.spec_from_file_location('kernel','tools/build-native-correspondence.py');m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m)
adapter=json.loads((m.RESOURCE/'manifests/generated/reader-adapter.json').read_bytes());story=next(s for s in adapter['stories'] if s['canonicalStoryId']=='narcissu-3rd/nar2_12')
route=json.loads(Path('apps/classic-reader/public/data/legacy-vn/narcissu-3rd/nar2_12.routes.json').read_bytes());variants={v['id']:v for v in story['variants']}
cn,jp=[m.native_tokens(variants[route[k]]) for k in ('chineseVariantId','japaneseVariantId')]
events=lambda key:[e for v in route['variantRoutes'] if v['variantId']==route[key] for sec in v['sections'] for e in sec['events']]
ce,je=events('chineseVariantId'),events('japaneseVariantId');run=lambda c=cn,j=jp,left=ce,right=je:m.blank_speaker_whole_stream(c,j,left,right)
proof=run();assert proof and len(proof['bodyPairs'])==388;assert len(proof['blankSpeakers']['cn'])==178 and len(proof['blankSpeakers']['jp'])==177
checks=[];blank=proof['blankSpeakers']['cn'][0]
c=copy.deepcopy(cn);c['tokens'][0]='0008ffffffff';assert run(c=c) is None;checks.append('changed-instruction')
c=copy.deepcopy(cn);c['branches'][0]['supported']=False;assert run(c=c) is None;checks.append('unknown-control')
c=copy.deepcopy(cn);c['branches'][0]['targetToken']=blank['tokenIndex'];assert run(c=c) is None;checks.append('entering-blank-speaker')
c=copy.deepcopy(cn);c['branches'][0]['targetToken']+=1;assert run(c=c) is None;checks.append('different-control-target')
c=copy.deepcopy(cn);next(x for x in c['messages'] if x['tokenIndex']==blank['tokenIndex']+1)['tokenIndex']+=10000;assert run(c=c) is None;checks.append('nonadjacent-body')
raw=json.loads(Path(cn['scriptPath']).read_bytes());next(e for e in raw['textEvents'] if e['codeOffset']==blank['codeOffset'])['text']='real speaker name'
with patch.object(Path,'read_bytes',return_value=json.dumps(raw).encode()):assert run() is None
checks.append('nonblank-speaker')
assert run(left=[e for e in ce if e.get('eventId')!='mjo-19a']) is None;checks.append('unaccounted-body')
print(json.dumps({'realBodyPairs':388,'negativeCases':checks}))`;
  const r=spawnSync('python',['-B','-c',code],{cwd:repositoryRoot,encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(JSON.parse(r.stdout).negativeCases.length,7);
});
