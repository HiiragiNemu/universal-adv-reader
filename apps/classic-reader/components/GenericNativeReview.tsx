'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useGlobal } from '@/app/providers';
import GenericReviewSurface from '@/components/GenericReviewSurface';
import { triggerUtf8Download } from '@/lib/browser-download';
import { nativeReviewRequest, NATIVE_REVIEW_LABELS, type NativeReviewRecord, type NativeReviewSummary } from '@/lib/native-review-client';
import { ADV_GITHUB_URL } from '@/lib/github-native-review';

export default function GenericNativeReview(props:{initialRecord?:NativeReviewRecord|null}) {
  if (process.env.NEXT_PUBLIC_ADV_STATIC === '1') return <GenericReviewSurface><main className="mx-auto max-w-3xl p-6" data-generic-review="public-export-only">
    <h1 className="text-xl font-bold">修订与投稿</h1>
    <p className="mt-4">公共站点提供剧情阅读及浏览器内编辑、补丁导入和导出。编辑结果保存在你的设备，不会自动上传。</p>
    <p className="mt-3">在线投稿使用公开 GitHub Issues：由 GitHub 账号确认身份并保存讨论。在原生编辑页生成投稿草稿，再到 GitHub 确认提交；也可以把导出的 JSON 补丁附在 Issue 中。只有 GitHub 显示 Issue 编号才表示已提交。</p>
    <p className="mt-3">站长核对来源后将补丁导入本机审核队列，分别批准、安装和发布；任何投稿都不会自动修改正文。无需 GitHub Actions，也不向阅读器输入 GitHub 口令。</p>
    <nav className="mt-5 flex flex-wrap gap-4"><a className="underline" href={`${ADV_GITHUB_URL}/issues`} target="_blank" rel="noopener noreferrer">查看公开投稿与反馈</a><a className="underline" href={`${ADV_GITHUB_URL}/issues/new`} target="_blank" rel="noopener noreferrer">新建反馈或附上修订补丁</a></nav>
    <nav className="mt-5 flex flex-wrap gap-4"><Link className="underline" href="/">返回目录</Link><Link className="underline" href="/review/machine-translations">查看补译待校对清单</Link></nav>
  </main></GenericReviewSurface>;
  return <LocalNativeReview {...props} />;
}

