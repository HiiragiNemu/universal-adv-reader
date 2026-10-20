import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {parseStoryContent} from '../apps/classic-reader/lib/story-parser.ts';
import {parseLegacyVoiceRouteDocument} from '../apps/classic-reader/lib/legacy-vn-voice-routing.ts';
import {buildParallelNativeAlignment} from '../apps/classic-reader/lib/legacy-vn-correspondence.ts';
import {mergeNativeAlignedRows,applyNativeEditedLines} from '../apps/classic-reader/lib/legacy-vn-alignment.ts';
import {resolveSameStoryNativeCounterparts,nativeCounterpartForRow,nativeChapterRelationHref} from '../apps/classic-reader/lib/native-section-anchors.ts';
import {nativeCoverage} from '../apps/classic-reader/lib/generic-progress.ts';
import {readNativeEditSource,withNativeCounterpartPolicy,seedNativeTranslationLines,createNativeTranslationPatch,validateNativeTranslationPatch,importNativeTranslationPatch} from '../apps/classic-reader/lib/native-translation-patch.ts';
import {React,renderToStaticMarkup,readerRowFragments,rowProps} from '../test-support/classic-module-loader.js';
const publicRoot=path.resolve(process.env.ADV_CLASSIC_PUBLIC_ROOT??'apps/classic-reader/public');
const identity='narcissu-3rd/nar3_05',id='legacy-narcissu-3rd-nar3_05',stem=path.join(publicRoot,'data/legacy-vn',identity);
const raw=ext=>fs.readFileSync(stem+ext,'utf8'),parse=ext=>parseStoryContent(raw(ext),{mergeConsecutiveTextLines:false}).lines;
const route=parseLegacyVoiceRouteDocument(JSON.parse(raw('.routes.json')),identity);
const rows=buildParallelNativeAlignment(route,parse('_cn.txt'),parse('_jp.txt'),JSON.parse(raw('.alignment.json')));
const cnKey='["mjo/narcissu3/update.arc.unpacked/nar3_05","main"]/mjo-3eac';
const jpKeys=['mjo-521e','mjo-526f'].map(event=>'["mjo/narcissu3/scenario.arc.unpacked/nar3_05","main"]/'+event);
const story={id,cross_chapter_relations:[
 {id:'father-jp',source_locale:'ja-JP',source_event_ids:['mjo-521e','mjo-526f'],target_story_id:id,target_locale:'zh-CN',target_event_id:'mjo-3eac',message_cn:'原译位于本章另一位置',message_jp:''},
 {id:'father-cn',source_locale:'zh-CN',source_event_ids:['mjo-3eac'],target_story_id:id,target_locale:'ja-JP',target_event_id:'mjo-521e',message_cn:'对应日文位于本章另一位置',message_jp:''},
]};
const counterparts=resolveSameStoryNativeCounterparts(story,rows);
const base=await readNativeEditSource(raw('.edit-source.json'),{storyId:identity,binding:{}});
const source=withNativeCounterpartPolicy(base,counterparts);
const find=(lines,key)=>lines.find(l=>l.nativeAlignmentKey===key);
const definitions=new Map(source.document.rows.map(r=>[r.key,r]));

