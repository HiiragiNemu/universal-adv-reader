'use client';

import { LoaderCircle, Square, Volume2 } from 'lucide-react';
import { useSyncExternalStore } from 'react';

import { isLegacyVnVoiceUrl } from '@/lib/audio/voice-cue';
import { voicePlaybackController } from '@/lib/audio/voice-player';

export interface VoicePlayButtonProps {
  cueId?: string | null;
  className?: string;
  label?: string;
  sourceUrl?: string | null;
}

export function VoicePlayButton({
  cueId,
  className = '',
  label = '播放语音',
  sourceUrl,
}: VoicePlayButtonProps) {
  const state = useSyncExternalStore(
    voicePlaybackController.subscribe,
    () => {
      const snapshot = voicePlaybackController.getSnapshot();
      return snapshot.cueId === cueId && snapshot.sourceUrl === sourceUrl
        ? snapshot : voicePlaybackController.getServerSnapshot();
    },
    voicePlaybackController.getServerSnapshot,
  );
  if (
    !cueId
    || !isLegacyVnVoiceUrl(sourceUrl)
  ) {
    return null;
  }

  const isCurrent = state.cueId === cueId && state.sourceUrl === sourceUrl;
  const isLoading = isCurrent && state.status === 'loading';
  const isPlaying = isCurrent && (state.status === 'playing' || state.status === 'paused');
  const accessibleLabel = isLoading
    ? '停止加载语音'
    : isPlaying
      ? '停止语音'
      : label;

  return (
    <span className="inline-flex self-start flex-col items-start gap-0.5">
      <button
        type="button"
        className={`magi-reader-voice-button inline-flex h-7 min-h-7 items-center justify-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-2 py-0 text-[11px] font-semibold leading-none text-sky-800 transition hover:bg-sky-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600 disabled:cursor-wait ${className}`}
        aria-label={`${accessibleLabel}：${cueId}`}
        aria-pressed={isPlaying}
        disabled={false}
        onClick={() => {
          void voicePlaybackController.toggle(cueId, sourceUrl ?? undefined);
        }}
      >
        {isLoading ? (
          <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" />
        ) : isPlaying ? (
          <Square aria-hidden className="h-3.5 w-3.5 fill-current" />
        ) : (
          <Volume2 aria-hidden className="h-3.5 w-3.5" />
        )}
        <span>{isLoading ? '加载中' : isPlaying ? '停止' : label}</span>
      </button>
      {isCurrent && state.status === 'error' && state.error ? (
        <span className="max-w-72 text-xs text-red-700" role="status">
          {state.error}
        </span>
      ) : null}
    </span>
  );
}

export default VoicePlayButton;
