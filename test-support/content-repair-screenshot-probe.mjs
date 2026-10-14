import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {classicModules,classicApp,React,renderToStaticMarkup,rowProps} from './classic-module-loader.js';
const root=path.resolve(classicApp,'../..'),input=path.resolve(process.argv[2]??root),pub=path.resolve(process.env.ADV_CLASSIC_PUBLIC_ROOT??path.join(classicApp,'public')),modules=classicModules();
const file=f=>fs.existsSync(path.join(input,f))?path.join(input,f):path.join(root,f);
import {readNativeCorpusExpectation,assertSelectedSourceVariants,assertRawNativeRows,assertDisplayConservesRows} from './native-corpus-expectations.js';
const {sources}=readNativeCorpusExpectation(pub);
const parser=modules.load('lib/story-parser.ts'),routing=modules.load('lib/legacy-vn-voice-routing.ts'),cross=modules.load('lib/legacy-vn-correspondence.ts');
const alignment=modules.compile(fs.readFileSync(file('apps/classic-reader/lib/legacy-vn-alignment.ts'),'utf8'),path.join(classicApp,'lib/legacy-vn-alignment.ts'));
const page=path.relative(classicApp,file('apps/classic-reader/app/reader/[id]/page.tsx'));
const read=p=>JSON.parse(fs.readFileSync(p,'utf8')),hash=s=>createHash('sha256').update(s).digest('hex'),index=read(path.join(pub,'story_index.json'));
function fixture(identity){
  const story=index.find(s=>s.source_identity===identity),raw=fs.readFileSync(path.join(pub,`data/legacy-vn/${identity}.routes.json`),'utf8');
  const route={...routing.parseLegacyVoiceRouteDocument(JSON.parse(raw),identity),documentSha256:hash(raw)};
  const cnText=fs.readFileSync(path.join(pub,story.path_cn),'utf8'),jpText=fs.readFileSync(path.join(pub,story.path_jp),'utf8');
  const cn=parser.parseStoryContent(cnText,{mergeConsecutiveTextLines:false}).lines,jp=parser.parseStoryContent(jpText,{mergeConsecutiveTextLines:false}).lines;
  const doc=route.chineseVariantId===route.japaneseVariantId?null:read(path.join(pub,`data/legacy-vn/${identity}.alignment.json`));
  const state=modules.fragments(page,['activeLegacyVoiceSlot','currentNativeCorrespondence','nativeAlignmentState','nativePresentationState','cnVoiceSlots','jpVoiceSlots','renderList','activeVoiceSlots'],{
    ...routing,...alignment,...cross,...modules.load('lib/native-reader-revision.ts'),useMemo:f=>f(),currentNativeEditSource:null,nativeEditState:{error:''},legacyVoiceRoute:route,
    cnEventLines:cn,jpEventLines:jp,cnSource:{raw:cnText},jpSource:{raw:jpText},currentLegacyVoiceRoutePath:routing.legacyVoiceRoutePath(identity),
    nativeCorrespondenceState:{route,cnRaw:cnText,jpRaw:jpText,data:doc,error:'',loading:false},isEditMode:false,editedCnLines:[],mode:'split',
    alignStoryLines(){throw Error('Native source fell back to ordinal zip')},displayedCnLines:cn,displayedJpLines:jp,
    legacyVoiceSlotState:{cn:routing.buildLegacyVoiceSlots(route,'zh-CN',cn),jp:routing.buildLegacyVoiceSlots(route,'ja-JP',jp)},
  });
  return{identity,story,cn,jp,doc,route,rawRoute:JSON.parse(raw),state,rows:state.renderList};
}
const text=modules.load('components/StoryText.tsx');
const {StoryRow}=modules.fragments(page,['countLineBreaks','translatedSpeaker','lineTextAlignClass','lineKindClass','speakerColor','SourceStatistics','SpeakerLabel','StoryRow'],{
  StoryText:text.default,LineBreakMarkerText:text.LineBreakMarkerText,...modules.load('app/config/dictionary.ts'),...modules.load('lib/bilingual-layout.ts'),...modules.load('lib/official-tw-titles.ts'),
  isNightTheme:v=>['dark','frost'].includes(v),useGlobal:()=>({nameColorsEnabled:true}),VoicePlayButton:()=>{throw Error('Unexpected voice mount')},
});
const html=(row,props={})=>renderToStaticMarkup(React.createElement(StoryRow,{...rowProps,nativeSpeakerEditable:false,row,...props}));
const nar=fixture('narcissu-3rd/nar2_12'),kana=fixture('kana-okaeri/ev462b'),ev22=fixture('kana-okaeri/ev22');
const stats=f=>({identity:f.identity,sourceBodies:{cn:f.cn.filter(l=>!l.isHeader).length,jp:f.jp.filter(l=>!l.isHeader).length},displayRows:f.rows.length,
  maxEventsPerRow:Math.max(...f.rows.map(r=>Math.max(r.cnIndices.length,r.jpIndices.length))),unpaired:f.doc?{cn:f.doc.unpaired.cn.length,jp:f.doc.unpaired.jp.length}:null,
  retainedSourceObjects:['cn','jp'].every(lang=>JSON.stringify(f.rows.flatMap(r=>r[lang+'Indices']).map(i=>f[lang][i]))===JSON.stringify(f[lang]))});
