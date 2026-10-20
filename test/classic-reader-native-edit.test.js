import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { File } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createNativeSourceContext, buildNativeEditSource, publicRoot, root } from '../tools/build-native-edit-sources.mjs';
import { readNativeEditSource, loadNativeEditSource, createNativeTranslationPatch, importNativeTranslationPatch, applyNativeTranslationPatch, composeIkuraMessageText, splitIkuraMessageText } from '../apps/classic-reader/lib/native-translation-patch.ts';
import { seedNativeEditableLines } from '../apps/classic-reader/lib/legacy-vn-alignment.ts';
import { validateStoryDocument } from '../packages/contracts/src/index.js';
import { classicModules, classicApp, React, renderToStaticMarkup, readerRowFragments, rowProps, ts } from '../test-support/classic-module-loader.js';
import { parseLegacyVoiceRouteDocument } from '../apps/classic-reader/lib/legacy-vn-voice-routing.ts';
import { readScenarioFile } from '../apps/classic-reader/lib/local-story.ts';
const index = JSON.parse(fs.readFileSync(path.join(publicRoot,'story_index.json'))).filter(s=>s.source_format!=='supplemental-text/v1');
const context = createNativeSourceContext();
const hash = value => createHash('sha256').update(value).digest('hex');
const fixtures = new Map();
async function fixture(entry) {
  if (!fixtures.has(entry.id)) fixtures.set(entry.id, (async()=>{
    const built = await buildNativeEditSource(await context, entry);
    const raw = fs.readFileSync(path.join(publicRoot,`data/legacy-vn/${entry.source_identity}.edit-source.json`),'utf8');
    assert.equal(raw,built.raw,'reconstruct exact original source before testing edits');
    return {...built,source:await readNativeEditSource(raw,built.document)};
  })());return fixtures.get(entry.id);
}
function controls(document) {
  const copy = structuredClone(document);
  for(const v of copy.variants)v.locales=v.locales.filter(l=>l!=='zh-CN');
  for(const v of copy.variants)for(const s of v.sections)for(const e of s.events){
    for(const field of ['text','speaker'])if(e[field]){delete e[field]['zh-CN'];if(!Object.keys(e[field]).length)delete e[field];}
    for(const c of e.choices??[])delete c.label['zh-CN'];
  }return copy;
}
fs.mkdirSync(path.join(root, 'work/test-results'), { recursive: true });

