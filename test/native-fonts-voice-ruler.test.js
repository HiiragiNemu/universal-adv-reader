import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {classicApp, classicModules} from '../test-support/classic-module-loader.js';

test('unvoiced placeholder uses a compact non-interactive height', () => {
  const page=fs.readFileSync(path.join(classicApp,'app/reader/[id]/page.tsx'),'utf8');
  const classes=page.match(/magi-reader-voice-unavailable[^`]+/)[0];
  assert.doesNotMatch(classes,/min-h-11|py-2/);
  assert.match(classes,/h-6/);
  assert.match(classes,/items-center/);
});

test('ruler uses actual responsive layout and retains original CN top / JP bottom design', () => {
  const component=fs.readFileSync(path.join(classicApp,'components/ReaderFilmViewport.tsx'),'utf8');
  assert.match(component,/getComputedStyle\(pair\)\.flexDirection === 'column'/);
  assert.doesNotMatch(component,/rails\[1\]\.left < rails\[0\]\.left/);
  assert.match(component,/state\.stacked \? \[rail\.language === 'cn' \? 'top' : 'bottom'\]/);
  assert.doesNotMatch(component,/data-ruler-track/);
  assert.match(component,/data-native-font-chinese.*data-native-font-japanese/);
});
test('native font profiles follow proven game identity, not the inherited Magireco bundle', () => {
  const {nativeFontProfile}=classicModules().load('lib/native-game-fonts.ts');
  assert.equal(nativeFontProfile('kana-okaeri/ev22'),'kana');
  assert.equal(nativeFontProfile('narcissu-3rd/nar3_01'),'narcissu-3rd');
  for(const work of ['himeko','iris','one-two','sumire','zero'])assert.equal(nativeFontProfile(`narcissu-${work}/test`),'narcissu-10th');
  assert.equal(nativeFontProfile('narcissu-texts/novel'),'system');
  assert.equal(nativeFontProfile(''),'system');
});

test('font settings disclose local availability and never offer inherited font downloads', () => {
  const settings=fs.readFileSync(path.join(classicApp,'components/ReaderFontSettings.tsx'),'utf8');
  assert.match(settings,/原作字体/);
  assert.match(settings,/本机/);
  assert.doesNotMatch(settings,/按需下载|下载并启用/);
  const runtime=fs.readFileSync(path.join(classicApp,'lib/reader-fonts.ts'),'utf8');
  assert.doesNotMatch(runtime,/\/fonts\/magi-|new FontFace|fetch\(/);
});
