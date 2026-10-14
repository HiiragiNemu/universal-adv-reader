import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { publicRoot, root } from './build-native-edit-sources.mjs';
import { loadNativeRevisionContext, sha } from './read-native-reader-revision.mjs';
import { readNativeEditSource, validateNativeTranslationPatch, importNativeTranslationPatch, applyNativeTranslationPatch } from '../apps/classic-reader/lib/native-translation-patch.ts';
import { readNativeReaderRevision, serializeNativeRevisionText } from '../apps/classic-reader/lib/native-reader-revision.ts';
import { mergeTranslationReview, validateTranslationReview } from '../apps/classic-reader/lib/translation-review.ts';
import { seedNativeEditableLines } from '../apps/classic-reader/lib/legacy-vn-alignment.ts';
import { validateStoryDocument } from '../packages/contracts/src/index.js';
import { buildGenericSearchIndex } from './build-generic-search-index.mjs';
const inside = value => { const full=path.resolve(value);if(!full.startsWith(root+path.sep))throw Error('Revision output must stay in generic checkout');return full; };
const child = (base,relative) => { const full=path.resolve(base,relative.replace(/^\//,''));if(!full.startsWith(base+path.sep))throw Error('Revision path escapes target');return full; };
const maybeRead = async file => { try{return await fs.readFile(file);}catch(error){if(error.code==='ENOENT')return null;throw error;} };
const writeNew = async (file,bytes) => { await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes,{flag:'wx'}); };
const json = value => JSON.stringify(value,null,2)+'\n';
async function walk(directory) { const out=[];for(const e of await fs.readdir(directory,{withFileTypes:true})){const f=path.join(directory,e.name);if(e.isDirectory())out.push(...await walk(f));else out.push(f);}return out; }

/** Stages derived DATA only, no checkout copy, native binary rewrite or live
 * content edit. Installation is an explicit separate local CLI operation. */
export async function stageNativeReaderRevision(patchPath, outputPath, inputPublic = publicRoot, options = {}) {
  const output=inside(outputPath);inputPublic=inside(inputPublic);
  if(output===publicRoot||output.startsWith(publicRoot+path.sep))throw Error('Stage must be separate from active public data');
  await fs.mkdir(path.dirname(output),{recursive:true});
  await fs.mkdir(output); // existing stages and their history are never replaced
  const patchBytes=await fs.readFile(patchPath),patchValue=JSON.parse(patchBytes);
  const indexBytes=await fs.readFile(path.join(inputPublic,'story_index.json')),index=JSON.parse(indexBytes);
  const entry=index.find(e=>e.source_identity===patchValue.storyId);if(!entry)throw Error('Patch story not in reviewed200 catalog');
  const state=await loadNativeRevisionContext(entry,inputPublic),patch=validateNativeTranslationPatch(state.source,patchValue);
  if(!patch.changes.length && !options.translationReview)throw Error('No-op patch does not create a revision');
  const story=await applyNativeTranslationPatch(state.source,patch,state.story),patchSha256=sha(patchBytes);
  const translationReview=mergeTranslationReview(state.source.revision?.translationReview,options.translationReview);
  if(translationReview)validateTranslationReview(translationReview,new Set(state.source.document.rows.map(r=>r.key)));
  const revision=sha(JSON.stringify(translationReview ? [state.source.sha256,patchSha256,translationReview] : [state.source.sha256,patchSha256]));
  const parentRevision=state.source.revision?.revision??null;
  story.revision=`${state.built.story.revision}--native-${revision}`;
  story.provenance.nativeReaderRevision={revision,parentRevision,baseNormalizedStory:state.base.document.binding.normalizedStory,patchSha256};
  validateStoryDocument(story);
  const edited=importNativeTranslationPatch(state.source,patch,state.rows),changed=new Set(patch.changes.map(c=>c.key));
  const definitions=new Map(state.source.document.rows.map(r=>[r.key,r]));
  const rows=state.rows.map((row,i)=>{
    const key=row.nativeKeys[0];if(!changed.has(key))return row;
    const definition=definitions.get(key),line={...edited[i]};
    const t=definition.target,event=story.variants.find(v=>v.variantId===t.variantId).sections.find(s=>s.sectionId===t.sectionId).events.find(e=>e.eventId===t.eventId);
    if(event.source?.engine==='ikura'&&patch.changes.some(c=>c.key===key&&c.field==='text')){
      line.speaker=event.speaker?.['zh-CN']??'';
      if(event.source.opcode===0x2B&&event.source.originalDisplayText)line.text=event.text?.['zh-CN']??'';
    }
    return{...row,cn:line,cnSlot:row.cnSlot??row.jpSlot};
  });
  const baseline=seedNativeEditableLines(rows,'current');
  const sourceDocument={...state.source.document,binding:{...state.source.document.binding,normalizedStory:sha(JSON.stringify(story))},
    rows:state.source.document.rows.map((r,i)=>({...r,baseline:{text:baseline[i].text,speaker:baseline[i].speaker,...(baseline[i].isChoice?{choiceLabel:baseline[i].choiceLabel??''}:{})}}))};
  const document={schema:'native-reader-revision/v1',storyId:patch.storyId,revision,parentRevision,baseSourceSha256:state.base.sha256,
    parentSourceSha256:state.source.sha256,patchSha256,source:sourceDocument,cnKeys:rows.filter(r=>r.cn).map(r=>r.nativeKeys[0]),
    ...(translationReview?{translationReview}:{})};
  const raw=json(document),stem=`/native-reader-revisions/${patch.storyId}/${revision}`,storyRaw=json(story);
  const provisional={document:sourceDocument,sha256:sha(JSON.stringify(sourceDocument)+'\n'),revision:document};
  const textRaw=serializeNativeRevisionText(provisional);
  const record={revision,path:stem+'.json',sha256:sha(raw),storyPath:stem+'.adv.json',storySha256:sha(storyRaw),textPath:stem+'.native.txt',textSha256:sha(textRaw)};
  const current=await readNativeReaderRevision(raw,record,state.base);
  const registry=structuredClone(state.registry);registry.entries[patch.storyId]=record;
  const stagedPublic=path.join(output,'public');
  for(const [relative,bytes]of [[record.path,raw],[record.storyPath,storyRaw],[record.textPath,textRaw],['/native-reader-revisions.json',json(registry)]])await writeNew(child(stagedPublic,relative),bytes);
  // The same search producer consumed by full materialization sees all existing
  // revisions and this one, never chooses just one Chinese compiled variant.
  const search=options.skipSearch ? null : await buildGenericSearchIndex(inputPublic,stagedPublic,{overrides:new Map([[patch.storyId,current]])});
  for(const [name,bytes]of [['patch.json',patchBytes],['parent-source.json',JSON.stringify(state.source.document)+'\n'],['original-source.json',state.built.raw],['parent.adv.json',json(state.story)],['original.adv.json',json(state.built.story)]])await writeNew(path.join(output,'history',name),bytes);
  const mutable=['native-reader-revisions.json','search_index_manifest.generic.json'],files=[];
  for(const file of await walk(stagedPublic)){
    const relative=path.relative(stagedPublic,file).replaceAll('\\','/'),bytes=await fs.readFile(file),before=await maybeRead(child(inputPublic,relative));
    if(before&&sha(before)!==sha(bytes)&&!mutable.includes(relative))throw Error('Immutable revision/hash-addressed content changed');
    if(before)await writeNew(child(path.join(output,'baseline'),relative),before);
    files.push({file:relative,sha256:sha(bytes),baselineSha256:before?sha(before):null,mutable:mutable.includes(relative)});
  }
  const guardPaths=['story_index.json',`data/legacy-vn/${patch.storyId}.edit-source.json`,`data/legacy-vn/${patch.storyId}.routes.json`,entry.path_cn,entry.path_jp].filter(Boolean);
  const guards=[];for(const file of guardPaths)guards.push({file:file.replace(/^\//,''),sha256:sha(await fs.readFile(child(inputPublic,file)))});
  const manifest={schema:'native-reader-revision-stage/v1',storyId:patch.storyId,revision,parentRevision,inputPublic,record,files,guards,search,originalFilesWritten:0};
  await writeNew(path.join(output,'stage.json'),json(manifest));
  return{output,...manifest};
}

/** All hash guards are checked before pointer changes. Content-addressed files
 * are installed first; registry and search manifest are the last two writes. */
export async function installNativeReaderRevision(stagePath,targetPublic=publicRoot,rollback=false){
  const stage=inside(stagePath),target=inside(targetPublic),manifest=JSON.parse(await fs.readFile(path.join(stage,'stage.json'),'utf8'));
  if(manifest.schema!=='native-reader-revision-stage/v1')throw Error('Invalid staged revision');
  for(const guard of manifest.guards)if(sha(await fs.readFile(child(target,guard.file)))!==guard.sha256)throw Error('Retain changed original: '+guard.file);
  const pending=[];
  for(const item of manifest.files){
    const bytes=await fs.readFile(child(path.join(stage,'public'),item.file));if(sha(bytes)!==item.sha256)throw Error('Stage bytes changed');
    const current=await maybeRead(child(target,item.file)),actual=current?sha(current):null;
    if(rollback){if(item.mutable&&actual!==item.sha256)throw Error('Retain later revision: '+item.file);}
    else if(actual!==item.baselineSha256 && !(actual===item.sha256&&!item.mutable))throw Error('Retain concurrent content: '+item.file);
    const baseline=await maybeRead(child(path.join(stage,'baseline'),item.file));if((baseline?sha(baseline):null)!==item.baselineSha256)throw Error('Stage baseline changed');
    pending.push({...item,bytes,baseline});
  }
  if(rollback){
    for(const item of pending.filter(f=>f.mutable)){const file=child(target,item.file);if(item.baseline)await fs.writeFile(file,item.baseline);else await fs.unlink(file);}
  }else{
    for(const item of pending.filter(f=>!f.mutable)){const file=child(target,item.file);if(!await maybeRead(file))await writeNew(file,item.bytes);}
    const written=[];
    try{
      for(const item of pending.filter(f=>f.mutable)){const file=child(target,item.file);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,item.bytes);written.push(item);}
    }catch(error){for(const item of written){const file=child(target,item.file);if(item.baseline)await fs.writeFile(file,item.baseline);else await fs.unlink(file);}throw error;}
  }
  for(const item of pending.filter(f=>f.mutable)){const bytes=await maybeRead(child(target,item.file));if((bytes?sha(bytes):null)!==(rollback?item.baselineSha256:item.sha256))throw Error('Revision pointer readback failed');}
  return{operation:rollback?'rollback':'install',target,revision:manifest.revision,mutablePointersVerified:pending.filter(f=>f.mutable).length,immutableHistoryRetained:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const arg=key=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1];};
  const stage=arg('--stage'),rollback=arg('--rollback');
  if(stage||rollback)console.log(JSON.stringify(await installNativeReaderRevision(stage??rollback,arg('--target')??publicRoot,Boolean(rollback))));
  else {if(!arg('--patch')||!arg('--output'))throw Error('Use --patch FILE --output NEW_DIRECTORY, --stage DIRECTORY or --rollback DIRECTORY');console.log(JSON.stringify(await stageNativeReaderRevision(arg('--patch'),arg('--output'),arg('--input')??publicRoot)));}
}