function LocalNativeReview({initialRecord=null}:{initialRecord?:NativeReviewRecord|null}) {
  const {theme}=useGlobal();
  const [items,setItems]=useState<NativeReviewSummary[]>([]),[selected,setSelected]=useState(initialRecord);
  const [filter,setFilter]=useState('all'),[query,setQuery]=useState(''),[actor,setActor]=useState(''),[note,setNote]=useState('');
  const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const live=useRef(true),lifetime=useRef(0);
  const detail=useRef({generation:0,id:initialRecord?.id??null,version:initialRecord?.version??null,loading:false,controller:null as AbortController|null});
  const list=useRef({generation:0,controller:null as AbortController|null});
  const pendingAction=useRef<{controller:AbortController;life:number}|null>(null);
  const confirmation=useRef<{id:string;version:number;generation:number}|null>(null);
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    if(!live.current||signal?.aborted)return;
    list.current.controller?.abort();
    const controller=new AbortController(),generation=++list.current.generation,life=lifetime.current,selection=detail.current.generation;
    list.current.controller=controller;
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    const current=()=>live.current&&life===lifetime.current&&generation===list.current.generation&&!controller.signal.aborted;
    try{const result=await nativeReviewRequest<{items:NativeReviewSummary[]}>('/api/native-reviews','GET',undefined,controller.signal);if(current())setItems(result.items);}
    catch(e){if(current()&&selection===detail.current.generation&&!pendingAction.current)setError(e instanceof Error?e.message:'读取列表失败');}
    finally{signal?.removeEventListener('abort',abort);if(generation===list.current.generation)list.current.controller=null;}
  },[]);
  const open=useCallback(async(id:string,signal?:AbortSignal)=>{
    if(!live.current||signal?.aborted)return;
    detail.current.controller?.abort();
    const controller=new AbortController(),generation=detail.current.generation+1,life=lifetime.current;
    detail.current={generation,id,version:null,loading:true,controller};
    // Invalidate synchronously: an old rendered click handler must not act on
    // the previous record, even before React commits the loading state.
    confirmation.current=null;setConfirmed(false);setLoading(true);setSelected(null);setError('');
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    const current=()=>live.current&&life===lifetime.current&&generation===detail.current.generation;
    try{
      const result=await nativeReviewRequest<{record:NativeReviewRecord}>(`/api/native-reviews/${encodeURIComponent(id)}`,'GET',undefined,controller.signal);
      if(current()&&!controller.signal.aborted){detail.current.version=result.record.version;setSelected(result.record);}
    }catch(e){if(current()&&!controller.signal.aborted)setError(e instanceof Error?e.message:'读取详情失败');}
    finally{
      signal?.removeEventListener('abort',abort);
      if(current()){detail.current.loading=false;detail.current.controller=null;setLoading(false);}
    }
  },[]);
  const mountSession=useCallback(()=>{
    live.current=true;lifetime.current++;confirmation.current=null;setConfirmed(false);setBusy(false);setLoading(false);
    void refresh();const id=new URLSearchParams(window.location.search).get('id');if(id)void open(id);
    return()=>{
      live.current=false;lifetime.current++;detail.current.generation++;list.current.generation++;
      detail.current.controller?.abort();list.current.controller?.abort();pendingAction.current?.controller.abort();
      detail.current.loading=false;pendingAction.current=null;confirmation.current=null;
    };
  },[refresh,open]);
  useEffect(mountSession,[mountSession]);
  const confirmCurrent=(checked:boolean)=>{
    const current=detail.current;
    confirmation.current=checked&&live.current&&!pendingAction.current&&!current.loading&&selected&&current.id===selected.id&&current.version===selected.version
      ?{id:selected.id,version:selected.version,generation:current.generation}:null;
    setConfirmed(confirmation.current!==null);
  };
  const act=async(action:string)=>{
    const current=detail.current,consent=confirmation.current;
    if(!live.current||pendingAction.current||current.loading||!selected||!confirmed||!actor.trim()||!consent
      ||current.id!==selected.id||current.version!==selected.version||consent.id!==selected.id||consent.version!==selected.version||consent.generation!==current.generation)return;
    const id=selected.id,generation=current.generation,operation={controller:new AbortController(),life:lifetime.current};
    pendingAction.current=operation;confirmation.current=null;setConfirmed(false);setBusy(true);setError('');
    const active=()=>live.current&&operation.life===lifetime.current&&!operation.controller.signal.aborted;
    const sameSelection=()=>active()&&detail.current.generation===generation&&detail.current.id===id;
    try{
      const result=await nativeReviewRequest<{record:NativeReviewRecord}>(`/api/native-reviews/${encodeURIComponent(id)}`,'PATCH',{action,actor,note,confirm:id,expectedVersion:selected.version,operationId:crypto.randomUUID()},operation.controller.signal);
      if(sameSelection()){detail.current.version=result.record.version;setSelected(result.record);}
      if(active())await refresh(operation.controller.signal);
    }catch(e){
      if(sameSelection()){
        const message=e instanceof Error?e.message:'本地操作失败';
        const reread=open(id,operation.controller.signal),recoveryGeneration=detail.current.generation;
        await reread;
        if(active()&&detail.current.generation===recoveryGeneration&&detail.current.id===id)setError(message);
      }
    }finally{
      if(pendingAction.current===operation){pendingAction.current=null;if(active())setBusy(false);}
    }
  };
  const visible=items.filter(item=>(filter==='all'||item.status===filter)&&`${item.title} ${item.storyId} ${item.author} ${item.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  const field=(name:string)=>({text:'正文',speaker:'说话人',choiceLabel:'选项'}[name]??name);
  const text=(value:string)=>value===''?<em className="opacity-60">（显式空文本）</em>:value;
  const button='magi-home-review-action rounded-lg border px-3 py-2 text-sm font-bold disabled:opacity-40';
  return <GenericReviewSurface><main data-generic-review="local-native" data-theme={theme} className="mx-auto min-h-full max-w-7xl p-4 md:p-8">
    <header className="magi-home-review-panel rounded-xl border p-5">
      <nav className="flex flex-wrap gap-4 text-sm font-bold"><Link href="/" className="underline">返回目录</Link><Link href="/review/machine-translations" className="underline">中文覆盖与待核对</Link><Link href="/proofreading/status" className="underline">接口与本地流程</Link></nav>
      <h1 className="mt-3 text-2xl font-black">Narcissu／加奈 原生补丁投稿与审核</h1>
      <p className="mt-2 text-sm opacity-75">GitHub 公开投稿或本机保存 → 明确审核 → 生成版本 → 另行确认本地安装。导入的 GitHub 投稿保留账号和 Issue 来源；手工本地署名不等于账号验证，批准记录不等于全部内容人工验收。</p>
    </header>
    {error&&<p role="status" className="magi-home-review-panel my-3 rounded border p-3">{error}；已保存记录和原文保留，可刷新后重试。</p>}
    <div className="mt-4 grid gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
      <aside className="magi-home-light-folder-card min-w-0 rounded-xl border p-3">
        <div className="flex gap-2"><select aria-label="审核状态筛选" value={filter} onChange={e=>setFilter(e.target.value)} className="min-w-0 flex-1 rounded border bg-transparent p-2"><option value="all">全部状态</option>{Object.entries(NATIVE_REVIEW_LABELS).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select><button type="button" className={button} disabled={busy} onClick={()=>void refresh()}>刷新</button></div>
        <input aria-label="搜索本地投稿" value={query} onChange={e=>setQuery(e.target.value)} placeholder="剧情、编号或署名" className="mt-2 w-full rounded border bg-transparent p-2" />
        <div className="mt-3 max-h-[65vh] space-y-2 overflow-auto">{visible.map(item=><button type="button" disabled={busy} key={item.id} onClick={()=>void open(item.id)} aria-pressed={selected?.id===item.id} className="magi-home-light-story-link block w-full rounded border p-3 text-left"><strong className="block">{item.title}</strong><span className="text-xs">{NATIVE_REVIEW_LABELS[item.status]} · {item.changes} 字段 · {item.author}</span><span className="block font-mono text-xs opacity-60">{item.id.slice(0,12)}{item.fixture?' · 测试夹具':''}</span></button>)}{!visible.length&&<p className="p-4 text-sm opacity-60">暂无符合条件的本地投稿。请从协助汉化页提交原生补丁。</p>}</div>
      </aside>
      <section aria-busy={loading} className="magi-home-light-folder-card min-w-0 rounded-xl border p-4">
        {!selected?<p className="p-8 text-center opacity-60">{loading?'正在读取选中的投稿…':'选择一项投稿查看原生字段差异与回执。'}</p>:<>
          <h2 className="text-xl font-bold">{selected.title} · {NATIVE_REVIEW_LABELS[selected.status]}</h2>
          <p className="mt-2 break-all font-mono text-xs opacity-70">{selected.patch.storyId} · source {selected.patch.sourceSha256} · 记录版本 {selected.version}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm">{selected.author}：{selected.note||'（无附言）'}{selected.fixture?' 【隔离测试记录，不是人工审核】':''}</p>
          <div className="my-3 flex flex-wrap gap-3 text-sm"><Link href={`/reader/${selected.readerId}?edit=1`} className="font-bold underline">打开原生编辑页</Link>
            <button type="button" className={button} onClick={()=>triggerUtf8Download(JSON.stringify(selected.patch,null,2)+'\n',`${selected.id}.patch.json`)}>下载补丁</button>
            <button type="button" className={button} onClick={()=>triggerUtf8Download(JSON.stringify(selected,null,2)+'\n',`${selected.id}.receipt.json`)}>下载回执</button>
            <button type="button" className={button} disabled={busy||loading} onClick={()=>void open(selected.id)}>刷新当前记录</button>
          </div>
          <div className="max-h-[55vh] overflow-auto rounded border">{selected.patch.changes.map((change,i)=>{const target=selected.targets[i]?.target;return <article key={change.key+change.field} className="border-b p-3" data-native-review-change={change.field}>
            <p className="break-all font-mono text-xs opacity-65">{field(change.field)} · {target?.variantId} / {target?.sectionId} / {target?.eventId}{target?.choiceId?` / ${target.choiceId}`:''}</p>
            <div className="mt-2 grid gap-3 md:grid-cols-3"><div><h3 className="text-xs opacity-60">原值</h3><p className="whitespace-pre-wrap break-words">{text(change.before)}</p></div><div><h3 className="text-xs opacity-60">提议值</h3><p className="whitespace-pre-wrap break-words">{text(change.after)}</p></div><div><h3 className="text-xs opacity-60">日文来源（原生对应）</h3>{selected.targets[i]?.originalJapanese ? <p className="whitespace-pre-wrap break-words"><strong>{selected.targets[i].originalJapanese!.speaker}</strong>{text(selected.targets[i].originalJapanese!.text)}</p> : <p className="text-sm opacity-60">无已证实的日文对应，不按行号猜配。</p>}</div></div>
          </article>;})}</div>
          <div className="mt-4 space-y-2"><input aria-label="本地审核操作署名" maxLength={80} value={actor} onChange={e=>setActor(e.target.value)} className="w-full rounded border bg-transparent p-2" placeholder="审核／操作署名" /><textarea aria-label="审核操作说明" maxLength={2000} value={note} onChange={e=>setNote(e.target.value)} className="w-full rounded border bg-transparent p-2" placeholder="审核说明" />
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy||loading} onChange={e=>confirmCurrent(e.target.checked)} />我已核对当前补丁和原生来源，明确确认下面选定的操作；安装会修改本地修订指针，回滚保留历史。</label>
            <div className="flex flex-wrap gap-2">{(selected.status==='pending'?[['approve','批准此补丁'],['reject','退回此补丁']]:selected.status==='approved'?[['stage','生成已批准的版本']]:selected.status==='staged'?[['install','安装此版本到本地']]:selected.status==='installed'?[['rollback','回滚此次本地安装']]:[]).map(([action,label])=><button type="button" key={action} disabled={busy||loading||!confirmed||!actor.trim()} className={button} onClick={()=>void act(action)}>{busy?'处理中…':label}</button>)}</div>
          </div>
          {selected.stage&&<p className="mt-3 break-all text-xs">版本：{selected.stage.revision}；本地暂存：{selected.stage.directory}</p>}
          <ol className="mt-4 space-y-1 border-t pt-3 text-xs" aria-label="原生投稿回执">{selected.events.map(e=><li key={e.sequence}>{e.sequence}. {e.at} · {e.action} · {e.outcome} · {e.actor}{e.error?` · ${e.error}`:''}{e.fixture?' · 测试夹具':''}</li>)}</ol>
        </>}
      </section>
    </div>
  </main></GenericReviewSurface>;
}