const narrativeDialogue=nar.state.nativeAlignmentState.rows.find(r=>r.cn?.text.includes('这次负责'));
// Pin the original source event, not a display label or the presence of the
// now-correctly-extracted name prefix in the reader's body text.
const namedEvent=ev22.rawRoute.variantRoutes.find(v=>v.variantId===ev22.route.chineseVariantId)
  .sections.flatMap(section=>section.events).find(event=>event.eventId==='ikura-b26');
assert.ok(namedEvent,'EV22 source instruction 249 is required');
assert.equal(namedEvent.source.instructionIndex,249);
assert.equal(namedEvent.source.zhOffset,3108);
assert.equal(namedEvent.source.jaOffset,2854);
const original=namedEvent.source.originalDisplayText;
assert.equal(original['zh-CN'],'美　树：「啊拉，两人今天又在一起吗？　关系真好啊」');
assert.equal(original['ja-JP'],'美　樹：「あら、二人とも今日も一緒なの？　仲がいいのねえ」');
const named=ev22.rows.find(row=>row.cnSlot?.eventIds.includes(namedEvent.eventId)&&row.jpSlot?.eventIds.includes(namedEvent.eventId));
assert.ok(named,'EV22 source event must remain addressable in both displayed slots');
const cPrefix=original['zh-CN'].split('：')[0],jPrefix=original['ja-JP'].split('：')[0];
const bodyAfterPrefix=source=>source.slice(source.indexOf('：')+1);
const normalized=source=>source.replace(/\s/gu,'');
assert.equal(named.cn.speaker,normalized(cPrefix));
assert.equal(named.jp.speaker,normalized(jPrefix));
assert.equal(named.cn.text,bodyAfterPrefix(original['zh-CN']));
assert.equal(named.jp.text,bodyAfterPrefix(original['ja-JP']));
const namedBefore=JSON.stringify(named),sourceBefore=JSON.stringify(namedEvent);
const actualNamed=html(named,{embeddedNativeSpeaker:true});
// Legacy/imported TXT can still retain original native embedded prefixes.
// Exercise those compatibility/negative contracts using this same byte-bound
// source event while the live projection has separate speaker/body fields.
const originalNamed={...named,cn:{...named.cn,text:original['zh-CN']},jp:{...named.jp,text:original['ja-JP']}};
const originalNamedBefore=JSON.stringify(originalNamed);
const nativeNamed=html(originalNamed,{embeddedNativeSpeaker:true});
const ordinaryNamed=html(originalNamed,{embeddedNativeSpeaker:false});
const namedPrefix=(s,p)=>Boolean(p&&s.includes(p+'：'));
const occurrences=(s,p)=>s.split(p).length-1;
const sourceVoice=namedEvent.cues.find(cue=>cue.kind==='voice'&&cue.raw?.sourceKey==='Mik0015');
assert.ok(sourceVoice,'EV22 Mik0015 voice instruction belongs to the same native event');
function assertNarNativeBufferDisplay(f) {
  const raw=f.state.nativeAlignmentState.rows;
  assert.equal(raw.length,389,'the 388 native bodies plus original header remain individually editable');
  assert.ok(raw.every(row=>row.cnIndices.length===1&&row.jpIndices.length===1));
  const savings={};
  for(const [side,locale] of [['cn','zh-CN'],['jp','ja-JP']]) {
    const variant=f.rawRoute.variantRoutes.find(value=>value.variantId===f.route[side==='cn'?'chineseVariantId':'japaneseVariantId']);
    const events=variant.sections.flatMap(section=>section.events),byId=new Map(events.map(event=>[event.eventId,event]));
    const groups=new Map(events.filter(event=>event.source?.presentationGroup).map(event=>[event.source.presentationGroup.id,event.source.presentationGroup]));
    assert.ok(groups.size>0,'nar2_12 contains real multi-message native display buffers');
    savings[side]=[...groups.values()].reduce((sum,group)=>sum+Math.max(0,group.visibleEventIdsByLocale[locale].length-1),0);
    for(const row of f.rows) {
      const ids=row[side+'Slot']?.eventIds??[];
      if(row[side+'Indices'].length<=1)continue;
      const first=byId.get(ids[0]),group=first?.source?.presentationGroup;
      assert.equal(group?.schema,'majiro-presentation-group/v1');
      assert.equal(group.displayJoinMode,'native-append');
      assert.deepEqual(ids,group.visibleEventIdsByLocale[locale],'display merges exactly this original native buffer');
      assert.ok(ids.every(id=>byId.get(id)?.source?.presentationGroup?.id===group.id));
      assert.equal(group.nativeBufferProof.length,ids.length-1,'every native join has its own instruction corridor proof');
      for(let index=1;index<ids.length;index++) {
        const proof=group.nativeBufferProof[index-1];
        assert.equal(proof.previousEventId,ids[index-1]);
        assert.equal(proof.eventId,ids[index]);
        assert.equal(proof.joinBefore,group.joinBeforeByEventId[ids[index]]);
        assert.ok(proof.instructionCodeOffsets.length>0);
      }
    }
  }
  assert.equal(savings.cn,savings.jp,'both proven native buffer streams have matching display boundaries');
  assert.equal(f.rows.length,raw.length-savings.cn,'display row change is exactly the native-source buffer join count');
  return true;
}
const checks={narWholeChapterPaired:nar.doc.pairs.length===388&&!nar.doc.unpaired.cn.length&&!nar.doc.unpaired.jp.length,
  narRawEventsAndNativeBufferJoinsPreserved:assertNarNativeBufferDisplay(nar),
  kana206BodiesAndHeader:kana.rows.length===207&&stats(kana).maxEventsPerRow===1,
  allThreeSourceObjectsRetained:[nar,kana,ev22].every(f=>stats(f).retainedSourceObjects),
  allThreeRawKeysAndVoiceCuesRetained:[nar,kana,ev22].every(f=>{
    assertSelectedSourceVariants(f.story,f.route,sources);
    assertRawNativeRows(f.route,f.state.nativeAlignmentState.rows,f.cn,f.jp);
    assertDisplayConservesRows(f.state.nativeAlignmentState.rows,f.rows,f.cn,f.jp);
    return true;
  }),
  anonymousDialogueNotNarrator:html(narrativeDialogue).includes('未署名'),
  kanaSourceIdentityAndSeparateFields:named.cn.speaker==='美树'&&named.jp.speaker==='美樹'
    &&named.cn.text===bodyAfterPrefix(original['zh-CN'])&&named.jp.text===bodyAfterPrefix(original['ja-JP']),
  kanaCurrentNameShownOnce:occurrences(actualNamed,'美树')===1&&occurrences(actualNamed,'美樹')===1
    &&!namedPrefix(actualNamed,cPrefix)&&!namedPrefix(actualNamed,jPrefix),
  kanaReadNamePrefixOnce:!namedPrefix(nativeNamed,cPrefix)&&!namedPrefix(nativeNamed,jPrefix),
  ordinaryTextUnchanged:namedPrefix(ordinaryNamed,cPrefix)&&namedPrefix(ordinaryNamed,jPrefix),
  differentNamePrefixRetained:namedPrefix(html({...originalNamed,cn:{...originalNamed.cn,speaker:'different-name'}},{embeddedNativeSpeaker:true}),cPrefix),
  editableOriginalPrefixRetained:namedPrefix(html(originalNamed,{embeddedNativeSpeaker:true,isEditMode:true,editIndex:0,editedLines:[originalNamed.cn]}),cPrefix),
  namedVoiceBoundToOriginalEvent:['cn','jp'].every(side=>named[side+'Slot'].cues.some(cue=>cue.cueId===sourceVoice.cueId)),
  underlyingKanaTextUnchanged:JSON.stringify(named)===namedBefore&&JSON.stringify(originalNamed)===originalNamedBefore&&JSON.stringify(namedEvent)===sourceBefore};
const missing={jp:{speaker:'旁白',text:'「おはよう」'},pairing:'unpaired-jp',nativeKeys:['fixture']};
checks.unpairedNotCalledMissingTranslation=html(missing).includes('中日对应待核实')&&!html(missing).includes('等待翻译');
console.log(JSON.stringify({input,publicRoot:pub,stories:[nar,kana,ev22].map(stats),sourceNamedFixture:{eventId:namedEvent.eventId,instructionIndex:249,jaOffset:2854,zhOffset:3108,sourceVoiceCueId:sourceVoice.cueId,cnSpeaker:named.cn.speaker,jpSpeaker:named.jp.speaker},checks},null,2));
process.exitCode=Object.values(checks).every(Boolean)?0:1;
