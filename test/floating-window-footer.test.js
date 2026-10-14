import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { classicApp } from '../test-support/classic-module-loader.js';
const require = createRequire(path.join(classicApp, 'package.json'));
const postcss = require('postcss');

test('layered floating-window footer reserves the resize handle despite unlayered global padding', () => {
  const css = postcss.parse(fs.readFileSync(path.join(classicApp,'app/display-stability.css'),'utf8'));
  let reservation;
  css.walkRules(rule => {
    if (rule.selector === 'html body :is(#magi-home-display,#magi-reader-display) .magi-floating-window-footer') {
      rule.walkDecls('padding-right', decl => { reservation=decl; });
    }
  });
  assert(reservation, 'Every reader/home floating footer must reserve the shared resize control');
  assert.equal(reservation.value,'28px');
  assert.equal(reservation.important,true,'An ordinary layered declaration loses to globals.css padding shorthand');
});
