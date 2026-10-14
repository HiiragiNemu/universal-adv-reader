import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { localBrowser } from './local-browser.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const site = process.env.ADV_TEST_BASE || 'http://127.0.0.1:4181';
const out = path.join(root,'reports/verification/cloudflare-20261014',process.env.ADV_TEST_NAME || 'search-recovery');
const browser = await localBrowser(out);
const report = {schema:'adv-search-browser/v1',site,generatedAt:new Date().toISOString(),faults:'Synthetic 503 responses in this isolated browser only; production backend is unchanged.',checks:[]};
const save = () => fs.writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');
const check = async (name,fn) => {try{report.checks.push({name,result:'PASS',details:await fn()});console.log('PASS '+name);}catch(e){report.checks.push({name,result:'FAIL',error:e.stack});console.log('FAIL '+name+': '+e.message);await browser.screenshot('failure-'+report.checks.length).catch(()=>{});}await save();};
const mode = async text => {
  await browser.evaluate(`(()=>{const b=[...document.querySelectorAll('header button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})||[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing search mode');b.dataset.searchProbe='mode';})()`);
  await browser.click('[data-search-probe=mode]');
  await browser.evaluate("document.querySelector('[data-search-probe=mode]')?.removeAttribute('data-search-probe')");
};
const type = async text => browser.evaluate(`(()=>{const e=document.querySelector('input[aria-label="搜索剧情标题或正文"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
const nav = async () => {
  await browser.navigate(site+'/apps/web');
  await browser.wait("document.querySelector('.magi-folder-source-card')&&document.querySelector('[data-optics-ready=true]')&&document.querySelector('input[type=search]')?.getBoundingClientRect().width>0",45000);
  await browser.click('[aria-label="显示全部作品与文本资料"]');
};
const matched = async id => {
  await browser.wait(`window.__searchResults.at(-1)?.matches.some(x=>x[0]===${JSON.stringify(id)})`,60000);
  await browser.wait("document.querySelectorAll('.magi-folder-source-card').length>0 && document.querySelector('input[type=search]').placeholder==='搜索标题或正文…'",30000);
  return browser.evaluate(`({query:document.querySelector('input[type=search]').value,calls:window.__manifestCalls,resultCount:window.__searchResults.at(-1).matches.length,cards:document.querySelectorAll('.magi-folder-source-card').length})`);
};
try {
  await browser.send('Emulation.setDeviceMetricsOverride',{width:1840,height:1000,deviceScaleFactor:1,mobile:false});
  await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
    window.__manifestFailures=Number(sessionStorage.getItem('adv-test-manifest-failures')||'1');window.__manifestCalls=0;window.__searchResults=[];
    const original=window.fetch;window.fetch=function(...args){if(String(args[0]).includes('/search_index_manifest.generic.json')){window.__manifestCalls++;if(window.__manifestFailures-->0)return Promise.resolve(new Response('injected transient fault',{status:503}));}return original.apply(this,args);};
    const W=window.Worker;window.Worker=new Proxy(W,{construct(t,args){const w=Reflect.construct(t,args);w.addEventListener('message',e=>{if(e.data?.type==='results')window.__searchResults.push(e.data);});return w;}});
  })();`});
  await check('A single manifest 503 recovers automatically and Chinese full-text search remains usable',async()=>{
    await nav();await mode('正文');await type('摩天轮');const result=await matched('legacy-narcissu-himeko-omake_062');assert.equal(result.calls,2);assert.equal(result.query,'摩天轮');await browser.screenshot('automatic-recovery');return result;
  });
  await check('Exhausted retries expose an in-page retry that preserves the query and current document',async()=>{
    await browser.evaluate("sessionStorage.setItem('adv-test-manifest-failures','3')");await nav();
    await browser.wait('window.__manifestCalls===3',15000);await mode('正文');await type('摩天轮');
    await browser.wait("!!document.querySelector('[data-retry-search=true]')",15000);
    const before=await browser.evaluate('performance.timeOrigin');
    await browser.evaluate('window.__manifestFailures=0');await browser.click('[data-retry-search=true]');
    const result=await matched('legacy-narcissu-himeko-omake_062');assert.equal(result.calls,4);assert.equal(result.query,'摩天轮');assert.equal(await browser.evaluate('performance.timeOrigin'),before);await browser.screenshot('manual-recovery-same-document');return {...result,reloaded:false};
  });
  await check('Rapid query replacement cannot display the older full-text result',async()=>{
    const priorSequence=await browser.evaluate('window.__searchResults.at(-1)?.sequence || 0');
    await type('绝不会匹配的检索测试词九七三五');await type('摩天轮');
    await browser.wait(`(window.__searchResults.at(-1)?.sequence || 0)>${priorSequence}`,30000);
    const result=await matched('legacy-narcissu-himeko-omake_062');assert.equal(result.query,'摩天轮');return {...result,priorSequence,finalSequence:await browser.evaluate('window.__searchResults.at(-1).sequence')};
  });
  await check('Title search remains available after a permanently failed content manifest',async()=>{
    await browser.evaluate("sessionStorage.setItem('adv-test-manifest-failures','99')");await nav();
    await browser.wait('window.__manifestCalls===3',15000);await mode('标题');await type('淡路');
    await browser.wait("document.querySelectorAll('.magi-folder-source-card').length===1",15000);
    const result=await browser.evaluate("({query:document.querySelector('input[type=search]').value,title:document.querySelector('.magi-folder-source-card')?.textContent,calls:window.__manifestCalls})");
    assert(result.title.includes('附带短篇')||result.title.includes('淡路'));assert.equal(result.calls,3);return result;
  });
  report.httpErrors=browser.events.filter(e=>e.method==='Network.responseReceived'&&e.params.response.status>=400).map(e=>({url:e.params.response.url,status:e.params.response.status}));
  report.runtimeErrors=browser.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails);
  report.release=await browser.evaluate("fetch('/release.json').then(r=>r.json())");
  report.result=report.checks.every(c=>c.result==='PASS')&&!report.httpErrors.length&&!report.runtimeErrors.length?'PASS':'FAIL';
}finally{await save();await browser.close();}
console.log(JSON.stringify({result:report.result,checks:report.checks.map(c=>({name:c.name,result:c.result})),httpErrors:report.httpErrors,runtimeErrors:report.runtimeErrors}));
if(report.result!=='PASS')process.exitCode=1;
