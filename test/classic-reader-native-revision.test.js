import { buildCurrentGenericProgress } from '../apps/classic-reader/lib/generic-progress-server.ts';
import {buildGenericSearchIndex} from '../tools/build-generic-search-index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import test from 'node:test';
import { publicRoot, root } from '../tools/build-native-edit-sources.mjs';
import { loadNativeRevisionContext, sha } from '../tools/read-native-reader-revision.mjs';
import { stageNativeReaderRevision, installNativeReaderRevision } from '../tools/stage-native-reader-revision.mjs';
import { createNativeTranslationPatch, composeIkuraMessageText, splitIkuraMessageText } from '../apps/classic-reader/lib/native-translation-patch.ts';
import { seedNativeEditableLines, mergeNativeAlignedRows } from '../apps/classic-reader/lib/legacy-vn-alignment.ts';
import { projectNativeReaderRevisionRows, loadCurrentNativeEditSource, serializeNativeRevisionText, readNativeReaderRevision } from '../apps/classic-reader/lib/native-reader-revision.ts';
import { parseLegacyVoiceRouteDocument, buildLegacyVoiceSequence } from '../apps/classic-reader/lib/legacy-vn-voice-routing.ts';
import { parseStoryContent } from '../apps/classic-reader/lib/story-parser.ts';
import { classicModules, classicApp, readerRowFragments, rowProps, React, renderToStaticMarkup } from '../test-support/classic-module-loader.js';
const directory=path.join(root,'work/reader-inheritance-20261012/native-revisions',randomUUID());
await fs.mkdir(directory,{recursive:true});
const index=JSON.parse(await fs.readFile(path.join(publicRoot,'story_index.json')));
const untranslatedIdentity='narcissu-himeko/omake_062';
const contexts=new Map();
const stateFor=async identity=>{
  if(!contexts.has(identity))contexts.set(identity,loadNativeRevisionContext(index.find(e=>e.source_identity===identity)));
  return contexts.get(identity);
};
const localFetch = base => async request => {
  try {return new Response(await fs.readFile(path.join(base,String(request))),{status:200});}
  catch(error){if(error.code==='ENOENT')return new Response('not found',{status:404});throw error;}
};
async function fixturePublic(name){
  const dir=path.join(directory,name);await fs.mkdir(dir);
  // Read-only data fixture mount; the installer writes only revision archives
  // and its two declared index pointers, never anything under this junction.
  await fs.symlink(path.join(publicRoot,'data'),path.join(dir,'data'),'junction');
  for(const file of ['story_index.json','native-reader-revisions.json','search_index_manifest.generic.json'])await fs.copyFile(path.join(publicRoot,file),path.join(dir,file));
  await fs.cp(path.join(publicRoot,'native-reader-revisions'),path.join(dir,'native-reader-revisions'),{recursive:true});
  return dir;
}
async function readerLoad(identity,base,fetcher=localFetch(base)){
  const entry=index.find(e=>e.source_identity===identity),raw=await (await fetcher(`/data/legacy-vn/${identity}.routes.json`)).text();
  const route={...parseLegacyVoiceRouteDocument(JSON.parse(raw),identity),documentSha256:sha(raw)};
  const cn=entry.path_cn?await (await fetcher(entry.path_cn)).text():'',jp=await (await fetcher(entry.path_jp)).text();
  return{source:await loadCurrentNativeEditSource(route,cn,jp,new AbortController().signal,fetcher),route,cn,jp};
}
function controls(story){
  const result=structuredClone(story);delete result.provenance.nativeReaderRevision;delete result.revision;
  for(const v of result.variants){v.locales=v.locales.filter(l=>l!=='zh-CN');for(const s of v.sections)for(const e of s.events){
    for(const key of ['text','speaker'])if(e[key]){delete e[key]['zh-CN'];if(!Object.keys(e[key]).length)delete e[key];}
    for(const c of e.choices??[])delete c.label['zh-CN'];
  }}return result;
}
async function searchBody(base){const m=JSON.parse(await fs.readFile(path.join(base,'search_index_manifest.generic.json')));const b=[];for(let i=0;i<m.chunks.length;i++)b.push(await fs.readFile(path.join(base,`search-chunks/generic/${m.sha256}/${String(i).padStart(4,'0')}.part`)));return JSON.parse(Buffer.concat(b));}