test('relocated original translation is counted separately without adding CN copies or proofreading credit',()=>{
 const before=JSON.stringify(rows),p=nativeCoverage(mergeNativeAlignedRows(rows),undefined,story);
 assert.deepEqual({rows:p.rows,cn:p.chineseRows,jpGaps:p.unmatchedJapaneseRows,relocated:p.relocatedJapaneseRows,missing:p.missingChineseRows,reviewed:p.reviewedRows,pending:p.pendingReviewRows},
  {rows:300,cn:298,jpGaps:2,relocated:2,missing:0,reviewed:298,pending:0});
 assert.equal(p.relocatedChineseRows,1);assert.equal(p.coveragePercent,99.33);
 assert.equal(JSON.stringify(rows),before);
 assert.equal(nativeCoverage(mergeNativeAlignedRows(rows)).missingChineseRows,2,'without valid source relations these remain genuine unresolved gaps');
});
for(const seed of ['current','empty','jp'])test(seed+' seed keeps both relocated JP fields at exact baseline and the sole original CN nonempty',()=>{
 const lines=seedNativeTranslationLines(source,rows,seed);
 assert.equal(lines.length,309);
 for(const key of jpKeys)for(const [field,value] of Object.entries(definitions.get(key).baseline))assert.equal(find(lines,key)[field],value);
 assert(find(lines,cnKey).text.trim());
 assert.equal(source.document,base.document);assert.equal(source.sha256,base.sha256);
 if(seed==='current')assert.deepEqual(createNativeTranslationPatch(source,lines).changes,[]);
});
test('create, import and validate reject duplicate CN on JP keys, but allow edits to the actual original CN',()=>{
 const lines=seedNativeTranslationLines(source,rows,'current');
 find(lines,cnKey).text+='（校对测试）';
 const patch=createNativeTranslationPatch(source,lines);
 assert.equal(patch.changes.length,1);assert.equal(patch.changes[0].key,cnKey);
 const imported=importNativeTranslationPatch(source,patch,rows);
 assert.equal(find(imported,cnKey).text,find(lines,cnKey).text);
 for(const key of jpKeys){
  const forged={...patch,changes:[{key,field:'text',before:definitions.get(key).baseline.text,after:'重复的补译'}]};
  assert.throws(()=>validateNativeTranslationPatch(source,forged),/原译位置/);
  assert.throws(()=>importNativeTranslationPatch(source,forged,rows),/原译位置/);
  const changed=seedNativeTranslationLines(source,rows,'current');find(changed,key).text='重复的补译';
  assert.throws(()=>createNativeTranslationPatch(source,changed),/原译位置/);
 }
 const erased=seedNativeTranslationLines(source,rows,'current');find(erased,cnKey).text=' ';
 assert.throws(()=>createNativeTranslationPatch(source,erased),/清空前须先复核/);
});
test('source links remain visible in CN-only, JP-only and read-only JP edit cells, outside text content',()=>{
 const {StoryRow}=readerRowFragments(),merged=mergeNativeAlignedRows(rows),edited=seedNativeTranslationLines(source,rows,'current');
 const display=applyNativeEditedLines(rows,edited);
 for(const key of [cnKey,...jpKeys]){
  const row=merged.find(r=>r.nativeKeys.includes(key)),mode=key===cnKey?'cn':'jp';
  const relation=nativeCounterpartForRow(counterparts,row);
  const html=renderToStaticMarkup(React.createElement(StoryRow,{...rowProps,row,mode,readerStoryId:id,counterpartRelation:relation}));
  assert.match(html,/data-native-counterpart-link=/);
  assert.match(html,key===cnKey?/#source-jp-mjo-521e/:/#source-cn-mjo-3eac/);
  assert(!/data-reader-text-content="[^"]*"[^>]*>[^<]*查看对应/.test(html));
  if(key!==cnKey){
   const editRow=display.find(r=>r.nativeKeys.includes(key)),editIndex=display.indexOf(editRow);
   const editor=renderToStaticMarkup(React.createElement(StoryRow,{...rowProps,readerStoryId:id,row:editRow,index:editIndex,editIndex,mode:'split',isEditMode:true,editedLines:edited,counterpartRelation:relation,nativeReadOnlyReason:'translation-on-relocated-source'}));
   assert.match(editor,/cn-relocated-note/);assert.match(editor,/#source-cn-mjo-3eac/);assert(!editor.includes('<textarea'));assert(!editor.includes('magi-translation-speaker-input'));
  }
 }
});

test('same-story source links retain edit/query state while cross-story links retain their destination',()=>{
 const relation=story.cross_chapter_relations[0];
 assert.equal(nativeChapterRelationHref(relation,id),'#source-cn-mjo-3eac');
 const base=new URL('https://example.test/reader/'+id+'?edit=1&cn=%2Foriginal.txt');
 const resolved=new URL(nativeChapterRelationHref(relation,id),base);
 assert.equal(resolved.pathname,base.pathname);assert.equal(resolved.search,base.search);
 assert.equal(nativeChapterRelationHref(relation,'other'),'/reader/'+id+'#source-cn-mjo-3eac');
});
