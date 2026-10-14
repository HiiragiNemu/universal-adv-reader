import { isLegacyVnVoiceUrl } from './voice-cue.ts';
import { loadSeekableVoiceBlob } from './seekable-voice-source.ts';

// Native-resource adaptation of the pinned Reader completion/session contract.
// This controller deliberately has no Magia proxy, bucket, decoder or ID fallback.
export type VoicePlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
export type VoicePlaybackOutcome = 'ended' | 'stopped' | 'error';
export interface VoiceSequenceEntry {
  cueId: string;
  sourceUrl: string;
  eventId: string;
  rowIndex: number | null;
}
export interface VoicePlaybackState {
  cueId: string | null;
  sourceUrl: string | null;
  error: string | null;
  status: VoicePlaybackStatus;
  currentTime: number;
  duration: number | null;
  sequence: { index: number; total: number; rowIndex: number | null; eventId: string } | null;
}
const IDLE_STATE: VoicePlaybackState = {
  cueId: null, sourceUrl: null, error: null, status: 'idle', currentTime: 0, duration: null, sequence: null,
};
type Session = {
  audio: HTMLAudioElement;
  attempt: number;
  resolve: (outcome: VoicePlaybackOutcome) => void;
  removeAbort?: () => void;
  transportAbort?: AbortController;
  blobAttempted?: boolean;
  restoreTime?: number;
};
type Sequence = {
  audio: HTMLAudioElement | null;
  resolve: (outcome: VoicePlaybackOutcome) => void;
  removeAbort?: () => void;
};

export class VoicePlaybackController {
  private state = IDLE_STATE;
  private listeners = new Set<() => void>();
  private session: Session | null = null;
  private sequence: Sequence | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private objectUrls = new WeakMap<HTMLAudioElement, string>();

