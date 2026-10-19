import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {classicApp} from '../test-support/classic-module-loader.js';
import {parseStoryContent} from '../apps/classic-reader/lib/story-parser.ts';
import {buildCurrentGenericProgress,loadCurrentGenericProgress} from '../apps/classic-reader/lib/generic-progress-server.ts';
const pub=path.resolve(process.env.ADV_CLASSIC_PUBLIC_ROOT??path.join(classicApp,'public'));
const read=rel=>fs.readFile(path.join(pub,rel.replace(/^\//,'')));
const json=async rel=>JSON.parse(await read(rel));
const hash=b=>createHash('sha256').update(b).digest('hex');
const manifest=await json('data/legacy-vn/manifests/supplemental-texts.json');
const index=await json('story_index.json');
const plain=s=>s.replace(/\s/g,'');

test('supplied ten source editions and identical archive members are preserved once, apart from native game membership',async()=>{
 assert.equal(manifest.sources.length,10);assert.equal(manifest.entries.length,121);assert.equal(manifest.counts.nativeGameScriptsAdded,0);
 const subset=index.filter(s=>s.source_format==='supplemental-text/v1');
 assert.equal(index.length-subset.length,202);
 assert.deepEqual(subset.map(s=>s.id).sort(),manifest.entries.map(s=>s.id).sort());
 for(const source of manifest.sources){
  const original=await fs.readFile(path.join(manifest.sourceRoot,source.filename));
  assert.equal(hash(original),source.sha256);assert.deepEqual(await read(source.originalPath),original);
  const decoder=new TextDecoder(source.encoding==='utf-8-sig'?'utf-8':source.encoding,{fatal:true});
  const lines=decoder.decode(original).replace(/\r\n?/g,'\n').split('\n');
  const covered=new Set();
  for(const record of manifest.entries.filter(e=>e.sourceSha256===source.sha256)){
   for(let i=record.startLine-1;i<record.endLine;i++){assert(!covered.has(i),'overlapping source span '+record.id);covered.add(i);}
   assert.equal(plain(record.paragraphs.map(p=>p.original).join('\n')),plain(lines.slice(record.startLine-1,record.endLine).join('\n')),record.id+' preserves every source character');
  }
  for(let i=0;i<lines.length;i++)if(lines[i].trim())assert(covered.has(i),source.filename+':'+(i+1));
 }
 for(const archive of manifest.archives){assert.equal(archive.members,10);assert.equal(archive.byteIdenticalToLooseSources,true);assert.equal(archive.importedAgain,false);}
});

test('each supplied paragraph remains a separate source-bound reading row with no synthesized Japanese or review flag',async()=>{
 for(const record of manifest.entries){
  const entry=index.find(s=>s.id===record.id),bytes=await read(record.path);assert.equal(hash(bytes),record.sha256);
  const rows=parseStoryContent(bytes.toString('utf8'),{mergeConsecutiveTextLines:false}).lines.filter(r=>!r.isHeader);
  assert.equal(rows.length,record.paragraphs.length,entry.id);
  assert.equal(entry.progress_rows,rows.length,entry.id);
  assert.equal(entry.pending_review_rows,0);assert.equal(entry.human_verified,true);assert.equal(entry.has_jp,false);assert.equal(entry.path_jp,undefined);
  for(let i=0;i<rows.length;i++){assert.equal(rows[i].speaker,record.paragraphs[i].speaker);assert.equal(rows[i].text,record.paragraphs[i].text);}
 }
});

test('single-newline novel and Himeko editions never collapse a whole chapter into one narration cell',()=>{
 for(const source of manifest.sources.filter(s=>['novel1','himeko'].includes(s.id))){
  const records=manifest.entries.filter(e=>e.sourceSha256===source.sha256);
  for(const record of records)for(const paragraph of record.paragraphs)assert(!paragraph.original.includes('\n'),record.id);
 }
 const prologue=manifest.entries.find(e=>e.id==='legacy-narcissu-texts-novel1-002');
 assert(prologue.paragraphs.length>30);assert.equal(index.find(s=>s.id===prologue.id).progress_rows,prologue.paragraphs.length);
});

test('native projection keeps two source-bound pending Japanese rows separate from seven translation proofreading tasks',async()=>{
 const direct=await buildCurrentGenericProgress(pub),snapshot=await loadCurrentGenericProgress(pub);
 assert.deepEqual(snapshot,direct,'initial catalog/snapshot and asynchronous API use the same counts');
 assert.equal(direct.withoutChinese,0);assert.equal(direct.entries.reduce((n,e)=>n+e.unmatchedJapaneseRows,0),2);
 assert.deepEqual(direct.entries.filter(e=>e.unmatchedJapaneseRows).map(e=>[e.identity,e.unmatchedJapaneseRows,e.pendingCorrespondenceRows,e.pendingCorrespondenceJapaneseRows]),[['narcissu-3rd/nard01',2,3,2]]);
 assert.equal(direct.chineseRows+2,direct.rows);assert.equal(direct.pendingReviewRows,136);assert.equal(direct.humanVerified,316);
 assert.deepEqual(direct.entries.filter(e=>e.pendingReviewRows).map(e=>[e.identity,e.pendingReviewRows]).sort(),[
  ['kana-okaeri/ev49b',1],['narcissu-3rd/nar3_04',2],['narcissu-3rd/nar3_05',2],['narcissu-3rd/nar3_07',1],['narcissu-3rd/nar3_08',1],['narcissu-3rd/product',4],['narcissu-himeko/omake_062',125],
 ].sort());
 assert.equal(direct.rows,direct.reviewedRows+direct.pendingReviewRows+2);
 for(const e of direct.entries){const s=index.find(s=>s.id===e.id);assert.equal(s.reviewed_rows,e.reviewedRows);assert.equal(s.pending_review_rows,e.pendingReviewRows);assert.equal(s.progress_rows,e.rows);}
});
