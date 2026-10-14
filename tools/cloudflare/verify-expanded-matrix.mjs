import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { localBrowser } from './local-browser.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const site=process.env.ADV_TEST_BASE || 'https://universal-adv-reader.pages.dev';
const out=path.join(root,'reports/verification/cloudflare-20261014',process.env.ADV_TEST_NAME || 'expanded-matrix');
const browser=await localBrowser(out);
const expected=JSON.parse(await fs.readFile(path.join(root,'work/cloudflare/build-receipt.json'),'utf8')).buildId;
const report={schema:'adv-expanded-theme-matrix/v1',startedAt:new Date().toISOString(),site,buildId:expected,realIOSDevice:false,humanAccepted:false,checks:[]};
const save=()=>fs.writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');
const check=async(name,run)=>{try{const details=await run();report.checks.push({name,result:'PASS',details});console.log('PASS '+name);}catch(e){report.checks.push({name,result:'FAIL',error:e.stack});console.log('FAIL '+name+': '+e.message);await browser.screenshot('failure-'+report.checks.length).catch(()=>{});}await save();};
const nav=async(route,condition)=>{await browser.navigate(site+route);await browser.wait(condition,45000);await browser.wait("!!document.querySelector('[data-optics-ready=true]')",45000);};
const geometry=async(selector)=>browser.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing surface');const r=e.getBoundingClientRect(),style=getComputedStyle(e);return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight,overflow:document.documentElement.scrollWidth-innerWidth,text:e.innerText.slice(0,250),visibility:style.visibility,display:style.display};})()`);
const validate=g=>{assert(g.width>100&&g.height>20,JSON.stringify(g));assert.equal(g.visibility,'visible');assert(g.overflow<8,'Page horizontal overflow: '+JSON.stringify(g));assert(g.text.trim().length>0);};
try{
 await browser.navigate(site+'/apps/web');
 for(const theme of ['paper','light','green','dark','frost'])for(const width of [1840,390]){
  const height=width<600?844:1000;
  await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
  await browser.evaluate(`localStorage.setItem('magi_theme',${JSON.stringify(theme)})`);
  await check(theme+'/'+width+'/home',async()=>{
   await nav('/apps/web',"!!document.querySelector('.magi-folder-source-card') && !!document.querySelector('input[type=search]')");
   await browser.wait(`document.querySelector('[data-theme-variant]')?.getAttribute('data-theme-variant')===${JSON.stringify(theme)} && document.querySelector('.magi-folder-source-card')?.innerText.length>0`,45000);
   const g=await geometry('.magi-folder-source-card');validate(g);await browser.screenshot(theme+'-'+width+'-home');return g;
  });
  await check(theme+'/'+width+'/settings',async()=>{
   await browser.click('[aria-label="打开字体与站点设置"]');
   await browser.wait("!!document.querySelector('.magi-site-settings-window')",15000);
   const g=await geometry('.magi-site-settings-window');validate(g);
   assert(g.x>=-8&&g.y>=-8&&g.right<=width+8&&g.bottom<=height+8,'Settings outside viewport: '+JSON.stringify(g));
   const state=await browser.evaluate("({theme:document.querySelector('.magi-site-settings-window')?.getAttribute('data-reader-theme'),selected:document.querySelectorAll('.magi-site-settings-window [data-theme-option][aria-pressed=true]').length})");
   assert.equal(state.theme,theme);assert.equal(state.selected,1);
   const footer=await browser.evaluate("(()=>{const f=document.querySelector('.magi-site-settings-window .magi-floating-window-footer'),h=document.querySelector('.magi-site-settings-window .magi-floating-window-resize'),range=document.createRange();range.selectNodeContents(f);const t=range.getBoundingClientRect(),r=h.getBoundingClientRect();return {text:f.textContent,paddingRight:getComputedStyle(f).paddingRight,gap:r.left-t.right};})()");
   assert.equal(footer.text,'设置只保存在当前浏览器');assert(footer.gap>=3,'Footer obscured by resize handle: '+JSON.stringify(footer));
   await browser.screenshot(theme+'-'+width+'-settings');await browser.click('[aria-label="关闭字体与站点设置"]');await browser.wait("!document.querySelector('.magi-site-settings-window')");return {...g,...state,footer};
  });
  await check(theme+'/'+width+'/reader',async()=>{
   await nav('/reader/legacy-narcissu-3rd-nard14',"document.querySelector('#reader-document')?.innerText.includes('对哥哥')");
   await browser.wait("document.querySelector('#reader-document')?.innerText.includes('千里')",30000);
   const g=await geometry('#reader-document');validate(g);await browser.screenshot(theme+'-'+width+'-reader');return g;
  });
  await check(theme+'/'+width+'/editor',async()=>{
   await nav('/reader/legacy-narcissu-3rd-nard14?edit=1',"!!document.querySelector('.magi-translation-textarea') && !!document.querySelector('[data-native-review-submit=export-only]')");
   const g=await geometry('#reader-document');validate(g);
   const field=await browser.evaluate("(()=>{const e=document.querySelector('.magi-translation-textarea'),r=e.getBoundingClientRect();return {width:r.width,height:r.height,valueLength:e.value.length,visibility:getComputedStyle(e).visibility};})()");
   assert(field.width>50&&field.height>15&&field.valueLength>0&&field.visibility==='visible',JSON.stringify(field));
   await browser.screenshot(theme+'-'+width+'-editor');return {...g,field};
  });
 }
 report.release=await browser.evaluate("fetch('/release.json').then(r=>r.json())");assert.equal(report.release.buildId,expected);
 report.httpErrors=browser.events.filter(e=>e.method==='Network.responseReceived'&&e.params.response.status>=400).map(e=>({url:e.params.response.url,status:e.params.response.status}));
 report.runtimeErrors=browser.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails);
 report.result=report.checks.every(c=>c.result==='PASS')&&!report.httpErrors.length&&!report.runtimeErrors.length?'PASS':'FAIL';
 report.finishedAt=new Date().toISOString();
}finally{await save();await browser.close();}
console.log(JSON.stringify({result:report.result,checks:report.checks.length,failed:report.checks.filter(c=>c.result!=='PASS'),httpErrors:report.httpErrors,runtimeErrors:report.runtimeErrors}));
if(report.result!=='PASS')process.exitCode=1;