  getSnapshot = (): VoicePlaybackState => this.state;
  getServerSnapshot = (): VoicePlaybackState => IDLE_STATE;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(next: VoicePlaybackState) {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
  private armTimer(session: Session, delay: number) {
    this.clearTimer();
    this.timer = setTimeout(() => {
      if (this.session === session) this.finish('error', '语音加载或播放超时，请重试');
    }, delay);
  }
  private releaseAudio(audio: HTMLAudioElement) {
    audio.onended = null; audio.onerror = null;
    audio.onloadedmetadata = null;
    audio.ontimeupdate = null; audio.ondurationchange = null;
    audio.pause(); audio.removeAttribute('src'); audio.load();
    const objectUrl = this.objectUrls.get(audio);
    if (objectUrl) { URL.revokeObjectURL(objectUrl); this.objectUrls.delete(audio); }
  }
  private finish(outcome: VoicePlaybackOutcome, error: string | null = null) {
    const session = this.session;
    if (!session) return;
    this.session = null; // Invalidate callbacks before pause/load fires media events.
    session.transportAbort?.abort();
    this.clearTimer(); session.removeAbort?.(); this.releaseAudio(session.audio);
    this.update(outcome === 'error'
      ? { ...this.state, status: 'error', error }
      : { ...IDLE_STATE, sequence: this.state.sequence });
    session.resolve(outcome);
  }
  stop = (): void => {
    const sequence = this.sequence;
    this.sequence = null;
    this.finish('stopped');
    sequence?.removeAbort?.();
    if (sequence?.audio) this.releaseAudio(sequence.audio);
    this.update(IDLE_STATE);
    sequence?.resolve('stopped');
  };
  pause = (): void => {
    const session = this.session;
    if (!session || !['loading', 'playing'].includes(this.state.status)) return;
    session.attempt += 1; this.clearTimer(); session.audio.pause();
    this.update({ ...this.state, status: 'paused' });
  };
  resume = (): void => {
    if (this.session && this.state.status === 'paused') this.requestPlay(this.session);
  };
  private requestPlay(session: Session) {
    const attempt = ++session.attempt;
    this.update({ ...this.state, status: 'loading', error: null });
    this.armTimer(session, 30_000);
    // Do not await media startup before returning the completion promise: a
    // pending play() must still settle immediately on stop/abort/error.
    void (async () => {
      try {
        await session.audio.play();
        if (this.session !== session || session.attempt !== attempt) return;
        this.update({ ...this.state, status: 'playing' });
        const remaining = session.audio.duration - session.audio.currentTime;
        this.armTimer(session, Number.isFinite(remaining) ? Math.max(90_000, (remaining + 10) * 1_000) : 90_000);
      } catch (error) {
        if (this.session !== session || session.attempt !== attempt) return;
        this.finish('error', error instanceof Error ? error.message : '原作语音播放失败，请重试');
      }
    })();
  }
  private repairUnseekableStaticMedia(session: Session, sourceUrl: string) {
    const audio = session.audio;
    if (process.env.NEXT_PUBLIC_ADV_STATIC !== '1' || session.blobAttempted ||
      (audio.seekable.length > 0 && audio.seekable.end(audio.seekable.length - 1) > 0)) return;
    session.blobAttempted = true;
    const controller = new AbortController(); session.transportAbort = controller;
    void (async () => {
      try {
        const blob = await loadSeekableVoiceBlob(sourceUrl, controller.signal);
        if (!blob || controller.signal.aborted || this.session !== session) return;
        const objectUrl = URL.createObjectURL(blob);
        // Reuse the already user-activated element, preserve play/pause and time,
        // and keep cue/resource identity separate from this disposable transport.
        session.restoreTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        session.attempt++; this.clearTimer();
        audio.pause();
        this.objectUrls.set(audio, objectUrl);
        const paused = this.state.status === 'paused';
        this.update({ ...this.state, status: paused ? 'paused' : 'loading' });
        if (!paused) this.armTimer(session, 30_000);
        audio.src = objectUrl; audio.load();
      } catch {
        // A failed optional seek-metadata repair must not interrupt the original
        // resource's working stream, nor revive an ended/replaced session.
      }
    })();
  }
  private start(cueId: string, sourceUrl?: string, signal?: AbortSignal): Promise<VoicePlaybackOutcome> {
    if (signal?.aborted || typeof window === 'undefined') return Promise.resolve('stopped');
    if (!cueId || !isLegacyVnVoiceUrl(sourceUrl)) {
      this.update({ ...this.state, cueId, sourceUrl: null, status: 'error', error: '缺少有效的原作语音资源路径' });
      return Promise.resolve('error');
    }
    let resolve!: Session['resolve'];
    const completion = new Promise<VoicePlaybackOutcome>(done => { resolve = done; });
    const audio = this.sequence?.audio ?? new Audio();
    if (this.sequence) this.sequence.audio = audio;
    const session: Session = { audio, attempt: 0, resolve };
    this.session = session;
    this.update({ ...this.state, cueId, sourceUrl, error: null, status: 'loading', currentTime: 0, duration: null });
    if (signal) {
      const abort = () => { if (this.session === session) this.stop(); };
      signal.addEventListener('abort', abort, { once: true });
      session.removeAbort = () => signal.removeEventListener('abort', abort);
    }
    audio.onended = () => { if (this.session === session) this.finish('ended'); };
    audio.onerror = () => { if (this.session === session) this.finish('error', '原作语音资源加载失败，请重试'); };
    const updateTimeline = () => {
      if (this.session !== session) return;
      this.update({ ...this.state, currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
        duration: Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null });
    };
    audio.ontimeupdate = updateTimeline; audio.ondurationchange = updateTimeline;
    audio.onloadedmetadata = () => {
      if (this.session !== session) return;
      if (session.restoreTime !== undefined) {
        const time = session.restoreTime; session.restoreTime = undefined;
        audio.currentTime = Number.isFinite(audio.duration) ? Math.min(time, Math.max(0, audio.duration - 0.001)) : time;
        updateTimeline();
        if (this.state.status !== 'paused') this.requestPlay(session);
      } else this.repairUnseekableStaticMedia(session, sourceUrl);
    };
    audio.preload = 'auto'; audio.src = sourceUrl;
    this.requestPlay(session);
    return completion;
  }
  playAndWait = (cueId: string, sourceUrl?: string, signal?: AbortSignal): Promise<VoicePlaybackOutcome> => {
    if (signal?.aborted) return Promise.resolve('stopped');
    this.stop(); return this.start(cueId, sourceUrl, signal);
  };
  play = (cueId: string, sourceUrl?: string): void => { void this.playAndWait(cueId, sourceUrl); };
  toggle = (cueId: string, sourceUrl?: string): void => {
    if (this.state.cueId === cueId && this.state.sourceUrl === sourceUrl && ['loading', 'playing', 'paused'].includes(this.state.status)) {
      this.stop();
    } else this.play(cueId, sourceUrl);
  };

  playSequence = (
    entries: readonly VoiceSequenceEntry[],
    onEntry?: (entry: VoiceSequenceEntry) => void,
    signal?: AbortSignal,
  ): Promise<VoicePlaybackOutcome> => {
    this.stop();
    if (signal?.aborted || typeof window === 'undefined') return Promise.resolve('stopped');
    // Snapshot the plan; neither sorting nor URL/cue deduplication is permitted.
    const plan = entries.map(entry => ({ ...entry }));
    if (plan.length === 0) return Promise.resolve('ended');
    let resolve!: Sequence['resolve'];
    const completion = new Promise<VoicePlaybackOutcome>(done => { resolve = done; });
    const run: Sequence = { audio: null, resolve };
    this.sequence = run;
    if (signal) {
      const abort = () => { if (this.sequence === run) this.stop(); };
      signal.addEventListener('abort', abort, { once: true });
      run.removeAbort = () => signal.removeEventListener('abort', abort);
    }
    void (async () => {
      let errors = 0;
      try {
        for (let index = 0; index < plan.length; index++) {
          if (this.sequence !== run) return;
          const entry = plan[index];
          this.update({ ...this.state, sequence: { index, total: plan.length, rowIndex: entry.rowIndex, eventId: entry.eventId } });
          onEntry?.(entry);
          if (this.sequence !== run) return;
          const outcome = await this.start(entry.cueId, entry.sourceUrl);
          if (this.sequence !== run) return;
          if (outcome === 'stopped') { this.stop(); return; }
          if (outcome === 'error') errors += 1;
        }
      } catch (error) {
        if (this.sequence !== run) return;
        errors += 1;
        this.finish('error', error instanceof Error ? error.message : '语音顺序播放中断');
      } finally {
        // An older run must never stop or overwrite its replacement.
        if (this.sequence === run) {
          this.sequence = null; run.removeAbort?.();
          if (run.audio) this.releaseAudio(run.audio);
          this.update(errors > 0 ? { ...IDLE_STATE, status: 'error', error: `本次 ${errors} 条语音播放失败；其余已继续，可重新播放重试。` } : IDLE_STATE);
          resolve(errors > 0 ? 'error' : 'ended');
        }
      }
    })();
    return completion;
  };
}
export const voicePlaybackController = new VoicePlaybackController();
