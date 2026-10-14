"use client";

import { BookOpen, Leaf, Moon, ScanLine, Sun } from 'lucide-react';

import { isNightTheme, type Theme } from '@/app/providers';
import FloatingWindow from '@/components/FloatingWindow';
import ReaderFontSettings from '@/components/ReaderFontSettings';

const THEME_OPTIONS = [
  { key: 'light', label: '明亮', icon: Sun },
  { key: 'paper', label: '纸张', icon: BookOpen },
  { key: 'green', label: '护眼', icon: Leaf },
  { key: 'dark', label: '深色', icon: Moon },
  { key: 'frost', label: '冷辉', icon: ScanLine },
] as const;

type MobileCategoryLayout = 'graph' | 'single-row';

export default function SiteSettingsWindow({
  isOpen,
  onClose,
  theme,
  setTheme,
  isExedra,
  mobileCategoryLayout,
  setMobileCategoryLayout,
}: {
  isOpen: boolean;
  onClose: () => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  isExedra: boolean;
  mobileCategoryLayout?: MobileCategoryLayout;
  setMobileCategoryLayout?: (layout: MobileCategoryLayout) => void;
}) {
  return (
    <FloatingWindow
      isOpen={isOpen}
      onClose={onClose}
      theme={theme}
      title="字体与站点设置"
      titleId="site-settings-window-title"
      systemLabel="SYS://MAGIREADER.SETTINGS"
      initialOffset={{ x: 118, y: 76 }}
      className={`magi-site-settings-window${theme === 'frost' ? ' magi-site-settings-window-frost' : ''}`}
      bodyClassName="space-y-3 p-3 sm:p-4"
      footer="设置只保存在当前浏览器"
    >
      <section
        aria-labelledby="site-theme-settings-heading"
        className={`rounded-lg border p-3 ${
          isNightTheme(theme)
            ? 'border-gray-700 bg-white/5'
            : 'border-stone-300 bg-white/60'
        }`}
      >
        <h3 id="site-theme-settings-heading" className="text-sm font-bold">
          站点主题
        </h3>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {THEME_OPTIONS.map(option => {
            const Icon = option.icon;
            const active = theme === option.key;
            return (
              <button
                key={option.key}
                type="button"
                data-theme-option={option.key}
                aria-pressed={active}
                onClick={() => setTheme(option.key)}
                className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-bold transition ${
                  active
                    ? 'magi-setting-selected'
                    : 'border-current opacity-60 hover:opacity-100'
                }`}
              >
                <Icon aria-hidden="true" size={14} />
                {option.label}
              </button>
            );
          })}
        </div>
      </section>

      {mobileCategoryLayout && setMobileCategoryLayout && (
        <section
          aria-labelledby="mobile-category-layout-heading"
          className={`rounded-lg border p-3 ${
            isNightTheme(theme)
              ? 'border-gray-700 bg-white/5'
              : 'border-stone-300 bg-white/60'
          }`}
        >
          <h3 id="mobile-category-layout-heading" className="text-sm font-bold">
            移动端分类栏
          </h3>
          <p className="mt-1 text-xs opacity-65">
            双排节点保留多重连接；单排滚动只显示分类与来源按钮，不显示节点和连线。
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(
              [
                { key: 'graph', label: '双排节点' },
                { key: 'single-row', label: '单排滚动' },
              ] as const
            ).map(option => {
              const active = mobileCategoryLayout === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setMobileCategoryLayout(option.key)}
                  className={`min-h-10 rounded-lg border px-2 py-2 text-xs font-bold transition ${
                    active
                      ? 'magi-setting-selected'
                      : 'border-current opacity-60 hover:opacity-100'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <ReaderFontSettings theme={theme} isExedra={isExedra} />
    </FloatingWindow>
  );
}