test('the effective catalog native edit sources reproduce exact bindings and patch every writable field without touching controls', async()=>{
  const expectedIdentities=new Set((await context).catalog.corpora.flatMap(c=>c.stories.map(s=>s.canonicalStoryId)));
  assert.equal(index.length,expectedIdentities.size);assert.deepEqual(new Set(index.map(e=>e.source_identity)),expectedIdentities);
  let stories=0,choices=0,speakers=0,text=0;
  for(const entry of index){const f=await fixture(entry),original=JSON.stringify(f.story);
    const lines=seedNativeEditableLines(f.rows,'current');assert.equal(createNativeTranslationPatch(f.source,lines).changes.length,0);
    for(let i=0;i<lines.length;i++){
      const def=f.document.rows[i];
      if(def.allowed.includes('text')){lines[i].text=`修订\n${lines[i].text}`;text++;}
      if(def.allowed.includes('speaker')){lines[i].speaker='';speakers++;}
      if(def.allowed.includes('choiceLabel')){lines[i].choiceLabel=`选择 ${lines[i].choiceLabel}`;lines[i].text=`【${lines[i].choiceLabel}】`;choices++;}
    }
    const patch=createNativeTranslationPatch(f.source,lines),imported=importNativeTranslationPatch(f.source,JSON.parse(JSON.stringify(patch)),f.rows);
    assert.deepEqual(imported,lines);
    const result=await applyNativeTranslationPatch(f.source,patch,f.story);validateStoryDocument(result);
    assert.deepEqual(controls(result),controls(f.story),'all branch/event/media/source/other-language fields unchanged');
    assert.equal(JSON.stringify(f.story),original,'original input object retained');stories++;
  }
  assert.equal(stories,expectedIdentities.size);assert.ok(text>60000);assert.ok(speakers>1000);assert.ok(choices>=93,'all original selector arms plus restored native choices are editable');
  fs.writeFileSync(path.join(root,'work/test-results/native-edit-coverage.json'),JSON.stringify({stories,text,speakers,choices,controlStructuresPreserved:true,binaryWriteback:false,userAccepted:false},null,2));
});
test('native patches reject stale versions, read-only/extra fields, duplicate operations and changed branches',async()=>{
  const f=await fixture(index.find(s=>s.source_identity==='narcissu-himeko/himeko_ep01')),lines=seedNativeEditableLines(f.rows,'current');
  const i=f.document.rows.findIndex(r=>r.allowed.includes('text'));lines[i].text='新的正文';const p=createNativeTranslationPatch(f.source,lines);
  const bad=[{...p,sourceSha256:'0'.repeat(64)},{...p,storyId:'kana-okaeri/ev00'},{...p,locale:'ja-JP'},
    {...p,changes:[p.changes[0],p.changes[0]]},{...p,changes:[{...p.changes[0],field:'nextEventId'}]},
    {...p,changes:[{...p.changes[0],after:'x',audioId:'changed'}]},{...p,binding:{...p.binding,route:'0'.repeat(64)}}];
  for(const value of bad)assert.throws(()=>importNativeTranslationPatch(f.source,value,f.rows));
  const original=structuredClone(f.story);original.variants[0].sections[0].events[0].nextEventId='new-target';
  await assert.rejects(()=>applyNativeTranslationPatch(f.source,p,original),/结构源已变化/);
  const readonly=f.document.rows.findIndex(r=>r.target&&!r.allowed.includes('speaker'));lines[readonly].speaker='假字段';assert.throws(()=>createNativeTranslationPatch(f.source,lines),/只读/);
});
test('a genuinely untranslated JP bonus receives Chinese on its own native event and retains all original variants',async()=>{
  const f=await fixture(index.find(e=>e.source_identity==='narcissu-himeko/omake_062'));
  const lines=seedNativeEditableLines(f.rows,'current'),j=f.rows.findIndex((r,i)=>r.jp&&!r.cn&&f.document.rows[i].allowed.includes('text'));assert.ok(j>=0);
  const t=f.document.rows[j].target,originalVariant=f.story.variants.find(v=>v.variantId===t.variantId);
  const originalEvent=originalVariant.sections.find(s=>s.sectionId===t.sectionId).events.find(e=>e.eventId===t.eventId);
  assert.equal(lines[j].text,'');assert.ok(originalVariant.locales.includes('ja-JP'));assert.ok(originalEvent.text['ja-JP']);assert.equal(originalEvent.text['zh-CN'],undefined);
  lines[j].text='补入字幕\n第二行';const p=createNativeTranslationPatch(f.source,lines);assert.equal(p.changes.length,1);
  const imported=importNativeTranslationPatch(f.source,p,f.rows);assert.equal(imported[j].text,lines[j].text);
  const result=await applyNativeTranslationPatch(f.source,p,f.story),changed=result.variants.find(v=>v.variantId===t.variantId);
  const event=changed.sections.find(s=>s.sectionId===t.sectionId).events.find(e=>e.eventId===t.eventId);
  assert.equal(event.text['zh-CN'],lines[j].text);assert.equal(event.text['ja-JP'],originalEvent.text['ja-JP']);
  assert.ok(changed.locales.includes('zh-CN'));assert.deepEqual(controls(result),controls(f.story));
  assert.deepEqual(result.variants.filter(v=>v.variantId!==t.variantId),f.story.variants.filter(v=>v.variantId!==t.variantId));
});

