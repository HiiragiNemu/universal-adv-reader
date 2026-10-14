'use client';
import { useId } from 'react';
import { useIOSWebKit } from '@/lib/use-ios-webkit';
import { useScreenEffects } from '@/lib/use-screen-effects';
import { updateScreenEffects, type ScreenEffects } from '@/lib/screen-effects';
import { updateReaderDisplayPreferences, parseReaderDisplayPreferences, getReaderDisplayPreferencesSnapshot } from '@/lib/reader-display-preferences';
const choices: [keyof ScreenEffects, string][] = [
  ['curvature', '屏幕曲率模拟'], ['scanlines', '扫描线'], ['noise', '屏幕噪点'], ['pixelFont', '像素字体'],
  ['registration', '全局色彩偏移（文字、图标、边框）'],
];
export default function ScreenEffectsSettings({ theme }: { theme: string }) {
  const effects = useScreenEffects(theme);
  const iosWebKit = useIOSWebKit();
  const noticeId = useId();
  const curvatureNotice = 'iOS 浏览器暂不支持屏幕曲率，请使用 Android 浏览器或电脑版。低保真、扫描线和噪点等其他效果仍可使用。';
  return <fieldset className="magi-screen-effects-settings rounded border p-3">
    <legend className="px-1 text-sm font-bold">屏幕与字体效果</legend>
    <p className="mb-2 text-xs opacity-65">{iosWebKit ? '夜间的扫描线、噪点与色散固定开启；' : '夜间的曲率、扫描线、噪点与色散固定开启；'}其他主题的屏幕效果独立保存。</p>
    {iosWebKit && <p id={noticeId} className="mb-2 text-xs" role="note">{curvatureNotice}</p>}
    {(theme === 'frost' ? [...choices, ['glassDamage', '玻璃裂纹与划痕'] as [keyof ScreenEffects, string]] : choices).map(([key, label]) => <label key={key} data-platform-disabled={iosWebKit && key === 'curvature' ? 'true' : undefined} className="flex min-h-10 items-center justify-between gap-3">
      <span>{label}</span><input type="checkbox" role="switch" aria-label={label} checked={effects[key]}
        disabled={(iosWebKit && key === 'curvature') || (theme === 'dark' && (key === 'curvature' || key === 'scanlines' || key === 'noise' || key === 'registration'))}
        aria-describedby={iosWebKit && key === 'curvature' ? noticeId : undefined}
        title={iosWebKit && key === 'curvature' ? curvatureNotice : theme === 'dark' && key !== 'pixelFont' ? '夜间模式固定开启' : undefined}
        onChange={event => {
          // Preserve the two existing night phosphor font preferences.
          if (key === 'pixelFont' && theme === 'dark') {
            const p = parseReaderDisplayPreferences(getReaderDisplayPreferencesSnapshot());
            updateReaderDisplayPreferences(p.nightPhosphor === 'green'
              ? { nightGreenPixelFontEnabled: event.target.checked } : { nightPixelFontEnabled: event.target.checked });
          } else updateScreenEffects(theme, { [key]: event.target.checked });
        }} className="h-5 w-5" />
    </label>)}
    {theme === 'frost' && <p className="mt-2 text-xs opacity-65">玻璃裂纹与划痕默认关闭，可手动开启；关闭时同时停止其折射，保留柔焦、颗粒和其他效果，加载页同步生效。</p>}
  </fieldset>;
}
