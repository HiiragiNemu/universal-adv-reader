"use client";

import FloatingWindow from '@/components/FloatingWindow';
import { isNightTheme } from '@/app/providers';
import { useState } from 'react';
import contributors from '@/lib/adv-contributors.json';

const LINKS = [
  {
    "href": "https://wpa.qq.com/msgrd?v=3&uin=254489200&site=qq&menu=yes",
    "icon": "QQ",
    "iconClass": "from-[#12b7f5] to-[#0084d1]",
    "title": "联系作者",
    "subtitle": "QQ：254489200"
  },
  {
    "href": "https://search.bilibili.com/all?keyword=MadeInMagius",
    "icon": "B站",
    "iconClass": "from-[#fb7299] to-[#e04b76]",
    "title": "B站 MadeInMagius",
    "subtitle": "关注我的B站动态"
  },
  {
    "href": "https://magireader.pages.dev/",
    "icon": "剧情",
    "iconClass": "from-[#10b981] to-[#059669]",
    "title": "魔法纪录／Exedra 阅读网站",
    "subtitle": "魔法纪录与 Magia Exedra 剧情、语音"
  },
  {
    "href": "https://magiaexedralive2dviewer.pages.dev/",
    "icon": "L2D",
    "iconClass": "from-[#f59e0b] to-[#d97706]",
    "title": "magia exedra 魔法纪录l2d查看器",
    "subtitle": "在线查看角色 Live2D 动态模型"
  },
  {
    "href": "https://magius3dviewer.pages.dev/",
    "icon": "3D",
    "iconClass": "from-[#14b8a6] to-[#0f766e]",
    "title": "MAGIA EXEDRA 3D网站",
    "subtitle": "在线查看 MAGIA EXEDRA 3D 模型"
  },
  {
    "href": "https://madeinmagius-site.pages.dev/",
    "icon": "下载",
    "iconClass": "from-[#6366f1] to-[#4338ca]",
    "title": "MADE IN MAGIUS下载中心和教程网站",
    "subtitle": "下载中心与使用教程"
  },
  {
    "href": "https://magireco-call-search-cn.pages.dev/",
    "icon": "搜索",
    "iconClass": "from-[#06b6d4] to-[#0891b2]",
    "title": "魔法少女称呼搜索与身高对比",
    "subtitle": "魔法纪录·Magia Exedra"
  },
  {
    "href": "https://exedra.wiki/wiki/Characters/zh",
    "icon": "WIKI",
    "iconClass": "from-[#8b5cf6] to-[#7c3aed]",
    "title": "MAGIA EXEDRA WIKI中文化中…",
    "subtitle": "角色剧情、活动剧情与语音"
  },
  {
    "href": "/review/machine-translations",
    "icon": "进度",
    "iconClass": "from-[#f59e0b] to-[#d97706]",
    "title": "中文覆盖与待核对",
    "subtitle": "查看各作品的中文覆盖与校对进度"
  }
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
  const [contributionsOpen, setContributionsOpen] = useState(false);
  return (
    <FloatingWindow
      isOpen={isOpen}
      onClose={onClose}
      theme={theme}
      title="我的其他工具和动态"
      titleId="about-dialog-title"
      systemLabel="SYS://ADVREADER.LINKS"
      initialOffset={{ x: 84, y: 62 }}
      className="magi-about-window"
      bodyClassName="space-y-2.5 p-3 sm:p-4"
      footer="Made with ♥ by MadeInMagius"
    >
      <p className="magi-tool-attribution text-center text-[11px] leading-relaxed opacity-80 sm:text-xs">
        使用本工具二创，请注明工具作者以及提供工具链接。
      </p>
      <button
        type="button"
        aria-expanded={contributionsOpen}
        aria-controls="magi-contribution-list"
        onClick={() => setContributionsOpen(open => !open)}
        className={`magi-floating-link flex w-full items-center gap-3.5 border px-3.5 py-3 text-left transition-all ${isDark ? 'border-white/[0.08] bg-white/[0.04]' : ''}`}
      >
        <div className={`magi-contribution-glyph flex h-11 w-11 flex-shrink-0 items-center justify-center text-xs font-black ${isDark ? 'border border-[#8b7b53] bg-[#2a261d] text-[#e6cf7b]' : 'border border-slate-300 bg-slate-100 text-slate-700'}`}>
          贡
        </div>
        <div className="magi-floating-link-copy flex-1">
          <div className="magi-floating-link-title text-sm font-bold">贡献名单</div>
          <div className="magi-floating-link-subtitle mt-0.5 text-xs opacity-60">Narcissu：风铃汉化组 · 加奈：妹乃萌汉化组</div>
        </div>
        <span aria-hidden="true" className="text-sm opacity-60">{contributionsOpen ? '−' : '+'}</span>
      </button>
      {contributionsOpen && (
        <div id="magi-contribution-list" className="magi-contribution-content border px-4 py-3 text-xs leading-6 whitespace-pre-wrap">
<p className="mb-3 opacity-70">{contributors.policy}</p>
          {contributors.groups.map(group => (
            <section key={group.title} className="mb-4 last:mb-0">
              <h3 className="text-sm font-bold">{group.title}</h3>
              <dl className="mt-1">
                {group.roles.map(([role, names]) => (
                  <div key={role} className="mb-1">
                    <dt className="inline font-bold">{role}：</dt><dd className="inline break-words">{names}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-1 text-[11px] opacity-70">来源：{group.source}</p>
            </section>
          ))}
        </div>
      )}
      <a
        href="https://afdian.com/a/madeinmagius"
        target="_blank"
        rel="noopener noreferrer"
        className={`magi-floating-link flex items-center gap-3.5 border px-3.5 py-3 transition-all ${isDark ? 'border-white/[0.08] bg-white/[0.04]' : ''}`}
      >
        <div className={`magi-contribution-glyph flex h-11 w-11 flex-shrink-0 items-center justify-center text-xs font-black ${isDark ? 'border border-[#8b7b53] bg-[#2a261d] text-[#e6cf7b]' : 'border border-slate-300 bg-slate-100 text-slate-700'}`}>赞</div>
        <div className="magi-floating-link-copy flex-1">
          <div className="magi-floating-link-title text-sm font-bold">赞助支持 MADE IN MAGIUS</div>
          <div className="magi-floating-link-subtitle mt-0.5 text-xs opacity-60">爱发电 · MADE IN MAGIUS</div>
        </div>
        <span aria-hidden="true" className="text-sm opacity-60">→</span>
      </a>
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
