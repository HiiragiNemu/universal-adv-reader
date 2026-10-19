import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {localBrowser} from './local-browser.mjs';
const base=path.dirname(fileURLToPath(import.meta.url)),site=process.env.ADV_TEST_BASE || 'http://127.0.0.1:4180',out=path.resolve(base,'../../reports/verification/cloudflare-20261014',process.env.ADV_TEST_NAME || 'browser-production');
const expectedIndex=JSON.parse(await fs.readFile(path.resolve(base,'../../apps/classic-reader/public/story_index.json'),'utf8'));
const expectedPending=expectedIndex.reduce((sum,row)=>sum+(row.pending_review_rows||0),0),expectedReviewScripts=expectedIndex.filter(row=>row.pending_review_rows>0).length;
const pendingFor=id=>expectedIndex.find(row=>row.id===id)?.pending_review_rows||0;
const browser=await localBrowser(out),report={schema:'reader-content-browser/v1',date:new Date().toISOString(),browser:'isolated headless Edge',humanAccepted:false,humanListeningVerified:false,checks:[]};
const save=()=>fs.writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2));
const check=async(name,run)=>{try{report.checks.push({name,result:'PASS',details:await run()});console.log('PASS '+name);}catch(e){report.checks.push({name,result:'FAIL',error:e.stack??String(e)});console.log('FAIL '+name+' '+e.message);await browser.screenshot('failed-'+report.checks.length).catch(()=>{});}await save();};
const nav=async(route,selector)=>{await browser.navigate(site+route);await browser.wait(`!!document.querySelector(${JSON.stringify(selector)})`,30000);await browser.wait("!!document.querySelector('[data-optics-ready=true]')",45000);await delay(500);};
const snapshot=()=>browser.evaluate(`({cards:[...document.querySelectorAll('.magi-folder-source-card')].map(e=>({title:e.querySelector('.magi-folder-display-title')?.textContent,completion:e.dataset.completionPercent,coverage:e.dataset.translationCoveragePercent,origin:e.dataset.translationOrigin,style:e.getAttribute('style')})),filters:[...document.querySelectorAll('[data-category][data-source-filter]')].map(e=>({category:e.dataset.category,filter:e.dataset.sourceFilter,title:e.title,style:e.getAttribute('style')}))})`);
const viewport=async(w,h=1000)=>browser.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:w<600});
const reader=async(id,cn)=>{await nav('/reader/'+id,'[data-reader-text-content="cn"]');await browser.wait(`document.querySelector('#reader-document')?.innerText.includes(${JSON.stringify(cn)})`,30000);await browser.wait("!document.querySelector('[role=alert]')");};
try{
 await viewport(1840);
 await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{window.__readerAudio=[];const A=window.Audio;window.Audio=new Proxy(A,{construct(t,a){const x=Reflect.construct(t,a);window.__readerAudio.push(x);return x;}});const F=window.fetch;window.__progressReturned=false;window.fetch=async function(...a){const r=await F.apply(this,a);if(String(a[0]).includes('/api/proofreading/machine-status')){await new Promise(q=>setTimeout(q,3500));window.__progressReturned=true;}return r;};})();`});
 await check('Initial load, asynchronous progress, clicks and reload keep identical paragraph-weighted colors',async()=>{
  await nav('/apps/web/','.magi-folder-source-card');const before=await snapshot();assert.equal(before.cards.length,8);
  await browser.wait('window.__progressReturned',20000);await delay(300);const after=await snapshot();assert.deepEqual(after,before);
  const iris=after.cards.find(c=>c.title?.includes('小小的伊丽丝'));assert(iris);assert(Number(iris.completion)>99&&Number(iris.completion)<=100);assert.equal(Number(iris.coverage),100);
  await browser.click('.magi-folder-source-card > button');const clicked=await snapshot();assert.deepEqual(clicked,after);
  await nav('/apps/web','.magi-folder-source-card');await browser.wait('window.__progressReturned',20000);assert.deepEqual(await snapshot(),after);
  await browser.screenshot('home-paper-desktop');return {before,after};
 });
 await check('Iris cross-chapter text is inline and the missing walking narration is present with only its own pending label',async()=>{
  await reader('legacy-narcissu-3rd-nar3_07','我一边走着，一边开口说道。');
  const s=await browser.evaluate(`(()=>{const rows=[...document.querySelectorAll('[data-reader-row-index]')],target=rows.find(r=>r.textContent.includes('我一边走着，一边开口说道。'));return {target:target?.innerText,credit:target?.querySelector('[data-author-translation]')?.textContent,initial:rows.slice(0,12).map(r=>r.innerText),empty:document.querySelectorAll('[data-reader-text-cell="cn-empty"]').length,labels:document.querySelectorAll('[data-author-translation]').length,aiBanner:!!document.querySelector('[data-native-bilingual-review=AI]')}})()`);
  assert(s.target?.includes('俺は歩きながら口を開く'));assert(s.credit===undefined||s.credit==='站长补译 · 待校对');assert.equal(s.empty,0);assert(s.labels<=pendingFor('legacy-narcissu-3rd-nar3_07'));assert.equal(s.aiBanner,false);
  await browser.screenshot('iris-inline-first-page');await browser.evaluate("[...document.querySelectorAll('[data-reader-row-index]')].find(r=>r.textContent.includes('我一边走着，一边开口说道。'))?.scrollIntoView({block:'center'})");await browser.screenshot('iris-authored-paragraph');return s;
 });
 await check('Awaji full Chinese and both native choices are readable and attributed to the owner',async()=>{
  await reader('legacy-narcissu-himeko-omake_062','摩天轮');
  const s=await browser.evaluate(`({empty:document.querySelectorAll('[data-reader-text-cell="cn-empty"]').length,labels:document.querySelectorAll('[data-author-translation]').length,choices:[...document.querySelectorAll('.magi-reader-choice-row')].map(e=>e.innerText),summary:document.querySelector('[data-translation-review-summary]')?.innerText,buttons:[...document.querySelectorAll('button')].filter(b=>['中','双','日'].includes(b.innerText.trim())).map(b=>({text:b.innerText,disabled:b.disabled})),end:document.querySelector('#reader-document')?.innerText.slice(-1300)})`);
  assert.equal(s.empty,0);assert.equal(s.labels,pendingFor('legacy-narcissu-himeko-omake_062'));assert(s.choices.some(s=>s.includes('犹豫')));assert(s.choices.some(s=>s.includes('乘坐')));assert(s.end.includes('更加遥远的地方'));assert(s.buttons.some(b=>b.text==='中'&&!b.disabled));
  await browser.screenshot('awaji-complete-chinese');return s;
 });
 await check('User-supplied novel stays Chinese-only, preserves paragraph breaks and retains its source credit',async()=>{
  await reader('legacy-narcissu-texts-novel1-002','旁白');
  const s=await browser.evaluate(`({source:document.querySelector('[data-supplement-source]')?.innerText,rows:document.querySelectorAll('[data-reader-text-content=cn]').length,japaneseCells:document.querySelectorAll('[data-reader-text-content=jp]').length,pending:document.querySelectorAll('[data-author-translation]').length,summary:document.querySelector('[data-translation-review-summary]')?.innerText,body:document.querySelector('#reader-document')?.innerText.slice(0,1900)})`);
  assert(s.source.includes('陆怡帆'));assert(s.rows>10);assert.equal(s.japaneseCells,0);assert.equal(s.pending,0);assert(s.summary.includes('原译文已校对'));await browser.screenshot('novel-source-and-paragraphs');return s;
 });
 await check('Review list flags exactly the currently pending supplemented scripts, never all fan translations or supplied editions',async()=>{
  await nav('/review/machine-translations','article');await browser.wait("document.querySelectorAll('article').length==="+expectedIndex.length,30000);
  await browser.evaluate("const s=document.querySelector('select[aria-label=\"筛选中文覆盖\"]');s.value='needs-review';s.dispatchEvent(new Event('change',{bubbles:true}));");
  await browser.wait("document.querySelectorAll('article').length==="+expectedReviewScripts);const text=await browser.evaluate("[...document.querySelectorAll('article')].map(e=>e.innerText)");assert(text.every(t=>t.includes('待校对')));await browser.screenshot('only-author-supplements-pending');return text;
 });
 await check('Original Chinese speaker and actual voice playback still work after content revisions',async()=>{
  await reader('legacy-narcissu-3rd-nard14','对哥哥');const names=await browser.evaluate("document.querySelector('#reader-document').innerText");assert(names.includes('千里')&&names.includes('チサト'));
  assert.equal(await browser.evaluate("document.querySelector('[aria-label=\"收起全部剧情语音\"]')?.getAttribute('aria-expanded')"),'true');await browser.wait("!!document.querySelector('[data-voice-cue-id] button')");await browser.click('[data-voice-cue-id] button');
  await browser.wait("window.__readerAudio.some(a=>a.currentTime>0.1&&a.readyState>=2&&!a.error)",20000);
  await browser.wait("window.__readerAudio.some(a=>Number.isFinite(a.duration)&&a.duration>0.5&&a.readyState>=3&&!a.error&&a.seekable.length>0&&a.seekable.end(a.seekable.length-1)>0)",30000);
  const seek=await browser.evaluate(`(async()=>{const a=window.__readerAudio.find(a=>Number.isFinite(a.duration)&&a.duration>0.5&&a.readyState>=3&&!a.error);a.pause();const target=a.duration/3;a.currentTime=target;await a.play();await new Promise(r=>setTimeout(r,250));return {url:a.currentSrc,target,time:a.currentTime,duration:a.duration,error:a.error?.code??null};})()`);
  assert.equal(seek.error,null);assert(seek.time>=seek.target-0.1,'Native audio seeking did not reach the requested time: '+JSON.stringify(seek));
  const audio=await browser.evaluate("window.__readerAudio.map(a=>({url:a.currentSrc,time:a.currentTime,duration:a.duration,error:a.error?.code??null}))");await nav('/apps/web','.magi-folder-source-card');return {audio,seek};
 });
 await check('Coverage overview has non-overlapping text/actions in all five themes at desktop and narrow widths',async()=>{
  await nav('/apps/web','.magi-folder-source-card');
  await browser.wait("!!document.querySelector('section.magi-home-review-panel')",20000);
  const matrix=[];
  for(const theme of ['paper','light','green','dark','frost'])for(const width of [1840,390]){
   await viewport(width,width<600?844:1000);
   await browser.evaluate(`localStorage.setItem('magi_theme',${JSON.stringify(theme)});window.dispatchEvent(new Event('magi-reader-theme-change'));`);await browser.wait(`document.querySelector('[data-theme-variant]')?.getAttribute('data-theme-variant')===${JSON.stringify(theme)}`,15000);await delay(200);await browser.wait(`!!document.querySelector('[data-optics-ready=true]') && document.querySelector('section.magi-home-review-panel')?.innerText.includes(${JSON.stringify(String(expectedPending))})`,45000);
   const state=await browser.evaluate(`(()=>{const p=document.querySelector('section.magi-home-review-panel');if(!p)throw Error('Missing overview');const intro=p.querySelector('.magi-home-review-intro').getBoundingClientRect(),toolbar=p.querySelector('.magi-home-review-toolbar').getBoundingClientRect();return {intro:{x:intro.x,y:intro.y,w:intro.width,h:intro.height},toolbar:{x:toolbar.x,y:toolbar.y,w:toolbar.width,h:toolbar.height},overlap:Math.min(intro.right,toolbar.right)-Math.max(intro.left,toolbar.left)>2&&Math.min(intro.bottom,toolbar.bottom)-Math.max(intro.top,toolbar.top)>2,summary:p.innerText,viewport:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth}})()`);
   assert.equal(state.overlap,false,theme+' '+width);assert(state.summary.includes(String(expectedPending)),JSON.stringify(state));assert(state.overflow<8,theme+' overflow '+state.overflow);matrix.push({theme,width,...state});
   if(width<600){const badges=await browser.evaluate("[...document.querySelectorAll('.magi-home-section-statistics > span')].map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,font:parseFloat(getComputedStyle(e).fontSize),text:e.textContent}))");assert.equal(badges.length,5);assert(badges.every(b=>b.left>=-3&&b.right<=width+3&&b.font>=10),JSON.stringify({theme,width,badges}));}
   await browser.screenshot('home-'+theme+'-'+width);
  }
  await viewport(1840);await browser.evaluate("localStorage.setItem('magi_theme','paper');window.dispatchEvent(new Event('magi-reader-theme-change'))");return matrix;
 });

 report.release=await browser.evaluate("fetch('/release.json').then(r=>r.json())");
 report.httpErrors=browser.events.filter(e=>e.method==='Network.responseReceived'&&e.params.response.status>=400).map(e=>({url:e.params.response.url,status:e.params.response.status}));
 report.runtimeErrors=browser.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails);
 report.supplementNativeRequests=browser.events.filter(e=>e.method==='Network.requestWillBeSent'&&/narcissu-texts.*\.(routes|edit-source|alignment)\.json/.test(e.params.request.url)).map(e=>e.params.request.url);
 report.result=report.checks.every(c=>c.result==='PASS')&&!report.httpErrors.length&&!report.runtimeErrors.length&&!report.supplementNativeRequests.length?'PASS':'FAIL';
 console.log(JSON.stringify({result:report.result,httpErrors:report.httpErrors,runtimeErrors:report.runtimeErrors,supplementNativeRequests:report.supplementNativeRequests}));

}finally{await save();await browser.close();}
if(report.result!=='PASS')process.exitCode=1;
