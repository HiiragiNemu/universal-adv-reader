'use client';

import Link from 'next/link';
import GenericReviewSurface from '@/components/GenericReviewSurface';
import { useGlobal } from '@/app/providers';
import { GENERIC_BACKEND_STATUS } from '@/lib/generic-backend';
import { ADV_GITHUB_URL } from '@/lib/github-native-review';

/** Local capability notice, not an invented submission or acceptance record. */
export default function GenericBackendStatus() {
  const { theme } = useGlobal();
  if (process.env.NEXT_PUBLIC_ADV_STATIC === '1') return <GenericReviewSurface><main data-generic-backend="github-issues" data-theme={theme} className="mx-auto min-h-full max-w-4xl px-4 py-8">
    <h1 className="text-2xl font-bold">通用 ADV 版本、修订与投稿</h1>
    <section className="magi-home-light-folder-card mt-5 rounded-xl border p-5">
      <h2 className="text-lg font-bold">公开源码与 GitHub 投稿</h2>
      <p className="mt-3">源码与公开投稿保存在独立的 universal-adv-reader 仓库。GitHub 提供账号登录、Issue 编号和讨论记录；阅读站不保存口令，编辑不会自动上传。</p>
      <nav className="mt-4 flex flex-wrap gap-4"><a className="underline" href={ADV_GITHUB_URL} target="_blank" rel="noopener noreferrer">公开源码仓库</a><Link className="underline" href="/review/submissions">投稿方式与审核流程</Link><a className="underline" href="/release.json">当前网站构建身份</a></nav>
    </section>
    <section className="magi-home-light-folder-card mt-4 rounded-xl border p-5">
      <h2 className="text-lg font-bold">修改生效需要明确审核</h2>
      <p className="mt-3">站长运行 <code>npm run review:github -- --issue 编号</code> 将投稿导入本机待审队列。来源哈希或原值不匹配会被拒绝，不会覆盖新版本。</p>
      <p className="mt-3">核对、批准、安装、提交 Git，再运行 <code>npm run publish:cloudflare</code> 直接发布。网站不暴露本机写接口，不使用 GitHub Actions。浏览器草稿、GitHub 投稿、批准和正式发布是不同状态。</p>
      <Link className="mt-4 inline-block underline" href="/">返回剧情目录</Link>
    </section>
  </main></GenericReviewSurface>;
  return (
    <GenericReviewSurface>
    <main data-generic-backend="unconfigured" data-theme={theme}
      className="mx-auto min-h-full max-w-4xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">通用汉化修订与投稿</h1>
          <p className="mt-1 text-sm opacity-70">Narcissu 系列 · 加奈欢迎回来</p>
        </div>
        <Link href="/" className="rounded-lg border px-3 py-2 text-sm">返回剧情目录</Link>
      </div>
      <section className="magi-home-light-folder-card rounded-xl border p-5" aria-labelledby="generic-local-title">
        <h2 id="generic-local-title" className="text-lg font-bold">已接入：本地原生投稿、审核与修订</h2>
        <p className="mt-3 text-sm"><Link href="/review/submissions" className="font-bold underline">打开本地投稿与审核队列</Link>：保存补丁、核对原生字段、明确批准或退回、下载回执；批准后生成版本，安装及回滚另行确认。</p>
        <p className="mt-3 text-sm">在协助汉化页编辑后下载原生补丁 JSON；本地生产器保留 Majiro / IKURA 事件、控制结构与只读语音身份，生成版本化 ADV、TXT 和检索索引。</p>
        <ol className="mt-3 list-inside list-decimal space-y-2 text-sm">
          <li>编辑与导出不上传内容。</li>
          <li>在工程根目录运行 <code>node tools/stage-native-reader-revision.mjs --patch FILE --output NEW_DIRECTORY</code>，生成待检查修订。</li>
          <li>检查后用 <code>--stage DIRECTORY</code> 安装本地修订；用 <code>--rollback DIRECTORY</code> 按新到旧回滚。</li>
        </ol>
        <p className="mt-3 text-sm">已安装修订由 <a href={GENERIC_BACKEND_STATUS.local.revision_registry} className="font-bold underline">本地修订索引</a>列出；空索引表示尚未安装修订，并非审核通过。</p>
      </section>
      <section className="magi-home-light-folder-card mt-4 rounded-xl border border-dashed p-5" aria-labelledby="generic-remote-title">
        <h2 id="generic-remote-title" className="text-lg font-bold">待配置：远端投稿与审核后端</h2>
        <ul className="mt-3 list-inside list-disc space-y-2 text-sm">
          {GENERIC_BACKEND_STATUS.missing.map(item => <li key={item.id} data-requirement={item.id}>{item.label}</li>)}
        </ul>
        <p className="mt-3 text-sm opacity-75">本地队列只接受本机同源操作；远端服务保持独立且尚未配置。此页不读取旧审核口令或回执。本地测试通过、安装修订和人工验收分别记录。</p>
      </section>
    </main>
    </GenericReviewSurface>
  );
}
