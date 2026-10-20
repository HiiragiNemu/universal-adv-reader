import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createNativeSourceContext,publicRoot} from '../tools/build-native-edit-sources.mjs';
import {loadNativeRevisionContext} from '../tools/read-native-reader-revision.mjs';
import {buildNarcissu3ChapterRelations,NARCISSU3_CHAPTER_RELATION_STORIES} from '../tools/lib/narcissu3-chapter-relations.mjs';
import {mergeNativeAlignedRows} from '../apps/classic-reader/lib/legacy-vn-alignment.ts';
import {nativeCoverage} from '../apps/classic-reader/lib/generic-progress.ts';
import {seedNativeTranslationLines,createNativeTranslationPatch,validateNativeTranslationPatch} from '../apps/classic-reader/lib/native-translation-patch.ts';
const identity='narcissu-3rd/nar3_08',original='「然后从此种些麦子什么的活下去。」';
const key=(archive,id)=>JSON.stringify([`mjo/narcissu3/${archive}.arc.unpacked/nar3_08`,'main'])+'/'+id;
const cnKey=key('update','mjo-de8'),jpKey=key('scenario','mjo-101f');
const context=await createNativeSourceContext();
const index=JSON.parse(await fs.readFile(path.join(publicRoot,'story_index.json'),'utf8')),entry=index.find(s=>s.source_identity===identity);
const state=await loadNativeRevisionContext(entry,publicRoot,context);
test('materialization collects every relation source including nar3_05 and nar3_08 and regenerates exact public links',async()=>{
 const source=await fs.readFile('tools/materialize-classic-reader-data.mjs','utf8');
 assert.match(source,/if \(NARCISSU3_CHAPTER_RELATION_STORIES\.includes\(storyEntry\.canonicalStoryId\)\) \{\s*chapterRelationInputs\.push/);
 assert(NARCISSU3_CHAPTER_RELATION_STORIES.includes('narcissu-3rd/nar3_05'));assert(NARCISSU3_CHAPTER_RELATION_STORIES.includes(identity));
 const inputs=await Promise.all(NARCISSU3_CHAPTER_RELATION_STORIES.map(async identity=>({identity,...await context.story(identity)})));
 const relations=await buildNarcissu3ChapterRelations(inputs,context.corpusRoot??path.resolve('../narcissu-kana-research'));
 for(const [identity,expected]of Object.entries(relations.byStory))assert.deepEqual(index.find(e=>e.source_identity===identity).cross_chapter_relations,expected);
});
test('nar3_08 displays the original wheat translation once while preserving all native rows and remaining supplement',()=>{
 assert.equal(state.rows.length,493);assert.equal(mergeNativeAlignedRows(state.rows).length,429);
 assert.equal(state.rows.filter(r=>r.cn?.text===original).length,1);
 const jp=state.rows.find(r=>r.nativeKeys.includes(jpKey)),raw=state.built.rows.find(r=>r.nativeKeys.includes(jpKey));
 assert.deepEqual(jp,raw);assert.equal(jp.cn,undefined);
 const cn=state.rows.find(r=>r.nativeKeys.includes(cnKey));assert.equal(cn.cn.text,original);assert.equal(cn.cn.speaker,'主人公');
 assert.equal(state.source.revision.translationReview.rows[jpKey],undefined);
 assert.equal(state.source.revision.translationReview.rows[key('scenario','mjo-922a')].state,'pending');
});
test('nar3_08 counterparts lock only the duplicated JP field and protect the sole original CN',()=>{
 assert.deepEqual([...state.source.translationPolicy.readonlyKeys],[jpKey]);
 assert.deepEqual([...state.source.translationPolicy.requiredTextKeys],[cnKey]);
 const lines=seedNativeTranslationLines(state.source,state.rows,'current');
 assert.equal(createNativeTranslationPatch(state.source,lines).changes.length,0);
 const make=(key,before,after)=>({schema:'native-reader-translation-patch/v1',storyId:identity,sourceSha256:state.source.sha256,binding:state.source.document.binding,locale:'zh-CN',changes:[{key,field:'text',before,after}]});
 assert.throws(()=>validateNativeTranslationPatch(state.source,make(jpKey,'',original)),/原译位置/);
 assert.throws(()=>validateNativeTranslationPatch(state.source,make(cnKey,original,'')),/清空前须先复核/);
 assert.equal(validateNativeTranslationPatch(state.source,make(cnKey,original,original+'测试')).changes.length,1);
});
test('nar3_08 statistics distinguish relocated original text from missing or pending translation',()=>{
 const coverage=nativeCoverage(mergeNativeAlignedRows(state.rows),state.source.revision.translationReview,entry);
 assert.equal(coverage.rows,428);assert.equal(coverage.chineseRows,427);
 assert.equal(coverage.relocatedJapaneseRows,1);assert.equal(coverage.missingChineseRows,0);assert.equal(coverage.pendingReviewRows,1);
});
test('regeneration recipe removes exactly the duplicated wheat operation while retaining the other nar3_08 operation',async()=>{
 const recipe=JSON.parse(await fs.readFile('tools/content/chinese-reading-repairs-20261014.json','utf8'));
 const operations=recipe.operations.filter(op=>op.identity===identity);
 assert.equal(operations.length,1);assert.deepEqual(operations[0].targetNativeKeys,[key('scenario','mjo-922a')]);
 assert.equal(operations[0].origin,'author-supplement');assert.equal(operations[0].review,'pending');
});
