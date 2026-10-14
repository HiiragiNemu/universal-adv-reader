import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import { repositoryRoot } from '../test-support/helpers.js';

const app = path.join(repositoryRoot, 'apps/classic-reader');
const require = createRequire(path.join(app, 'package.json'));
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Real React component/server-render tests with an explicit theme context.
// These do not simulate browser paint, layout effects or human visual acceptance.
function sceneModules(theme) {
  const cache = new Map();
  const global = { theme, nightPhosphor: 'green', nameColorsEnabled: true,
    setNameColorsEnabled() {}, setNightPhosphor() {} };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    if (filename.endsWith('.css')) return {};
    const module = { exports: {} };
    cache.set(filename, module);
    const localRequire = spec => {
      if (spec === '@/app/providers') return { useGlobal: () => global, isNightTheme: value => ['dark', 'frost'].includes(value) };
      if (!spec.startsWith('@/') && !spec.startsWith('.')) return require(spec);
      const base = spec.startsWith('@/') ? path.join(app, spec.slice(2)) : path.resolve(path.dirname(filename), spec);
      const resolved = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`].find(x => fs.existsSync(x));
      assert.ok(resolved, `${filename} imports ${spec}`);
      return load(resolved);
    };
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    });
    const execute = vm.runInThisContext(`(function(require,module,exports){${compiled.outputText}\n})`, { filename });
    execute(localRequire, module, module.exports);
    return module.exports;
  }
  return file => load(path.join(app, file));
}

test('all five real optical surfaces and settings server-render without dropping source effects', () => {
  for (const theme of ['light', 'paper', 'green', 'dark', 'frost']) {
    const load = sceneModules(theme);
    const { ReaderFilmSurface, ReaderTubeSurface } = load('components/RetroDisplaySurface.tsx');
    const Settings = load('components/ReaderFontSettings.tsx').default;
    const html = renderToStaticMarkup(React.createElement('div', null,
      theme === 'frost' ? React.createElement(ReaderFilmSurface) : null,
      React.createElement(ReaderTubeSurface, { theme }), React.createElement(Settings, { theme })));
    assert.match(html, /data-display-readiness="owned"/);
    assert.match(html, /屏幕曲率模拟/);
    assert.match(html, /全局色彩偏移/);
    assert.match(html, /阅读刻度尺/);
    if (theme === 'frost') assert.match(html, /data-frost-glass="shared"/);
    if (theme === 'dark') { assert.match(html, /绿色荧光/); assert.match(html, /disabled=""/); }
    assert.match(html, /<filter\b/);
  }
});

test('both retained home implementations and the read/edit route mount shared readiness and optics', () => {
  for (const file of ['app/page.tsx', 'components/ClassicHome.tsx', 'app/reader/[id]/page.tsx']) {
    const text = fs.readFileSync(path.join(app, file), 'utf8');
    assert.equal((text.match(/<ReaderTubeSurface theme=\{theme\}/g) ?? []).length, 1, file);
    assert.equal((text.match(/<ReaderFilmSurface/g) ?? []).length, 1, file);
    assert.match(text, /<div className="magi-scene-content">/);
    assert.match(text, /<LoadingScreen\s*\/>/);
    assert.match(text, /id="magi-(home|reader)-display"/);
    assert.match(text, /<IOSHeaderSurface/);
  }
  const reader = fs.readFileSync(path.join(app, 'app/reader/[id]/page.tsx'), 'utf8');
  assert.match(reader, /data-reader-mode=\{isEditMode \? 'edit' : 'read'\}/);
  assert.match(reader, /buildLegacyVoiceSlots/);
  assert.match(reader, /sourceUrl=\{cue.url\}/);
  assert.match(reader, /<ReaderStyleScope\s*\/>/);
});

test('all literal pinned optical image and font dependencies exist in public', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'test-support/fixtures/optical/manifest.json'), 'utf8'));
  const assets = new Set();
  for (const entry of manifest.entries.filter(x => /\.(css|tsx?)$/.test(x.file))) {
    const text = fs.readFileSync(path.join(app, entry.file), 'utf8');
    for (const match of text.matchAll(/["'(](\/(?:textures|fonts)\/[^"'()\s?#]+)(?:[?#][^"'()\s]*)?["')]/g)) {
      assets.add(match[1]);
      assert.ok(fs.existsSync(path.join(app, 'public', match[1])), `${entry.file}: ${match[1]}`);
    }
  }
  assert.ok(assets.size >= 11);
});

test('startup gate preserves selected themes and waits for the complete optical scene', () => {
  const providers = fs.readFileSync(path.join(app, 'app/providers.tsx'), 'utf8');
  const readiness = fs.readFileSync(path.join(app, 'components/DisplayReadiness.tsx'), 'utf8');
  assert.match(providers, /opticalRoute && <DisplayStartupCover/);
  assert.match(providers, /document.documentElement.dataset.screenGlassDamage/);
  assert.match(readiness, /prepareDisplayAssets/);
  assert.match(readiness, /prepareDisplayFonts/);
  assert.match(readiness, /waitForFilmSurface/);
  assert.match(readiness, /root.inert = false/);
});
