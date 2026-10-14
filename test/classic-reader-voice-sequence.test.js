import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { classicApp, classicModules, ts } from '../test-support/classic-module-loader.js';

const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const url = '/corpus/archive/voice/n001.ogg';
const entry = (id, rowIndex = 1) => ({ cueId: `cue-${id}`, sourceUrl: url, eventId: `event-${id}`, rowIndex });
class FakeAudio {
  static instances = [];
  static behavior = () => Promise.resolve();
  constructor() { FakeAudio.instances.push(this); this.currentTime = 0; this.duration = 2; this.starts = []; }
  play() { this.starts.push(this.src); this.paused = false; return FakeAudio.behavior(this); }
  pause() { this.paused = true; }
  load() { this.loads = (this.loads ?? 0) + 1; }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
}
function setup(t) {
  const saved = { window: globalThis.window, Audio: globalThis.Audio };
  globalThis.window = {}; globalThis.Audio = FakeAudio;
  FakeAudio.instances = []; FakeAudio.behavior = () => Promise.resolve();
  const modules = classicModules();
  const filename = path.join(classicApp, 'lib/audio/voice-player.ts');
  const controller = modules.compile(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(filename).href)), filename).voicePlaybackController;
  t.after(() => { controller.stop(); for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  return controller;
}

test('completion waits for ended, not media startup, and releases the resource', async t => {
  const c = setup(t); let completed = false;
  const pending = c.playAndWait('cue-a', url).then(value => { completed = true; return value; });
  await tick(); assert.equal(c.getSnapshot().status, 'playing'); assert.equal(completed, false);
  const audio = FakeAudio.instances[0]; audio.onended();
  assert.equal(await pending, 'ended'); assert.equal(audio.paused, true); assert.equal(audio.src, '');
  assert.equal(c.getSnapshot().status, 'idle');
});
test('stop settles even a never-resolving play request and late resolution stays idle', async t => {
  const c = setup(t); let resolve;
  FakeAudio.behavior = () => new Promise(r => { resolve = r; });
  const pending = c.playAndWait('cue-a', url); c.stop();
  assert.equal(await pending, 'stopped'); resolve(); await tick(); assert.equal(c.getSnapshot().status, 'idle');
});
test('media error and stale early-ended startup never resurrect playing state', async t => {
  const c = setup(t); let resolve;
  FakeAudio.behavior = () => new Promise(r => { resolve = r; });
  const failed = c.playAndWait('cue-a', url); FakeAudio.instances[0].onerror();
  assert.equal(await failed, 'error'); resolve(); await tick(); assert.equal(c.getSnapshot().status, 'error');
  const ended = c.playAndWait('cue-b', url); FakeAudio.instances.at(-1).onended();
  assert.equal(await ended, 'ended'); resolve(); await tick(); assert.equal(c.getSnapshot().status, 'idle');
});
test('pause/resume retains native timeline; paused loading rejection is not an error', async t => {
  const c = setup(t); let reject;
  FakeAudio.behavior = () => new Promise((_, r) => { reject = r; });
  const done = c.playAndWait('cue-a', url); const audio = FakeAudio.instances[0];
  c.pause(); reject(new Error('paused before starting')); await tick(); assert.equal(c.getSnapshot().status, 'paused');
  FakeAudio.behavior = () => Promise.resolve(); audio.currentTime = 0.7;
  c.resume(); await tick(); assert.equal(c.getSnapshot().status, 'playing'); assert.equal(audio.currentTime, 0.7);
  audio.ontimeupdate(); assert.equal(c.getSnapshot().currentTime, 0.7); assert.equal(c.getSnapshot().duration, 2);
  audio.onended(); assert.equal(await done, 'ended');
});
test('sequence preserves order and identical URLs in distinct events and reuses one native element', async t => {
  const c = setup(t), observed = []; const plan = [entry('a'), entry('b', null), entry('c', 9)];
  const done = c.playSequence(plan, item => observed.push(item.eventId)); await tick();
  const audio = FakeAudio.instances[0];
  assert.deepEqual(observed, ['event-a']); assert.equal(c.getSnapshot().sequence.index, 0);
  audio.onended(); await tick(); assert.deepEqual(observed, ['event-a', 'event-b']);
  c.pause(); await tick(); assert.equal(c.getSnapshot().status, 'paused'); assert.equal(observed.length, 2);
  c.resume(); await tick(); audio.onended(); await tick(); assert.deepEqual(observed, ['event-a', 'event-b', 'event-c']);
  audio.onended(); assert.equal(await done, 'ended'); assert.equal(FakeAudio.instances.length, 1);
  assert.equal(audio.starts.length, 4); assert.equal(c.getSnapshot().sequence, null);
});
test('stopped sequence does not advance; replacing it cannot be stopped by an old async continuation', async t => {
  const c = setup(t), seen = []; const old = c.playSequence([entry('a'), entry('b')], x => seen.push(x.cueId));
  await tick(); const staleEnded = FakeAudio.instances[0].onended;
  const current = c.playAndWait('cue-new', url); assert.equal(await old, 'stopped');
  staleEnded(); await tick(); assert.equal(c.getSnapshot().cueId, 'cue-new'); assert.deepEqual(seen, ['cue-a']);
  FakeAudio.instances.at(-1).onended(); assert.equal(await current, 'ended');
});
test('sequence records unavailable resource and continues; retry creates a fresh load', async t => {
  const c = setup(t); const done = c.playSequence([entry('a'), entry('b')]); await tick();
  const audio = FakeAudio.instances[0]; audio.onerror(); await tick(); assert.equal(c.getSnapshot().cueId, 'cue-b');
  audio.onended(); assert.equal(await done, 'error'); assert.match(c.getSnapshot().error, /1/);
  const retry = c.playAndWait('cue-a', url); await tick(); FakeAudio.instances.at(-1).onended();
  assert.equal(await retry, 'ended'); assert.equal(c.getSnapshot().error, null);
});
test('aborting current request settles it without interfering with a later request', async t => {
  const c = setup(t), abort = new AbortController();
  const old = c.playAndWait('cue-a', url, abort.signal); abort.abort(); assert.equal(await old, 'stopped');
  const now = c.playAndWait('cue-b', url); await tick(); assert.equal(c.getSnapshot().cueId, 'cue-b');
  FakeAudio.instances.at(-1).onended(); assert.equal(await now, 'ended');
});
test('native controller never resolves a missing/invalid corpus URL through a Magia backend', async t => {
  const c = setup(t);
  for (const source of [undefined, 'https://exedra.wiki/voice.ogg', '/api/audio/magireco-voice/x', '/corpus/../secret.ogg']) {
    assert.equal(await c.playAndWait('vo_char_3031_00_01', source), 'error');
  }
  assert.equal(FakeAudio.instances.length, 0);
});

test('timeout settles a stalled session and an old rejection leaves its replacement untouched', async t => {
  const c = setup(t); const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  const timers = new Map(); let next = 0, reject;
  globalThis.setTimeout = fn => { timers.set(++next, fn); return next; };
  globalThis.clearTimeout = id => timers.delete(id);
  t.after(() => { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; });
  FakeAudio.behavior = () => new Promise((_, r) => { reject = r; });
  const old = c.playAndWait('cue-old', url); [...timers.values()][0](); assert.equal(await old, 'error');
  FakeAudio.behavior = () => Promise.resolve(); const now = c.playAndWait('cue-now', url); await tick();
  reject(new Error('late network response')); await tick(); assert.equal(c.getSnapshot().cueId, 'cue-now');
  assert.equal(c.getSnapshot().status, 'playing'); FakeAudio.instances.at(-1).onended(); assert.equal(await now, 'ended');
  assert.equal(timers.size, 0);
});

test('actual pagehide/visibility/mode cleanup and manual page/reveal handlers cancel without advancing', async t => {
  const c = setup(t), modules = classicModules(), win = new EventTarget(), doc = new EventTarget();
  doc.visibilityState = 'visible';
  const file = path.join(classicApp, 'app/reader/[id]/page.tsx'), source = fs.readFileSync(file, 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const effects = [];
  const visit = node => { if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect') effects.push(node); ts.forEachChild(node, visit); };
  visit(tree);
  const leave = effects.find(node => node.arguments[0].getText(tree).includes('stopForHiddenPage'));
  const context = effects.find(node => node.arguments[1]?.getText(tree) === '[id, mode, isEditMode, storyRowsPerPage, legacyVoiceRoute]');
  assert.ok(leave); assert.ok(context);
  const compileEffect = node => modules.compile(`export const run = ${node.arguments[0].getText(tree)};`, file, { window: win, document: doc, voicePlaybackController: c }).run;
  const cleanup = compileEffect(leave)();
  const seen = [];
  let pending = c.playSequence([entry('a'), entry('b')], item => seen.push(item.cueId)); await tick();
  doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')); assert.equal(await pending, 'stopped'); await tick(); assert.deepEqual(seen, ['cue-a']);
  pending = c.playSequence([entry('a'), entry('b')]); win.dispatchEvent(new Event('pagehide')); assert.equal(await pending, 'stopped');
  pending = c.playSequence([entry('a'), entry('b')]); cleanup(); assert.equal(await pending, 'stopped');
  pending = c.playSequence([entry('a'), entry('b')]); const contextCleanup = compileEffect(context)(); assert.equal(await pending, 'stopped');
  pending = c.playSequence([entry('a'), entry('b')]); contextCleanup(); assert.equal(await pending, 'stopped');
  const bindings = { useCallback: fn => fn, voicePlaybackController: c, visiblePage: 0, pageCount: 5, storyRowsPerPage: 200,
    pageTurnResetRef: { current: null }, window: { setTimeout: () => 1, clearTimeout() {} },
    setPageTurnDirection() {}, setPageTurnSequence() {}, setVisiblePage() {}, setPendingRowScroll() {} };
  const handlers = modules.fragments('app/reader/[id]/page.tsx', ['changeVisiblePage', 'revealRow'], bindings);
  for (const [handler, input] of [[handlers.changeVisiblePage, 1], [handlers.revealRow, 401]]) {
    pending = c.playSequence([entry('a'), entry('b')]); handler(input); assert.equal(await pending, 'stopped');
  }
});

test('reader subscription selects only the active row; clock ticks do not invalidate the full document', () => {
  const modules = classicModules(); let snapshot = { sequence: { rowIndex: 11 }, currentTime: 0 };
  const subscriptions = [];
  modules.fragments('app/reader/[id]/page.tsx', ['activeVoiceRow'], {
    voicePlaybackController: { subscribe() {}, getSnapshot: () => snapshot },
    useSyncExternalStore(_subscribe, getter) { subscriptions.push(getter); return getter(); },
  });
  const getter = subscriptions[0]; assert.equal(getter(), 11);
  snapshot = { ...snapshot, currentTime: 5 }; assert.equal(getter(), 11);
  snapshot = { ...snapshot, sequence: null }; assert.equal(getter(), -1);
});

test('all selected story plans match raw native variant/cue order, multiplicity and event-to-row mapping', () => {
  const modules = classicModules(), routing = modules.load('lib/legacy-vn-voice-routing.ts'), parser = modules.load('lib/story-parser.ts');
  assert.equal(typeof routing.buildLegacyVoiceSequence, 'function');
  const publicRoot = process.env.ADV_READER_PUBLIC_ROOT || path.join(classicApp, 'public');
  const publicFile = value => path.join(publicRoot, value.replace(/^\/+/, ''));
  const stories = JSON.parse(fs.readFileSync(publicFile('/story_index.json'), 'utf8')).filter(s=>s.source_format!=='supplemental-text/v1');
  const manifest = JSON.parse(fs.readFileSync(publicFile('/data/legacy-vn/manifests/reader-adapter.json'), 'utf8'));
  const expectedIds = manifest.stories.filter(item => item.resource.reader.decision === 'include').map(item => item.readerIdentity ?? item.canonicalStoryId);
  assert.deepEqual(stories.map(item => item.source_identity).sort(), expectedIds.sort());
  const totals = { 'zh-CN': 0, 'ja-JP': 0 }, expectedTotals = { 'zh-CN': 0, 'ja-JP': 0 };
  let detached = 0, expectedDetached = 0, repeated = 0;
  for (const story of stories) {
    const raw = JSON.parse(fs.readFileSync(publicFile(routing.legacyVoiceRoutePath(story.source_identity)), 'utf8'));
    const route = routing.parseLegacyVoiceRouteDocument(raw, story.source_identity);
    for (const [locale, textPath] of [['zh-CN', story.path_cn], ['ja-JP', story.path_jp]]) {
      const lines = textPath ? parser.parseStoryContent(fs.readFileSync(publicFile(textPath), 'utf8'), { filename: textPath.split('/').at(-1), mergeConsecutiveTextLines: false }).lines : [];
      const slots = routing.buildLegacyVoiceSlots(route, locale, lines);
      const variantId = locale === 'zh-CN' ? raw.chineseVariantId : raw.japaneseVariantId;
      const variant = raw.variantRoutes.find(v => v.variantId === variantId);
      assert.equal(Boolean(textPath), Boolean(variant), `${story.id}/${locale} source presence`);
      if (!variant) {
        assert.deepEqual(slots.eventSlots, []); assert.deepEqual(slots.displaySlots, []); assert.deepEqual(slots.detachedCues, []);
      }
      const expected = variant?.sections.flatMap(s => s.events.flatMap(e => (e.cues ?? []).filter(c => c.kind === 'voice').map(c => ({ cueId: c.cueId, eventId: e.eventId, mediaId: c.mediaId })))) ?? [];
      expectedTotals[locale] += expected.length;
      expectedDetached += variant?.sections.flatMap(s => s.events).filter(e => e.kind !== 'line' || e.textLineIndex?.[locale] === undefined).reduce((n, e) => n + (e.cues ?? []).filter(c => c.kind === 'voice').length, 0) ?? 0;
      for (const selected of [slots.eventSlots, slots.displaySlots]) {
        const plan = routing.buildLegacyVoiceSequence(route, locale, selected);
        assert.deepEqual(plan.map(({ cueId, eventId, mediaId }) => ({ cueId, eventId, mediaId })), expected, `${story.id}/${locale}`);
        for (const item of plan) {
          if (item.rowIndex !== null) assert.ok(selected[item.rowIndex].eventIds.includes(item.eventId));
          else assert.ok(slots.detachedCues.some(c => c.cueId === item.cueId && c.eventId === item.eventId));
        }
      }
      const plan = routing.buildLegacyVoiceSequence(route, locale, slots.displaySlots);
      totals[locale] += plan.length; detached += plan.filter(x => x.rowIndex === null).length;
      repeated += plan.length - new Set(plan.map(x => x.sourceUrl)).size;
    }
  }
  assert.deepEqual(totals, expectedTotals); assert.equal(detached, expectedDetached); assert.ok(repeated > 0);
});

test('actual transport JSX dispatches start/pause/resume/stop and reports timeline', () => {
  const modules = classicModules(); let state = { status: 'idle', sequence: null, currentTime: 0, duration: null, error: null };
  const calls = [];
  const controller = { subscribe() {}, getSnapshot() { return state; }, getServerSnapshot() { return state; }, pause() { calls.push('pause'); }, resume() { calls.push('resume'); }, stop() { calls.push('stop'); } };
  const file = 'components/voice/VoiceSequenceControls.tsx';
  const { VoiceSequenceControls } = modules.fragments(file, ['VoiceSequenceControls'], {
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(), voicePlaybackController: controller,
    Volume2: 'i', Square: 'i', Pause: 'i', Play: 'i', LoaderCircle: 'i',
  });
  const descendants = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(descendants) : [n, ...descendants(n.props?.children)];
  const render = () => descendants(VoiceSequenceControls({ onStart: () => calls.push('start'), count: 3, disabled: false, sourceLabel: '日文原作' }));
  render().find(n => n.type === 'button').props.onClick();
  state = { ...state, status: 'playing', currentTime: 1, duration: 2, sequence: { index: 1, total: 3, rowIndex: 5, eventId: 'mjo-269' } };
  let nodes = render(); nodes.find(n => n.props?.['aria-label'] === '暂停语音').props.onClick();
  state = { ...state, status: 'paused' }; nodes = render(); nodes.find(n => n.props?.['aria-label'] === '继续语音').props.onClick();
  nodes.find(n => n.props?.['aria-label'] === '停止顺序播放').props.onClick();
  assert.deepEqual(calls, ['start', 'pause', 'resume', 'stop']);
  assert.ok(nodes.some(n => n.props?.['data-voice-timeline'] === 'true'));
});

test('actual reader sequence handler uses selected native version and follows row/page, without zip/URL dedupe', () => {
  const modules = classicModules(); const plan = [entry('a', 421), entry('b', null)]; const calls = [];
  const bindings = { legacyVoiceSequence: plan, effectiveLegacyVoiceError: '', loading: false, legacyVoiceRouteLoading: false,
    storyRowsPerPage: 200, setVoicePanelExpanded: x => calls.push(['expanded', x]),
    setVisiblePage: x => calls.push(['page', x]), setPendingRowScroll: x => calls.push(['row', x]),
    voicePlaybackController: { playSequence(value, onEntry) { assert.equal(value, plan); value.forEach(onEntry); return Promise.resolve('ended'); } },
  };
  const { startLegacyVoiceSequence } = modules.fragments('app/reader/[id]/page.tsx', ['startLegacyVoiceSequence'], bindings);
  startLegacyVoiceSequence(); assert.deepEqual(calls, [['expanded', true], ['page', 2], ['row', { rowIndex: 421, highlight: false }]]);
  const source = fs.readFileSync(path.join(classicApp, 'app/reader/[id]/page.tsx'), 'utf8');
  assert.match(source, /<VoiceSequenceControls[\s\S]*?onStart=\{startLegacyVoiceSequence\}/);
  assert.match(source, /\[id, mode, isEditMode, storyRowsPerPage, legacyVoiceRoute\]/);
});
