import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { classicModules, classicApp, React, renderToStaticMarkup, rowProps } from '../test-support/classic-module-loader.js';
import { parseMarkup, query, scopedDeclarations } from '../test-support/css-dom-contract.js';
const pin = '56309ca742130e36d8d10fdb4f72de2a04cda02a';
const cssFile = path.join(classicApp, 'app/reader/reader-stacked-alignment.css');
const nativeFile = path.join(classicApp, 'app/reader/native-stacked-alignment.css');
const page = fs.readFileSync(path.join(classicApp, 'app/reader/[id]/page.tsx'), 'utf8');
const require = createRequire(classicApp + '/package.json');
const source = file => {
  return fs.readFileSync(path.join(classicApp, '../../test-support/fixtures/upstream', file));
};
function components(theme, status = 'idle') {
  const modules = classicModules(theme), text = modules.load('components/StoryText.tsx');
  const snapshot = { status, cueId: 'native-cue', sourceUrl: '/corpus/voice/native.ogg', error: status === 'error' ? '原作音频读取失败' : null };
  const { VoicePlayButton } = modules.fragments('components/voice/VoicePlayButton.tsx', ['VoicePlayButton'], {
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    voicePlaybackController: { subscribe() {}, getSnapshot: () => snapshot, getServerSnapshot: () => snapshot, toggle() {} },
    isLegacyVnVoiceUrl: value => typeof value === 'string' && value.startsWith('/corpus/'),
    LoaderCircle: 'svg', Square: 'svg', Volume2: 'svg',
  });
  return modules.fragments('app/reader/[id]/page.tsx', ['countLineBreaks','translatedSpeaker','lineTextAlignClass','lineKindClass','speakerColor','SourceStatistics','SpeakerLabel','StoryRow'], {
    StoryText: text.default, LineBreakMarkerText: text.LineBreakMarkerText,
    ...modules.load('app/config/dictionary.ts'), ...modules.load('lib/bilingual-layout.ts'), ...modules.load('lib/official-tw-titles.ts'),
    isNightTheme: value => ['dark','frost'].includes(value), useGlobal: () => ({ nameColorsEnabled: true }), VoicePlayButton,
  });
}
function markup(StoryRow, props) {
  return parseMarkup(renderToStaticMarkup(React.createElement('html', null, React.createElement('body', null,
    React.createElement('main', { id: 'magi-reader-display' }, React.createElement(StoryRow, props))))));
}
const propsFor = (theme, mode, layout, editing, voice, missing = null) => ({ ...rowProps, theme, mode, bilingualLayout: layout,
  row: { cn: missing === 'cn' ? undefined : { speaker: '很长很长很长的中文角色姓名', text: '中文第一行\n第二行' },
    jp: missing === 'jp' ? undefined : { speaker: 'とても長い日本語の登場人物名', text: '日本語第一行\n第二行' } },
  isEditMode: editing, editedLines: [{ speaker: '', text: '编辑第一行\n第二行' }], nativeSpeakerEditable: true,
  voicePanelExpanded: voice !== 'hidden', voiceRouteError: voice === 'error' ? '路由读取失败' : '',
  voiceSlot: voice === 'resolved' ? { eventIds: ['native-event'], cues: [{ cueId: 'native-cue', url: '/corpus/voice/native.ogg', sourceKey: 'native-source' }] } : null,
});