test('actual page downloads/imports the native patch with empty fields and never calls the legacy submit endpoint',async()=>{
  const f=await fixture(index[0]),modules=classicModules(),lines=seedNativeEditableLines(f.rows,'current');
  lines[f.document.rows.findIndex(r=>r.allowed.includes('text'))].text='';
  const name=f.document.rows.findIndex(r=>r.allowed.includes('speaker'));if(name>=0)lines[name].speaker='';
  const downloads=[],messages=[],captured=[],nativeRef={current:f.source};
  const bindings={currentNativeEditSource:f.source,currentLegacyVoiceRoutePath:'/native/routes',nativeEditState:{error:''},nativeAlignmentState:{rows:f.rows,error:''},editedCnLines:lines,id:index[0].id,
    currentStory:index[0],useMemo:fn=>fn(),...modules.load('lib/native-section-anchors.ts'),...modules.load('lib/native-translation-patch.ts'),
    createNativeTranslationPatch,importNativeTranslationPatch,triggerUtf8Download:(raw,name)=>downloads.push({raw,name}),setEditMessage:message=>messages.push(message),
    nativeEditSourceRef:nativeRef,readScenarioFile,setEditedCnLines:next=>captured.push(next),setMode(){},jpEventLines:[{}],
    fetch:()=>{throw Error('Native editing must not submit to the old backend');}};
  const {downloadNativePatch,downloadTranslation,uploadTranslation,submitToCloud}=modules.fragments('app/reader/[id]/page.tsx',
    ['nativeCounterpartState','nativeCounterparts','effectiveNativeEditSource','downloadNativePatch','downloadTranslation','uploadTranslation','submitToCloud'],bindings);
  downloadTranslation();assert.equal(downloads.length,1);assert.match(downloads[0].name,/_native-translation\.patch\.json$/);
  const payload=JSON.parse(downloads[0].raw);assert.equal(payload.schema,'native-reader-translation-patch/v1');assert.ok(payload.changes.some(c=>c.after===''));
  await uploadTranslation({target:{files:[new File([downloads[0].raw],'progress.json')],value:'input'}});assert.deepEqual(captured[0],lines);
  await submitToCloud();assert.match(messages.at(-1),/尚未指定远端与投稿后端/);
  nativeRef.current=null;await uploadTranslation({target:{files:[new File([downloads[0].raw],'stale.json')],value:'input'}});assert.equal(captured.length,1);assert.match(messages.at(-1),/剧情已切换/);
  // The named handler remains the actual primary UI entry point.
  assert.ok(downloadNativePatch);
});

test('actual speaker input honors native write capability in all five themes and ignores forced readonly changes',()=>{
  for(const theme of ['light','paper','green','dark','frost']){
    const {StoryRow}=readerRowFragments(theme),props={...rowProps,theme,isEditMode:true,row:{cn:{speaker:'名字',text:'正文'},jp:{speaker:'名前',text:'原文'}},editedLines:[{speaker:'名字',text:'正文'}],editIndex:0};
    const html=renderToStaticMarkup(React.createElement(StoryRow,{...props,nativeSpeakerEditable:false}));assert.match(html,/readonly=""/i);
    assert.doesNotMatch(renderToStaticMarkup(React.createElement(StoryRow,{...props,nativeSpeakerEditable:true})),/readonly=""/i);
    let changed=false;const tree=StoryRow({...props,nativeSpeakerEditable:false,setEditedLines(){changed=true;}});
    const walk=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(walk):[n,...walk(n.props?.children)];
    const input=walk(tree).find(n=>n.type==='input'&&n.props['aria-label']?.includes('角色名'));assert.ok(input);input.props.onChange({target:{value:'ignored'}});assert.equal(changed,false);
  }
});

test('native source loader binds bilingual and JP-only route/text bytes and rejects stale text or cancellation',async()=>{
  const bilingual=index.find(entry=>entry.path_cn&&entry.path_jp);
  const jpOnly=index.find(entry=>entry.source_identity==='narcissu-himeko/omake_062');
  assert.ok(bilingual&&jpOnly);assert.equal(jpOnly.path_cn,undefined);
  for(const entry of [bilingual,jpOnly]){
    const f=await fixture(entry),routeRaw=fs.readFileSync(path.join(publicRoot,`data/legacy-vn/${entry.source_identity}.routes.json`));
    const route={...parseLegacyVoiceRouteDocument(JSON.parse(routeRaw),entry.source_identity),documentSha256:hash(routeRaw)};
    const cn=entry.path_cn?fs.readFileSync(path.join(publicRoot,entry.path_cn),'utf8'):'';
    const jp=fs.readFileSync(path.join(publicRoot,entry.path_jp),'utf8');
    if(entry===jpOnly){assert.equal(route.chineseVariantId,null);assert.equal(hash(cn),f.document.binding.cnText);}
    const fetcher=async url=>{assert.equal(url,`/data/legacy-vn/${entry.source_identity}.edit-source.json`);return new Response(f.raw);};
    assert.equal((await loadNativeEditSource(route,cn,jp,new AbortController().signal,fetcher)).sha256,f.source.sha256);
    await assert.rejects(()=>loadNativeEditSource(route,cn+'changed',jp,new AbortController().signal,fetcher),/哈希/);
    const controller=new AbortController();controller.abort();await assert.rejects(()=>loadNativeEditSource(route,cn,jp,controller.signal,fetcher),/Aborted/);
  }
});

