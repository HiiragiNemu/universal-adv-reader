'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createNativeTranslationPatch, type LoadedNativeEditSource } from '@/lib/native-translation-patch';
import type { StoryLine } from '@/lib/story-parser';
import { triggerUtf8Download } from '@/lib/browser-download';
import { nativeReviewRequest, type NativeReviewRecord } from '@/lib/native-review-client';
import { githubNativeReviewDraft } from '@/lib/github-native-review';

export default function NativeReviewSubmit({source,lines}:{source:LoadedNativeEditSource;lines:StoryLine[]}) {
  const [author,setAuthor]=useState(''),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [receipt,setReceipt]=useState<NativeReviewRecord|null>(null);
  const request=useRef<{content:string;id:string}|null>(null);
  const [publicConfirmed,setPublicConfirmed]=useState(false);
  const [githubDraft,setGithubDraft]=useState<ReturnType<typeof githubNativeReviewDraft>|null>(null);
  useEffect(()=>{setGithubDraft(null);setPublicConfirmed(false);},[source.sha256,lines]);
  if (process.env.NEXT_PUBLIC_ADV_STATIC === '1') return <section className="magi-proofreading-panel mt-3" data-native-review-submit="export-only">
    <h3 className="font-bold">导出或投稿原生修订补丁</h3>
    <p className="magi-proofreading-help">编辑不会自动上传。可以只导出到设备，也可以通过 GitHub 账号公开投稿；批准、安装和发布仍由站长明确执行。</p>
    <button type="button" className="magi-proofreading-button" onClick={() => {
      try {
        const patch = createNativeTranslationPatch(source, lines);
        if (!patch.changes.length) throw Error('没有待导出的文本变化');
        triggerUtf8Download(JSON.stringify(patch, null, 2) + '\n', 'universal-adv-revision.json');
        setMessage('补丁已导出到你的设备，尚未上传或安装。');
      } catch (error) { setMessage(error instanceof Error ? error.message : '导出失败'); }
    }}>导出修改补丁</button>
    <div className="mt-3 space-y-2" data-public-contribution="github-issues">
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={publicConfirmed} onChange={e=>setPublicConfirmed(e.target.checked)} />我确认此补丁可以公开，并将在 GitHub 检查后提交。</label>
      <button type="button" className="magi-proofreading-button" disabled={!publicConfirmed} onClick={()=>{
        try {
          const draft=githubNativeReviewDraft(createNativeTranslationPatch(source,lines));
          setGithubDraft(draft);
          if(!draft.inline)triggerUtf8Download(draft.serialized+'\n','universal-adv-revision.json');
          setMessage(draft.inline?'投稿草稿已在本机准备。请打开 GitHub 检查并提交；当前尚未投稿。':'补丁较大，已导出完整文件。请打开 GitHub 草稿并附上文件或粘贴 JSON，然后确认提交。');
        }catch(error){setGithubDraft(null);setMessage(error instanceof Error?error.message:'准备投稿失败');}
      }}>生成 GitHub 投稿草稿</button>
      {githubDraft&&publicConfirmed&&<a className="block font-bold underline" data-github-review-draft href={githubDraft.url} target="_blank" rel="noopener noreferrer">打开 GitHub 草稿并确认提交</a>}
    </div>
    {message && <p role="status" className="magi-proofreading-status mt-2">{message}</p>}
  </section>;
  const submit=async()=>{
    setBusy(true);setMessage('');
    try{
      if(!author.trim())throw Error('请填写本地投稿署名');
      const patch=createNativeTranslationPatch(source,lines);if(!patch.changes.length)throw Error('没有待提交的文本变化');
      const content=JSON.stringify({patch,author,note});
      if(request.current?.content!==content)request.current={content,id:crypto.randomUUID()};
      const result=await nativeReviewRequest<{record:NativeReviewRecord}>('/api/native-reviews','POST',{patch,author,note,requestId:request.current!.id});
      setReceipt(result.record);setMessage('原生补丁已保存到本地待审核队列；尚未批准或安装。');
    }catch(error){setMessage(error instanceof Error?error.message:'本地投稿失败，可保留编辑后重试');}
    finally{setBusy(false);}
  };
  return <section className="magi-proofreading-panel mt-3" data-native-review-submit="local">
    <h3 className="font-bold">本地原生补丁投稿</h3>
    <p className="magi-proofreading-help">只保存通用工程的补丁和回执；明确审核后再生成版本，安装需要另一次确认。</p>
    <div className="mt-2 flex flex-wrap gap-2">
      <input aria-label="本地投稿署名" maxLength={80} value={author} onChange={e=>setAuthor(e.target.value)} className="magi-proofreading-input min-w-0 rounded border bg-transparent px-2 py-1" placeholder="署名" />
      <input aria-label="本地投稿说明" maxLength={2000} value={note} onChange={e=>setNote(e.target.value)} className="magi-proofreading-input min-w-0 flex-1 rounded border bg-transparent px-2 py-1" placeholder="修改说明（选填）" />
      <button type="button" className="magi-proofreading-button" disabled={busy} onClick={()=>void submit()}>{busy?'保存中…':'提交到本地审核'}</button>
    </div>
    {message&&<p role="status" className="magi-proofreading-status mt-2">{message}</p>}
    {receipt&&<Link className="font-bold underline" href={`/review/submissions?id=${receipt.id}`}>查看投稿与回执 {receipt.id.slice(0,12)}</Link>}
  </section>;
}
