import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { classicApp, classicModules } from '../test-support/classic-module-loader.js';

const widths = classicModules().load('lib/sidebar-width.ts');

test('home sidebar defaults to space for complete work names', () => {
  assert.equal(widths.HOME_SIDEBAR_WIDTH_DEFAULT, 320);
  for (const raw of [null, '', ' ', 'invalid', 'NaN']) {
    assert.equal(widths.parseStoredHomeSidebarWidth(raw), 320, String(raw));
  }
});

test('home sidebar preserves explicit widths and reader sidebar preferences', () => {
  for (const value of [208, 256, 320, 480]) {
    assert.equal(widths.parseStoredHomeSidebarWidth(String(value)), value);
  }
  assert.equal(widths.clampHomeSidebarWidth(0), 208);
  assert.equal(widths.clampHomeSidebarWidth(1000), 480);
  assert.equal(widths.HOME_SIDEBAR_WIDTH_STEP, 16);
  assert.equal(widths.SIDEBAR_WIDTH_DEFAULT, 288);
});

test('CSS fallback follows the new default without changing mobile layout', () => {
  const css = fs.readFileSync(path.join(classicApp, 'app/globals.css'), 'utf8');
  const fallbacks = [...css.matchAll(/var\(--magi-home-sidebar-width,\s*([^)]*)\)/g)];
  assert.equal(fallbacks.length, 5);
  assert.ok(fallbacks.every(match => match[1] === '20rem'));
});

test('frost desktop titles use available column width rather than a fixed cap', () => {
  const css = fs.readFileSync(path.join(classicApp, 'app/accepted-baseline-increments.css'), 'utf8');
  const block = css.slice(css.indexOf('/* Keep the category socket'));
  assert.match(block, /@media\s*\(min-width:\s*768px\)/);
  assert.match(block, /magi-home-frost-root\.magi-home-dark-root\s+\.magi-home-category-nav\s*>\s*\.magi-home-category-node\s*\{\s*width:\s*100% !important;\s*grid-template-columns:\s*minmax\(0, 1fr\) 1rem !important;/);
  assert.match(block, /magi-home-frost-root\.magi-home-dark-root\s+\.magi-home-category-nav \.magi-home-category-trigger\s*\{\s*width:\s*100% !important;/);
});
