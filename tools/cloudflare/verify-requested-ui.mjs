import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { localBrowser } from './local-browser.mjs';

const site = process.env.ADV_TEST_BASE || 'http://127.0.0.1:4182';
const out = path.resolve('reports/verification/ui-repair-20261019', process.env.ADV_TEST_NAME || 'local');
const browser = await localBrowser(out);
const report = { site, startedAt: new Date().toISOString(), checks: [] };
try {
  await browser.navigate(site + '/review/machine-translations');
  await browser.wait("document.querySelectorAll('article').length > 0", 90000);
  for (const theme of ['light', 'paper', 'green', 'dark', 'frost']) {
    for (const width of [1440, 390]) {
      const height = width < 600 ? 844 : 800;
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
      await browser.evaluate(`localStorage.setItem('magi_theme', ${JSON.stringify(theme)}); window.dispatchEvent(new Event('magi-reader-theme-change')); document.querySelector('[data-generic-review-scroll]').scrollTop = 0;`);
      await browser.wait(`document.documentElement.dataset.readerTheme === ${JSON.stringify(theme)} && !!document.querySelector('[data-optics-ready=true]')`, 45000);
      const before = await browser.evaluate(`(() => {const e=document.querySelector('[data-generic-review-scroll]');return {height:e.clientHeight, content:e.scrollHeight, top:e.scrollTop, root:document.querySelector('[data-generic-review-surface]').getBoundingClientRect().height};})()`);
      assert(before.height <= height + 2 && before.root <= height + 2, JSON.stringify({theme,width,before}));
      assert(before.content > before.height, 'Long page must overflow inside its scroll host');
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: width / 2, y: 300, deltaX: 0, deltaY: 650 });
      await browser.wait("document.querySelector('[data-generic-review-scroll]').scrollTop > 20");
      const wheelTop = await browser.evaluate("document.querySelector('[data-generic-review-scroll]').scrollTop");
      await browser.evaluate("document.querySelector('[data-generic-review-scroll]').focus({preventScroll:true})");
      await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 });
      await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 });
      await browser.wait("(()=>{const e=document.querySelector('[data-generic-review-scroll]');return e.scrollTop >= e.scrollHeight-e.clientHeight-2})()");
      const bottom = await browser.evaluate("(()=>{const e=document.querySelector('[data-generic-review-scroll]');return {top:e.scrollTop,max:e.scrollHeight-e.clientHeight,horizontalOverflow:document.documentElement.scrollWidth-innerWidth}})()");
      assert(bottom.horizontalOverflow < 3);
      await browser.evaluate("(()=>{const list=document.querySelector('article').parentElement;list.setAttribute('tabindex','0');list.scrollTop=0;list.focus({preventScroll:true})})()");
      await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 });
      await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 });
      await browser.wait("(()=>{const e=document.querySelector('article').parentElement;return e.scrollTop>=e.scrollHeight-e.clientHeight-2})()");
      const lastEntry = await browser.evaluate("(()=>{const list=document.querySelector('article').parentElement,r=list.lastElementChild.getBoundingClientRect();return {count:list.children.length,top:list.scrollTop,max:list.scrollHeight-list.clientHeight,lastBottom:r.bottom,viewport:innerHeight}})()");
      assert(lastEntry.count===323 && lastEntry.lastBottom<=height+2, JSON.stringify(lastEntry));
      report.checks.push({ name: 'progress-wheel-and-keyboard-bottom', theme, width, before, wheelTop, bottom, lastEntry, passed: true });
      await browser.screenshot('progress-bottom-' + theme + '-' + width);
    }
  }
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 800, deviceScaleFactor: 1, mobile: false });
  await browser.evaluate("localStorage.setItem('magi_theme','paper');window.dispatchEvent(new Event('magi-reader-theme-change'))");
  await browser.navigate(site + '/apps/web');
  await browser.wait("!!document.querySelector('.magi-folder-source-card') && !!document.querySelector('[data-optics-ready=true]')", 90000);
  await browser.evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='关于').setAttribute('data-ui-about-open','true')");
  await browser.click('[data-ui-about-open]');
  await browser.wait("!!document.querySelector('.magi-about-window')");
  const links = await browser.evaluate("[...document.querySelectorAll('.magi-about-window a')].map(e=>({href:e.getAttribute('href'),text:e.innerText}))");
  assert(links.some(e=>e.text.includes('联系作者') && e.text.includes('254489200')));
  for (const host of ['magireader.pages.dev','magiaexedralive2dviewer.pages.dev','magius3dviewer.pages.dev','madeinmagius-site.pages.dev','magireco-call-search-cn.pages.dev']) assert(links.some(e=>e.href.includes(host)),host);
  assert(!links.some(e=>['/','/proofreading/status','/native-reader-revisions.json'].includes(e.href)));
  await browser.click('[aria-controls="magi-contribution-list"]');
  const credits = await browser.evaluate("document.querySelector('#magi-contribution-list').innerText");
  assert(credits.includes('风铃汉化组') && credits.includes('妹乃萌汉化组'));
  await browser.screenshot('about-contributors');
  await browser.evaluate("(()=>{const e=document.querySelector('.magi-about-window .magi-floating-window-body');e.scrollTop=e.scrollHeight})()");
  await browser.screenshot('about-project-links');
  report.checks.push({ name:'about-contact-links-native-contributors', links, passed:true });
  await browser.send('Emulation.setDeviceMetricsOverride', { width:390,height:844,deviceScaleFactor:1,mobile:true });
  await browser.evaluate("(()=>{const e=document.querySelector('.magi-about-window .magi-floating-window-body');e.scrollTop=0})()");
  await browser.wait("document.querySelector('.magi-about-window').getBoundingClientRect().width<391");
  const aboutMobile = await browser.evaluate("(()=>{const w=document.querySelector('.magi-about-window').getBoundingClientRect(),b=document.querySelector('.magi-about-window .magi-floating-window-body');return {left:w.left,right:w.right,top:w.top,bottom:w.bottom,bodyHeight:b.clientHeight,bodyContent:b.scrollHeight}})()");
  assert(aboutMobile.left>=0 && aboutMobile.right<=391 && aboutMobile.bottom<=845,JSON.stringify(aboutMobile));
  await browser.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:195,y:400,deltaX:0,deltaY:700});
  await browser.wait("document.querySelector('.magi-about-window .magi-floating-window-body').scrollTop>20");
  await browser.evaluate("(()=>{const e=document.querySelector('.magi-about-window .magi-floating-window-body');e.scrollTop=e.scrollHeight})()");
  const aboutLast = await browser.evaluate("[...document.querySelectorAll('.magi-about-window a')].at(-1).getBoundingClientRect().bottom");
  assert(aboutLast<=844 && aboutLast>0,String(aboutLast));
  await browser.screenshot('about-mobile-bottom');
  report.checks.push({name:'about-mobile-scroll-and-last-link',...aboutMobile,lastLinkBottom:aboutLast,passed:true});
  report.runtimeErrors = browser.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails);
  assert.equal(report.runtimeErrors.length,0,JSON.stringify(report.runtimeErrors));
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = String(error.stack || error); throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({site,passed:report.passed,checks:report.checks.length,error:report.error}));
  await browser.close();
}
