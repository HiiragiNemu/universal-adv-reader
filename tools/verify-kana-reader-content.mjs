import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseStoryContent } from '../apps/classic-reader/lib/story-parser.ts';
import { parseLegacyVoiceRouteDocument } from '../apps/classic-reader/lib/legacy-vn-voice-routing.ts';
import { buildSharedNativeAlignment, mergeNativeAlignedRows, seedNativeEditableLines } from '../apps/classic-reader/lib/legacy-vn-alignment.ts';
import { readNativeEditSource, splitIkuraMessageText } from '../apps/classic-reader/lib/native-translation-patch.ts';
import { KANA_CHINESE_SPEAKER_LABELS, localizeKanaChineseSpeaker } from './lib/kana-speaker-labels.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.resolve(process.argv[2] ?? path.join(root,'reports/verification/content-repair-20261013/candidate-public'));
if (!input.startsWith(root + path.sep)) throw Error('Candidate must be inside this project');
const output = path.join(root,'reports/verification/content-repair-20261013/kana/candidate-reader-verification.json');
const read = async relative => fs.readFile(path.join(input,relative.replace(/^\//u,'')),'utf8');
const sha = value => createHash('sha256').update(value).digest('hex');
const norm = value => String(value??'').replace(/\s/gu,'');
const independent = JSON.parse(await fs.readFile(path.join(root,'reports/verification/content-repair-20261013/kana/independent-audit.json'),'utf8'));
const proof = JSON.parse(await fs.readFile(path.join(root,'reports/verification/content-repair-20261013/kana/presentation-groups.json'),'utf8'));
const index = JSON.parse(await read('story_index.json')).filter(item=>item.source_identity.startsWith('kana-okaeri/'));
const expectedIds = independent.scripts.filter(s=>s.decision==='include').map(s=>s.canonicalStoryId).sort();
assert.deepEqual(index.map(e=>e.source_identity).sort(),expectedIds);
const adapterRaw = await read('data/legacy-vn/manifests/reader-adapter.json');
const results = [], allGroups = [], names = new Map();
const sourcePayloadKinds = Object.fromEntries(['zh-CN','ja-JP'].map(locale => [locale,
  { message: 0, visibleMessage: 0, blankMessage: 0, title: 0, visibleTitle: 0, blankTitle: 0, other: 0 }]));
let cnUnits=0,jpUnits=0,cnReadUnits=0,jpReadUnits=0,sections=0,localizedSpeakers=0,corrections=0,rawBodiesVerified=0;
for (const entry of index) {
  const identity = entry.source_identity, stem='data/legacy-vn/'+identity;
  const [cnRaw,jpRaw,routeRaw,editRaw] = await Promise.all([read(entry.path_cn),read(entry.path_jp),read(stem+'.routes.json'),read(stem+'.edit-source.json')]);
  const routeJson=JSON.parse(routeRaw), route=parseLegacyVoiceRouteDocument(routeJson,identity);
  const cn=parseStoryContent(cnRaw,{mergeConsecutiveTextLines:false}).lines;
  const jp=parseStoryContent(jpRaw,{mergeConsecutiveTextLines:false}).lines;
  const raw=buildSharedNativeAlignment(route,cn,jp);
  assert.ok(raw,'KANA must retain one shared native graph');
  const merged=mergeNativeAlignedRows(raw);
  assert.deepEqual(merged.flatMap(r=>r.nativeKeys),raw.flatMap(r=>r.nativeKeys),'read merge must preserve every ordered raw key');
  const editable=seedNativeEditableLines(raw,'current');
  assert.equal(editable.length,raw.length,'editing stays on all raw events');
  const edit=await readNativeEditSource(editRaw,{storyId:identity,binding:{route:sha(routeRaw),cnText:sha(cnRaw),jpText:sha(jpRaw),adapter:sha(adapterRaw)}});
  assert.deepEqual(edit.document.rows.map(r=>r.key),raw.map(r=>r.nativeKeys[0]));
  for(const side of ['cn','jp']) {
    assert.equal(merged.map(r=>r[side]?.text??'').join(''),raw.map(r=>r[side]?.text??'').join(''),'no visible character lost by read merge');
    const key=side==='cn'?'cnSlot':'jpSlot';
    assert.deepEqual(merged.flatMap(r=>r[key]?.cues??[]),raw.flatMap(r=>r[key]?.cues??[]),'voice occurrences and order survive display merge');
  }
  const selected=routeJson.variantRoutes.find(v=>v.variantId===routeJson.chineseVariantId);
  assert.equal(selected.sections.length,1);assert.equal(selected.sections[0].sectionId,'main');
  const events=selected.sections[0].events, byId=new Map(events.map(e=>[e.eventId,e]));
  for(const section of entry.native_sections) {
    assert.ok(byId.has(section.target_event_id_cn)&&byId.has(section.target_event_id_jp),'both native navigation targets exist');
  }
  const rowByEvent=new Map(raw.map(r=>[r.nativeEventId??r.nativeKeys[0].split('/').at(-1),r]));
  for(const event of events) {
    const row=rowByEvent.get(event.eventId),original=event.source?.originalDisplayText?.['zh-CN'];
    for(const [side,locale] of [['cn','zh-CN'],['jp','ja-JP']]) {
      const sourceText=event.source?.originalDisplayText?.[locale];
      if(typeof sourceText==='string') {
        assert.equal(norm(row?.[side]?.text),norm(splitIkuraMessageText(sourceText).body),'every original message body survives projection: '+identity+'/'+event.eventId+'/'+locale);
        rawBodiesVerified++;
        const kind = event.source.opcode === 0x2b ? 'message' : event.source.opcode === 0xf7 ? 'title' : 'other';
        sourcePayloadKinds[locale][kind]++;
        if (kind !== 'other') sourcePayloadKinds[locale][(sourceText.trim() ? 'visible' : 'blank') + (kind === 'message' ? 'Message' : 'Title')]++;
      }
    }
    if(row?.cn&&!row.cn.isHeader&&!row.cn.isChoice) {
      names.set(row.cn.speaker,(names.get(row.cn.speaker)??0)+1);
      assert.equal(KANA_CHINESE_SPEAKER_LABELS[row.cn.speaker],undefined,'Japanese label must not remain in Chinese speaker');
      assert.doesNotMatch(row.cn.speaker,/[ぁ-んァ-ヿ]/u,'Chinese speaker must not contain untranslated kana');
    }
    if(typeof original==='string') {
      const speaker=splitIkuraMessageText(original).speaker;
      if(speaker&&KANA_CHINESE_SPEAKER_LABELS[speaker]) {
        assert.equal(row?.cn?.speaker,localizeKanaChineseSpeaker(speaker));
        localizedSpeakers++;
      }
    }
    if(identity==='kana-okaeri/ev49b'&&event.source?.instructionIndex===1176) {
      assert.equal(row.cn.text.trim(),'这是之前约定好的事。');
      assert.equal(event.source.readerContentCorrection?.id,'kana-ev49b-1176-missing-narration');
      assert.equal(event.source.readerContentCorrection.originalText,'　','original empty translation remains in correction evidence');
      corrections++;
    }
  }
  const expectedGroups=proof.groups.filter(g=>g.canonicalStoryId===identity);
  const actualGroups=merged.filter(r=>r.presentationGroup&&r.nativeKeys.length>1);
  assert.deepEqual(actualGroups.map(r=>r.presentationGroup.id),expectedGroups.map(g=>g.id));
  for(const group of expectedGroups) {
    const row=actualGroups.find(r=>r.presentationGroup.id===group.id);
    assert.deepEqual(row.cnSlot?.eventIds??[],group.visibleEventIdsByLocale['zh-CN']);
    assert.deepEqual(row.jpSlot?.eventIds??[],group.visibleEventIdsByLocale['ja-JP']);
    for(const [side,locale] of [['cn','zh-CN'],['jp','ja-JP']])
      assert.equal(norm(row[side]?.text),norm(splitIkuraMessageText(group.joinedText[locale]).body),'native append spelling remains complete');
    allGroups.push({id:group.id,cnFragments:row.cnIndices.length,jpFragments:row.jpIndices.length,
      mergedCn:row.cn?.text,mergedJp:row.jp?.text,nativeKeys:row.nativeKeys.length});
  }
  const count=side=>raw.filter(r=>r[side]&&!r[side].isHeader).length;
  const c=count('cn'),j=count('jp');cnUnits+=c;jpUnits+=j;sections+=entry.native_sections.length;
  cnReadUnits+=merged.filter(r=>r.cn&&!r.cn.isHeader).length;jpReadUnits+=merged.filter(r=>r.jp&&!r.jp.isHeader).length;
  results.push({identity,rawRows:raw.length,readRows:merged.length,chineseUnits:c,japaneseUnits:j,
    nativeSections:entry.native_sections.length,presentationGroups:actualGroups.length,sourceSha256:edit.sha256});
}
assert.equal(index.length,52);assert.equal(sections,101);assert.equal(allGroups.length,14);assert.equal(corrections,1);
assert.equal(jpUnits,independent.counts.japaneseNarrativeVisibleTextAndChoiceUnits);
assert.equal(cnUnits,independent.counts.chineseNarrativeVisibleTextAndChoiceUnits+1);
assert.equal(localizedSpeakers,155);
assert.equal(cnReadUnits,cnUnits-proof.counts.visibleChineseFragments+allGroups.length);
assert.equal(jpReadUnits,jpUnits-proof.counts.visibleJapaneseFragments+allGroups.length);
const report={schema:'kana-candidate-reader-verification/v1',result:'PASS',input,
  counts:{stories:index.length,nativeSections:sections,presentationGroups:allGroups.length,
    japaneseRawVisibleUnits:jpUnits,chineseRawVisibleUnits:cnUnits,
    japaneseReadVisibleUnits:jpReadUnits,chineseReadVisibleUnits:cnReadUnits,sourceTextPayloadsVerified:rawBodiesVerified,
    sourceChineseOmissionCorrections:corrections,localizedSpeakerOccurrences:localizedSpeakers},
  sourcePayloadKinds,
  countDefinitions:{sourceTextPayloadsVerified:'Verified source.originalDisplayText values, including native titles and blank payloads; this is not a count of visible dialogue passages.',
    rawVisibleUnits:'Visible native message units plus 95 native titles and 105 choice labels per locale.',
    readVisibleUnits:'The same source text after 14 native-proved continuation groups are joined for reading only.'},
  evidence:{independentOriginalArchiveAudit:'kana/independent-audit.json',nativeCountReconciliation:'kana/count-denominators.json',nativePresentationProof:'kana/presentation-groups.json',
    orderedSourceKeysRetained:true,allVoiceOccurrencesRetained:true,rawEditEventCountRetained:true,
    fullBilingualVisibleCharacterStreamRetained:true,sameMainGraph:true},
  speakers:Object.fromEntries([...names].sort()),stories:results,groups:allGroups};
await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,result:report.result,counts:report.counts,groups:allGroups.map(({id,cnFragments,jpFragments})=>({id,cnFragments,jpFragments}))}));
