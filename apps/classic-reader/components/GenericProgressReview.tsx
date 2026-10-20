'use client';

import Link from 'next/link';
import GenericReviewSurface from '@/components/GenericReviewSurface';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useGlobal, isNightTheme } from '@/app/providers';
import { GENERIC_PROGRESS_WORKS, readGenericProgress, type GenericProgress } from '@/lib/generic-progress';

export default function GenericProgressReview({ initialProgress = null }: { initialProgress?: GenericProgress | null }) {
  const { theme } = useGlobal(), dark = isNightTheme(theme);
  const [status,setStatus] = useState(initialProgress), [query,setQuery] = useState('');
  const [work,setWork] = useState('all'), [coverage,setCoverage] = useState('all');
  const [message,setMessage] = useState(''), [loading,setLoading] = useState(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);setMessage('');
    try {
      const response = await fetch('/api/proofreading/machine-status',{cache:'no-store',signal});
      if (!response.ok) throw Error(`通用进度读取失败：HTTP ${response.status}`);
      const next = readGenericProgress(await response.json()); if (!signal?.aborted) setStatus(next);
    } catch(error) { if (!signal?.aborted) setMessage(error instanceof Error ? error.message : '通用进度读取失败'); }
    finally { if (!signal?.aborted) setLoading(false); }
  },[]);
  useEffect(() => { const c = new AbortController();void refresh(c.signal);return () => c.abort(); },[refresh]);
  const entries = useMemo(() => (status?.entries ?? []).filter(entry =>
    (work === 'all' || entry.category === work)
    && (coverage === 'all' || (coverage === 'with-cn' ? entry.hasChinese : coverage === 'without-cn' ? !entry.hasChinese : entry.review === 'pending'))
    && [entry.id,entry.identity,entry.title,entry.titleJp,entry.work,GENERIC_PROGRESS_WORKS[entry.category]].join(' ').toLowerCase().includes(query.trim().toLowerCase())),[status,query,work,coverage]);
  const panel = `magi-home-light-folder-card ${dark ? 'border-white/15 bg-white/5' : 'border-black/15 bg-white/75'}`;
  return (
    <GenericReviewSurface>
    <main data-generic-progress="native" data-theme={theme} className="min-h-full p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className={`rounded-2xl border p-5 shadow-sm ${panel}`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <nav className="flex flex-wrap gap-3 text-sm font-bold">
                <Link href="/" className="underline">← 返回目录</Link>
                <Link href="/review/submissions" className="underline">修订与投稿</Link>
                <Link href="/proofreading/status" className="underline">本地流程与接口状态</Link>
              </nav>
              <h1 className="mt-3 text-2xl font-black">Narcissu／加奈 中文翻译与校对清单</h1>
              <p className="mt-1 text-sm opacity-70">原汉化及站长提供的中文文本按已校对计；仅站长新增补译列为待校对。中日版本对应与译文校对分别记录。</p>
            </div>
            <button type="button" disabled={loading} onClick={() => void refresh()}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{loading ? '读取中…' : '刷新本地进度'}</button>
          </div>
        </header>
        {status && <>
          <section className="grid gap-3 sm:grid-cols-3" aria-label="公开剧情覆盖">
            {[['有中文',status.withChinese],['无中文',status.withoutChinese],['补译待校对',status.needsReview]].map(([label,value]) =>
              <div key={label} className={`rounded-xl border p-4 ${panel}`}><p className="text-xs font-bold">{label}</p><p className="text-3xl font-black">{value}</p></div>)}
          </section>
          <section className={`rounded-xl border p-4 ${panel}`}>
            <p className="text-sm">游戏 {status.nativeTotal} 个脚本、{status.nativeChapters} 个原生章节；文本资料 {status.supplementalSources} 个来源版本、{status.supplementalTotal} 个篇目。游戏归档 {status.archive.stories} 项与补充资料分别统计。</p>
            <p className="mt-2 text-sm">中文 {status.chineseRows}/{status.rows} 段（{status.coveragePercent}%）；已校对 {status.reviewedRows} 段，站长补译待校对 {status.pendingReviewRows} 段。分母为实际阅读段落及选项。</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/10"><div className="h-full bg-amber-500" style={{width:`${status.coveragePercent}%`}} /></div>
            <ul className="mt-3 space-y-1 text-sm">{status.works.map(w => <li key={w.category}>{GENERIC_PROGRESS_WORKS[w.category]}：{w.total} 篇，有中文 {w.withChinese}，无中文 {w.withoutChinese}，补译待校对 {w.needsReview}</li>)}</ul>
          </section>
        </>}
        {message && <div role="status" className={`rounded-xl border p-3 text-sm ${panel}`}>{message}；保留上次已读取数据，可点击刷新重试。</div>}
        <section className={`rounded-xl border p-4 shadow-sm ${panel}`}>
          <div className="mb-4 flex flex-wrap gap-3">
            <input aria-label="搜索原生剧情" value={query} onChange={e => setQuery(e.target.value)} className="min-w-0 rounded-lg border bg-transparent px-3 py-2 text-sm" placeholder="编号、中日标题或作品" />
            <select aria-label="筛选作品" value={work} onChange={e => setWork(e.target.value)} className="rounded-lg border bg-transparent px-3 py-2 text-sm"><option value="all">全部作品</option>{Object.entries(GENERIC_PROGRESS_WORKS).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select>
            <select aria-label="筛选中文覆盖" value={coverage} onChange={e => setCoverage(e.target.value)} className="rounded-lg border bg-transparent px-3 py-2 text-sm"><option value="all">全部</option><option value="with-cn">有中文</option><option value="without-cn">无中文</option><option value="needs-review">补译待校对</option></select>
          </div>
          <p className="mb-2 text-xs opacity-70">{entries.length} 篇；原译文保留原署名；新补译归站长署名并单独标记待校对。</p>
          <div className="max-h-[72vh] overflow-auto rounded-lg border">
            {entries.map(entry => <article key={entry.id} className={`grid gap-3 border-b p-3 md:grid-cols-[10rem_minmax(0,1fr)_10rem] md:items-center ${entry.pendingReviewRows>0 ? 'bg-amber-500/10' : ''}`}>
              <strong className="break-all font-mono text-xs">{entry.identity}</strong>
              <div className="min-w-0"><p className="font-bold">{entry.title || entry.identity}</p><p className="text-xs opacity-70">{GENERIC_PROGRESS_WORKS[entry.category]} · {entry.variants} 版本 · 中文 {entry.chineseRows}/{entry.rows} · {entry.pendingReviewRows>0 ? `补译 ${entry.pendingReviewRows} 段待校对` : entry.hasChinese ? '已校对' : '无中文'}</p>
                <p className="mt-1 text-xs opacity-60">本行无日文 {entry.unmatchedChineseRows} 段{entry.relocatedChineseRows ? `（其中 ${entry.relocatedChineseRows} 段已定位对应日文）` : ''}；缺中文 {entry.missingChineseRows ?? Math.max(0,entry.unmatchedJapaneseRows-(entry.pendingCorrespondenceJapaneseRows??0))} 段{entry.relocatedJapaneseRows ? `；${entry.relocatedJapaneseRows} 个日文段落对应已有中文原文` : ''}{entry.pendingCorrespondenceRows ? `；中日对应待核实 ${entry.pendingCorrespondenceRows} 段` : ''}{entry.revision ? ' · 已安装本地修订' : ''}</p></div>
              <div className="flex gap-3 text-xs font-black"><Link href={`/reader/${entry.id}`} className="underline">阅读</Link><Link href={`/reader/${entry.id}?edit=1`} className="underline">{entry.relocatedJapaneseRows && !entry.pendingReviewRows ? '校对原译文' : '协助汉化'}</Link></div>
            </article>)}
            {!entries.length && <p className="p-8 text-center opacity-60">{loading ? '正在读取本地进度…' : '没有符合筛选条件的剧情。'}</p>}
          </div>
        </section>
      </div>
    </main>
    </GenericReviewSurface>
  );
}
