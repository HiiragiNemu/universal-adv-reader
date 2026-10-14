'use client';

import { LoaderCircle, Pause, Play, Square, Volume2 } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { voicePlaybackController } from '@/lib/audio/voice-player';

export function VoiceSequenceControls({ onStart, count, disabled, sourceLabel }: {
  onStart: () => void; count: number; disabled: boolean; sourceLabel: string;
}) {
  const state = useSyncExternalStore(voicePlaybackController.subscribe, voicePlaybackController.getSnapshot, voicePlaybackController.getServerSnapshot);
  const active = state.sequence !== null;
  const paused = state.status === 'paused';
  const canPause = ['loading', 'playing', 'paused'].includes(state.status);
  const buttonClass = 'magi-reader-utility-button inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-current/20 px-3 py-2 text-xs font-bold transition hover:opacity-75 disabled:opacity-40';
  return <div data-voice-sequence-controls="true" className="flex flex-wrap items-center gap-2">
    <button type="button" className={buttonClass} disabled={disabled || count === 0}
      aria-label={active ? '停止顺序播放' : '顺序播语音'} aria-pressed={active}
      title={`${sourceLabel} · 按原作事件顺序播放 ${count} 条语音（含无正文锚点语音）`}
      onClick={active ? voicePlaybackController.stop : onStart}>
      {active ? <Square aria-hidden size={13} /> : <Volume2 aria-hidden size={13} />}
      <span>{active ? '停止顺序播放' : '顺序播语音'}</span>
    </button>
    {canPause && <button type="button" className={buttonClass} aria-label={paused ? '继续语音' : '暂停语音'}
      onClick={paused ? voicePlaybackController.resume : voicePlaybackController.pause}>
      {paused ? <Play aria-hidden size={13} /> : <Pause aria-hidden size={13} />}{paused ? '继续' : '暂停'}
    </button>}
    <span className="font-mono text-xs opacity-70" data-voice-timeline="true">
      {state.sequence ? `${state.sequence.index + 1}/${state.sequence.total} · ` : ''}
      {state.status === 'loading' ? <LoaderCircle aria-label="语音加载中" size={13} className="inline animate-spin" />
        : `${state.currentTime.toFixed(1)} / ${state.duration?.toFixed(1) ?? '—'} s`}
    </span>
    {state.error && <span role="status" className="w-full text-xs text-red-600">{state.error}</span>}
  </div>;
}
