import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const NARCISSU3_CHAPTER_RELATION_STORIES = [
  'narcissu-3rd/nar3_05','narcissu-3rd/nar3_06','narcissu-3rd/nar3_07',
  'narcissu-3rd/nar3_08','narcissu-3rd/nara03',
];
const SOURCE_BINDINGS={
  'archive/derived/scripts/narcissu3/update.arc.unpacked/nar3_08.plain.mjo':'b0d6044c9b41e77345e6add59f7291fba1ce74610a37c34bc853a01a754501e4',
  'archive/derived/scripts/narcissu3/update.arc.unpacked/nar3_08.script.json':'84f6b12d7d7403768a565c2a7466e97a8c3d1a9ca52998ec60997660dc84c513',
  'archive/derived/scripts/narcissu3/scenario.arc.unpacked/nar3_08.plain.mjo':'d0ef6ef1fc7358f744263080ba865c6239ad8c62cc84743c310ca75bdda35c87',
  'archive/derived/scripts/narcissu3/scenario.arc.unpacked/nar3_08.script.json':'c904c4e6dd232d92db494712d553e0ed4ea658cea76bb864c01076fa444b3108',
  'archive/derived/scripts/narcissu3/update.arc.unpacked/nar3_05.plain.mjo':'a9835b41e4f9faf6ddfdb1feac7270f0a216518b75e60c91bcab9af12d1412bb',
  'archive/derived/scripts/narcissu3/update.arc.unpacked/nar3_05.script.json':'0e2ad2281b7e791c2a9193cc227cf39ee8536562234370658e131b37e8e499b6',
  'archive/derived/scripts/narcissu3/scenario.arc.unpacked/nar3_05.plain.mjo':'b047e12a9b356c9ed5549db0e1cdba9e50c8ce7c60fe0e82e7d92036832e0dfb',
  'archive/derived/scripts/narcissu3/scenario.arc.unpacked/nar3_05.script.json':'5dc2cb5a20d2069ccd49a622200bf10e7b51713db5e8f389353ae37e0bbbafee',
  'archive/derived/scripts/narcissu3/update.arc.unpacked/nara03.plain.mjo':'e751480b97c3dd5787357f2c8c0fef896a89f2437b6699f999bd945a4421673a',
  'archive/derived/scripts/narcissu3/update.arc.unpacked/nara03.script.json':'56d229fb129ec08c4e963e24c33edf1fb25d390d78fea2038c3093de7270ad21',
  'archive/derived/scripts/narcissu3/scenario.arc.unpacked/nara03.plain.mjo':'593fcb46fda34dedd1ebb5007e22c4645addfd5c0e0a8402f65cd064fec4386d',
  'archive/derived/scripts/narcissu3/scenario.arc.unpacked/nara03.script.json':'071c537747bf4f418b264b1709eda19e333d86cc41db0ae6439a2c2449d8124e',
  'archive/derived/scripts/narcissu3/update.arc.unpacked/nar3_06.plain.mjo':'f112f2f393b2af741af120affd62ec4d6d551e5a8d86467fb8210b7e90b2f700',
  'archive/derived/scripts/narcissu3/update.arc.unpacked/nar3_06.script.json':'16b14b4be65757de263ea69fec59a3478a2d1ee36ea6c60e52d008bbab1e2d46',
  'archive/derived/scripts/narcissu3/scenario.arc.unpacked/nar3_07.plain.mjo':'231237999ce5af7ef38a7524023cd65df5f6fbf786d1e8f642bb9513ce1010b9',
  'archive/derived/scripts/narcissu3/scenario.arc.unpacked/nar3_07.script.json':'8cb89698985deeb91be8c14ee0d45506ffbf6d94bcf52d5c3891175241e1ec15',
};

/** A cross-chapter location, not a fabricated same-file event pair. The source
 * chapter split stays intact and both original editable streams are retained. */
