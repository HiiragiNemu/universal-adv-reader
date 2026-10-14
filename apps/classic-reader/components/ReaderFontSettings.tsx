'use client';

import { useMemo, useSyncExternalStore } from 'react';
import {
  CheckCircle2,
  Download,
  LoaderCircle,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from 'lucide-react';

import {
  READER_FONT_BUNDLES,
  disableReaderFontBundle,
  enableReaderFontBundle,
  formatReaderFontBytes,
  getReaderFontRuntimeServerSnapshot,
  getReaderFontRuntimeSnapshot,
  parseReaderFontRuntimeSnapshot,
  removeReaderFontBundleCache,
  restoreSystemReaderFonts,
  subscribeReaderFontRuntime,
  type ReaderFontBundleId,
  type ReaderFontBundleRuntime,
} from '@/lib/reader-fonts';
import { getReaderDisplayPreferencesSnapshot, getReaderDisplayPreferencesServerSnapshot, parseReaderDisplayPreferences, subscribeReaderDisplayPreferences, updateReaderDisplayPreferences, isReaderRulerEnabled } from '@/lib/reader-display-preferences';
import ScreenEffectsSettings from '@/components/ScreenEffectsSettings';
import ExedraFontSettings from '@/components/ExedraFontSettings';
import { isNightTheme, useGlobal } from '@/app/providers';

const BUSY_STATUSES = new Set(['checking', 'downloading', 'loading']);

const bundleStatusText = (
  runtime: ReaderFontBundleRuntime,
  totalBytes: number,
): string => {
  switch (runtime.status) {
    case 'checking':
      return '正在检查本地字体缓存…';
    case 'downloading':
      return `正在下载（总计 ${formatReaderFontBytes(totalBytes)}）…`;
    case 'loading':
      return runtime.loadedBytes > 0
        ? `正在校验并载入 ${formatReaderFontBytes(runtime.loadedBytes)} / ${formatReaderFontBytes(totalBytes)}…`
        : '正在从本地缓存载入…';
    case 'ready':
      return runtime.source === 'cache'
        ? '已从本地缓存启用。'
        : runtime.cached
          ? '已启用，并保存到本地字体缓存。'
          : '已启用；浏览器未授予持久缓存，刷新时可能重新下载。';
    case 'error':
    case 'unsupported':
      return runtime.error;
    default:
      return runtime.cached
        ? '已下载但未启用；当前使用系统字体。'
        : '尚未下载；当前使用系统字体。';
  }
};

const actionLabel = (
  bundleId: ReaderFontBundleId,
  runtime: ReaderFontBundleRuntime,
): string => {
  const label = READER_FONT_BUNDLES[bundleId].label;
  if (BUSY_STATUSES.has(runtime.status)) return '正在处理…';
  if (runtime.status === 'ready') return '恢复系统字体';
  return runtime.cached ? `启用已下载的${label}` : `下载并启用${label}`;
};

export default function ReaderFontSettings({
  theme,
  isExedra = false,
}: {
  theme: string;
  isExedra?: boolean;
}) {
  const { nameColorsEnabled, setNameColorsEnabled, nightPhosphor, setNightPhosphor } = useGlobal();
  const displaySnapshot = useSyncExternalStore(
    subscribeReaderDisplayPreferences,
    getReaderDisplayPreferencesSnapshot,
    getReaderDisplayPreferencesServerSnapshot,
  );
  const displayPreferences = useMemo(() => parseReaderDisplayPreferences(displaySnapshot), [displaySnapshot]);
  const snapshot = useSyncExternalStore(
    subscribeReaderFontRuntime,
    getReaderFontRuntimeSnapshot,
    getReaderFontRuntimeServerSnapshot,
  );
  const state = useMemo(
    () => parseReaderFontRuntimeSnapshot(snapshot),
    [snapshot],
  );
  const anyReady = Object.values(state.bundles).some(
    bundle => bundle.status === 'ready',
  );

  return (
    <div className="magi-reader-display-settings space-y-3">
    <label className="magi-reading-ruler-setting flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg border p-3">
      <span>
        <span className="block text-sm font-bold">阅读刻度尺</span>
        <span className="mt-1 block text-xs opacity-65">显示正文行号与字位刻度。冷辉默认开启，其他主题默认关闭；不影响底部字号滑块。</span>
      </span>
      <input type="checkbox" role="switch" aria-label="阅读刻度尺"
        checked={isReaderRulerEnabled(displayPreferences, theme)}
        onChange={event => updateReaderDisplayPreferences({ rulerEnabled: event.target.checked })}
        className="h-5 w-5 shrink-0" />
    </label>
    {theme === 'dark' && <fieldset className="magi-night-phosphor-setting rounded border p-3">
      <legend className="px-1 text-sm font-bold">夜间显像管颜色</legend>
      <div className="flex gap-2">
        {(['green', 'amber'] as const).map(value => <button type="button" key={value}
          className="min-h-9 flex-1 border px-3 py-2 text-sm"
          aria-pressed={nightPhosphor === value} onClick={() => setNightPhosphor(value)}>
          {value === 'green' ? '绿色荧光' : '琥珀黄色'}
        </button>)}
      </div>
    </fieldset>}
    <ScreenEffectsSettings theme={theme} />
    <label
      className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 ${
        isNightTheme(theme)
          ? 'border-gray-700 bg-white/5'
          : 'border-gray-200 bg-black/[0.02]'
      }`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-bold">说话人／角色名彩色显示</span>
        <span className="mt-1 block text-xs opacity-65">
          全局生效：关闭后，所有阅读页和角色列表的名字跟随主题文字颜色。
        </span>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label="说话人／角色名彩色显示"
        checked={nameColorsEnabled}
        onChange={event => setNameColorsEnabled(event.target.checked)}
        className="h-5 w-5 shrink-0 accent-emerald-600"
      />
    </label>
    <details
      data-reader-font-settings="true"
      className={`rounded-lg border p-3 ${
        isNightTheme(theme)
          ? 'border-gray-700 bg-white/5'
          : 'border-gray-200 bg-black/[0.02]'
      }`}
    >
      <summary className="cursor-pointer select-none font-bold">
        游戏字体（按需下载）
      </summary>
      <p className="mt-2 text-[11px] leading-relaxed opacity-65">
        默认不请求字体文件。下载的是完整 WOFF2，不裁掉字形；遇到缺字时会继续使用
        系统 CJK 字体。浏览器缓存可用时，后续启用无需再次联网。
      </p>

      <div className="mt-3 space-y-3">
        {(['chinese', 'japanese'] as const).map(bundleId => {
          const definition = READER_FONT_BUNDLES[bundleId];
          const runtime = state.bundles[bundleId];
          const busy = BUSY_STATUSES.has(runtime.status);
          const failed =
            runtime.status === 'error' || runtime.status === 'unsupported';
          return (
            <section
              key={bundleId}
              data-reader-font-bundle={bundleId}
              className={`rounded-lg border p-3 ${
                isNightTheme(theme)
                  ? 'border-gray-600 bg-black/10'
                  : 'border-gray-200 bg-white'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold">{definition.label}</h3>
                  <p className="mt-0.5 text-[10px] opacity-60">
                    {definition.description}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-current px-2 py-0.5 font-mono text-[10px] opacity-60">
                  {formatReaderFontBytes(definition.totalBytes)}
                </span>
              </div>

              <p
                role="status"
                aria-live="polite"
                className={`mt-2 flex items-start gap-1.5 text-[11px] ${
                  failed
                    ? 'text-red-600'
                    : runtime.status === 'ready'
                      ? 'text-emerald-600'
                      : 'opacity-65'
                }`}
              >
                {busy ? (
                  <LoaderCircle className="mt-0.5 shrink-0 animate-spin" size={12} />
                ) : failed ? (
                  <TriangleAlert className="mt-0.5 shrink-0" size={12} />
                ) : runtime.status === 'ready' ? (
                  <CheckCircle2 className="mt-0.5 shrink-0" size={12} />
                ) : null}
                <span>{bundleStatusText(runtime, definition.totalBytes)}</span>
              </p>

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (runtime.status === 'ready') {
                      disableReaderFontBundle(bundleId);
                    } else {
                      void enableReaderFontBundle(bundleId);
                    }
                  }}
                  className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white transition disabled:cursor-wait disabled:opacity-50 ${
                    runtime.status === 'ready'
                      ? 'bg-gray-600 hover:bg-gray-700'
                      : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {runtime.status === 'ready' ? (
                    <RotateCcw size={13} />
                  ) : (
                    <Download size={13} />
                  )}
                  {actionLabel(bundleId, runtime)}
                </button>
                {runtime.cached && runtime.status !== 'ready' && !busy && (
                  <button
                    type="button"
                    onClick={() => void removeReaderFontBundleCache(bundleId)}
                    className="flex min-h-10 items-center gap-1 rounded-lg border border-red-300 px-2 py-2 text-[10px] font-bold text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={12} />
                    删除缓存
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <button
        type="button"
        disabled={!anyReady}
        onClick={restoreSystemReaderFonts}
        className="mt-3 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-current px-3 py-2 text-xs font-bold opacity-70 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
      >
        <RotateCcw size={13} />
        全部恢复系统字体
      </button>
    </details>
    {isExedra && <ExedraFontSettings theme={theme} />}
    </div>
  );
}
