import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {root,publicRoot} from './build-native-edit-sources.mjs';
import {buildCurrentGenericProgress,loadCurrentGenericProgress} from '../apps/classic-reader/lib/generic-progress-server.ts';
import {parseStoryIndex} from '../apps/classic-reader/lib/story-index.ts';
import {classicStoryIds} from './generate-classic-story-ids.mjs';
import {buildGenericSearchIndex} from './build-generic-search-index.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const write=async(p,value)=>{await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,JSON.stringify(value,null,2)+'\n');};
export async function finalizeGenericReaderData(inputPublic,reportPath){
 inputPublic=path.resolve(inputPublic);assert(inputPublic.startsWith(root+path.sep)&&inputPublic!==publicRoot,'Finalize a separate data candidate');
 const progress=await buildCurrentGenericProgress(inputPublic);
 assert.equal(progress.withoutChinese,0,'Every published entry must contain Chinese');
 for(const entry of progress.entries){
  assert.equal(entry.unmatchedJapaneseRows,(entry.pendingCorrespondenceJapaneseRows??0)+(entry.relocatedJapaneseRows??0)+(entry.missingChineseRows??0),'Unpaired Japanese classification must retain its denominator: '+entry.identity);
  assert.equal(entry.missingChineseRows??0,0,'Japanese needs a source-bound pending record or resolved original translation: '+entry.identity);
 }
 const index=JSON.parse(await fs.readFile(path.join(inputPublic,'story_index.json'),'utf8')),byId=new Map(progress.entries.map(e=>[e.id,e]));
 const registry=JSON.parse(await fs.readFile(path.join(inputPublic,'native-reader-revisions.json'),'utf8'));
 for(const story of index){const record=registry.entries[story.source_identity];if(record)story.reader_revision_cn={path:record.textPath,sha256:record.textSha256,revision:record.revision};}
 for(const story of index){const p=byId.get(story.id);assert(p);Object.assign(story,{percent:Math.floor(p.coveragePercent),has_cn:p.hasChinese,source_unverified:p.pendingReviewRows>0,human_verified:p.hasChinese&&p.pendingReviewRows===0,progress_rows:p.rows,chinese_rows:p.chineseRows,reviewed_rows:p.reviewedRows,pending_review_rows:p.pendingReviewRows,translation_review_policy:progress.policy});}
 parseStoryIndex(index);
 await write(path.join(inputPublic,'story_index.json'),index);await write(path.join(inputPublic,'apps/web/story_index.json'),index);
 await write(path.join(inputPublic,'data/story_ids.generated.json'),classicStoryIds(index));
 const search=await buildGenericSearchIndex(inputPublic,inputPublic);
 const bindings={};for(const file of ['story_index.json','native-reader-revisions.json','data/legacy-vn/manifest.json','data/legacy-vn/manifests/reader-adapter.json','data/legacy-vn/manifests/supplemental-texts.json', ...index.filter(s=>s.source_format!=='supplemental-text/v1').map(s=>'data/legacy-vn/'+s.source_identity+'.alignment.json').filter(p=>fsSync.existsSync(path.join(inputPublic,p)))])bindings[file]=hash(await fs.readFile(path.join(inputPublic,file)));
 await write(path.join(inputPublic,'generic-progress.json'),{schema:'generic-progress-snapshot/v1',bindings,progress});
 assert.deepEqual(await loadCurrentGenericProgress(inputPublic),progress);
 const report={schema:'generic-reader-finalization/v1',inputPublic,total:progress.total,nativeTotal:progress.nativeTotal,nativeChapters:progress.nativeChapters,supplementalSources:progress.supplementalSources,supplementalTotal:progress.supplementalTotal,rows:progress.rows,chineseRows:progress.chineseRows,reviewedRows:progress.reviewedRows,pendingReviewRows:progress.pendingReviewRows,needsReview:progress.needsReview,fullyReviewedEntries:progress.humanVerified,coveragePercent:progress.coveragePercent,reviewedPercent:progress.reviewedPercent,missingChinese:0,works:progress.works,pending:progress.entries.filter(e=>e.pendingReviewRows>0),search};
 if(reportPath)await write(path.resolve(reportPath),report);console.log(JSON.stringify(report,null,2));return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){if(!process.argv[2])throw Error('Usage: node tools/finalize-generic-reader-data.mjs CANDIDATE_PUBLIC [REPORT]');await finalizeGenericReaderData(process.argv[2],process.argv[3]);}
