import assert from 'node:assert/strict';
import test from 'node:test';
import { applyKanaChineseContentCorrections } from '../tools/lib/kana-content-corrections.mjs';

const original = () => ({
  scriptId: 'EV49B',
  textAlignments: [{
    instructionIndex: 1176, opcode: 0x2B, kind: 'message',
    jaOffset: 14236, zhOffset: 15258,
    jaText: '　以前に約束したことだった。', zhText: '　',
  }],
});

test('KANA omission fix is copied, source-bound, auditable, and idempotent', () => {
  const source = original();
  const result = applyKanaChineseContentCorrections(source);
  assert.equal(source.textAlignments[0].zhText, '　');
  assert.equal(result.route.textAlignments[0].zhText, '　这是之前约定好的事。');
  assert.equal(result.appliedCorrections[0].originalText, '　');
  assert.equal(result.appliedCorrections[0].evidence.chineseMemberSha256.length, 64);
  assert.equal(applyKanaChineseContentCorrections(result.route).appliedCorrections.length, 0);
});

test('KANA omission fix refuses to replace a changed source or an existing translation', () => {
  const changed = original();
  changed.textAlignments[0].zhText = '已有人工校译';
  assert.throws(() => applyKanaChineseContentCorrections(changed), /source changed/u);
  const shifted = original();
  shifted.textAlignments[0].jaOffset += 1;
  assert.throws(() => applyKanaChineseContentCorrections(shifted), /source changed/u);
});
