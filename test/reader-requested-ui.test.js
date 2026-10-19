import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const read = p => fs.readFile(new URL('../apps/classic-reader/' + p, import.meta.url), 'utf8');

test('About shows the requested contact and project links, not internal directory/help/version cards', async () => {
  const source = await read('components/AboutModal.tsx');
  const links = JSON.parse(source.match(/const LINKS = (\[[\s\S]*?\n\]);/)[1]);
  const contact = links.find(l => l.title === '联系作者');
  assert.equal(contact?.subtitle, 'QQ：254489200');
  assert.match(contact.href, /uin=254489200/);
  for (const host of ['magireader.pages.dev', 'magiaexedralive2dviewer.pages.dev', 'magius3dviewer.pages.dev', 'madeinmagius-site.pages.dev', 'magireco-call-search-cn.pages.dev']) {
    assert(links.some(l => new URL(l.href, 'https://universal-adv-reader.pages.dev').hostname === host), host);
  }
  for (const path of ['/', '/proofreading/status', '/native-reader-revisions.json']) assert(!links.some(l => l.href === path), path);
  assert.match(source, /Narcissu：风铃汉化组/);
  assert.match(source, /加奈：妹乃萌汉化组/);
});

test('work display names are Chinese and compact without changing category identities', async () => {
  for (const file of ['app/page.tsx', 'components/ClassicHome.tsx', 'components/Sidebar.tsx']) {
    const source = await read(file);
    assert.match(source, /character_story:\s*\{\s*label: '加奈，欢迎回来！'/, file);
    assert.match(source, /main_story:\s*\{\s*label: 'Narcissu10周年'/, file);
  }
  const source = await read('lib/generic-progress.ts');
  assert.match(source, /character_story: '加奈，欢迎回来！'/);
  assert.match(source, /main_story: 'Narcissu10周年'/);
});

test('generic long pages have a viewport-bound accessible scroll region', async () => {
  const source = await read('components/GenericReviewSurface.tsx');
  assert.match(source, /data-generic-review-scroll/);
  assert.match(source, /tabIndex=\{0\}/);
  const css = await read('app/viewport-scene.css');
  assert.match(css, /#magi-home-display\[data-generic-review-surface\][^{]*\{[^}]*height:\s*100dvh\s*!important[^}]*max-height:\s*100dvh\s*!important/s);
});