test('actual native source effect drops old async results and legacy config effect does not run for native stories',async()=>{
  const filename=path.join(classicApp,'app/reader/[id]/page.tsx'),code=fs.readFileSync(filename,'utf8'),tree=ts.createSourceFile(filename,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),effects=[];
  const visit=n=>{if(ts.isCallExpression(n)&&n.expression.getText(tree)==='useEffect')effects.push(n.arguments[0].getText(tree));ts.forEachChild(n,visit);};visit(tree);
  let complete;const calls=[],modules=classicModules(),bindings={legacyVoiceRoute:{id:'old'},cnSource:{raw:'CN'},jpSource:{raw:'JP'},setNativeEditState:v=>calls.push(v),loadNativeEditSource:()=>new Promise(resolve=>{complete=resolve;})};
  const run=modules.compile(`export const run=${effects.find(e=>e.includes('loadNativeEditSource('))};`,filename,bindings).run;
  const cleanup=run();cleanup();complete({storyId:'old'});await Promise.resolve();await Promise.resolve();assert.equal(calls.length,1);
  modules.compile(`export const run=${effects.find(e=>e.includes("fetch('/api/proofreading/config'"))};`,filename,{isEditMode:true,isLocal:false,id:index[0].id,fetch(){throw Error('Old backend contacted');}}).run();
  const nativePanel=code.includes('data-native-edit-tools="true"');assert.equal(nativePanel,true);assert.match(code,/currentLegacyVoiceRoutePath \? \(/);
});
test('IKURA exposes separate editable name and body while preserving the original native operand and selector graph',async()=>{
  const f=await fixture(index.find(e=>e.source_identity==='kana-okaeri/ev494')),lines=seedNativeEditableLines(f.rows,'current');
  const i=f.document.rows.findIndex(r=>r.allowed.includes('speaker')&&r.speakerReason==='embedded-in-text');assert.ok(i>=0);
  assert.deepEqual(f.document.rows[i].allowed,['text','speaker']);
  lines[i].speaker='新名字';lines[i].text='「对白内容」';
  const p=createNativeTranslationPatch(f.source,lines);assert.equal(p.changes.length,2);
  assert.deepEqual(importNativeTranslationPatch(f.source,JSON.parse(JSON.stringify(p)),f.rows),lines);
  const result=await applyNativeTranslationPatch(f.source,p,f.story),t=f.document.rows[i].target;
  const nativeEvent=story=>story.variants.find(v=>v.variantId===t.variantId).sections.find(s=>s.sectionId===t.sectionId).events.find(e=>e.eventId===t.eventId);
  const e=nativeEvent(result),before=nativeEvent(f.story);
  assert.equal(e.speaker['zh-CN'],'新名字');assert.equal(e.text['zh-CN'],'「对白内容」');
  assert.deepEqual(e.source.originalDisplayText,before.source.originalDisplayText);
  assert.equal(splitIkuraMessageText(composeIkuraMessageText(e)).speaker,'新名字');
  assert.equal(splitIkuraMessageText(composeIkuraMessageText(e)).body,e.text['zh-CN']);
  assert.deepEqual(controls(result),controls(f.story));
});
test('packaged CLI creates and reopens a new ADV derivative, preserves originals and refuses an existing output',async()=>{
  const f=await fixture(index.find(s=>s.source_identity==='narcissu-himeko/himeko_ep01')),lines=seedNativeEditableLines(f.rows,'current'),i=f.document.rows.findIndex(r=>r.allowed.includes('text'));lines[i].text='本地派生测试';
  const directory=path.join(root,'work/reader-inheritance-20261012/native-patch-cli',randomUUID());fs.mkdirSync(directory,{recursive:true});const patch=path.join(directory,'patch.json'),output=path.join(directory,'derivative.json');
  fs.writeFileSync(patch,JSON.stringify(createNativeTranslationPatch(f.source,lines)));
  const args=['tools/apply-native-reader-patch.mjs','--patch',patch,'--output',output],records=[];
  for(let pass=0;pass<2;pass++){const r=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8'});records.push({command:'node '+args.join(' '),cwd:root,exitStatus:r.status,stdout:r.stdout,stderr:r.stderr});assert.equal(r.status===0,pass===0);}
  validateStoryDocument(JSON.parse(fs.readFileSync(output)));assert.deepEqual(controls(JSON.parse(fs.readFileSync(output))),controls(f.story));
  for(const source of f.document.nativeSources)assert.equal(hash(fs.readFileSync(path.join(process.env.ADV_CORPUS_REPOSITORY ?? path.resolve(root, '../narcissu-kana-research'),source.path))),source.sha256);
  fs.writeFileSync(path.join(root,'work/test-results/cli-commands.json'),JSON.stringify(records,null,2));
});
