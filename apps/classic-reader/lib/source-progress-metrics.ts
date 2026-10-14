export type SourceRowProgress = {
  progress_rows?: number; chinese_rows?: number; reviewed_rows?: number; pending_review_rows?: number;
};
export const sourcePercent = (value: number,total: number): number => total<=0?0:value>=total?100:Math.floor(Math.max(0,value)/total*10000)/100;
export function sourceRowTotals(stories: readonly SourceRowProgress[]) {
  if(!stories.length || stories.some(s=>![s.progress_rows,s.chinese_rows,s.reviewed_rows,s.pending_review_rows].every(v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0)))return null;
  const totals=stories.reduce((a,s)=>({rows:a.rows+s.progress_rows!,chinese:a.chinese+s.chinese_rows!,reviewed:a.reviewed+s.reviewed_rows!,pending:a.pending+s.pending_review_rows!}),{rows:0,chinese:0,reviewed:0,pending:0});
  if(totals.reviewed+totals.pending!==totals.chinese||totals.chinese>totals.rows)throw Error('来源进度分母错误');
  return {...totals,coveragePercent:sourcePercent(totals.chinese,totals.rows),reviewedPercent:sourcePercent(totals.reviewed,totals.rows),pendingPercent:sourcePercent(totals.pending,totals.rows)};
}
