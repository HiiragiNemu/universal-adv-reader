import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { classicApp, classicModules, ts } from '../test-support/classic-module-loader.js';
import { readNativeCorpusExpectation, requiresParallelNativeCorrespondence, assertSelectedSourceVariants, assertRawNativeRows, assertDisplayConservesRows } from '../test-support/native-corpus-expectations.js';

const root = path.resolve(classicApp, '../..'), pub = path.resolve(process.env.ADV_CLASSIC_PUBLIC_ROOT ?? path.join(classicApp, 'public'));
const read = file => fs.readFileSync(path.join(pub, file.replace(/^\/+/, '')), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const { index: stories, sources } = readNativeCorpusExpectation(pub);
const legacyVoiceProofs = JSON.parse(fs.readFileSync(path.join(root, 'test-support/fixtures/native/legacy-voice-proof-baseline.json'), 'utf8')).records;
const modules = classicModules(), parser = modules.load('lib/story-parser.ts'), routing = modules.load('lib/legacy-vn-voice-routing.ts');
const cross = () => modules.load('lib/legacy-vn-correspondence.ts'), alignment = () => modules.load('lib/legacy-vn-alignment.ts');

const parallelStories = stories.filter(story => requiresParallelNativeCorrespondence(sources.get(story.source_identity)));
function seedGeneratorInputs(destination) {
  assert.ok(destination.startsWith(path.join(root, 'work') + path.sep));
  const files = new Set(['story_index.json', 'data/legacy-vn/manifests/reader-adapter.json']);
  for (const story of stories) {
    files.add(routing.legacyVoiceRoutePath(story.source_identity));
    if (story.path_cn) files.add(story.path_cn);
    if (story.path_jp) files.add(story.path_jp);
  }
  for (const file of files) {
    const relative = file.replace(/^\/+/, ''), target = path.join(destination, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(pub, relative), target);
  }
}

function fixture(story) {
  const rawRoute = read(routing.legacyVoiceRoutePath(story.source_identity));
  const route = { ...routing.parseLegacyVoiceRouteDocument(JSON.parse(rawRoute), story.source_identity), documentSha256: digest(rawRoute) };
  const cnText = story.path_cn ? read(story.path_cn) : '', jpText = story.path_jp ? read(story.path_jp) : '';
  const parse = (text, file) => file ? parser.parseStoryContent(text, { filename: file.split('/').at(-1), mergeConsecutiveTextLines: false }).lines : [];
  return { route, cnText, jpText, cn: parse(cnText, story.path_cn), jp: parse(jpText, story.path_jp) };
}
function manifest(f) { return JSON.parse(read(`/data/legacy-vn/${f.route.canonicalStoryId}.alignment.json`)); }
function actualPage(f, document, mode = 'split') {
  return modules.fragments('app/reader/[id]/page.tsx', [
    'activeLegacyVoiceSlot', 'currentNativeCorrespondence', 'nativeAlignmentState', 'nativePresentationState', 'cnVoiceSlots', 'jpVoiceSlots', 'renderList', 'activeVoiceSlots',
  ], { ...routing, ...alignment(), ...cross(), currentNativeEditSource: null, nativeEditState: { error: '' }, ...modules.load('lib/native-reader-revision.ts'), useMemo: fn => fn(), legacyVoiceRoute: f.route,
    cnEventLines: f.cn, jpEventLines: f.jp, cnSource: { raw: f.cnText }, jpSource: { raw: f.jpText },
    currentLegacyVoiceRoutePath: routing.legacyVoiceRoutePath(f.route.canonicalStoryId),
    nativeCorrespondenceState: { route: f.route, cnRaw: f.cnText, jpRaw: f.jpText, data: document, error: '', loading: false },
    isEditMode: false, editedCnLines: [], mode, alignStoryLines() { throw Error('Cross-version reader fell back to array zip'); },
    displayedCnLines: f.cn, displayedJpLines: f.jp,
    legacyVoiceSlotState: { cn: routing.buildLegacyVoiceSlots(f.route, 'zh-CN', f.cn), jp: routing.buildLegacyVoiceSlots(f.route, 'ja-JP', f.jp) },
  });
}

fs.mkdirSync(path.join(root, 'work/test-results'), { recursive: true });

test('effective cross-version sidecars bind exact source bytes and independently cover every native body, choice and raw editor key', async () => {
  const x = cross(), a = alignment(), tested = [];
  for (const story of stories) {
    const f = fixture(story);
    assertSelectedSourceVariants(story, f.route, sources);
    if (!f.route.chineseVariantId || f.route.chineseVariantId === f.route.japaneseVariantId) continue;
    tested.push(story.source_identity);
    const before = JSON.stringify(f);
    const fetcher = async (input, options) => { assert.ok(input.endsWith('.alignment.json')); assert.equal(options.credentials, 'same-origin'); return new Response(read(input)); };
    const sidecar = await x.loadNativeCorrespondence(f.route, f.cnText, f.jpText, new AbortController().signal, fetcher);
    const events = side => f.route.variantRoutes.find(v => v.variantId === f.route[side === 'cn' ? 'chineseVariantId' : 'japaneseVariantId']).sections.flatMap(section => section.events);
    for (const side of ['cn', 'jp']) {
      const all = events(side).filter(event => event.kind === 'line').map(event => event.eventId);
      assert.equal(new Set(all).size, all.length);
      const ordinary = sidecar.pairs.map(pair => pair[side + 'EventId']);
      assert.equal(new Set(ordinary).size, ordinary.length, 'one-to-one anchors retain unique source IDs');
      const grouped = (sidecar.groupPairs ?? []).flatMap(group => group[side + 'EventIds']);
      assert.equal(new Set(grouped).size, grouped.length, 'native buffer groups do not overlap each other');
      for (const group of sidecar.groupPairs ?? []) {
        const ids = group[side + 'EventIds'];
        assert.ok(ids.length > 0);
        const positions = ids.map(id => all.indexOf(id));
        assert.ok(positions.every((value, index) => value >= 0 && (!index || value > positions[index - 1])), 'group members keep native source order');
        assert.equal(group.proof.completeNativeBuffers, true);
        assert.equal(group.proof.existingAnchorsRetainOrder, true);
        for (const pair of sidecar.pairs) {
          assert.equal(group.cnEventIds.includes(pair.cnEventId), group.jpEventIds.includes(pair.jpEventId), 'a retained pair cannot cross a group boundary');
        }
      }
      const reviewSource = JSON.parse(fs.readFileSync(path.join(root, 'tools/data/narcissu3-bilingual-review.json'), 'utf8'));
      const expectedReview = reviewSource.stories.find(item => item.storyId === story.source_identity)?.blocks.flatMap(block => block.passages) ?? [];
      const actualReview = sidecar.reviewedPassages ?? [];
      assert.deepEqual(actualReview.map(item => [item.id, item.cnEventIds, item.jpEventIds]), expectedReview.map(item => [item.id, item.cnEventIds, item.jpEventIds]), 'review IDs come from independently frozen source passages, never native offset guesses');
      for (const review of actualReview) {
        assert.equal(review.schema, 'source-bound-bilingual-review/v1');
        assert.equal(review.reviewer, 'AI'); assert.equal(review.humanVerified, false); assert.equal(review.translationQualityVerified, false);
      }
      const reviewed = expectedReview.flatMap(item => item[side + 'EventIds']);
      assert.equal(new Set(reviewed).size, reviewed.length, 'review passages never overlap');
      assert.ok(reviewed.every(id => !ordinary.includes(id) && !grouped.includes(id)), 'review never replaces an existing native proof');
      const covered = new Set([...ordinary, ...grouped, ...reviewed]);
      assert.ok([...covered].every(id => all.includes(id)), 'all paired IDs exist in that selected native variant');
      const rest = all.filter(id => !covered.has(id));
      assert.deepEqual([...sidecar.unpaired[side]].sort(), [...rest].sort(), side + ' unpaired is the independently recomputed source complement');
      assert.equal(covered.size + rest.length, all.length, 'paired/unpaired body union has no gap or duplication');
      const choiceIds = events(side).filter(event => event.kind === 'choice').map(event => event.eventId);
      const choicePairs = (sidecar.choicePairs ?? []).map(pair => pair[side + 'EventId']);
      assert.equal(new Set(choicePairs).size, choicePairs.length);
      assert.ok(choicePairs.every(id => choiceIds.includes(id)));
      assert.deepEqual([...(sidecar.unpairedChoices?.[side] ?? [])].sort(), choiceIds.filter(id => !choicePairs.includes(id)).sort(), side + ' native menu coverage');
    }
    const rows = x.buildParallelNativeAlignment(f.route, f.cn, f.jp, sidecar);
    assertRawNativeRows(f.route, rows, f.cn, f.jp);
    const compact = a.mergeNativeAlignedRows(rows);
    assertDisplayConservesRows(rows, compact, f.cn, f.jp);
    for (const [language, source] of [['cn', f.cn], ['jp', f.jp]]) {
      const slots = routing.buildLegacyVoiceSlots(f.route, language === 'cn' ? 'zh-CN' : 'ja-JP', source).eventSlots;
      const strip = cue => { const { occurrenceId, ...original } = cue; return original; };
      assert.deepEqual(rows.flatMap(row => row[language + 'Slot']?.cues.map(strip) ?? []), slots.flatMap(slot => slot?.cues ?? []));
    }
    const state = actualPage(f, sidecar);
    assert.equal(state.nativeAlignmentState.error, '');
    assert.deepEqual(state.renderList, compact);
    const edits = a.seedNativeEditableLines(rows, 'current');
    assert.deepEqual(edits.map(line => line.nativeAlignmentKey), rows.flatMap(row => row.nativeKeys));
    const applied = a.applyNativeEditedLines(rows, [...edits].reverse());
    assert.equal(applied.length, rows.length);
    for (let i = 0; i < rows.length; i++) {
      assert.equal(applied[i].jp, rows[i].jp);
      assert.deepEqual(applied[i].nativeKeys, rows[i].nativeKeys);
      if (rows[i].pairing === 'unpaired-jp') assert.equal(applied[i].cnSlot, null, 'JP byte offsets are not CN event identities');
    }
    for (const [locale, slots] of [['zh-CN', state.cnVoiceSlots], ['ja-JP', state.jpVoiceSlots]]) {
      for (const cue of routing.buildLegacyVoiceSequence(f.route, locale, slots)) if (cue.rowIndex !== null) assert.ok(slots[cue.rowIndex].eventIds.includes(cue.eventId));
    }
    assert.equal(JSON.stringify(f), before, 'source text, speakers, control graph and cue identities remain unchanged');
  }
  const expected = [...sources.entries()].filter(([, source]) => requiresParallelNativeCorrespondence(source)).map(([identity]) => identity).sort();
  assert.deepEqual(tested.sort(), expected, 'every effective source requiring cross-version evidence was checked');
});

test('nar1_00 bilingual button aliases one actual native instruction while repeated assets stay repeated', () => {
  const f = fixture(stories.find(s => s.id === 'legacy-narcissu-3rd-nar1_00')), doc = manifest(f), x = cross(), a = alignment();
  const rows = x.buildParallelNativeAlignment(f.route, f.cn, f.jp, doc);
  const row = rows.find(row => row.cnSlot?.eventIds.includes('mjo-269'));
  assert.equal(row.cnSlot.cues.length, 1); assert.equal(row.jpSlot.cues.length, 1);
  assert.notEqual(row.cnSlot.cues[0].cueId, row.jpSlot.cues[0].cueId);
  assert.equal(a.mergeNativeVoiceCues(row.cnSlot.cues, row.jpSlot.cues).length, 1);
  const repeated = { ...row.jpSlot.cues[0], eventId: 'another-real-event', occurrenceId: 'another-native-instruction' };
  assert.equal(a.mergeNativeVoiceCues(row.cnSlot.cues, [repeated]).length, 2);
  assert.equal(a.mergeNativeVoiceCues([...row.cnSlot.cues, ...row.cnSlot.cues], [...row.jpSlot.cues, ...row.jpSlot.cues]).length, 2);
});

for (const [name, cnEventId] of [["nar1_00", "mjo-c0d"], ["nar1_01", "mjo-4140"], ["nar1_03", "mjo-11c7"], ["nar2_11", "mjo-d5c"], ["nar1_02", "mjo-42b1"], ["nar1_08", "mjo-114e"], ["nar1_08", "mjo-2246"], ["nar2_17", "mjo-366a"], ["nar2_18", "mjo-e3a"]]) test(`${name}/${cnEventId} voice-proved next-message pair preserves text and follows the actual CN/JP page row`, () => {
  const f=fixture(stories.find(s=>s.source_identity===`narcissu-3rd/${name}`)),doc=manifest(f),x=cross(),a=alignment();
  const retained = legacyVoiceProofs.find(item => item.storyId === 'narcissu-3rd/' + name && item.cnEventId === cnEventId); assert.ok(retained);
  for (const [key, value] of Object.entries(retained.sourceGuards)) assert.equal(doc.proof[key], value, 'retained native instruction source guard');
  const currentAlias = doc.cueAliases.find(cue => cue.cnCueId === retained.proof.cue.cnCueId && cue.jpCueId === retained.proof.cue.jpCueId); assert.ok(currentAlias, 'source-proved voice occurrence must not regress');
  assert.equal(currentAlias.cnEventId, retained.proof.cnEventId); assert.equal(currentAlias.jpEventId, retained.proof.jpEventId);
  const proof = { ...retained.proof, cue: currentAlias };
  assert.equal(retained.proof.method,'mapped-native-voice-next-message-branch-checked');
  assert.ok(doc.pairs.some(p=>p.cnEventId===proof.cnEventId&&p.jpEventId===proof.jpEventId));
  const rows=x.buildParallelNativeAlignment(f.route,f.cn,f.jp,doc);
  const row=rows.find(r=>r.cnSlot?.eventIds.includes(proof.cnEventId));
  assert.equal(row.pairing,'verified');assert.ok(row.jpSlot.eventIds.includes(proof.jpEventId));
  assert.ok(row.cn&&row.jp);assert.equal(a.mergeNativeVoiceCues(row.cnSlot.cues,row.jpSlot.cues).filter(c=>c.occurrenceId===proof.cue.occurrenceId).length,1);
  const old={...doc,pairs:doc.pairs.filter(p=>p.cnEventId!==proof.cnEventId),unpaired:{cn:[...doc.unpaired.cn,proof.cnEventId],jp:[...doc.unpaired.jp,proof.jpEventId]}};
  const before=x.buildParallelNativeAlignment(f.route,f.cn,f.jp,old);
  assert.equal(before.length,rows.length+1);
  for(const lang of ['cn','jp'])assert.deepEqual(rows.flatMap(r=>r[lang]?[r[lang]]:[]),before.flatMap(r=>r[lang]?[r[lang]]:[]));
  for(const mode of ['cn','jp','split']){
    const state=actualPage(f,doc,mode);
    for(const [locale,key,slots] of [['zh-CN','cnEventId',state.cnVoiceSlots],['ja-JP','jpEventId',state.jpVoiceSlots]]){
      const sequence=routing.buildLegacyVoiceSequence(f.route,locale,slots);
      const cue=sequence.find(c=>c.cueId===proof.cue[locale==='zh-CN'?'cnCueId':'jpCueId']);assert.ok(cue);
      // In split mode BOTH native voice identities follow the single paired
      // rendered row. Opposite-only single-language rows are still retained by
      // their own sequence semantics; no global URL deduplication is added.
      if(mode==='split'||mode===(locale==='zh-CN'?'cn':'jp')){
        assert.notEqual(cue.rowIndex,null);assert.ok(slots[cue.rowIndex].eventIds.includes(proof[key]));
        const displayed=state.renderList[cue.rowIndex];assert.ok(displayed.cnIndices.some(i=>row.cnIndices.includes(i)));assert.ok(displayed.jpIndices.some(i=>row.jpIndices.includes(i)));
      }
    }
  }
});

test('voice next-message proof rejects intervening messages, changed calls, unknown/entering branches and crossed pairings',()=>{
  const code=`import importlib.util,sys,copy,json
from pathlib import Path
s=importlib.util.spec_from_file_location('kernel','tools/build-native-correspondence.py');m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m)
adapter=json.loads((m.RESOURCE/'manifests/generated/reader-adapter.json').read_bytes());story=next(s for s in adapter['stories'] if s['canonicalStoryId']=='narcissu-3rd/nar1_00')
# Retained raw-message algorithm regression; current reader uses native display units.
doc=json.loads(Path('test-support/fixtures/native/nar1_00.alignment.json').read_bytes())
variants={v['id']:v for v in story['variants']};cn,jp=[m.native_tokens(variants[doc[k]]) for k in ('cnVariantId','jpVariantId')]
proof=doc['proof']['voiceBoundMessagePairs'][0]
for lang,source in (('cn',cn),('jp',jp)):
 assert source['plainSha256']==doc['proof'][lang+'PlainSha256']
 assert source['scriptSha256']==doc['proof'][lang+'ScriptSha256']
def events(lang,source):
 ids={p[lang+'EventId'] for p in doc['pairs']}|set(doc['unpaired'][lang])
 result=[{'kind':'line','eventId':f"mjo-{message['codeOffset']:x}",'cues':[]} for message in source['messages'] if f"mjo-{message['codeOffset']:x}" in ids]
 assert {event['eventId'] for event in result}==ids
 target=proof[lang+'EventId'];event=next(event for event in result if event['eventId']==target)
 start=next(offset for offset,token in source['offsetToToken'].items() if token==proof['tokenRanges'][lang][0])
 event['cues']=[{'cueId':proof['cue'][lang+'CueId'],'timing':'utterance','raw':{'targetEventId':target,'codeOffset':start}}]
 return result
ce,je=events('cn',cn),events('jp',jp);pairs=dict(m.instruction_pairs(cn['tokens'],jp['tokens'])[0]);old=[p for p in doc['pairs'] if p['cnEventId']!=proof['cnEventId']];aliases=[proof['cue']]
run=lambda c=cn,j=jp,p=pairs,b=old,a=aliases:m.voice_bound_body_pairs(c,j,ce,je,p,b,a)[0]
assert len(run())==1
start,end=proof['tokenRanges']['cn'];checks=[]
for label,token in [('intervening-message','MESSAGE'),('branch-in-corridor','2e0800000000'),('changed-call','100800000000000000000100')]:
 c=copy.deepcopy(cn);c['tokens'][start+3]=token;assert not run(c=c),label;checks.append(label)
c=copy.deepcopy(cn);c['branches'][0]['supported']=False;assert not run(c=c);checks.append('unsupported-control')
c=copy.deepcopy(cn);j=copy.deepcopy(jp);c['branches'][0]['targetToken']=end;j['branches'][0]['targetToken']=proof['tokenRanges']['jp'][1];p=dict(pairs);p[end]=proof['tokenRanges']['jp'][1];assert not run(c=c,j=j,p=p);checks.append('incoming-edge')
p=dict(pairs);p.pop(start);assert not run(p=p);checks.append('voice-not-previously-mapped')
c=copy.deepcopy(cn);c['tokens'][start]='010806006f7468657200';assert not run(c=c);checks.append('different-voice-load')
after=next(p for p in old if int(p['cnEventId'][4:],16)>int(proof['cnEventId'][4:],16));prior=next(p for p in reversed(old) if int(p['cnEventId'][4:],16)<int(proof['cnEventId'][4:],16))
assert not run(b=[{'cnEventId':after['cnEventId'],'jpEventId':prior['jpEventId']}]);checks.append('crossed-pair')
assert not run(b=[{'cnEventId':proof['cnEventId'],'jpEventId':prior['jpEventId']}]);checks.append('already-paired')
print(json.dumps({'realNativeProofPassed':True,'negativeCases':checks}))`;
  const result=spawnSync('python',['-B','-c',code],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).negativeCases.length,9);
});
test('integer-call corridor requires exact numeric operands and calls, with no extra body or control edge',()=>{
  const code=`import importlib.util,sys,copy,json
from pathlib import Path
s=importlib.util.spec_from_file_location('kernel','tools/build-native-correspondence.py');m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m)
adapter=json.loads((m.RESOURCE/'manifests/generated/reader-adapter.json').read_bytes());story=next(s for s in adapter['stories'] if s['canonicalStoryId']=='narcissu-3rd/nar1_02')
# Retained raw-message algorithm regression; current reader uses native display units.
doc=json.loads(Path('test-support/fixtures/native/nar1_02.alignment.json').read_bytes())
variants={v['id']:v for v in story['variants']};cn,jp=[m.native_tokens(variants[doc[k]]) for k in ('cnVariantId','jpVariantId')]
proof=doc['proof']['voiceBoundMessagePairs'][0]
for lang,source in (('cn',cn),('jp',jp)):
 assert source['plainSha256']==doc['proof'][lang+'PlainSha256']
 assert source['scriptSha256']==doc['proof'][lang+'ScriptSha256']
def events(lang,source):
 ids={p[lang+'EventId'] for p in doc['pairs']}|set(doc['unpaired'][lang])
 result=[{'kind':'line','eventId':f"mjo-{message['codeOffset']:x}",'cues':[]} for message in source['messages'] if f"mjo-{message['codeOffset']:x}" in ids]
 assert {event['eventId'] for event in result}==ids
 target=proof[lang+'EventId'];event=next(event for event in result if event['eventId']==target)
 start=next(offset for offset,token in source['offsetToToken'].items() if token==proof['tokenRanges'][lang][0])
 event['cues']=[{'cueId':proof['cue'][lang+'CueId'],'timing':'utterance','raw':{'targetEventId':target,'codeOffset':start}}]
 return result
ce,je=events('cn',cn),events('jp',jp);pairs=dict(m.instruction_pairs(cn['tokens'],jp['tokens'])[0]);old=[p for p in doc['pairs'] if p['cnEventId']!=proof['cnEventId']];aliases=[proof['cue']]
run=lambda c=cn,j=jp,p=pairs:m.voice_bound_body_pairs(c,j,ce,je,p,old,aliases)[0]
assert len(run())==1
start,end=proof['tokenRanges']['cn'];js,je_=proof['tokenRanges']['jp'];assert cn['tokens'][start+2:start+4]==jp['tokens'][js+2:js+4];assert cn['tokens'][start+4]!=jp['tokens'][js+4]
checks=[]
for label,index,token in [('changed-integer',2,'000856000000'),('changed-load-type',2,'020855000000'),('changed-integer-call',3,'100800000000000000000100'),('intervening-message',2,'MESSAGE'),('branch-in-corridor',2,'2e0800000000'),('unknown-operation',4,'3508e3f035cf0100'),('second-integer',4,'000855000000')]:
 c=copy.deepcopy(cn);c['tokens'][start+index]=token;assert not run(c=c),label;checks.append(label)
c=copy.deepcopy(cn);c['branches'][0]['supported']=False;assert not run(c=c);checks.append('unsupported-control')
c=copy.deepcopy(cn);j=copy.deepcopy(jp);c['branches'][0]['targetToken']=start+2;j['branches'][0]['targetToken']=js+2;p=dict(pairs);p[start+2]=js+2;assert not run(c=c,j=j,p=p);checks.append('incoming-edge')
print(json.dumps({'realNativeProofPassed':True,'negativeCases':checks}))`;
  const result=spawnSync('python',['-B','-c',code],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).negativeCases.length,9);
});