test('actual reader imports byte-exact pinned stacked stylesheet and scoped native adapter, not prohibited night-ink CSS', () => {
  assert.ok(fs.readFileSync(cssFile).equals(source('app/reader/reader-stacked-alignment.css')));
  assert.match(page, /import '@\/app\/reader\/reader-stacked-alignment\.css';/);
  assert.match(page, /import '@\/app\/reader\/native-stacked-alignment\.css';/);
  assert.doesNotMatch(page, /import\s+['"][^'"]*night-ink-controls/);
  for (const filename of [cssFile, nativeFile]) require('lightningcss').transform({ filename, code: fs.readFileSync(filename), minify: true });
});

test('actual StoryRow and VoicePlayButton DOM match voice/name/text columns across 480 theme-mode-edit-voice-layout cases', () => {
  const declarations = scopedDeclarations(fs.readFileSync(cssFile,'utf8') + '\n' + fs.readFileSync(nativeFile,'utf8'));
  let cases = 0, paneChecks = 0;
  for (const theme of ['light','paper','green','dark','frost']) {
    const { StoryRow } = components(theme);
    for (const mode of ['cn','jp','split']) for (const editing of [false,true]) for (const voice of ['hidden','resolved','unresolved','error'])
      for (const [layout,width] of [['stacked',390],['stacked',1280],['side-by-side',390],['side-by-side',1280]]) {
        const dom = markup(StoryRow, propsFor(theme,mode,layout,editing,voice));
        const panes = query(dom, '.magi-bilingual-pair > [lang]');
        assert.equal(panes.length, mode === 'split' ? 2 : 1);
        for (const pane of panes) {
          const css = declarations(pane,width), grid = width < 768 || mode === 'split' && layout === 'stacked';
          assert.equal(css.display === 'grid',grid, 'preserve pinned single-language/desktop and side-by-side eligibility');
          if (grid) assert.equal(css['grid-template-columns'], '24px minmax(0,calc(5.25em - 24px)) minmax(0,1fr)');
          const name = pane.children.find(n => /magi-reader-speaker-label|magi-translation-speaker-input/.test(n.attrs.class ?? ''));
          const text = pane.children.find(n => Object.hasOwn(n.attrs,'data-reader-text-cell'));
          assert.ok(name); assert.ok(text); assert.equal(declarations(name,width)['grid-column'],'2'); assert.equal(declarations(text,width)['grid-column'],'3');
          if (name.tag === 'input') assert.equal(name.attrs.value,'','intentional empty name');
          for (const slot of pane.children.filter(n => n.attrs['data-voice-slot'] === 'true')) {
            assert.equal(declarations(slot,width)['grid-column'],'1'); assert.equal(declarations(slot,width)['grid-row'],'1');
            const controls = query(slot,'.magi-reader-voice-button');
            assert.equal(controls.length,voice === 'resolved' ? 1 : 0);
            for (const control of controls) {
              assert.match(control.attrs['aria-label'],/native-cue/);
              if (grid) { assert.equal(declarations(control,width).width,'24px'); assert.equal(declarations(control,width).height,'24px'); }
            }
            for (const label of query(slot,'[data-voice-unavailable-label]')) if (grid) assert.equal(declarations(label,width).display,'none');
          }
          paneChecks++;
        }
        assert.equal(query(dom,'[data-voice-slot]').length,voice === 'hidden' ? 0 : 1);
        cases++;
      }
  }
  assert.equal(cases,480); assert.equal(paneChecks,640);
});

test('native missing-language placeholders occupy the same text column, with no fabricated name or voice', () => {
  const declarations = scopedDeclarations(fs.readFileSync(cssFile,'utf8') + '\n' + fs.readFileSync(nativeFile,'utf8'));
  const { StoryRow } = components('frost');
  for (const missing of ['cn','jp']) for (const voice of ['hidden','unresolved']) for (const width of [390,1280]) {
    const dom = markup(StoryRow,propsFor('frost','split','stacked',false,voice,missing));
    const placeholder = query(dom,`[data-reader-text-cell="${missing}-empty"]`); assert.equal(placeholder.length,1);
    assert.equal(declarations(placeholder[0],width)['grid-column'],'3');
    assert.equal(placeholder[0].parent.children.filter(n=>(n.attrs.class??'').includes('magi-reader-speaker-label')).length,0);
  }
});

test('actual native voice button retains loading/playing/error accessibility and compact selector while source URL routing stays native', () => {
  for (const status of ['idle','loading','playing','paused','error']) {
    const { StoryRow } = components('frost',status), dom = markup(StoryRow,propsFor('frost','split','stacked',false,'resolved'));
    const buttons = query(dom,'.magi-reader-voice-button'); assert.equal(buttons.length,1);
    assert.match(buttons[0].attrs['aria-label'],status === 'loading' ? /停止加载/ : ['playing','paused'].includes(status) ? /停止语音/ : /播放/);
    assert.equal(buttons[0].attrs['aria-pressed'],String(['playing','paused'].includes(status)));
    assert.equal(query(dom,'[role="status"]').length,status === 'error' ? 1 : 0);
  }
});
