import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {root,publicRoot} from './build-native-edit-sources.mjs';
import {loadNativeRevisionContext,sha} from './read-native-reader-revision.mjs';
import {stageNativeReaderRevision,installNativeReaderRevision} from './stage-native-reader-revision.mjs';
import {mergeNativeAlignedRows} from '../apps/classic-reader/lib/legacy-vn-alignment.ts';
import {parseStoryContent} from '../apps/classic-reader/lib/story-parser.ts';
const child=(base,rel)=>{const p=path.resolve(base,rel.replace(/^\//,''));assert(p.startsWith(path.resolve(base)+path.sep));return p;};
const json=v=>JSON.stringify(v,null,2)+'\n';

/** Apply reviewed, source-bound reader corrections to a separate DATA candidate.
 * Original native files and the resource repository are never rewritten. */
export async function applyChineseReadingRepairs(inputPublic,workRoot){
 inputPublic=path.resolve(inputPublic);workRoot=path.resolve(workRoot);
 assert(inputPublic.startsWith(root+path.sep)&&workRoot.startsWith(root+path.sep));
 assert(inputPublic!==publicRoot&&!inputPublic.startsWith(publicRoot+path.sep),'Use an isolated data candidate');
 const recipePath=path.join(root,'tools/content/chinese-reading-repairs-20261014.json');
 const recipeRaw=await fs.readFile(recipePath,'utf8'),recipe=JSON.parse(recipeRaw);
 assert.equal(recipe.schema,'reader-chinese-repair-recipe/v1');
 for(const [relative,hash] of Object.entries(recipe.guards))assert.equal(sha(await fs.readFile(child(inputPublic,relative))),hash,'Changed source: '+relative);
 const index=JSON.parse(await fs.readFile(path.join(inputPublic,'story_index.json'),'utf8'));
 const byStory=new Map();for(const operation of recipe.operations){if(!byStory.has(operation.identity))byStory.set(operation.identity,[]);byStory.get(operation.identity).push(operation);}
 byStory.set(recipe.awaji.identity,[]);
 const report=[];await fs.mkdir(workRoot,{recursive:true});
 for(const [identity,operations] of byStory){
  const entry=index.find(e=>e.source_identity===identity);assert(entry,'Missing catalog identity '+identity);
  const state=await loadNativeRevisionContext(entry,inputPublic);
  assert(!state.source.revision,'Existing user revision requires an explicit reconciliation: '+identity);
  const definitions=new Map(state.source.document.rows.map(r=>[r.key,r]));
  const merged=mergeNativeAlignedRows(state.rows),changes=new Map(),reviews={};
  const target=(key,cn,speaker,review)=>{
   const d=definitions.get(key);assert(d,'Unknown native key');
   const field=d.allowed.includes('choiceLabel')?'choiceLabel':'text';
   if(field==='choiceLabel')cn=cn.replace(/^【|】$/g,'');
   assert(d.allowed.includes(field),'Read-only native group reference '+key);
   const before=d.baseline[field]??'';
   if(before!==cn){const id=JSON.stringify([key,field]);assert(!changes.has(id),'Duplicate edit '+key);changes.set(id,{key,field,before,after:cn});}
   if(speaker&&d.allowed.includes('speaker')&&speaker!==d.baseline.speaker){const id=JSON.stringify([key,'speaker']);assert(!changes.has(id));changes.set(id,{key,field:'speaker',before:d.baseline.speaker,after:speaker});}
   reviews[key]=review;
  };
  for(const op of operations){
   const row=merged.find(r=>JSON.stringify(r.nativeKeys)===JSON.stringify(op.targetNativeKeys));
   assert(row,'Changed merged native boundary '+identity);
   assert.equal(row.jp?.text,op.expectedJP,'Changed Japanese paragraph');
   assert.equal(row.cn?.text??'',op.beforeCN,'Changed original Chinese paragraph');
   const members=op.targetNativeKeys.map(k=>state.rows.find(r=>r.nativeKeys[0]===k));
   assert(members.every(Boolean));
   // Multiple keys here are a proven native-append buffer, not independent paragraphs.
   if(members.length>1)assert(members.every(r=>r.presentationGroup?.displayJoinMode==='native-append'),'Do not merge independent original paragraphs');
   const review={state:op.review,origin:op.origin,credit:op.origin==='author-supplement'?recipe.credit:'原汉化组',sources:op.sources??[],recipeSha256:sha(recipeRaw),targetJapanese:op.expectedJP,...(op.preservedChineseOnly?{preservedChineseOnly:op.preservedChineseOnly}:{})};
   members.forEach((r,i)=>target(r.nativeKeys[0],i===0?op.afterCN:'',op.speaker,review));
  }
  if(identity===recipe.awaji.identity){
   const jp=await fs.readFile(child(inputPublic,entry.path_jp),'utf8');assert.equal(sha(jp),recipe.awaji.japaneseSha256);
   const cn=await fs.readFile(path.join(root,recipe.awaji.chineseFile),'utf8');
   const jpLines=parseStoryContent(jp,{mergeConsecutiveTextLines:false}).lines;
   const cnLines=parseStoryContent(cn,{mergeConsecutiveTextLines:false}).lines;
   assert.equal(cnLines.length,jpLines.length,'Authored translation must include every native text/choice line');
   for(const row of state.rows){
    if(row.jp?.isHeader)continue;
    assert.equal(row.jpIndices.length,1,'Awaji native row must retain one source text position');
    const i=row.jpIndices[0],line=cnLines[i],original=jpLines[i];
    assert(line&&original&&line.isChoice===original.isChoice&&line.isHeader===original.isHeader);
    if(line.isChoice)assert.equal(line.choiceTargetId,original.choiceTargetId,'Choice control target changed');
    target(row.nativeKeys[0],line.isChoice?line.choiceLabel:line.text,line.speaker,{state:'pending',origin:'author-supplement',credit:recipe.credit,sources:[{path:recipe.awaji.chineseFile,sha256:sha(cn),originalJapaneseSha256:sha(jp),sourceLine:i+1}]});
   }
  }
  const patch={schema:'native-reader-translation-patch/v1',storyId:identity,sourceSha256:state.source.sha256,binding:state.source.document.binding,locale:'zh-CN',changes:[...changes.values()]};
  const stem=identity.replace('/','--'),patchFile=path.join(workRoot,stem+'.patch.json');
  await fs.writeFile(patchFile,json(patch));
  const stage=path.join(workRoot,stem+'.stage');
  await stageNativeReaderRevision(patchFile,stage,inputPublic,{skipSearch:true,translationReview:{policy:recipe.sourcePolicy,rows:reviews}});
  await installNativeReaderRevision(stage,inputPublic);
  const current=await loadNativeRevisionContext(entry,inputPublic);
  const after=mergeNativeAlignedRows(current.rows);
  const missing=after.filter(r=>r.jp&&!r.jp.isHeader&&r.jp.text.trim()&&!(r.cn?.text??'').trim());
  report.push({identity,changes:changes.size,reviewedKeys:Object.values(reviews).filter(r=>r.state==='reviewed').length,pendingKeys:Object.values(reviews).filter(r=>r.state==='pending').length,readingRows:after.length,missingChinese:missing.length,revision:current.source.revision.revision});
  console.log(JSON.stringify(report.at(-1)));
 }
 await fs.writeFile(path.join(workRoot,'report.json'),json({schema:'chinese-reading-repair-result/v1',recipeSha256:sha(recipeRaw),stories:report,originalFilesWritten:0}));
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 if(!process.argv[2]||!process.argv[3])throw Error('Usage: node tools/apply-chinese-reading-repairs.mjs CANDIDATE_PUBLIC NEW_HISTORY_DIRECTORY');
 await applyChineseReadingRepairs(process.argv[2],process.argv[3]);
}
