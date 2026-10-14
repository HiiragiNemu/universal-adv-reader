/** Read-only source audit. Generated reports stay in the generic reader project. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildResearchCatalog,createResearchReaderAdapter} from '../packages/adapters/src/research-reader-v1.js';
import {parseMajiroInstructions,NARCISSU_SPEAKER_ZH,normalizeNarcissuChineseSpeaker} from '../packages/adapters/src/majiro-native-content.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const resourceRoot=path.resolve(root,'../narcissu-kana-research');
const publicRoot=path.resolve(process.argv[2]??path.join(root,'reports/verification/content-repair-20261013/candidate-public'));
const output=path.resolve(root,'reports/verification/content-repair-20261013/narcissu3');
const sha=data=>createHash('sha256').update(data).digest('hex');
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const sourcePath=url=>path.join(resourceRoot,...decodeURIComponent(url.replace(/^\/corpus\//u,'')).split('/'));
const io={fetchJson:async url=>json(sourcePath(url)),fetchBinary:async url=>new Uint8Array(await readFile(sourcePath(url)))};
const manifest=await json(path.join(publicRoot,'data/legacy-vn/manifests/reader-adapter.json'));
const catalog=buildResearchCatalog(manifest),adapter=createResearchReaderAdapter();
const counts={stories:0,variants:0,nativeTextOperands:0,retainedTextOperands:0,rawMessageEvents:0,nativeUnits:0,rubyBases:0,translationMessageTargets:0,retainedTranslationMessageTargets:0,nativeChoiceEvents:0,nativeChoiceOptions:0,presentationGroups:0,presentationEvents:0};
const controlCounts={};
const failures=[],variants=[],nameUses=new Map(),attestations=new Map(),inlineResidual=[],patchLiterals=[];
const keepEvidence=(name,evidence)=>{if(!attestations.has(name))attestations.set(name,[]);const list=attestations.get(name);if(list.length<5)list.push(evidence);};
const all=variant=>variant.sections.flatMap(section=>section.events);
for(const corpus of catalog.corpora.filter(c=>c.corpusId.startsWith('narcissu')))for(const entry of corpus.stories){
  const story=await adapter.load({corpus,storyEntry:entry,io});counts.stories++;
  for(const variant of story.variants){
    const source=entry.sourceStory.variants.find(v=>v.id===variant.variantId);
    const [plain,scriptBytes]=await Promise.all([readFile(path.join(resourceRoot,source.references.plainObject)),readFile(path.join(resourceRoot,source.references.script))]);
    const script=JSON.parse(scriptBytes),instructions=parseMajiroInstructions(plain),events=all(variant);
    for(const instruction of instructions.filter(i=>i.opcode===0x842)){
      controlCounts[instruction.string]=(controlCounts[instruction.string]??0)+1;
      if(!['p','w','n','s','o'].includes(instruction.string))failures.push({storyId:entry.canonicalStoryId,variantId:variant.variantId,type:'unreviewed-render-control',codeOffset:instruction.codeOffset,control:instruction.string});
    }
    const native=instructions.filter(i=>i.opcode===0x840).map(i=>i.codeOffset),nativeSet=new Set(native);
    const retained=events.flatMap(e=>e.source?.nativeUnit?.codeOffsets??[]).filter(offset=>nativeSet.has(offset));
    const one=new Map();for(const n of retained)one.set(n,(one.get(n)??0)+1);
    const missing=native.filter(n=>!one.has(n)),duplicates=[...one].filter(([,n])=>n!==1);
    if(missing.length||duplicates.length)failures.push({storyId:entry.canonicalStoryId,variantId:variant.variantId,type:'native-text-coverage',missing,duplicates});
    const expected=(script.translation?.alignment==='exact-bytecode-order'?script.translation.entries:[]).filter(e=>e.target.kind==='message');
    const bindings=events.flatMap(e=>e.source?.nativeUnit?.translationBindings??[]).filter(e=>e.field!=='ruby');
    const bound=new Map();for(const b of bindings)bound.set(b.targetCodeOffset,(bound.get(b.targetCodeOffset)??0)+1);
    const unbound=expected.filter(e=>!bound.has(e.target.codeOffset)).map(e=>({codeOffset:e.target.codeOffset,text:e.displayText}));
    const duplicateBindings=[...bound].filter(([,n])=>n!==1);
    if(unbound.length||duplicateBindings.length||bound.size!==expected.length)failures.push({storyId:entry.canonicalStoryId,variantId:variant.variantId,type:'translation-message-coverage',unbound,duplicateBindings});
    const nativeGroups=new Map(events.filter(e=>e.source?.presentationGroup).map(e=>[e.source.presentationGroup.id,e.source.presentationGroup]));
    const bodies=events.filter(e=>e.kind==='line'),choice=events.filter(e=>e.kind==='choice');
    const info={storyId:entry.canonicalStoryId,archiveIdentity:entry.sourceCanonicalStoryId,variantId:variant.variantId,
      scriptPath:source.references.script,plainPath:source.references.plainObject,scriptSha256:sha(scriptBytes),plainSha256:sha(plain),
      rawMessageEvents:script.textEvents.length,nativeTextOperands:native.length,retainedTextOperands:retained.length,
      nativeUnits:bodies.length,rubyBases:bodies.reduce((n,e)=>n+e.source.nativeUnit.ruby.length,0),
      translationMessageTargets:expected.length,retainedTranslationMessageTargets:bindings.length,
      nativeChoiceEvents:choice.length,nativeChoiceOptions:choice.reduce((n,e)=>n+e.choices.length,0),
      presentationGroups:nativeGroups.size,presentationEvents:events.filter(e=>e.source?.presentationGroup).length};
    variants.push(info);counts.variants++;
    for(const key of Object.keys(counts).filter(k=>!['stories','variants'].includes(k)))counts[key]+=info[key]??0;
    if(variant.variantId===entry.preferredVariantId||source.sourceLocale==='zh-CN'){
      for(const e of bodies){
        const label=e.speaker?.['zh-CN'];if(!label)continue;
        const native=e.source.nativeUnit,raw=native.speakerRaw,normal=native.speakerDisplayNormalization;
        const rawName=normal?.source??raw?.decodedText??raw?.text??'';
        const key=JSON.stringify([rawName,label]);if(!nameUses.has(key))nameUses.set(key,{rawName,display:label,count:0,examples:[]});
        const use=nameUses.get(key);use.count++;if(use.examples.length<3)use.examples.push({storyId:entry.canonicalStoryId,variantId:variant.variantId,eventId:e.eventId,codeOffset:raw?.codeOffset,rawHex:raw?.rawHex,scriptPath:source.references.script});
        const patchName=native.translationBindings?.find(b=>b.field==='speaker');
        if(raw&&patchName&&!/[ぁ-ヿ]/u.test(patchName.text))keepEvidence(raw.decodedText??raw.text,{kind:'exact-bytecode-order-patch-name-target',storyId:entry.canonicalStoryId,scriptPath:source.references.script,scriptSha256:info.scriptSha256,eventId:e.eventId,
          japaneseName:raw.decodedText??raw.text,chineseName:patchName.text,translationLine:patchName.translationLine,targetCodeOffset:patchName.targetCodeOffset,rawHex:patchName.sourceRawHex});
        if(e.text?.['zh-CN']?.includes('@'))inlineResidual.push({storyId:entry.canonicalStoryId,eventId:e.eventId,speaker:label,text:e.text['zh-CN'],speakerRaw:raw});
      }
      for(const e of bodies.filter(e=>!e.speaker?.['zh-CN']&&e.text?.['zh-CN']?.includes('@')))inlineResidual.push({storyId:entry.canonicalStoryId,eventId:e.eventId,text:e.text['zh-CN'],speakerRaw:e.source.nativeUnit.speakerRaw});
      for(const tr of (script.translation?.alignment==='exact-bytecode-order'?script.translation.entries:[]).filter(e=>e.target.kind==='literal')){
        const at=instructions.findIndex(i=>i.codeOffset===tr.target.codeOffset),following=instructions[at+1];
        patchLiterals.push({storyId:entry.canonicalStoryId,scriptPath:source.references.script,target:tr.target,translationLine:tr.line,chineseText:tr.displayText,followingInstruction:{codeOffset:following?.codeOffset,hex:following?.hex},classification:'non-message-native-call-argument-preserved-in-source'});
      }
    }
  }
}
for(const entry of await json(path.join(publicRoot,'story_index.json'))){
  if(!entry.source_identity.startsWith('narcissu-3rd/'))continue;
  const routePath=path.join(publicRoot,'data/legacy-vn',entry.source_identity+'.routes.json');
  const routeBytes=await readFile(routePath),route=JSON.parse(routeBytes);
  const correspondence=await json(routePath.replace(/\.routes\.json$/u,'.alignment.json'));
  if(correspondence.hashes.route!==sha(routeBytes))throw Error('stale correspondence '+entry.source_identity);
  const sides=Object.fromEntries(['cn','jp'].map(side=>[side,new Map(route.variantRoutes.find(v=>v.variantId===route[side==='cn'?'chineseVariantId':'japaneseVariantId']).sections.flatMap(s=>s.events).map(e=>[e.eventId,e]))]));
  for(const pair of correspondence.pairs){
    const c=sides.cn.get(pair.cnEventId)?.source?.nativeUnit?.speakerRaw,j=sides.jp.get(pair.jpEventId)?.source?.nativeUnit?.speakerRaw;
    if(!c||!j||/[ぁ-ヿ]/u.test(c.decodedText??c.text))continue;
    keepEvidence((j.decodedText??j.text).trim(),{kind:'proved-native-cross-variant-name-slots',storyId:entry.source_identity,cnEventId:pair.cnEventId,jpEventId:pair.jpEventId,japaneseName:j.decodedText??j.text,chineseName:c.decodedText??c.text,cnRawHex:c.rawHex,jpRawHex:j.rawHex,routeSha256:sha(routeBytes),proofMethod:correspondence.proof.method});
  }
}
const properNames=new Set(['チサト','カズアキ','セツミ','蒔絵','姫子','千尋','優花','イリス','子供イリス','とも','多　恵']);
const mappings=Object.entries(NARCISSU_SPEAKER_ZH).map(([source,display])=>({source,display,
  kind:properNames.has(source)?'proper-name-existing-patch-or-Chinese-glyph-normalization':source==='お老奶奶Ｃ★'?'mixed-prefix-and-decoration-cleanup':'explicit-role-label-translation',
  sourceUses:[...nameUses.values()].filter(x=>x.rawName.trim()===source).reduce((n,x)=>n+x.count,0),
  evidence:(attestations.get(source)??[]).filter(e=>normalizeNarcissuChineseSpeaker(e.chineseName)===display)}));
const uses=[...nameUses.values()].sort((a,b)=>b.count-a.count);
const speakers={schema:'narcissu-chinese-speaker-audit/v1',source:'installed native scripts and Chinese patch, source identities retained',
  counts:{displayedOccurrences:uses.reduce((n,x)=>n+x.count,0),rawDisplayMappings:uses.length,normalizations:uses.filter(x=>x.rawName!==x.display).reduce((n,x)=>n+x.count,0),kanaResidue:uses.filter(x=>/[ぁ-ヿ]/u.test(x.display)).reduce((n,x)=>n+x.count,0)},
  residualJapaneseKana:uses.filter(x=>/[ぁ-ヿ]/u.test(x.display)),mappings,uses,inlineDelimiterResidue:inlineResidual,
  policy:'Proper names retain existing patch spellings; explicit role labels use literal Chinese equivalents. Decorative stars are removed for display only. All raw name bytes and original translation strings remain native edit bindings.'};
await mkdir(output,{recursive:true});
await writeFile(path.join(output,'native-text-coverage.json'),JSON.stringify({schema:'majiro-native-text-coverage/v1',status:failures.length?'FAIL':'PASS',counts,controlCounts,controlReference:'https://github.com/AtomCrafty/MajiroTools/wiki/Table-of-opcodes',failures,variants,nonMessagePatchTargets:patchLiterals},null,2)+'\n');
await writeFile(path.join(output,'speaker-audit.json'),JSON.stringify(speakers,null,2)+'\n');
console.log(JSON.stringify({status:failures.length?'FAIL':'PASS',counts,speakers:speakers.counts,inlineDelimiterResidue:inlineResidual.length,unattestedProper:mappings.filter(m=>properNames.has(m.source)&&!m.evidence.length).map(m=>m.source),failures}));
if(failures.length)process.exitCode=1;