test('stale hashes, other-story identity, crossed pairs and incomplete unresolved coverage are rejected', async () => {
  const f = fixture(stories.find(s => s.id === 'legacy-narcissu-3rd-nar1_04')), x = cross(), doc = manifest(f);
  const load = (value, cn = f.cnText) => x.loadNativeCorrespondence(f.route, cn, f.jpText, new AbortController().signal, async () => new Response(JSON.stringify(value)));
  await assert.rejects(load(doc, f.cnText + '\n'), /版本不一致/);
  await assert.rejects(load({ ...doc, hashes: { ...doc.hashes, route: '0'.repeat(64) } }), /版本不一致/);
  await assert.rejects(load({ ...doc, storyId: 'narcissu-3rd/wrong' }), /身份/);
  assert.throws(() => x.buildParallelNativeAlignment(f.route, f.cn, f.jp, { ...doc, pairs: [...doc.pairs].reverse() }), /交叉/);
  assert.throws(() => x.buildParallelNativeAlignment(f.route, f.cn, f.jp, { ...doc, pairs: doc.pairs.slice(1) }), /未对应事件/);
});
test('single-language mode preserves its full text without displaying pending opposite-only rows', () => {
  const f = fixture(stories.find(s => s.id === 'legacy-narcissu-3rd-nar1_00')), doc = manifest(f);
  const statsFor = (state, mode) => modules.fragments('app/reader/[id]/page.tsx', ['emptyTextTotals', 'readableSourceText', 'sourceTextTotals', 'textStatistics'], {
    useMemo: fn => fn(), renderList: state.renderList, nativeAlignmentState: state.nativeAlignmentState, isEditMode: false, mode,
  }).textStatistics;
  const both = statsFor(actualPage(f, doc), 'split');
  for (const language of ['cn', 'jp']) {
    const state = actualPage(f, doc, language);
    assert.ok(state.renderList.every(row => row[language]));
    assert.deepEqual(state.renderList.flatMap(row => row[`${language}Indices`]), f[language].map((_, i) => i));
    assert.deepEqual(statsFor(state, language).total, both.total);
    assert.deepEqual([...statsFor(state, language).sections.values()], [...both.sections.values()]);
  }
});

