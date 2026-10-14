"use client";

import FloatingWindow from '@/components/FloatingWindow';
import { isNightTheme } from '@/app/providers';

const LINKS = [
  { href: '/', icon: '目录', iconClass: 'from-[#12b7f5] to-[#0084d1]', title: 'Narcissu／加奈 作品目录', subtitle: '公开剧情与三部作品筛选' },
  { href: '/review/machine-translations', icon: '进度', iconClass: 'from-[#f59e0b] to-[#d97706]', title: '中文覆盖与待核对', subtitle: '按实际原生事件、作品和版本统计，不冒认人工验收' },
  { href: '/proofreading/status', icon: '帮助', iconClass: 'from-[#06b6d4] to-[#0891b2]', title: '汉化修订与投稿帮助', subtitle: '原生补丁、版本化 TXT、检索及本地回滚' },
  { href: '/native-reader-revisions.json', icon: '版本', iconClass: 'from-[#8b5cf6] to-[#7c3aed]', title: '本地修订索引', subtitle: '原始资源保留，独立修订按版本追溯' },
  { href: 'https://search.bilibili.com/all?keyword=MadeInMagius', icon: 'B站', iconClass: 'from-[#fb7299] to-[#e04b76]', title: 'Reader UI 作者 MadeInMagius', subtitle: '继承的 UI 作者署名与动态' },
];

export default function AboutModal({
  isOpen,
  onClose,
  theme,
}: {
  isOpen: boolean;
  onClose: () => void;
  theme: string;
}) {
  const isDark = isNightTheme(theme);
  return (
    <FloatingWindow
      isOpen={isOpen}
      onClose={onClose}
      theme={theme}
      title="通用阅读器 · 关于与帮助"
      titleId="about-dialog-title"
      systemLabel="SYS://ADVREADER.HELP"
      initialOffset={{ x: 84, y: 62 }}
      className="magi-about-window"
      bodyClassName="space-y-2.5 p-3 sm:p-4"
      footer="Made with ♥ by MadeInMagius"
    >
      {LINKS.map((link) => (
        <a
          key={link.href}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className={`magi-floating-link group flex items-center gap-3.5 border px-3.5 py-3 transition-all active:scale-[0.99] ${isDark ? 'border-white/[0.08] bg-white/[0.04]' : ''}`}
        >
          <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center bg-gradient-to-br text-xs font-black text-white ${link.iconClass}`}>
            {link.icon}
          </div>
          <div className="magi-floating-link-copy">
            <div className="magi-floating-link-title text-sm font-bold">
              {link.title}
            </div>
            <div className="magi-floating-link-subtitle mt-0.5 text-xs opacity-60">
              {link.subtitle}
            </div>
          </div>
          <span className="flex-shrink-0 text-sm opacity-30 transition-all group-hover:translate-x-1 group-hover:opacity-60">
            →
          </span>
        </a>
      ))}
    </FloatingWindow>
  );
}
