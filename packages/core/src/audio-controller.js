const IDLE = Object.freeze({ status: 'idle', cueId: null, error: null });

export class BrowserAudioBackend {
  #audio;
  #ended = () => {};
  #failed = () => {};

  constructor(url) {
    this.#audio = new Audio(url);
    this.#audio.preload = 'none';
    this.#audio.addEventListener('ended', () => this.#ended(), { once: true });
    this.#audio.addEventListener('error', () => this.#failed(new Error('browser audio failed')), {
      once: true,
    });
  }

  onEnded(callback) {
    this.#ended = callback;
  }

  onError(callback) {
    this.#failed = callback;
  }

  async play() {
    await this.#audio.play();
  }

  stop() {
    this.#audio.pause();
    this.#audio.removeAttribute('src');
    this.#audio.load();
  }
}

export class AudioController {
  #state = IDLE;
  #listeners = new Set();
  #backend = null;
  #backendFactory;
  #disposed = false;

  constructor({ backendFactory = (url) => new BrowserAudioBackend(url) } = {}) {
    this.#backendFactory = backendFactory;
  }

  #setState(next) {
    this.#state = Object.freeze(next);
    for (const listener of [...this.#listeners]) listener(this.#state);
  }

  subscribe(listener) {
    if (this.#disposed) return () => {};
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getSnapshot() {
    return this.#state;
  }

  async toggle(cue, resolution) {
    if (this.#disposed) return;
    if (this.#state.cueId === cue.cueId && ['loading', 'playing'].includes(this.#state.status)) {
      this.stop();
      return;
    }
    await this.play(cue, resolution);
  }

  async play(cue, resolution) {
    if (this.#disposed) return;
    this.stop();
    if (!resolution || resolution.status !== 'resolved') {
      this.#setState({
        status: 'error',
        cueId: cue.cueId,
        error: resolution?.reason ?? 'media route is unresolved',
      });
      return;
    }
    const backend = this.#backendFactory(resolution.url, resolution);
    this.#backend = backend;
    backend.onEnded?.(() => {
      if (this.#backend === backend) {
        this.#backend = null;
        this.#setState(IDLE);
      }
    });
    backend.onError?.((error) => {
      if (this.#backend === backend) {
        this.#backend = null;
        this.#setState({
          status: 'error',
          cueId: cue.cueId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    this.#setState({ status: 'loading', cueId: cue.cueId, error: null });
    try {
      await backend.play();
      if (this.#backend === backend) {
        this.#setState({ status: 'playing', cueId: cue.cueId, error: null });
      }
    } catch (error) {
      if (this.#backend === backend) {
        this.#backend = null;
        backend.stop?.();
        this.#setState({
          status: 'error',
          cueId: cue.cueId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  stop() {
    this.#backend?.stop?.();
    this.#backend = null;
    if (this.#state !== IDLE) this.#setState(IDLE);
  }

  suspend() {
    this.stop();
  }

  dispose() {
    if (this.#disposed) return;
    this.stop();
    this.#disposed = true;
    this.#listeners.clear();
  }
}
