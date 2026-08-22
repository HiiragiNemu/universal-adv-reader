import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { classicShell } from '../apps/web/shells/classic.js';
import { nextShell } from '../apps/web/shells/next.js';
import { UiShellRegistry } from '../packages/ui-shell/src/registry.js';
import { repositoryRoot } from '../test-support/helpers.js';

test('classic remains default while next stays behind manual acceptance', async () => {
  const registry = new UiShellRegistry();
  registry.register(classicShell);
  registry.register(nextShell);
  const document = { documentElement: { dataset: {} } };

  registry.activate('classic', { document });
  assert.equal(document.documentElement.dataset.uiShell, 'classic');
  registry.activate('next', { document });
  assert.equal(document.documentElement.dataset.uiShell, 'next');
  assert.equal(registry.active.requiresManualAcceptance, true);

  const manifest = JSON.parse(await readFile(path.join(
    repositoryRoot,
    'apps',
    'web',
    '.well-known',
    'ui-shells.json',
  ), 'utf8'));
  assert.equal(manifest.defaultShellId, 'classic');
  assert.equal(manifest.contract, 'ui-shell/1.0.0');
  assert.equal(manifest.migration.promotionPolicy, 'manual-acceptance-only');
  assert.equal(manifest.migration.persistent, false);
  assert.equal(manifest.migration.autoPromotion, false);
  assert.deepEqual(manifest.slots, [
    'shell',
    'navigation',
    'catalog',
    'reader',
    'sidebar-tree',
    'floating-tools',
    'pager',
    'media',
  ]);
  assert.deepEqual(
    Object.fromEntries(manifest.themes.map((theme) => [theme.id, theme.status])),
    {
      yellow: 'accepted',
      'eye-care': 'accepted',
      white: 'accepted',
      night: 'pending',
      'cold-frost': 'pending',
    },
  );
  assert.equal(manifest.shells.find((shell) => shell.id === 'next').architectureTaskId,
    '01a029af-2c48-76f0-ba83-6070ac3f6618');
  registry.dispose();
});
