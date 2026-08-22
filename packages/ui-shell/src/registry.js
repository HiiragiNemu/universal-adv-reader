export const UI_SHELL_API_VERSION = 'ui-shell/1.0.0';

const SHELL_ID = /^[a-z][a-z0-9-]{0,63}$/u;
const SHELL_STATUSES = new Set(['stable', 'experimental']);

export class UiShellRegistryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UiShellRegistryError';
  }
}

const validateShell = (shell) => {
  if (!shell || typeof shell !== 'object') throw new UiShellRegistryError('shell contract is missing');
  if (!SHELL_ID.test(shell.id ?? '')) throw new UiShellRegistryError('shell id is invalid');
  if (shell.apiVersion !== UI_SHELL_API_VERSION) {
    throw new UiShellRegistryError(`shell ${shell.id} uses an incompatible API version`);
  }
  if (!SHELL_STATUSES.has(shell.status)) {
    throw new UiShellRegistryError(`shell ${shell.id} has an invalid status`);
  }
  if (typeof shell.label !== 'string' || shell.label.length === 0) {
    throw new UiShellRegistryError(`shell ${shell.id} is missing a label`);
  }
  if (typeof shell.activate !== 'function') {
    throw new UiShellRegistryError(`shell ${shell.id} is missing activate()`);
  }
  return shell;
};

export class UiShellRegistry {
  #shells = new Map();
  #active = null;
  #disposeActive = null;

  register(shell) {
    validateShell(shell);
    if (this.#shells.has(shell.id)) {
      throw new UiShellRegistryError(`shell ${shell.id} is already registered`);
    }
    const record = Object.freeze({ ...shell });
    this.#shells.set(record.id, record);
    return () => {
      if (this.#active?.id === record.id) throw new UiShellRegistryError('active shell cannot be removed');
      this.#shells.delete(record.id);
    };
  }

  get(shellId) {
    return this.#shells.get(shellId) ?? null;
  }

  list() {
    return [...this.#shells.values()];
  }

  get active() {
    return this.#active;
  }

  activate(shellId, context) {
    const shell = this.get(shellId);
    if (!shell) throw new UiShellRegistryError(`shell ${shellId} is not registered`);
    if (this.#active?.id === shell.id) return shell;
    this.#disposeActive?.();
    this.#disposeActive = null;
    const dispose = shell.activate(context);
    if (dispose !== undefined && typeof dispose !== 'function') {
      throw new UiShellRegistryError(`shell ${shell.id} activate() returned an invalid disposer`);
    }
    this.#active = shell;
    this.#disposeActive = dispose ?? null;
    return shell;
  }

  dispose() {
    this.#disposeActive?.();
    this.#disposeActive = null;
    this.#active = null;
  }
}
