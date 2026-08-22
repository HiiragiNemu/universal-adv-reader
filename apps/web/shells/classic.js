import { UI_SHELL_API_VERSION } from '../../../packages/ui-shell/src/registry.js';

export const classicShell = Object.freeze({
  id: 'classic',
  apiVersion: UI_SHELL_API_VERSION,
  label: '继承版',
  status: 'stable',
  runtime: 'inherited-classic',
  lineage: Object.freeze({
    sourceTaskId: '01a0256c-1bae-76a2-a328-d4db01f1fde4',
    policy: 'read-only-architecture-reference',
  }),
  activate({ document }) {
    document.documentElement.dataset.uiShell = 'classic';
    return () => {
      if (document.documentElement.dataset.uiShell === 'classic') {
        delete document.documentElement.dataset.uiShell;
      }
    };
  },
});
