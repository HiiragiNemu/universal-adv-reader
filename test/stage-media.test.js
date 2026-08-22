import assert from 'node:assert/strict';
import test from 'node:test';

import { stageImageCueForEvents } from '../packages/core/src/stage-media.js';

test('stage media preserves a routed scene image across transition-rule cues', () => {
  const events = [{
    cues: [
      { cueId: 'scene', kind: 'image', raw: { presentationRole: 'scene' } },
      { cueId: 'rule', kind: 'image', raw: { presentationRole: 'transition' } },
    ],
  }];
  assert.equal(stageImageCueForEvents(events, 0).cueId, 'scene');
});

test('stage media falls back to the latest image when only transition cues exist', () => {
  const events = [{ cues: [
    { cueId: 'rule-a', kind: 'image', raw: { presentationRole: 'transition' } },
    { cueId: 'rule-b', kind: 'image', raw: { presentationRole: 'transition' } },
  ] }];
  assert.equal(stageImageCueForEvents(events, 0).cueId, 'rule-b');
});
