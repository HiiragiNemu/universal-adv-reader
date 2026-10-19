import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { localBrowser } from './local-browser.mjs';

const usage = `Home followthrough isolated-browser regression (U2/U3/U4/U6/U7/U8).
Required: ADV_TEST_BASE=http://127.0.0.1:PORT or https://universal-adv-reader.pages.dev.
An exact project preview host additionally requires ADV_TEST_PREVIEW_HOST=<label>.universal-adv-reader.pages.dev.
Optional: ADV_TEST_HOME_PATH=/apps/web, ADV_TEST_NAME=local-candidate,
ADV_TEST_GROUPS=mobile,desktop,night,connectors (default: all),
ADV_TEST_THEMES=light,paper,green,dark,frost (default: all).
ADV_TEST_CASES=<exact comma-separated case names> reruns only selected cases.
Output: reports/verification/ui-followthrough-20261020/browser/<run-name>/
No existing browser/profile is used; no file is selected or uploaded.
--help prints this interface without starting a browser.`;
if (process.argv.includes('--help')) {
  console.log(usage);
  process.exit(0);
}
assert(process.env.ADV_TEST_BASE, `ADV_TEST_BASE is required.\n${usage}`);
const site = new URL(process.env.ADV_TEST_BASE);
assert(['http:', 'https:'].includes(site.protocol), 'Expected HTTP(S) service');
assert(!site.username && !site.password, 'URL credentials are not part of the target allowlist');
const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(site.hostname);
const production = site.hostname === 'universal-adv-reader.pages.dev';
const explicitPreview = site.hostname === process.env.ADV_TEST_PREVIEW_HOST
  && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.universal-adv-reader\.pages\.dev$/u.test(site.hostname);
