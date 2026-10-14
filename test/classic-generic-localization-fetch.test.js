import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { classicApp, classicModules } from '../test-support/classic-module-loader.js';

const { applyTrustedExedraLocalizationStatus } = classicModules().load('lib/story-index.ts');
const catalog = JSON.parse(fs.readFileSync(path.join(classicApp, 'public/story_index.json'), 'utf8'));

test('native Narcissu and KANA catalog never requests the unrelated Exedra backend', async () => {
  const before = JSON.stringify(catalog); let calls = 0;
  const result = await applyTrustedExedraLocalizationStatus(catalog, async () => { calls++; return Response.json({error:'unconfigured'}, {status:503}); });
  assert.equal(calls, 0, 'native catalog hydration must not emit an inherited /api/exedra/localization-status 503');
  assert.deepEqual(result, catalog); assert.equal(JSON.stringify(catalog), before);
});

test('empty or already localized catalog does not need an Exedra localization request', async () => {
  for (const entries of [[], [{ id:'done', game:'exedra', has_cn:true, source_identity:'exedra:done' }],
    [{id:'local',game:'exedra',has_cn:false,path_cn:'/local.txt',source_identity:'exedra:local'}],
    [{id:'invalid',game:'kana',source_identity:'exedra:invalid'}]]) {
    let calls=0; const result=await applyTrustedExedraLocalizationStatus(entries,async()=>{calls++;return Response.json({});});
    assert.equal(calls,0); assert.deepEqual(result,entries);
  }
});

test('eligible Exedra consumer retains exact trusted identity matching in mixed catalogs', async () => {
  const waiting={id:'exedra-story',game:'exedra',has_cn:false,source_identity:'exedra:source-A'};
  let calls=0;
  const result=await applyTrustedExedraLocalizationStatus([catalog[0],waiting],async(url,options)=>{
    calls++;assert.equal(url,'/api/exedra/localization-status');assert.equal(options.credentials,'same-origin');
    return Response.json({version:1,total:1,database_configured:true,entries:[{story_id:waiting.id,source_identity:waiting.source_identity}]});
  });
  assert.equal(calls,1);assert.strictEqual(result[0],catalog[0]);assert.equal(result[1].path_cn,'/api/exedra/localized/exedra-story');
  assert.equal(waiting.has_cn,false);
  const stale=await applyTrustedExedraLocalizationStatus([waiting],async()=>Response.json({version:1,total:1,database_configured:true,entries:[{story_id:waiting.id,source_identity:'exedra:wrong-source'}]}));
  assert.deepEqual(stale,[waiting]);
});
