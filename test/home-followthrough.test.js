import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const page = await fs.readFile(new URL('../apps/classic-reader/app/page.tsx', import.meta.url), 'utf8');

test('mobile source filters start collapsed and keep their explicit toggle', () => {
  assert.match(page, /mobileSourceRailOpen = false/);
  assert.match(page, /\[mobileSourceRailOpen, setMobileSourceRailOpen\] = useState\(false\)/);
  assert.match(page, /onClick=\{\(\) => setMobileSourceRailOpen\(open => !open\)\}/);
});

test('local import and revision links live in the collapsible review panel, not the toolbar', () => {
  const panel = page.indexOf('id={machineReviewPanelContentId}');
  const tail = page.indexOf('<div className="magi-home-review-tail-actions">', panel);
  const local = page.indexOf('<LocalStoryPicker theme={theme} />');
  const revisions = page.indexOf('data-generic-revisions-link');
  const panelEnd = page.indexOf('</section>', tail);
  assert(panel > 0 && tail > panel);
  assert(local > tail && local < panelEnd);
  assert(revisions > tail && revisions < panelEnd);
  assert.equal(page.match(/<LocalStoryPicker /g)?.length, 1);
  assert.equal(page.match(/data-generic-revisions-link/g)?.length, 1);
  assert.match(page.slice(panel, tail), /hidden=\{machineReviewPanelCollapsed\}/);
});

test('desktop category rail has a matching fixed width and a reserved socket corridor', async () => {
  assert.match(page, /const menuWidth = Math\.min\(56, Math\.max\(1, viewportWidth - rightInset\)\)/);
  assert.doesNotMatch(page, /widestTriggerRight|minimumMenuWidth|latestMenuLeft/);
  const css = await fs.readFile(new URL('../apps/classic-reader/app/accepted-baseline-increments.css', import.meta.url), 'utf8');
  assert.match(css, /magi-home-category-nav > \.magi-home-category-node\s*\{\s*max-width: calc\(100% - 80px\) !important/);
  assert.match(css, /magi-home-category-trigger\s*\{\s*flex: 0 1 auto !important;\s*max-width: calc\(100% - 20px\) !important/);
});