await fs.mkdir(path.join(root, 'work/test-results'), { recursive: true });

test('actual page uses revision-aware loader and projection, and offers lossless revision TXT without replacing originals', async()=>{
  const code=await fs.readFile(path.join(classicApp,'app/reader/[id]/page.tsx'),'utf8');
  assert.match(code,/loadCurrentNativeEditSource as loadNativeEditSource/);
  assert.match(code,/projectNativeReaderRevisionRows\(shared, currentNativeEditSource\)/);
  assert.match(code,/onClick=\{downloadNativeRevisionText\}/);
  assert.match(code,/cnSource\.raw/,'original Chinese download remains separate');
});

test('JP-origin revision survives actual reader pipeline, TXT, regenerated search and two-version install/rollback',async t=>{
  const identity=untranslatedIdentity,entry=index.find(e=>e.source_identity===identity),target=await fixturePublic('consumer');
  // Only this isolated fixture restores the source's original Japanese-only state.
  // The installed site translation and every unrelated revision remain untouched.
  const originalRegistry=JSON.parse(await fs.readFile(path.join(target,'native-reader-revisions.json'),'utf8'));
  delete originalRegistry.entries[identity];
  await fs.writeFile(path.join(target,'native-reader-revisions.json'),JSON.stringify(originalRegistry,null,2)+'\n');
  await buildGenericSearchIndex(target,target);
  const baselineSearchManifest=await fs.readFile(path.join(target,'search_index_manifest.generic.json'),'utf8');
  const state=await loadNativeRevisionContext(entry,target);
  const baselineProgress=await buildCurrentGenericProgress(target);
  const edited=seedNativeEditableLines(state.rows,'current'),added=state.rows.findIndex((r,i)=>r.jp&&!r.cn&&state.source.document.rows[i].allowed.includes('text'));
  const speaker=state.source.document.rows.findIndex((r,i)=>i!==added&&r.allowed.includes('speaker')&&state.rows[i].jp?.speaker);
  assert.ok(added>=0&&speaker>=0);assert.equal(edited[added].text,'');
  edited[added].text='GEN11跨版本新增中文检索标记\n保留第二行';edited[speaker].speaker='';
  const patch=path.join(directory,'first.patch.json');await fs.writeFile(patch,JSON.stringify(createNativeTranslationPatch(state.source,edited)));
  const translationReview={policy:'original-reviewed-author-pending/v1',defaultState:'reviewed',defaultOrigin:'existing-translation',defaultCredit:'原汉化组',rows:{[state.rows[added].nativeKeys[0]]:{state:'pending',origin:'author-supplement',credit:'站长'}}};
  const staged=await stageNativeReaderRevision(patch,path.join(directory,'stage-first'),target,{translationReview});
  await installNativeReaderRevision(staged.output,target);
  const requests=[];
  const server=createServer(async(req,res)=>{
    const requested=new URL(req.url,'http://localhost').pathname;
    const file=path.resolve(target,'.'+decodeURIComponent(requested));
    if(!file.startsWith(target+path.sep)){res.writeHead(400);res.end();return;}
    try{const bytes=await fs.readFile(file);requests.push({path:requested,status:200,sha256:sha(bytes),bytes:bytes.length});res.writeHead(200);res.end(bytes);}
    catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const origin=`http://127.0.0.1:${server.address().port}`,httpFetch=url=>fetch(new URL(url,origin));
  const loaded=await readerLoad(identity,target,httpFetch),rows=projectNativeReaderRevisionRows(state.rows,loaded.source);
  assert.equal(rows[added].cn.text,edited[added].text);assert.equal(rows[speaker].cn.speaker,'');
  assert.equal(state.rows[added].cn,undefined);assert.equal(state.rows[speaker].cn,undefined);
  assert.equal(rows[speaker].cn.text,'','clearing a JP-origin name does not copy its Japanese body as Chinese');
  const addedChineseKeys=rows.filter((row,i)=>!state.rows[i].cn&&row.cn).map(row=>row.nativeKeys[0]);
  assert.deepEqual(addedChineseKeys.sort(),[state.rows[added].nativeKeys[0],state.rows[speaker].nativeKeys[0]].sort(),
    'exactly the independently edited body and empty-name keys gain Chinese fields');
  assert.equal(new Set(addedChineseKeys).size,2,'different native edits must not create duplicate translations');
  for(const theme of ['light','paper','green','dark','frost']){
    const {StoryRow}=readerRowFragments(theme),html=renderToStaticMarkup(React.createElement(StoryRow,{...rowProps,theme,mode:'cn',row:rows[speaker]}));
    assert.match(html,/<div[^>]*class="magi-reader-speaker-label[^>]*><\/div>/,'read mode leaves intentional empty name empty');
  }
  for(let i=0;i<rows.length;i++){assert.equal(rows[i].jp,state.rows[i].jp);if(i!==speaker&&i!==added)assert.deepEqual(rows[i].cn,state.rows[i].cn);}
  assert.deepEqual(rows[added].cnSlot,rows[added].jpSlot,'new Chinese uses its own Japanese native occurrence, not old CN offset');
  const modules=classicModules(),parse=t=>parseStoryContent(t,{mergeConsecutiveTextLines:false}).lines;
  const currentNativeCorrespondence=await fs.readFile(path.join(target,`data/legacy-vn/${identity}.alignment.json`),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  const actual=modules.fragments('app/reader/[id]/page.tsx',['nativeAlignmentState','nativeCounterpartState','nativePresentationState'],{
    ...modules.load('lib/legacy-vn-alignment.ts'),...modules.load('lib/legacy-vn-correspondence.ts'),...modules.load('lib/native-section-anchors.ts'),projectNativeReaderRevisionRows,
    currentStory:entry,
    currentNativeEditSource:loaded.source,nativeEditState:{error:''},useMemo:f=>f(),legacyVoiceRoute:loaded.route,cnEventLines:parse(loaded.cn),jpEventLines:parse(loaded.jp),
    currentLegacyVoiceRoutePath:'/native/routes',currentNativeCorrespondence,nativeCorrespondenceState:{error:''},isEditMode:false,editedCnLines:[],mode:'split',
  });
  assert.equal(actual.nativeAlignmentState.error,'');assert.deepEqual(actual.nativeAlignmentState.rows,rows);
  assert.deepEqual(actual.nativePresentationState.rows,mergeNativeAlignedRows(rows));
  const downloaded=[];modules.fragments('app/reader/[id]/page.tsx',['downloadNativeRevisionText'],{currentNativeEditSource:loaded.source,serializeNativeRevisionText,triggerUtf8Download:(bytes,name)=>downloaded.push({bytes,name}),id:entry.id}).downloadNativeRevisionText();
  assert.equal(downloaded[0].bytes,await fs.readFile(path.join(target,staged.record.textPath),'utf8'));
  const textRows=downloaded[0].bytes.trimEnd().split('\n').slice(1).map(s=>JSON.parse(s));
  assert.equal(textRows.find(r=>r.key===state.rows[speaker].nativeKeys[0]).speaker,'');
  assert.equal(textRows.find(r=>r.key===state.rows[added].nativeKeys[0]).text,edited[added].text);
  const progress=await buildCurrentGenericProgress(target);
  const beforeEntry=baselineProgress.entries.find(item=>item.identity===identity),afterEntry=progress.entries.find(item=>item.identity===identity);
  assert.equal(beforeEntry.hasChinese,false);assert.equal(afterEntry.hasChinese,true);
  // A present but empty name/body field is not readable Chinese coverage.
  assert.equal(afterEntry.chineseRows,beforeEntry.chineseRows+1);
  assert.equal(afterEntry.nonemptyChineseRows,beforeEntry.nonemptyChineseRows+1);
  assert.equal(progress.chineseRows,baselineProgress.chineseRows+1);
  assert.equal(progress.rows,baselineProgress.rows,'the raw native event denominator cannot grow');
  assert.equal(progress.withChinese,baselineProgress.withChinese+1);
  assert.equal(progress.withoutChinese,baselineProgress.withoutChinese-1);
  assert.equal(progress.needsReview,baselineProgress.needsReview+1,'first Chinese body makes the JP-only work pending review');
  assert.equal(progress.humanVerified,baselineProgress.humanVerified);assert.equal(afterEntry.pendingReviewRows,1);
  assert.deepEqual(progress.entries.filter(item=>item.identity!==identity),baselineProgress.entries.filter(item=>item.identity!==identity));
  const search=await searchBody(target);assert.ok(search.some(r=>r.id===entry.id&&r.l==='cn'&&r.c.includes('GEN11跨版本新增中文检索标记')));
  const originalSearch=await searchBody(publicRoot),unaffected=search.filter(r=>r.id!==entry.id||r.l==='jp');
  assert.deepEqual(unaffected,originalSearch.filter(r=>r.id!==entry.id||r.l==='jp'));
  const current=await loadNativeRevisionContext(entry,target);assert.deepEqual(controls(current.story),controls(state.story));
  const changedVariant=state.source.document.rows[added].target.variantId;
  assert.equal(changedVariant,loaded.route.japaneseVariantId);assert.equal(loaded.route.chineseVariantId,null);
  const selected=current.story.variants.find(v=>v.variantId===changedVariant);assert.ok(selected.locales.includes('zh-CN'));
  assert.deepEqual(current.story.variants.filter(v=>v.variantId!==changedVariant),state.story.variants.filter(v=>v.variantId!==changedVariant));
  const second=seedNativeEditableLines(current.rows,'current');second[added].text='GEN11第二版中文';
  const patch2=path.join(directory,'second.patch.json');await fs.writeFile(patch2,JSON.stringify(createNativeTranslationPatch(current.source,second)));
  const stage2=await stageNativeReaderRevision(patch2,path.join(directory,'stage-second'),target);assert.equal(stage2.parentRevision,staged.revision);
  await installNativeReaderRevision(stage2.output,target);assert.equal(projectNativeReaderRevisionRows(state.rows,(await readerLoad(identity,target)).source)[added].cn.text,second[added].text);
  await assert.rejects(()=>stageNativeReaderRevision(patch,path.join(directory,'stale-stage'),target),/版本不一致/);
  await assert.rejects(()=>installNativeReaderRevision(staged.output,target,true),/later revision/);
  await installNativeReaderRevision(stage2.output,target,true);assert.equal((await readerLoad(identity,target)).source.revision.revision,staged.revision);
  await installNativeReaderRevision(staged.output,target,true);assert.equal((await readerLoad(identity,target)).source.revision,undefined);
  const rolledBackProgress=await buildCurrentGenericProgress(target);assert.equal(rolledBackProgress.chineseRows,baselineProgress.chineseRows);
  assert.equal(await fs.readFile(path.join(target,'search_index_manifest.generic.json'),'utf8'),baselineSearchManifest);
  assert.ok((await fs.stat(path.join(target,stage2.record.path))).isFile(),'version history retained after rollback');
  for(const original of state.base.document.nativeSources)assert.equal(sha(await fs.readFile(path.join(process.env.ADV_CORPUS_REPOSITORY ?? path.resolve(root, '../narcissu-kana-research'),original.path))),original.sha256);
  await fs.writeFile(path.join(root,'work/test-results/cross-variant-consumption.json'),JSON.stringify({identity,addedKey:state.rows[added].nativeKeys[0],speakerKey:state.rows[speaker].nativeKeys[0],first:staged.output,second:stage2.output,target,searchEntries:search.length,actualPagePipeline:true,localFixtureHttp:requests,rollbackVerified:true,nativeBinariesWritten:0,userAccepted:false},null,2));
});

test('shared Majiro and IKURA revisions preserve blank text and separate name/body edits in consuming rows',async()=>{
  for(const identity of ['narcissu-himeko/himeko_atogaki','kana-okaeri/ev494']){
    const state=await stateFor(identity),lines=seedNativeEditableLines(state.rows,'current'),kana=identity.startsWith('kana');
    const position=state.source.document.rows.findIndex(r=>kana?r.speakerReason==='embedded-in-text'&&r.allowed.includes('speaker'):r.allowed.includes('text'));
    assert.ok(position>=0);lines[position].text=kana?'「增量中文」\n第二行':'';
    if(kana)lines[position].speaker='新姓名';
    const narrator=kana?state.source.document.rows.findIndex(r=>r.speakerReason==='no-native-speaker'&&r.allowed.includes('text')&&r.allowed.includes('speaker')):-1;
    if(kana)assert.ok(narrator>=0,'native IKURA narration has a writable name/body operand');
    if(narrator>=0){lines[narrator].text='「原旁白现在有名字」';lines[narrator].speaker='补入名字';}
    const patch=path.join(directory,identity.replace('/','-')+'.json');await fs.writeFile(patch,JSON.stringify(createNativeTranslationPatch(state.source,lines)));
    const staged=await stageNativeReaderRevision(patch,path.join(directory,identity.replace('/','-')));
    const source=await readNativeReaderRevision(await fs.readFile(path.join(staged.output,'public',staged.record.path),'utf8'),staged.record,state.base);
    const rows=projectNativeReaderRevisionRows(state.rows,source);assert.equal(rows[position].cn.text,lines[position].text);
    if(kana)assert.equal(rows[position].cn.speaker,'新姓名');
    if(narrator>=0){assert.equal(rows[narrator].cn.speaker,'补入名字');assert.equal(rows[narrator].cn.text,lines[narrator].text);}
    const derived=JSON.parse(await fs.readFile(path.join(staged.output,'public',staged.record.storyPath)));assert.deepEqual(controls(derived),controls(state.story));
    if(kana)for(const i of [position,narrator]){
      const t=state.source.document.rows[i].target;
      const event=story=>story.variants.find(v=>v.variantId===t.variantId).sections.find(s=>s.sectionId===t.sectionId).events.find(e=>e.eventId===t.eventId);
      const native=event(derived),original=event(state.story),composed=splitIkuraMessageText(composeIkuraMessageText(native));
      assert.equal(composed.speaker,lines[i].speaker);assert.equal(composed.body,lines[i].text);assert.deepEqual(native.source,original.source);
    }
    const search=await searchBody(path.join(staged.output,'public'));if(kana)assert.ok(search.some(e=>e.c.includes('增量中文')));
  }
});

test('revision loader rejects missing registry and tampered archives instead of silently falling back to old translations',async()=>{
  const identity=untranslatedIdentity,normal=await readerLoad(identity,publicRoot);
  await assert.rejects(()=>loadCurrentNativeEditSource(normal.route,normal.cn,normal.jp,new AbortController().signal,async url=>String(url)==='/native-reader-revisions.json'?new Response('error',{status:500}):localFetch(publicRoot)(url)),/索引读取失败/);
  const stage=JSON.parse(await fs.readFile(path.join(directory,'stage-first','stage.json'))),state=await stateFor(identity),raw=await fs.readFile(path.join(directory,'stage-first/public',stage.record.path),'utf8');
  await assert.rejects(()=>readNativeReaderRevision(raw+' ',stage.record,state.base),/哈希/);
  const bad=JSON.parse(raw);bad.source.rows.find(r=>r.target).target.eventId='foreign';const badRaw=JSON.stringify(bad);
  await assert.rejects(()=>readNativeReaderRevision(badRaw,{...stage.record,sha256:sha(badRaw)},state.base),/事件\/权限/);
});

test('packaged revision CLI reopens immutable staged artifacts and rejects existing stages',async()=>{
  const patch=path.join(directory,'first.patch.json'),output=path.join(directory,'cli-stage'),records=[];
  for(let i=0;i<2;i++){
    const args=['tools/stage-native-reader-revision.mjs','--patch',patch,'--output',output,'--input',path.join(directory,'consumer')],r=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
    records.push({command:'node '+args.join(' '),cwd:root,exitStatus:r.status,stdout:r.stdout,stderr:r.stderr});assert.equal(r.status===0,i===0);
  }
  await fs.writeFile(path.join(root,'work/test-results/revision-cli-commands.json'),JSON.stringify(records,null,2));
});

test('choice-only revision consumes an explicit empty label without changing its original target',async()=>{
  let entry;
  for(const candidate of index){
    const source=JSON.parse(await fs.readFile(path.join(publicRoot,`data/legacy-vn/${candidate.source_identity}.edit-source.json`)));
    if(source.rows.some(r=>r.allowed.includes('choiceLabel'))){entry=candidate;break;}
  }
  assert.ok(entry);const state=await stateFor(entry.source_identity),lines=seedNativeEditableLines(state.rows,'current');
  const i=state.source.document.rows.findIndex(r=>r.allowed.includes('choiceLabel'));
  lines[i].choiceLabel='';lines[i].text='【】';
  const patch=path.join(directory,'choice.patch.json');await fs.writeFile(patch,JSON.stringify(createNativeTranslationPatch(state.source,lines)));
  const staged=await stageNativeReaderRevision(patch,path.join(directory,'choice-stage'));
  const current=await readNativeReaderRevision(await fs.readFile(path.join(staged.output,'public',staged.record.path),'utf8'),staged.record,state.base);
  const projected=projectNativeReaderRevisionRows(state.rows,current);
  assert.equal(projected[i].cn.choiceLabel,'');assert.equal(projected[i].cn.choiceTargetId,state.rows[i].cn?.choiceTargetId??state.rows[i].jp.choiceTargetId);
  assert.deepEqual(controls(JSON.parse(await fs.readFile(path.join(staged.output,'public',staged.record.storyPath)))),controls(state.story));
});

test('installer preserves concurrent pointer edits and revision loader honors an already-cancelled request',async()=>{
  const target=await fixturePublic('concurrent'),stage=path.join(directory,'stage-first');
  const original=await fs.readFile(path.join(target,'native-reader-revisions.json'));
  await fs.writeFile(path.join(target,'native-reader-revisions.json'),Buffer.concat([original,Buffer.from(' ')]));
  const before=await fs.readFile(path.join(target,'search_index_manifest.generic.json'));
  await assert.rejects(()=>installNativeReaderRevision(stage,target),/concurrent content/);
  assert.ok(before.equals(await fs.readFile(path.join(target,'search_index_manifest.generic.json'))));
  const f=await readerLoad(untranslatedIdentity,publicRoot),abort=new AbortController();abort.abort();
  await assert.rejects(()=>loadCurrentNativeEditSource(f.route,f.cn,f.jp,abort.signal,localFetch(publicRoot)),/Aborted/);
});

test('revised JP-origin row never steals a CN sequence follow target merely because compiled offsets collide',()=>{
  const cueId='cue-'+'1'.repeat(16),mediaId='asset/a-'+'1'.repeat(16),foreignId='cue-'+'2'.repeat(16);
  const route={canonicalStoryId:'narcissu-3rd/fixture',chineseVariantId:'cn-version',japaneseVariantId:'jp-version',
    variantRoutes:[{variantId:'cn-version',readerLocales:['zh-CN'],textLineCounts:{'zh-CN':1},sections:[{sectionId:'main',events:[{eventId:'mjo-bf9',kind:'line',cues:[{kind:'voice',cueId,mediaId,raw:{sourceKey:'cn-original'}}]}]}]}],
    media:[{mediaId,role:'voice',url:'/corpus/voice/test.ogg',mimeType:'audio/ogg'}]};
  const own={eventIds:['mjo-bf9'],cues:[{cueId,mediaId,eventId:'mjo-bf9',url:'/corpus/voice/test.ogg',sourceKey:'cn-original',mimeType:'audio/ogg'}]};
  const foreign={eventIds:['mjo-bf9'],cues:[{...own.cues[0],cueId:foreignId,sourceKey:'jp-original'}]};
  assert.equal(buildLegacyVoiceSequence(route,'zh-CN',[own,foreign])[0].rowIndex,0);
  assert.equal(buildLegacyVoiceSequence(route,'zh-CN',[foreign])[0].rowIndex,null);
  assert.equal(buildLegacyVoiceSequence(route,'zh-CN',[own,{eventIds:['mjo-bf9'],cues:[]}])[0].rowIndex,0);
});