test('failed correspondence can preserve both original streams separately without inferring added/deleted translation', () => {
  const f = fixture(stories.find(s => s.id === 'legacy-narcissu-3rd-nar1_00')), x = cross();
  const empty = x.unpairedNativeCorrespondence(f.route), rows = x.buildParallelNativeAlignment(f.route, f.cn, f.jp, empty);
  assert.equal(empty.pairs.length, 0); assert.equal(empty.cueAliases.length, 0);
  for (const language of ['cn', 'jp']) assert.deepEqual(rows.flatMap(row => row[`${language}Indices`]), f[language].map((_, i) => i));
  assert.ok(rows.every(row => row.cn?.isHeader || !row.cn || !row.jp));
});
test('actual correspondence effect aborts old work and route loader hashes the literal body', async () => {
  const source = fs.readFileSync(path.join(classicApp, 'app/reader/[id]/page.tsx'), 'utf8');
  const tree = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  const visit = node => { if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect' && node.arguments[0].getText(tree).includes('loadNativeCorrespondence(')) effect = node; ts.forEachChild(node, visit); };
  visit(tree); assert.ok(effect);
  const calls = []; let resolve, signal;
  const bindings = { legacyVoiceRoute: { chineseVariantId: 'cn', japaneseVariantId: 'jp' }, cnSource: { raw: 'CN' }, jpSource: { raw: 'JP' },
    setNativeCorrespondenceState: value => calls.push(value),
    loadNativeCorrespondence(_route, _cn, _jp, abort) { signal = abort; return new Promise(done => { resolve = done; }); },
  };
  const run = modules.compile(`export const run = ${effect.arguments[0].getText(tree)};`, path.join(classicApp, 'app/reader/[id]/page.tsx'), bindings).run;
  const cleanup = run(); assert.equal(calls.length, 1); assert.equal(calls[0].loading, true);
  cleanup(); assert.equal(signal.aborted, true); resolve({ storyId: 'old' }); await Promise.resolve(); await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.match(source, /documentSha256: await hashNativeText\(raw\)/);
  assert.match(source, /data-native-pairing=/);
});
test('native correspondence generation is byte-repeatable and preserves ambiguous message intervals', () => {
  const output = 'work/reader-inheritance-20261012/cross-version-regeneration';
  const args = ['-B', 'tools/build-native-correspondence.py', '--public', pub, '--output', output, '--report', output + '/report.json'];
  const r = spawnSync('python', args, { cwd: root, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr);
  for (const story of parallelStories) {
    const file = `data/legacy-vn/${story.source_identity}.alignment.json`;
    assert.equal(fs.readFileSync(path.join(root, output, file), 'utf8'), read(file));
  }
  // Load the hyphenated tool under a local module name; exercise its real kernel.
  const kernel = `import importlib.util,sys\ns=importlib.util.spec_from_file_location('kernel','tools/build-native-correspondence.py');m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m)\na=['010861','100861','010862','100862'];b=['010863','100863','010864','100864']\nc=a+['MESSAGE','MESSAGE']+b;j=a+['MESSAGE','MESSAGE','MESSAGE']+b\np,method,gaps=m.instruction_pairs(c,j)\nassert all(c[i]!='MESSAGE' for i,k in p),p\nassert gaps and gaps[0]['cnMessages']==2 and gaps[0]['jpMessages']==3\nassert len(m.instruction_pairs(c,c)[0])==len(c)\nprint('PASS ambiguous insertion retained; exact structure paired')`;
  const result = spawnSync('python', ['-B', '-c', kernel], { cwd: root, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
});

test('actual materializer completion hook invokes native generation and reproduces every effective cross-version sidecar', () => {
  const filename = path.join(root, 'tools/materialize-classic-reader-data.mjs');
  const source = fs.readFileSync(filename, 'utf8').replace(/\r\n?/g, '\n');
  const begin = source.indexOf('const nativeCorrespondenceBuild = spawnSync(');
  const end = source.indexOf('console.log(JSON.stringify({\n  result: bundleManifest.result,', begin);
  assert.ok(begin >= 0 && end > begin);
  const body = source.slice(begin, end).replaceAll('import.meta.url', JSON.stringify(pathToFileURL(filename).href));
  const publicRoot = path.join(root, 'work/reader-inheritance-20261012/materializer-hook-runtime/apps/classic-reader/public');
  fs.mkdirSync(publicRoot, { recursive: true }); seedGeneratorInputs(publicRoot); const records = [];
  const buildReportRoot = path.join(root, 'work/reader-inheritance-20261012/materializer-hook-runtime/build');
  fs.mkdirSync(buildReportRoot, { recursive: true });
  const run = (command, args, options) => {
    const result = spawnSync(command, args, options);
    records.push({ command: [command, ...args], cwd: options.cwd, exitStatus: result.status, stdout: result.stdout, stderr: result.stderr });
    return result;
  };
  new vm.Script(body, { filename }).runInNewContext({ spawnSync: run, path, fileURLToPath, publicRoot, repositoryRoot: root, buildReportRoot, console: { log() {} } });
  assert.equal(records.length, 1); assert.equal(records[0].exitStatus, 0, records[0].stderr);
  for (const story of parallelStories) {
    const file = `data/legacy-vn/${story.source_identity}.alignment.json`;
    assert.equal(fs.readFileSync(path.join(publicRoot, file), 'utf8'), read(file));
  }
  fs.writeFileSync(path.join(root, 'work/test-results/materializer-hook-commands.json'), JSON.stringify(records, null, 2));
});