export async function buildNarcissu3ChapterRelations(inputs, corpusRoot) {
  for(const [relative,expected] of Object.entries(SOURCE_BINDINGS)){
    if(sha(await readFile(path.join(corpusRoot,relative)))!==expected)throw Error('Cross-chapter source changed: '+relative);
  }
  const pick=(identity,variantId,start,end,count,locale)=>{
    const input=inputs.find(item=>item.identity===identity);
    const variant=input?.story.variants.find(v=>v.variantId===variantId);
    if(!variant)throw Error('Missing cross-chapter variant');
    const events=variant.sections.flatMap(s=>s.events);
    const a=events.findIndex(e=>e.eventId===start),b=events.findIndex(e=>e.eventId===end);
    if(a<0||b<a)throw Error('Cross-chapter range changed');
    const selected=events.slice(a,b+1);
    if(selected.some(e=>e.kind!=='line')||selected.length!==count)throw Error('Cross-chapter range must remain the reviewed linear text block');
    return {identity,variantId,locale,events:selected};
  };
  const cn=pick('narcissu-3rd/nar3_06','mjo/narcissu3/update.arc.unpacked/nar3_06','mjo-51e0','mjo-5f5d',46,'zh-CN');
  const jp=pick('narcissu-3rd/nar3_07','mjo/narcissu3/scenario.arc.unpacked/nar3_07','mjo-c5','mjo-1138',45,'ja-JP');
  const voices=side=>side.events.flatMap(e=>(e.cues??[]).filter(c=>c.kind==='voice').map(c=>({
    eventId:e.eventId,codeOffset:c.raw?.codeOffset,sourceKey:c.raw?.sourceKey,mediaId:c.mediaId
  })));
  const cv=voices(cn),jv=voices(jp);
  const expected=['n3iri_0194','n3iri_0195','n3iri_0196','n3iri_0197','n3iri_0198','n3iri_0199'];
  for(const list of [cv,jv])if(JSON.stringify(list.map(c=>c.sourceKey))!==JSON.stringify(expected)||list.some(c=>!Number.isSafeInteger(c.codeOffset)))throw Error('Native voice-call sequence differs from reviewed cross-chapter range');
  if(cv.some((c,i)=>c.mediaId!==jv[i].mediaId))throw Error('Cross-chapter media operands changed');
  const movedCn=pick('narcissu-3rd/nara03','mjo/narcissu3/update.arc.unpacked/nara03','mjo-213d','mjo-221f',3,'zh-CN');
  const movedJp=pick('narcissu-3rd/nara03','mjo/narcissu3/scenario.arc.unpacked/nara03','mjo-32d1','mjo-3407',3,'ja-JP');
  const movedCnVoices=voices(movedCn),movedJpVoices=voices(movedJp);
  for(const [list,offsets] of [[movedCnVoices,[8482,8708]],[movedJpVoices,[12965,13275]]]){
    if(JSON.stringify(list.map(c=>c.sourceKey))!==JSON.stringify(['n3kai_0198','n3kai_0199'])
      ||JSON.stringify(list.map(c=>c.codeOffset))!==JSON.stringify(offsets))throw Error('Relocated native voice block changed');
  }
  if(movedCnVoices.some((c,i)=>c.mediaId!==movedJpVoices[i].mediaId))throw Error('Relocated native voice media changed');
  const movedMessageCn='中日版本将海璃与英治的这三句对话放在了本章不同的位置。';
  const movedMessageJp='中国語版と日本語版では、海璃と英治のこの3つの台詞が、章内の異なる位置に配置されています。';
  const fatherCn=pick('narcissu-3rd/nar3_05','mjo/narcissu3/update.arc.unpacked/nar3_05','mjo-3eac','mjo-3eac',1,'zh-CN');
  const fatherJp=pick('narcissu-3rd/nar3_05','mjo/narcissu3/scenario.arc.unpacked/nar3_05','mjo-521e','mjo-526f',2,'ja-JP');
  if([...fatherCn.events,...fatherJp.events].some(e=>(e.cues??[]).length||e.source?.nativeUnit?.speakerRaw))
    throw Error('Relocated father recollection gained unreviewed cue/name controls');
  const wheatCn=pick('narcissu-3rd/nar3_08','mjo/narcissu3/update.arc.unpacked/nar3_08','mjo-de8','mjo-de8',1,'zh-CN');
  const wheatJp=pick('narcissu-3rd/nar3_08','mjo/narcissu3/scenario.arc.unpacked/nar3_08','mjo-101f','mjo-101f',1,'ja-JP');
  for(const [side,text] of [[wheatCn,'「然后从此种些麦子什么的活下去。」'],[wheatJp,'「…そしてこれからは…麦でも作って生きろ」']]){
    const event=side.events[0];
    if(event.text?.[side.locale]!==text||event.source?.nativeUnit?.speakerRaw?.rawHex!=='8ee5906c8cf6'||(event.cues??[]).length)
      throw Error('Relocated wheat dialogue differs from reviewed native source');
  }
  const relation=(source,target,message_cn,message_jp,name='iris-border-scene')=>({
    id:name+'-'+(source.locale==='zh-CN'?'cn':'jp'),
    source_locale:source.locale,source_event_ids:source.events.map(e=>e.eventId),
    target_story_id:'legacy-'+target.identity.replace('/','-'),target_locale:target.locale,
    target_event_id:target.events[0].eventId,message_cn,message_jp
  });
  return {
    schema:'narcissu3-cross-chapter-locations/v1',
    method:'byte-bound-native-call-sequence-and-reviewed-bilingual-scene',
    sourceHashes:SOURCE_BINDINGS,
    explanation:'The 46 Chinese text units at the end of nar3_06 correspond to the 45 Japanese units at the start of nar3_07; the first two Chinese units form one Japanese paragraph. All following dialogue and narration were reviewed in order. This supplies location links only, never ordinal same-file pairing or substituted source text.',
    nativeVoiceCalls:{cn:cv,jp:jv},
    sameChapterRelocationExplanation:'Three complete native text units in nara03 have the same two byte-bound native voice operands surrounding Eiji\'s matching landlord instructions, but occupy different positions. Location links preserve the full order of both versions; they never override existing stronger message anchors.',
    additionalNativeVoiceCalls:{ciRelocation:{cn:movedCnVoices,jp:movedJpVoices}},
    fatherRecollectionEvidence:'Byte-bound native instructions and next-event chains put the original Chinese father/killer recollection before the sister dialogue, and the two Japanese units after it. Same-scene location only; no line-number matching, new translation or word-for-word quality approval.',
    wheatRelocationEvidence:'Reviewed native dialogue and byte-bound source place the wheat command before n3iri_0239 in Chinese and after it in Japanese, between the shared sword command and n3iri_0240. Link the original occurrences without duplicating the Chinese body or moving native calls.',
    sourceBlocks:[cn,jp,movedCn,movedJp,fatherCn,fatherJp,wheatCn,wheatJp].map(side=>({storyId:side.identity,variantId:side.variantId,locale:side.locale,
      events:side.events.map(e=>({eventId:e.eventId,text:e.text?.[side.locale],source:e.source?.nativeUnit}))})),
    byStory:{
      [fatherCn.identity]:[
        {...relation(fatherJp,fatherCn,'两版本的父亲回忆段落位置不同：对应中文原文位于本章妹妹对话之前；原文顺序分别保留。','対応する中国語原文を参照。'),id:'nar3_05-father-recollection-jp-to-cn'},
        {...relation(fatherCn,fatherJp,'对应日文为妹妹回忆之后的两个连续原生段落；两版本不交叉拼接。','対応する日本語原文を参照。'),id:'nar3_05-father-recollection-cn-to-jp'},
      ],
      [wheatCn.identity]:[
        {...relation(wheatJp,wheatCn,'两版本的种麦对白位于伊丽丝应答的不同侧：对应中文原文在应答之前；两版原文顺序分别保留。','対応する中国語原文を参照。'),id:'nar3_08-wheat-relocation-jp-to-cn'},
        {...relation(wheatCn,wheatJp,'对应日文原文在伊丽丝应答之后；两版本保留原位，不重复复用中文。','対応する日本語原文を参照。'),id:'nar3_08-wheat-relocation-cn-to-jp'},
      ],
      [movedCn.identity]:[
        // Explicit reviewed native pairs, not an ordinal zip. Each original
        // needs its own target for navigation and required-translation policy.
        ['mjo-213d','mjo-32d1'],['mjo-218b','mjo-3344'],['mjo-221f','mjo-3407'],
      ].flatMap(([cnId,jpId])=>{
        const c={...movedCn,events:movedCn.events.filter(e=>e.eventId===cnId)};
        const j={...movedJp,events:movedJp.events.filter(e=>e.eventId===jpId)};
        if(c.events.length!==1||j.events.length!==1)throw Error('Reviewed relocated dialogue pair changed');
        return [relation(c,j,movedMessageCn,movedMessageJp,'ci-relocated-'+cnId),
          relation(j,c,movedMessageCn,movedMessageJp,'ci-relocated-'+cnId)];
      }),
      [cn.identity]:[relation(cn,jp,'中日版本的分章位置不同：本章末段的对应日文位于下一章开头。','章の区切りが異なります。この章の中国語末尾に対応する日本語は、次の章の冒頭にあります。')],
      [jp.identity]:[relation(jp,cn,'中日版本的分章位置不同：本章日文开头的对应中文位于上一章末段。','章の区切りが異なります。この章の日本語冒頭に対応する中国語は、前の章の末尾にあります。')],
    },
  };
}
