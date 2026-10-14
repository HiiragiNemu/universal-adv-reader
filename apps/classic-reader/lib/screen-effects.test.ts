import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveScreenEffects, parseScreenEffects } from './screen-effects.ts';
test('night defaults preserve optics and the existing phosphor-specific pixel choice', () => {
  assert.deepEqual(resolveScreenEffects(null, 'dark', false), { curvature: true, scanlines: true, noise: true, pixelFont: false, balloons: false, registration: true, glassDamage: false });
  assert.equal(resolveScreenEffects(null, 'dark', true).pixelFont, true);
  assert.equal(resolveScreenEffects('{"dark":{"pixelFont":true}}', 'dark', false).pixelFont, false);
  assert.equal(resolveScreenEffects('{"dark":{"pixelFont":false}}', 'dark', true).pixelFont, true);
});
test('other themes opt in independently without enabling another theme', () => {
  for (const theme of ['light', 'paper', 'green', 'frost']) {
    assert.deepEqual(resolveScreenEffects(null, theme, true), { curvature: false, scanlines: false, noise: false, pixelFont: false, balloons: false, registration: true, glassDamage: false });
    const s = JSON.stringify({ [theme]: { curvature: true, scanlines: true, noise: true, pixelFont: true, balloons: true, registration: true } });
    const enabled = resolveScreenEffects(s, theme, false); assert.equal(enabled.registration, true); assert.ok(enabled.curvature && enabled.scanlines && enabled.noise && enabled.pixelFont); assert.equal(enabled.balloons, false);
    assert.equal(resolveScreenEffects(s, theme === 'light' ? 'paper' : 'light', true).curvature, false);
  }
});
test('corrupt settings and unknown fields do not activate effects', () => {
  assert.deepEqual(parseScreenEffects('{broken'), {});
  assert.deepEqual(parseScreenEffects('{"light":{"curvature":"yes","noise":false,"unknown":true}}'), { light: { noise: false } });
});

test('night optics stay on even when an older global switch saved false', () => {
  const effects = resolveScreenEffects('{"dark":{"curvature":false,"scanlines":false,"noise":false}}', 'dark', false);
  assert.equal(effects.curvature, true);
  assert.equal(effects.scanlines, true);
  assert.equal(effects.noise, true);
  assert.equal(effects.pixelFont, false);
});

test('retired balloons remain off across themes despite current or legacy opt-in', () => {
  for (const theme of ['light', 'paper', 'green', 'dark', 'frost']) {
    assert.equal(resolveScreenEffects('{"green":{"balloons":true}}', theme, false).balloons, false);
    assert.equal(resolveScreenEffects('{"global":{"balloons":true}}', theme, false).balloons, false);
    assert.equal(resolveScreenEffects('{"global":{"balloons":false},"green":{"balloons":true}}', theme, false).balloons, false);
  }
  assert.deepEqual(parseScreenEffects('{"global":{"balloons":true,"curvature":true}}'), {global:{balloons:true}});
});


test('day registration defaults on across platforms but an explicit off always wins', () => {
  for (const ios of [false, true]) for (const theme of ['light', 'paper', 'green']) {
    assert.equal(resolveScreenEffects(null, theme, false, ios).registration, true);
    assert.equal(resolveScreenEffects(JSON.stringify({ [theme]: { registration: false } }), theme, false, ios).registration, false);
    assert.equal(resolveScreenEffects(JSON.stringify({ [theme]: { registration: true } }), theme, false, ios).registration, true);
  }
});
test('frost registration can be enabled and disabled independently', () => {
  for (const ios of [false, true]) {
    assert.equal(resolveScreenEffects(null, 'frost', false, ios).registration, true);
    for (const registration of [false, true]) assert.equal(resolveScreenEffects(JSON.stringify({ frost: { registration } }), 'frost', false, ios).registration, registration);
  }
});
