import { UI_SHELL_API_VERSION } from '../../../packages/ui-shell/src/registry.js';

export const nextShell = Object.freeze({
  id: 'next',
  apiVersion: UI_SHELL_API_VERSION,
  label: '迁移候选',
  status: 'experimental',
  runtime: 'react-contract-first',
  requiresManualAcceptance: true,
  persistent: false,
  inputPolicy: 'read-only',
  commandPolicy: 'append-only',
  slots: Object.freeze([
    'shell',
    'navigation',
    'catalog',
    'reader',
    'sidebar-tree',
    'floating-tools',
    'pager',
    'media',
  ]),
  lineage: Object.freeze({
    researchTaskId: '01a02998-e9b8-78f0-b9ed-bac62839a31b',
    architectureTaskId: '01a029af-2c48-76f0-ba83-6070ac3f6618',
    promotion: 'manual-acceptance-only',
  }),
  activate({ document }) {
    document.documentElement.dataset.uiShell = 'next';
    return () => {
      if (document.documentElement.dataset.uiShell === 'next') {
        delete document.documentElement.dataset.uiShell;
      }
    };
  },
});
