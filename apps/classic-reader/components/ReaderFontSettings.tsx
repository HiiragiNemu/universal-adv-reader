'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { RotateCcw } from 'lucide-react';

import {
  disableReaderFontBundle,
  enableReaderFontBundle,
  getReaderFontRuntimeServerSnapshot,
  getReaderFontRuntimeSnapshot,
  parseReaderFontRuntimeSnapshot,
  restoreSystemReaderFonts,
  subscribeReaderFontRuntime,
} from '@/lib/reader-fonts';
import { getReaderDisplayPreferencesSnapshot, getReaderDisplayPreferencesServerSnapshot, parseReaderDisplayPreferences, subscribeReaderDisplayPreferences, updateReaderDisplayPreferences, isReaderRulerEnabled } from '@/lib/reader-display-preferences';
import ScreenEffectsSettings from '@/components/ScreenEffectsSettings';
import ExedraFontSettings from '@/components/ExedraFontSettings';
import { isNightTheme, useGlobal } from '@/app/providers';

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
    <details data-reader-font-settings="true" className="rounded-lg border p-3">
      <summary className="cursor-pointer select-none font-bold">原作字体（本机匹配）</summary>
      <p className="mt-2 text-xs leading-relaxed opacity-75">
        正文与角色名按作品选择原作或汉化补丁指定字体；只匹配本机已安装字体，不下载字体包。
        本机缺少时使用系统后备字体；正文原作字体优先于主题像素字体，站点界面和独立文本资料继续跟随主题。
      </p>
      <ul className="my-3 space-y-1 text-xs leading-relaxed">
        <li>加奈，欢迎回来！／Narcissu 3rd：中文黑体（SimHei）；日文 MS Gothic。</li>
        <li>Narcissu10周年：中文幼圆（YouYuan）；日文 MS Gothic。</li>
        <li>10周年 1+2：优先本机 Narci_chs_Font；现有资源缺少 CNFont.ttf，缺失时退回已核验的幼圆，不标称特制字体已还原。</li>
      </ul>
      <div className="space-y-2">
        {(['chinese', 'japanese'] as const).map(id => {
          const enabled = state.preferences[id === 'chinese' ? 'chineseEnabled' : 'japaneseEnabled'];
          return <label key={id} className="flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded border px-3 py-2 text-xs">
            <span>{id === 'chinese' ? '中文按作品匹配原作字体' : '日文按作品匹配原作字体'}</span>
            <input type="checkbox" role="switch" aria-label={id === 'chinese' ? '中文原作字体' : '日文原作字体'} checked={enabled}
              onChange={event => { if (event.target.checked) void enableReaderFontBundle(id); else disableReaderFontBundle(id); }} />
          </label>;
        })}
      </div>
      <button type="button" disabled={!anyReady} onClick={restoreSystemReaderFonts}
        className="mt-3 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-current px-3 py-2 text-xs font-bold opacity-70 hover:opacity-100 disabled:opacity-30">
        <RotateCcw size={13} />关闭原作匹配，恢复主题字体
      </button>
    </details>
    {isExedra && <ExedraFontSettings theme={theme} />}
    </div>
  );
}
