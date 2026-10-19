import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {localBrowser} from './local-browser.mjs';
const site=process.env.ADV_TEST_BASE??'http://127.0.0.1:4182';
const out=path.resolve('reports/verification/nard01-bilingual-review-20261020/browser',process.env.ADV_TEST_NAME??'local');
const browser=await localBrowser(out),report={site,checks:[],humanAccepted:false};
const check=async(name,run)=>{try{report.checks.push({name,status:'PASS',details:await run()});console.log('PASS '+name);}catch(e){report.checks.push({name,status:'FAIL',error:String(e.stack)});console.log('FAIL '+name+' '+e.message);await browser.screenshot('failure-'+report.checks.length);}await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2));};
try{
 await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await browser.navigate(site+'/reader/legacy-narcissu-3rd-nard01?cn=%2Fdata%2Flegacy-vn%2Fnarcissu-3rd%2Fnard01_cn.txt&jp=%2Fdata%2Flegacy-vn%2Fnarcissu-3rd%2Fnard01_jp.txt');
 await browser.wait("document.querySelectorAll('[data-correspondence-review]').length===7",60000);
 await browser.wait("!!document.querySelector('[data-optics-ready=true]')",45000);
 await check('voice buttons visible on first load; no autoplay',async()=>{
  const state=await browser.evaluate(`({expanded:document.querySelector('[aria-label="收起全部剧情语音"]')?.getAttribute('aria-expanded'),buttons:document.querySelectorAll('[data-voice-cue-id] button').length,playing:[...document.querySelectorAll('audio')].filter(a=>!a.paused).length})`);
  assert.equal(state.expanded,'true');assert(state.buttons>0);assert.equal(state.playing,0);return state;
 });
 await check('four correct bilingual groups and three independent pending rows',async()=>{
  const state=await browser.evaluate(`([...document.querySelectorAll('[data-correspondence-review]')].map(d=>{const r=d.closest('[data-reader-row-index]');return {kind:d.dataset.correspondenceReview,id:d.dataset.correspondenceId,pairing:r.dataset.nativePairing,cn:r.querySelector('[data-reader-text-content="cn"]')?.textContent,jp:r.querySelector('[data-reader-text-content="jp"]')?.textContent,href:d.querySelector('a').href}}))`);
  assert.equal(state.filter(r=>r.kind==='AI-source-review').length,4);assert.equal(state.filter(r=>r.kind==='pending').length,3);
  const named=state.find(r=>r.id.endsWith('chisato'));assert(named.cn.includes('听好了老爷爷'));assert(named.jp.includes('いいかなおじいちゃん'));
  for(const r of state.filter(r=>r.kind==='pending'))assert.match(r.pairing,/^unpaired-/);
  for(const r of state){const u=new URL(r.href);assert.equal(u.host,'github.com');assert(u.searchParams.get('body').includes('narcissu-3rd/nard01'));}
  return state;
 });
 for(const theme of ['paper','light','green','dark','frost'])for(const width of [1440,390])await check('review layout '+theme+' '+width,async()=>{
  await browser.send('Emulation.setDeviceMetricsOverride',{width,height:width<600?844:1000,deviceScaleFactor:1,mobile:width<600});
  await browser.evaluate(`localStorage.setItem('magi_theme',${JSON.stringify(theme)});window.dispatchEvent(new Event('magi-reader-theme-change'));`);
  await delay(300);await browser.wait(`!!document.querySelector('[data-optics-ready=true]')`,30000);
  const state=await browser.evaluate(`(()=>{const boxes=[...document.querySelectorAll('[data-correspondence-review]')].map(d=>{const r=d.getBoundingClientRect(),row=d.closest('[data-reader-row-index]');const cells=[...row.querySelectorAll('[data-reader-text-content]')].map(e=>e.getBoundingClientRect());return {left:r.left,right:r.right,bottom:r.bottom,sideBySide:cells.length!==2||innerWidth<768||Math.abs(cells[0].top-cells[1].top)<20,overlap:cells.some(c=>c.top<r.bottom-1&&c.bottom>r.top+1)}});return {boxes,overflow:document.documentElement.scrollWidth-innerWidth}})()`);
  assert(state.overflow<=8,JSON.stringify(state));assert(state.boxes.every(b=>b.left>=-2&&b.right<=width+2&&!b.overlap&&b.sideBySide),JSON.stringify(state));
  await browser.evaluate("document.querySelector('[data-correspondence-review]').scrollIntoView({block:'center',behavior:'instant'})");await browser.screenshot(theme+'-'+width);return state;
 });
 await check('voice visibility can still be toggled off and on',async()=>{
  // Reading toolbar may be sticky; use the actual button's DOM click for this state test.
  await browser.evaluate("document.querySelector('[aria-label=\"收起全部剧情语音\"]').click()");await browser.wait("!document.querySelector('[data-voice-slot]')");
  await browser.evaluate("document.querySelector('[aria-label=\"展开全部剧情语音\"]').click()");await browser.wait("!!document.querySelector('[data-voice-cue-id] button')");return {off:true,on:true};
 });
 report.runtimeErrors=browser.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails);
 report.passed=report.checks.filter(c=>c.status==='PASS').length;report.total=report.checks.length;
 report.result=report.passed===report.total&&!report.runtimeErrors.length?'PASS':'FAIL';
 await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2));console.log(report.result+' '+report.passed+'/'+report.total);
 if(report.result!=='PASS')process.exitCode=1;
}finally{await browser.close();}
