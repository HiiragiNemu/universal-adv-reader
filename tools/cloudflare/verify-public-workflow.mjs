import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { localBrowser } from './local-browser.mjs';
import { parseGithubNativeReviewBody, ADV_GITHUB_URL } from '../../apps/classic-reader/lib/github-native-review.ts';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const expectedIndex = JSON.parse(await fs.readFile(path.join(root, 'apps/classic-reader/public/story_index.json'), 'utf8'));
const site = process.env.ADV_TEST_BASE || 'http://127.0.0.1:4180';
const out = path.join(root, 'reports/verification/cloudflare-20261014', process.env.ADV_TEST_NAME || 'browser-public-workflow');
const browser = await localBrowser(out);
const report = { schema: 'adv-public-workflow/v1', site, generatedAt: new Date().toISOString(), humanAccepted: false, checks: [] };
let exportedPatch;
const save = () => fs.writeFile(path.join(out, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
const check = async (name, fn) => { try { const details = await fn(); report.checks.push({ name, result: 'PASS', details }); console.log('PASS ' + name); } catch (e) { report.checks.push({ name, result: 'FAIL', error: e.stack }); console.log('FAIL ' + name + ': ' + e.message); await browser.screenshot('failure-' + report.checks.length).catch(() => {}); } await save(); };
const nav = async (route, condition) => { await browser.navigate(site + route); await browser.wait(condition, 45000); await browser.wait("!!document.querySelector('[data-optics-ready=true]')", 45000); };
const markButton = async (text, marker) => browser.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Button not found');b.dataset.publicTest=${JSON.stringify(marker)}; })()`);
try {
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1840, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const original = window.fetch; window.__holdNativeEdit = true; window.__nativeEditWaiters = 0;
    window.fetch = async function(...args) {
      const response = await original.apply(this, args);
      if (String(args[0]).includes('.edit-source.json')) {
        window.__nativeEditWaiters++;
        while (window.__holdNativeEdit) await new Promise(resolve => setTimeout(resolve, 50));
        window.__nativeEditWaiters--;
      }
      return response;
    };
  })();` });
  const downloadRoot = path.join(out, 'downloads'); await fs.mkdir(downloadRoot, { recursive: true });
  const downloads = await fs.mkdtemp(path.join(downloadRoot, 'run-'));
  await browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
  await check('Public review page does not read or write the local moderation queue', async () => {
    await nav('/review/submissions', "!!document.querySelector('[data-generic-review=public-export-only]')");
    const text = await browser.evaluate('document.body.innerText');
    assert(text.includes('GitHub Issues')); assert(text.includes('不会自动上传')); assert(text.includes('导出'));
    assert.equal(await browser.evaluate(`document.querySelector('a[href="${ADV_GITHUB_URL}/issues"]')?.target`), '_blank');
    await browser.click('a[href="/review/machine-translations"]');
    await browser.wait("document.querySelectorAll('article').length===" + expectedIndex.length, 45000);
    await browser.screenshot('public-review-client-navigation');
    return { articles: expectedIndex.length, remoteModerationEnabled: false };
  });
  await check('Native editing exports one valid source-bound change without uploading it', async () => {
    await nav('/reader/legacy-narcissu-3rd-nard14', "document.querySelector('#reader-document')?.innerText.includes('对哥哥')");
    await markButton('协助汉化', 'edit'); await browser.click('[data-public-test=edit]');
    await browser.wait("!!document.querySelector('[data-native-edit-state=loading]')", 5000);
    assert((await browser.evaluate("document.querySelector('[data-edit-startup-status]')?.textContent")).includes('自动打开'));
    await browser.evaluate('window.__holdNativeEdit = false');
    await browser.wait("!!document.querySelector('[data-native-review-submit=export-only]') && !!document.querySelector('.magi-translation-textarea')", 45000);
    const original = await browser.evaluate("document.querySelector('.magi-translation-textarea').value");
    const replacement = original + '〔导出回归测试，不上传〕';
    await browser.evaluate(`(() => { const field=document.querySelector('.magi-translation-textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,${JSON.stringify(replacement)});field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await delay(300);
    await markButton('导出修改补丁', 'export'); await browser.click('[data-public-test=export]');
    let patch;
    for (let attempt = 0; attempt < 50; attempt++) { try { patch = JSON.parse(await fs.readFile(path.join(downloads, 'universal-adv-revision.json'), 'utf8')); break; } catch { await delay(200); } }
    assert(patch, 'Download was not created'); assert.equal(patch.schema, 'native-reader-translation-patch/v1'); assert.equal(patch.changes.length, 1);
    assert(JSON.stringify(patch.changes).includes('导出回归测试'));
    exportedPatch=patch;
    await browser.screenshot('native-edit-export-only');
    return { schema: patch.schema, changes: patch.changes.length, uploaded: false, oneClickSurvivesSlowSource: true };
  });
  await check('Public GitHub contribution requires consent, preserves patch identity and invalidates stale drafts without posting', async () => {
    assert(exportedPatch,'Export fixture is required');
    const start=browser.events.length;
    const selector='[data-public-contribution=github-issues]';
    assert.equal(await browser.evaluate(`document.querySelector('${selector} button').disabled`),true);
    assert.equal(await browser.evaluate("document.querySelectorAll('[data-github-review-draft]').length"),0);
    await browser.click(selector+' input[type=checkbox]');
    await browser.click(selector+' button');
    await browser.wait("!!document.querySelector('[data-github-review-draft]')",10000);
    const href=await browser.evaluate("document.querySelector('[data-github-review-draft]').href");
    const url=new URL(href);assert.equal(url.origin+url.pathname,ADV_GITHUB_URL+'/issues/new');assert(href.length<=6000);
    const body=url.searchParams.get('body');
    if(!body.includes('补丁已导出为'))assert.deepEqual(parseGithubNativeReviewBody(body),exportedPatch);
    else assert(body.includes('请将该文件附在本 Issue'));
    await browser.screenshot('github-draft-explicit-consent');
    await browser.evaluate(`(()=>{const field=document.querySelector('.magi-translation-textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,field.value+'〔修改后旧草稿失效〕');field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await browser.wait("!document.querySelector('[data-github-review-draft]') && !document.querySelector('[data-public-contribution] input[type=checkbox]').checked",10000);
    const requests=browser.events.slice(start).filter(e=>e.method==='Network.requestWillBeSent').map(e=>e.params.request);
    assert(requests.every(r=>!r.url.startsWith('https://github.com/')&&!r.url.startsWith('https://api.github.com/')));
    return {provider:'github-issues',explicitConsent:true,oldDraftInvalidated:true,githubRequests:0,issueCreated:false};
  });
  await check('Pending edit startup can be cancelled without opening later or changing text', async () => {
    await nav('/reader/legacy-narcissu-3rd-nard14', "document.querySelector('#reader-document')?.innerText.includes('对哥哥')");
    await markButton('协助汉化', 'cancel-edit'); await browser.click('[data-public-test=cancel-edit]');
    await browser.wait("!!document.querySelector('[data-native-edit-state=loading]')", 5000);
    await browser.click('[data-native-edit-state=loading]');
    await browser.evaluate('window.__holdNativeEdit = false');
    await browser.wait('window.__nativeEditWaiters === 0', 45000);
    await delay(1000);
    assert.equal(await browser.evaluate("document.querySelectorAll('.magi-translation-textarea').length"), 0);
    assert((await browser.evaluate("document.querySelector('[data-edit-startup-status]')?.textContent")).includes('已取消'));
    return { openedAfterCancellation: false };
  });
  await check('Review edit deep links enter the editor after native source becomes ready', async () => {
    await nav('/reader/legacy-narcissu-3rd-nard14?edit=1', "document.querySelector('#reader-document')?.innerText.includes('对哥哥')");
    await browser.wait("!!document.querySelector('[data-native-edit-state=loading]')", 10000);
    await browser.evaluate('window.__holdNativeEdit = false');
    await browser.wait("!!document.querySelector('[data-native-review-submit=export-only]') && !!document.querySelector('.magi-translation-textarea')", 45000);
    return { editDeepLinkWorks: true, uploaded: false };
  });
  await check('Local file opens at a reusable static route and its filename/content never appear in network requests', async () => {
    const fixture = path.join(out, 'PRIVATE_LOCAL_TEST_7441_cn.txt');
    const secretText = '本地私有剧情验证七四四一';
    await fs.writeFile(fixture, '旁白\t' + secretText + '\n旁白\t第二个独立段落\n', 'utf8');
    await nav('/apps/web', "!!document.querySelector('input[type=file][multiple]')");
    const start = browser.events.length;
    await browser.send('DOM.enable');
    const doc = await browser.send('DOM.getDocument');
    const { nodeId } = await browser.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file][multiple]' });
    await browser.send('DOM.setFileInputFiles', { nodeId, files: [fixture] });
    await browser.wait(`(location.pathname==='/reader/local'||location.pathname==='/reader/local/') && document.querySelector('#reader-document')?.innerText.includes(${JSON.stringify(secretText)})`, 45000);
    const location = await browser.evaluate('window.location.href');
    assert(location.endsWith('/reader/local?local=1'));
    await browser.send('Page.reload', { ignoreCache: true });
    await browser.wait(`document.querySelector('#reader-document')?.innerText.includes(${JSON.stringify(secretText)})`, 45000);
    const network = browser.events.slice(start).filter(e => e.method === 'Network.requestWillBeSent').map(e => e.params.request);
    assert(network.every(r => !JSON.stringify(r).includes(secretText) && !JSON.stringify(r).includes('PRIVATE_LOCAL_TEST_7441')));
    await browser.screenshot('local-file-private-static-route');
    return { location, localContentSurvivesReload: true, requestCount: network.length, privateDataUploaded: false };
  });
  await check('Settings footer text never overlaps the resize handle in any theme on narrow screens', async () => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const results = [];
    for (const theme of ['paper', 'light', 'green', 'dark', 'frost']) {
      await browser.evaluate(`localStorage.setItem('magi_theme',${JSON.stringify(theme)})`);
      await nav('/apps/web', "document.querySelector('.magi-folder-source-card')?.innerText.length>0");
      await browser.wait(`document.querySelector('[data-theme-variant]')?.getAttribute('data-theme-variant')===${JSON.stringify(theme)}`,15000);
      await browser.click('[aria-label="打开字体与站点设置"]');
      await browser.wait("!!document.querySelector('.magi-site-settings-window')");
      const result = await browser.evaluate(`(() => {
        const footer=document.querySelector('.magi-site-settings-window .magi-floating-window-footer');
        const handle=document.querySelector('.magi-site-settings-window .magi-floating-window-resize');
        const range=document.createRange();range.selectNodeContents(footer);
        const text=range.getBoundingClientRect(),control=handle.getBoundingClientRect();
        return {text:footer.textContent,paddingRight:getComputedStyle(footer).paddingRight,gap:control.left-text.right,
          overlap:Math.min(text.right,control.right)>Math.max(text.left,control.left)&&Math.min(text.bottom,control.bottom)>Math.max(text.top,control.top)};
      })()`);
      assert.equal(result.text,'设置只保存在当前浏览器');assert.equal(result.overlap,false,theme+' '+JSON.stringify(result));assert(result.gap>=3);
      await browser.screenshot('settings-footer-'+theme+'-390');results.push({theme,...result});
      await browser.click('[aria-label="关闭字体与站点设置"]');
    }
    return results;
  });
  report.release = await browser.evaluate("fetch('/release.json').then(r=>r.json())");
  report.httpErrors = browser.events.filter(e => e.method === 'Network.responseReceived' && e.params.response.status >= 400).map(e => ({ url: e.params.response.url, status: e.params.response.status }));
  report.runtimeErrors = browser.events.filter(e => e.method === 'Runtime.exceptionThrown').map(e => e.params.exceptionDetails);
  report.unexpectedWrites = browser.events.filter(e => e.method === 'Network.requestWillBeSent' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(e.params.request.method) && e.params.request.url.startsWith(site)).map(e => e.params.request.url);
  report.localQueueRequests = browser.events.filter(e => e.method === 'Network.requestWillBeSent' && e.params.request.url.includes('/api/native-reviews')).map(e => e.params.request.url);
  report.result = report.checks.every(c => c.result === 'PASS') && !report.httpErrors.length && !report.runtimeErrors.length && !report.unexpectedWrites.length && !report.localQueueRequests.length ? 'PASS' : 'FAIL';
  console.log(JSON.stringify({ result: report.result, httpErrors: report.httpErrors, runtimeErrors: report.runtimeErrors, unexpectedWrites: report.unexpectedWrites, localQueueRequests: report.localQueueRequests }));
} finally { await save(); await browser.close(); }
if (report.result !== 'PASS') process.exitCode = 1;