assert(loopback || ((production || explicitPreview) && site.protocol === 'https:' && site.port === ''), 'Target must be loopback, the project production host, or its explicitly named HTTPS preview host');
const home = new URL(process.env.ADV_TEST_HOME_PATH || '/apps/web', site);
assert.equal(home.origin, site.origin, 'Home URL must retain the allowed service origin');
const repository = fileURLToPath(new URL('../../', import.meta.url));
const runName = process.env.ADV_TEST_NAME || `local-${new Date().toISOString().replace(/[:.]/gu, '-')}`;
assert(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(runName) && !runName.includes('..'), 'Use a simple run name');
const output = path.join(repository, 'reports/verification/ui-followthrough-20261020/browser', runName);
const groupNames = ['mobile', 'desktop', 'night', 'connectors'];
const groups = (process.env.ADV_TEST_GROUPS || groupNames.join(',')).split(',');
assert(groups.length && groups.every(group => groupNames.includes(group)), 'Unknown test group');
const allThemes = ['light', 'paper', 'green', 'dark', 'frost'];
const themes = (process.env.ADV_TEST_THEMES || allThemes.join(',')).split(',');
assert(themes.length && themes.every(theme => allThemes.includes(theme)), 'Unknown theme');
const caseFilter = process.env.ADV_TEST_CASES?.split(',').filter(Boolean);
await fs.mkdir(output, { recursive: true });
try {
  await fs.access(path.join(output, 'verification.json'));
  throw new Error(`A verification record already exists; choose a fresh ADV_TEST_NAME: ${output}`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const report = {
  site: site.origin, home: home.href, output, startedAt: new Date().toISOString(),
  command: 'node tools/cloudflare/verify-home-followthrough.mjs',
  environment: { ADV_TEST_BASE: process.env.ADV_TEST_BASE, ADV_TEST_PREVIEW_HOST: process.env.ADV_TEST_PREVIEW_HOST, ADV_TEST_HOME_PATH: home.pathname, ADV_TEST_NAME: runName, ADV_TEST_GROUPS: groups, ADV_TEST_THEMES: themes, ADV_TEST_CASES: caseFilter },
  thresholds: { connectorEndpointPx: 0.75, sourceAnchorGapPx: 8, layoutTolerancePx: 0.5, reviewMaxWidthDesktopPx: 112, reviewMaxWidthMobilePx: 96, reviewMaxHeightPx: 36 },
  checks: [], screenshots: [], status: 'RUNNING',
};
let browser;
let seedScript;
const save = () => fs.writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
const screenshot = async (name) => {
  await browser.screenshot(name);
  const fullPath = path.join(output, `${name}.png`);
  report.screenshots.push(fullPath);
  return fullPath;
};
const check = async (name, run) => {
  if (caseFilter && !caseFilter.includes(name)) return;
  const result = { name, startedAt: new Date().toISOString(), passed: false };
  try {
    result.evidence = await run();
    result.passed = true;
  } catch (error) {
    result.error = String(error.stack || error);
    if (error.evidence) result.evidence = error.evidence;
  }
  try { result.screenshot = await screenshot(`${name}-${result.passed ? 'pass' : 'fail'}`); }
  catch (error) { result.screenshotError = String(error); result.passed = false; }
  result.finishedAt = new Date().toISOString();
  report.checks.push(result);
  await save();
  console.log(JSON.stringify({ name, passed: result.passed, error: result.error, screenshot: result.screenshot }));
};
const visibleFunction = `(e) => !!e && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none'`;
// Keep real pointer interaction while allowing a usable part of a small title
// to be clicked when the development-only badge covers just its centre.
const clickControl = async (selector) => {
  const point = await browser.evaluate(`(() => {
    const visible=${visibleFunction},e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(visible);
    if(!e)throw Error('Missing visible control: '+${JSON.stringify(selector)});
    e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
    const r=e.getBoundingClientRect(),attempts=[];
    for(const [fx,fy] of [[.5,.5],[.75,.5],[.25,.5],[.5,.25],[.5,.75],[.9,.5],[.1,.5]]) {
      const p={x:r.left+r.width*fx,y:r.top+r.height*fy},hit=document.elementFromPoint(p.x,p.y);
      attempts.push({...p,hit:hit?.tagName});
      if(hit&&e.contains(hit))return {...p,attempts};
    }
    throw Error('No clickable interior point: '+JSON.stringify({selector:${JSON.stringify(selector)},rect:{left:r.left,top:r.top,width:r.width,height:r.height},attempts}));
  })()`);
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await delay(250);
  return point;
};
const loadHome = async ({ width = 1440, theme = 'paper', sidebar = 256, preferences } = {}) => {
  await browser.send('Emulation.setDeviceMetricsOverride', { width, height: width < 768 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 768 });
  if (seedScript) await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seedScript });
  const entries = { 'magi-reader-home-sidebar-width-v1': String(sidebar) };
  if (theme !== null) entries.magi_theme = theme;
  if (preferences !== undefined) entries['magi-reader-display-preferences-v1'] = preferences;
  const { identifier } = await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    window.__homeFollowthroughBoot = null;
    window.__homeFollowthroughSeedError = null;
    try {
      localStorage.clear();
      for (const [key, value] of Object.entries(${JSON.stringify(entries)})) localStorage.setItem(key, value);
    } catch (error) { window.__homeFollowthroughSeedError = String(error); }
    const observer = new MutationObserver(() => {
      const data = document.documentElement?.dataset;
      if (!window.__homeFollowthroughBoot && data?.loadingPhosphor) {
        window.__homeFollowthroughBoot = { loadingPhosphor:data.loadingPhosphor, nightPhosphor:data.nightPhosphor,
          loadingTheme:data.loadingTheme, nightPixelFont:data.nightPixelFont, readyState:document.readyState, at:performance.now() };
        observer.disconnect();
      }
    });
    observer.observe(document, {subtree:true, attributes:true, attributeFilter:['data-loading-phosphor','data-night-phosphor','data-night-pixel-font']});
  })()` });
  seedScript = identifier;
  await browser.navigate(home.href);
  await browser.wait(`!!document.querySelector('.magi-folder-source-card') && !!document.querySelector('[data-optics-ready=true]') && !!document.querySelector('.magi-home-heading-review-trigger')`, 90000);
  await browser.evaluate('document.fonts.ready.then(() => true)');
  await delay(200);
  assert.equal(await browser.evaluate('window.__homeFollowthroughSeedError'), null, 'Isolated preference seeding failed');
};
const reviewState = () => browser.evaluate(`(() => {
  const visible=${visibleFunction};
  const button=[...document.querySelectorAll('.magi-home-heading-review-trigger,.magi-home-mobile-review-button')].find(visible);
  if(!button) throw Error('Missing visible review trigger');
  const panel=document.getElementById(button.getAttribute('aria-controls'));
  if(!panel) throw Error('Review trigger has no controlled panel');
  const toolbar=document.querySelector('.magi-home-toolbar-shell');
  const localTitle='可选择一个剧情文件，或同时选择一对中日文文件';
  return {panelId:panel.id,hidden:panel.hidden,panelVisible:visible(panel),expanded:button.getAttribute('aria-expanded'),
    stored:localStorage.getItem('magi-reader-machine-review-panel-v1'),
    toolbarLocalButtons:toolbar.querySelectorAll('button[title="'+localTitle+'"]').length,
    toolbarFiles:toolbar.querySelectorAll('input[type=file]').length,
    toolbarRevisionLinks:toolbar.querySelectorAll('[data-generic-revisions-link],a[href="/proofreading/status"]').length};
})()`);
const reviewGeometry = () => browser.evaluate(`(() => {
  const visible=${visibleFunction},rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
  const button=[...document.querySelectorAll('.magi-home-heading-review-trigger,.magi-home-mobile-review-button')].find(visible);
  const row=document.querySelector('.magi-home-section-heading-row'),b=rect(button),r=rect(row);
  const statistics=[...document.querySelectorAll('.magi-home-section-statistics [data-stat]')].filter(visible).map(e=>({stat:e.dataset.stat,...rect(e)}));
  const overlaps=statistics.map(s=>({stat:s.stat,width:Math.max(0,Math.min(s.right,b.right)-Math.max(s.left,b.left)),height:Math.max(0,Math.min(s.bottom,b.bottom)-Math.max(s.top,b.top))}));
  return {button:b,row:r,statistics,overlaps,viewportWidth:innerWidth,viewportHeight:innerHeight};
})()`);
const assertCompactReview = (geometry, mobile) => {
  assert(geometry.statistics.length === 5, `Expected all five statistical badges: ${JSON.stringify(geometry)}`);
  assert(geometry.button.width <= (mobile ? 96 : 112) + 0.5 && geometry.button.height <= 36.5, `Review trigger exceeds declared compact box: ${JSON.stringify(geometry.button)}`);
  assert(geometry.button.left >= -0.5 && geometry.button.right <= geometry.viewportWidth + 0.5, 'Review trigger exceeds viewport');
  assert(geometry.overlaps.every(overlap => overlap.width <= 0.5 || overlap.height <= 0.5), `Review trigger overlaps statistics: ${JSON.stringify(geometry.overlaps)}`);
};
const openReview = async () => {
  await browser.click('.magi-home-heading-review-trigger,.magi-home-mobile-review-button');
  await browser.wait(`(() => {const visible=${visibleFunction};const b=[...document.querySelectorAll('.magi-home-heading-review-trigger,.magi-home-mobile-review-button')].find(visible);return b?.getAttribute('aria-expanded')==='true' && !document.getElementById(b.getAttribute('aria-controls')).hidden;})()`);
};
const verifyPanelEntries = async (name) => {
  const entries = await browser.evaluate(`(() => {
    const visible=${visibleFunction};const b=[...document.querySelectorAll('.magi-home-heading-review-trigger,.magi-home-mobile-review-button')].find(visible);
    const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    const panel=document.getElementById(b.getAttribute('aria-controls'));
    const local=panel.querySelector('button[title="可选择一个剧情文件，或同时选择一对中日文文件"]');
    const input=panel.querySelector('input[type=file]'),link=panel.querySelector('[data-generic-revisions-link]');
    const tail=panel.querySelector('.magi-home-review-tail-actions');
    const layout=e=>{const s=getComputedStyle(e);return {display:s.display,flex:s.flex,flexWrap:s.flexWrap,width:s.width,minWidth:s.minWidth,maxWidth:s.maxWidth,whiteSpace:s.whiteSpace};};
    return {local:!!local,localVisible:visible(local),disabled:local?.disabled,input:!!input,accept:input?.accept,multiple:input?.multiple,
      linkVisible:visible(link),href:link?.getAttribute('href'),linkText:link?.textContent?.trim(),
      panelBox:box(panel),localBox:box(local),linkBox:box(link),tailBox:box(tail),tailLayout:tail&&layout(tail),linkLayout:link&&layout(link),viewportWidth:innerWidth,documentScrollWidth:document.documentElement.scrollWidth};
  })()`);
  assert(entries.local && entries.localVisible && !entries.disabled && entries.input && entries.multiple, `Local-story entry missing/disabled in review panel: ${JSON.stringify(entries)}`);
  assert(entries.linkVisible && entries.href === '/proofreading/status', `Revision entry missing from review panel: ${JSON.stringify(entries)}`);
  try {
    for (const key of ['localBox', 'linkBox']) {
      const box = entries[key];
      assert(box.left >= entries.panelBox.left - 0.5 && box.right <= entries.panelBox.right + 0.5
        && box.left >= -0.5 && box.right <= entries.viewportWidth + 0.5,
      `Review entry ${key} exceeds panel/viewport: ${JSON.stringify(entries)}`);
    }
  } catch (error) { error.evidence = { entries }; throw error; }
  const before = browser.events.length;
  await browser.click('.magi-home-review-panel button[title="可选择一个剧情文件，或同时选择一对中日文文件"]');
  const start = Date.now();
  while (!browser.events.slice(before).some(event => event.method === 'Page.fileChooserOpened') && Date.now() - start < 5000) await delay(50);
  const chooser = browser.events.slice(before).find(event => event.method === 'Page.fileChooserOpened');
  assert(chooser, 'Local-story button did not open its intercepted file chooser');
  if (chooser.params.backendNodeId) await browser.send('DOM.setFileInputFiles', { files: [], backendNodeId: chooser.params.backendNodeId });
  await screenshot(`${name}-panel-entries`);
  await browser.click('.magi-home-review-panel [data-generic-revisions-link]');
  await browser.wait("location.pathname.replace(/\\/$/,'')==='/proofreading/status' && document.readyState==='complete'", 45000);
  return { ...entries, chooserMode: chooser.params.mode, navigation: await browser.evaluate('location.href'), fileSelected: false };
};

const measureConnectors = () => browser.evaluate(`(() => {
  const nav=document.querySelector('.magi-home-category-nav'),svg=nav.querySelector('.magi-home-category-overlay-lines'),menu=nav.querySelector('.magi-home-category-filter-overlay-menu');
  if(!svg||!menu)throw Error('Missing desktop connector overlay');
  const box=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
  const center=e=>{const r=box(e);return {x:r.left+r.width/2,y:r.top+r.height/2};};
  const plaques=[...menu.querySelectorAll('.magi-home-category-filter')].map(e=>({filter:e.dataset.filter,...box(e)}));
  const anchors=[...menu.querySelectorAll('.magi-home-category-filter-anchor-dot')].map(box);
  const railLeft=Math.min(...plaques.map(r=>r.left)),anchorLeft=Math.min(...anchors.map(r=>r.left));
  const rows=[...nav.querySelectorAll('.magi-home-category-node')].map(e=>{const title=box(e.querySelector('.magi-home-category-trigger')),socket=box(e.querySelector('.magi-home-category-select-box'));return {category:e.dataset.category,title,socket,titleOverlap:Math.max(0,title.right-railLeft),anchorGap:anchorLeft-socket.right};});
  const lines=[...svg.querySelectorAll('.magi-home-category-branch-line')].map(p=>{
    const start=nav.querySelector('.magi-home-category-select-box[data-category="'+p.dataset.category+'"]');
    const end=menu.querySelector('.magi-home-category-filter[data-filter-index="'+p.dataset.filterIndex+'"] .magi-home-category-filter-anchor-dot[data-anchor-index="'+p.dataset.anchorIndex+'"]');
    if(!start||!end)throw Error('Unresolved connector endpoint');
    const a=center(start),b=center(end),ctm=p.getScreenCTM(),first=p.getPointAtLength(0),last=p.getPointAtLength(p.getTotalLength());
    const from=new DOMPoint(first.x,first.y).matrixTransform(ctm),to=new DOMPoint(last.x,last.y).matrixTransform(ctm);
    return {category:p.dataset.category,filter:p.dataset.filterIndex,anchor:p.dataset.anchorIndex,path:p.getAttribute('d'),dx:b.x-a.x,
      startError:Math.hypot(from.x-a.x,from.y-a.y),endError:Math.hypot(to.x-b.x,to.y-b.y)};
  });
  return {nav:{...box(nav),clientWidth:nav.clientWidth},svg:box(svg),menu:box(menu),plaques,rows,lines,
    selectedCategories:[...nav.querySelectorAll('.magi-home-category-select-box[aria-pressed=true]')].map(e=>e.dataset.category),theme:document.documentElement.dataset.readerTheme,
    phosphor:document.documentElement.dataset.nightPhosphor,sidebarWidth:document.querySelector('.magi-sidebar-resize-handle').getAttribute('aria-valuenow')};
})()`);
const assertConnectors = (data, selected, sidebar) => {
  assert.equal(Number(data.sidebarWidth), sidebar);
  assert.equal(data.rows.length, 4, 'Expected four Universal ADV categories');
  assert.equal(data.selectedCategories.length, selected);
  assert.equal(data.lines.length, selected * 4, 'Expected four source connections per selected category');
  assert(data.rows.every(row => row.titleOverlap <= 0.5), `Category titles enter source rail: ${JSON.stringify(data.rows)}`);
  assert(data.rows.every(row => row.anchorGap >= 7.5), `Category socket overlaps source anchor/corridor: ${JSON.stringify(data.rows)}`);
  assert(data.lines.every(line => line.dx > 0), `Connector runs backwards into source rail: ${JSON.stringify(data.lines)}`);
  assert(data.lines.every(line => line.startError <= 0.75 && line.endError <= 0.75), `Connector endpoints miss sockets: ${JSON.stringify(data.lines)}`);
  assert(data.menu.left >= data.nav.left - 0.5 && data.menu.right <= data.nav.right + 0.5, 'Source menu exceeds nav');
  assert(data.plaques.every(plate => plate.left >= data.menu.left - 0.5 && plate.right <= data.menu.right + 0.5 && plate.width <= data.menu.width + 0.5), 'Fixed plaque exceeds measured menu budget');
};

try {
  browser = await localBrowser(output);
  report.isolatedProfile = browser.profile;
  await browser.send('Page.setInterceptFileChooserDialog', { enabled: true });
  if (groups.includes('mobile')) for (const width of [320, 390, 430]) for (const theme of themes) {
    const name = `U2-U3-U4-U7-mobile-${width}-${theme}`;
    await check(name, async () => {
      await loadHome({ width, theme });
      const initial = await reviewState();
      assert(initial.hidden && !initial.panelVisible && initial.expanded === 'false' && initial.stored === null, `New-user coverage panel is expanded: ${JSON.stringify(initial)}`);
      assert(initial.toolbarLocalButtons === 0 && initial.toolbarFiles === 0 && initial.toolbarRevisionLinks === 0, `Old actions remain in toolbar: ${JSON.stringify(initial)}`);
      const geometry = await reviewGeometry(); assertCompactReview(geometry, true);
      const source = await browser.evaluate(`(() => {const t=document.querySelector('.magi-home-mobile-source-toggle');return {expanded:t?.getAttribute('aria-expanded'),rail:!!document.querySelector('#mobile-category-source-rail')};})()`);
      assert(source.expanded === 'false' && !source.rail, `Mobile source rail is initially expanded: ${JSON.stringify(source)}`);
      await screenshot(`${name}-initial`);
      await browser.click('.magi-home-mobile-source-toggle');
      await browser.wait("document.querySelector('.magi-home-mobile-source-toggle')?.getAttribute('aria-expanded')==='true' && document.querySelectorAll('#mobile-category-source-rail .magi-home-mobile-source-filter').length===4");
      await screenshot(`${name}-source-open`);
      await browser.click('.magi-home-mobile-source-toggle');
      await browser.wait("!document.querySelector('#mobile-category-source-rail')");
      await openReview();
      return { initial, geometry, source, entries: await verifyPanelEntries(name) };
    });
  }
  if (groups.includes('desktop')) for (const theme of themes) {
    const name = `U3-U4-U7-desktop-${theme}`;
    await check(name, async () => {
      await loadHome({ theme });
      const initial = await reviewState();
      assert(initial.hidden && !initial.panelVisible && initial.expanded === 'false' && initial.stored === null, `New-user coverage panel is expanded: ${JSON.stringify(initial)}`);
      assert(initial.toolbarLocalButtons === 0 && initial.toolbarFiles === 0 && initial.toolbarRevisionLinks === 0, `Old actions remain in toolbar: ${JSON.stringify(initial)}`);
      const geometry = await reviewGeometry(); assertCompactReview(geometry, false);
      await screenshot(`${name}-initial`);
      await openReview();
      return { initial, geometry, entries: await verifyPanelEntries(name) };
    });
  }
  if (groups.includes('night')) {
    for (const scenario of [
      { name: 'no-preferences', preferences: undefined, expected: 'amber', pixel: 'true' },
      { name: 'explicit-green', preferences: '{"nightPhosphor":"green"}', expected: 'green', pixel: 'false' },
      { name: 'corrupt-json', preferences: '{broken', expected: 'amber', pixel: 'true' },
    ]) await check(`U8-night-${scenario.name}`, async () => {
      await loadHome({ theme: 'dark', preferences: scenario.preferences });
      const state = await browser.evaluate(`({boot:window.__homeFollowthroughBoot,phosphor:document.documentElement.dataset.nightPhosphor,pixel:document.documentElement.dataset.nightPixelFont,stored:localStorage.getItem('magi-reader-display-preferences-v1')})`);
      assert(state.boot && state.boot.readyState === 'loading', `No parser-time bootstrap observation: ${JSON.stringify(state)}`);
      assert.equal(state.boot.loadingPhosphor, scenario.expected);
      assert.equal(state.boot.nightPhosphor, scenario.expected);
      assert.equal(state.phosphor, scenario.expected);
      assert.equal(state.pixel, scenario.pixel);
      assert.equal(state.stored, scenario.preferences ?? null, 'Initial hydration rewrote stored choices');
      await browser.click('[data-theme-option=paper]');
      await browser.wait("document.documentElement.dataset.readerTheme==='paper'");
      await browser.click('[data-theme-option=dark]');
      await browser.wait("document.documentElement.dataset.readerTheme==='dark'");
      assert.equal(await browser.evaluate('document.documentElement.dataset.nightPhosphor'), scenario.expected);
      return state;
    });
    await check('U8-switch-night-from-fresh-paper', async () => {
      await loadHome({ theme: null });
      await browser.click('[data-theme-option=dark]');
      await browser.wait("document.documentElement.dataset.readerTheme==='dark' && !!document.querySelector('[data-optics-ready=true]')");
      const state = await browser.evaluate(`({theme:document.documentElement.dataset.readerTheme,phosphor:document.documentElement.dataset.nightPhosphor,stored:localStorage.getItem('magi-reader-display-preferences-v1')})`);
      assert.equal(state.phosphor, 'amber'); assert.equal(state.stored, null);
      return state;
    });
  }
  if (groups.includes('connectors')) for (const sidebar of [208, 256, 480]) for (const theme of themes) for (const selected of [1, 3]) {
    await check(`U6-sidebar-${sidebar}-${theme}-${selected}-selected`, async () => {
      await loadHome({ theme, sidebar });
      const clicks = [await clickControl('.magi-home-category-nav .magi-home-category-node[data-category=supplement_story] .magi-home-category-trigger')];
      await browser.wait("!!document.querySelector('.magi-home-category-overlay-lines .magi-home-category-branch-line[data-category=supplement_story]')");
      if (selected === 3) {
        clicks.push(await clickControl('.magi-home-category-nav .magi-home-category-select-box[data-category=character_story]'));
        clicks.push(await clickControl('.magi-home-category-nav .magi-home-category-select-box[data-category=main_story]'));
      }
      await browser.wait(`document.querySelectorAll('.magi-home-category-overlay-lines .magi-home-category-branch-line').length===${selected * 4}`);
      await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const geometry = await measureConnectors();
      geometry.clicks = clicks;
      try { assertConnectors(geometry, selected, sidebar); }
      catch (error) { error.evidence = geometry; throw error; }
      return geometry;
    });
  }
  report.runtimeErrors = browser.events.filter(event => event.method === 'Runtime.exceptionThrown').map(event => event.params.exceptionDetails);
  report.networkFailures = browser.events.filter(event => event.method === 'Network.loadingFailed').map(event => ({ error: event.params.errorText, canceled: event.params.canceled }));
  report.requestMethods = [...new Set(browser.events.filter(event => event.method === 'Network.requestWillBeSent').map(event => event.params.request.method))];
  if (caseFilter) assert(caseFilter.every(name => report.checks.some(result => result.name === name)), 'An explicitly requested case name did not run');
  report.passed = report.checks.length > 0 && report.checks.every(result => result.passed) && report.runtimeErrors.length === 0;
  report.status = report.passed ? 'PASS' : 'FAIL';
} catch (error) {
  report.passed = false; report.status = 'HARNESS_ERROR'; report.error = String(error.stack || error);
} finally {
  report.finishedAt = new Date().toISOString();
  report.acceptance = 'Automated isolated-browser regression at the recorded target; no deployment action or human acceptance claim.';
  if (browser) await browser.close();
  report.browserClosed = Boolean(browser);
  await save();
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, failed: report.checks.filter(result => !result.passed).map(result => result.name), report: path.join(output, 'verification.json') }));
}
process.exitCode = report.passed ? 0 : 1;
