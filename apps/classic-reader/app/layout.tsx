import type { Metadata } from 'next';
import './globals.css';
import './ui-refinements.css';
import './home-story-tree.css';
import './home-controller-refinements.css';
import './night-pixel-font.css';
import './accepted-baseline-increments.css';
import './material-study.css';
import './display-material.css';
import './loading-screen.css';
import './display-startup.css';
import './ios-optical-pipeline.css';
import './display-stability.css';
import './reader/reader-editor-surface.css';
// Shared optics must arrive with the initial loader, not a later route chunk.
import './screen-effects.css';
import './night-display-surface.css';
import './frost-glass-surface.css';
import './frost-curved-edge.css';
import './viewport-scene.css';
import './cold-scene-composition.css';
import { loadingAppearanceBootstrap } from '@/lib/loading-appearance-bootstrap';

import { GlobalProvider } from '@/app/providers';

export const metadata: Metadata = {
  title: 'Universal ADV Reader',
  description: '通用 ADV 双语阅读、原生章节导航与文本修订；现收录 Narcissu、KANA 及独立中文文本资料。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/textures/magi-tube-lens-512.png" as="image" />
        {/* Native inline script runs even while Next chunks are still downloading. */}
        <script id="magi-loading-appearance" dangerouslySetInnerHTML={{ __html: loadingAppearanceBootstrap }} />
      </head>
      <body className="antialiased font-serif">
        <GlobalProvider>
          {children}
        </GlobalProvider>
      </body>
    </html>
  );
}
