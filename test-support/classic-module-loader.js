import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { repositoryRoot } from './helpers.js';

export const classicApp = path.join(repositoryRoot, 'apps/classic-reader');
const require = createRequire(path.join(classicApp, 'package.json'));
export const React = require('react');
export const renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
export const ts = require('typescript');

// Run the checked-out TS/TSX, not a duplicate implementation. CSS and provider
// context are explicit SSR fixtures; this harness does not claim browser layout.
export function classicModules(theme = 'frost') {
  const cache = new Map();
  function compile(code, filename, bindings = {}) {
    const module = { exports: {} };
    const localRequire = spec => {
      if (spec === '@/app/providers') return {
        useGlobal: () => ({ theme, nameColorsEnabled: true, nightPhosphor: 'green' }),
        isNightTheme: value => ['dark', 'frost'].includes(value),
      };
      if (!spec.startsWith('@/') && !spec.startsWith('.')) return require(spec);
      const base = spec.startsWith('@/') ? path.join(classicApp, spec.slice(2)) : path.resolve(path.dirname(filename), spec);
      const resolved = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`].find(file => fs.existsSync(file));
      assert.ok(resolved, `${filename} imports ${spec}`);
      return load(resolved);
    };
    const output = ts.transpileModule(code, { fileName: filename, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } });
    const run = vm.runInThisContext(`(function(require,module,exports,${Object.keys(bindings).join(',')}){${output.outputText}\n})`, { filename });
    run(localRequire, module, module.exports, ...Object.values(bindings));
    return module.exports;
  }
  function load(file) {
    const filename = path.isAbsolute(file) ? file : path.join(classicApp, file);
    if (filename.endsWith('.json')) return JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (filename.endsWith('.css')) return {};
    if (cache.has(filename)) return cache.get(filename);
    const exports = compile(fs.readFileSync(filename, 'utf8'), filename);
    cache.set(filename, exports);
    return exports;
  }
  function fragments(file, names, bindings = {}) {
    const filename = path.join(classicApp, file), code = fs.readFileSync(filename, 'utf8');
    const tree = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const found = new Map();
    function visit(node) {
      if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name && names.includes(node.name.getText(tree))) {
        const name = node.name.getText(tree);
        assert.ok(!found.has(name), `nonunique fragment ${name}`);
        found.set(name, ts.isVariableDeclaration(node) ? `const ${node.getText(tree)};` : node.getText(tree));
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
    for (const name of names) assert.ok(found.has(name), `missing real fragment ${name}`);
    return compile([...names.map(name => found.get(name)), `export { ${names.join(', ')} };`].join('\n'), filename, { ...load('lib/source-progress-metrics.ts'), ...bindings });
  }
  return { load, compile, fragments };
}

export function readerRowFragments(theme = 'frost') {
  const modules = classicModules(theme);
  const text = modules.load('components/StoryText.tsx');
  const dictionary = modules.load('app/config/dictionary.ts');
  const layout = modules.load('lib/bilingual-layout.ts');
  const titles = modules.load('lib/official-tw-titles.ts');
  const names = ['countLineBreaks', 'translatedSpeaker', 'lineTextAlignClass', 'lineKindClass', 'speakerColor',
    'SourceStatistics', 'SpeakerLabel', 'StoryRow'];
  return modules.fragments('app/reader/[id]/page.tsx', names, {
    NativeCorrespondenceReview: modules.load('components/NativeCorrespondenceReview.tsx').default,
    StoryText: text.default, LineBreakMarkerText: text.LineBreakMarkerText,
    ...dictionary, ...layout, ...titles, ...modules.load('lib/native-section-anchors.ts'),
    isNightTheme: value => ['dark', 'frost'].includes(value),
    useGlobal: () => ({ nameColorsEnabled: true }),
    // Voice behavior has its own real routing/player tests. No voice control is
    // mounted in these text-only fixtures; fail rather than silently fake one.
    VoicePlayButton: () => { throw Error('Unexpected voice mount in text fixture'); },
  });
}

export const rowProps = {
  index: 2, editIndex: 0, mode: 'split', bilingualLayout: 'side-by-side', showLineBreaks: true,
  theme: 'frost', isExedra: false, voicePanelExpanded: false, voiceRouteError: '', voiceSlot: null,
  isFirstStoryHeader: false, isEditMode: false, editedLines: [], setEditedLines() {},
  query: '', normalizedQuery: '', focused: false, onChoice() {},
};
