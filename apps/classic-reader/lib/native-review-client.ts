import type { NativeTranslationPatch, NativeEditTarget } from './native-translation-patch';
export const NATIVE_REVIEW_LABELS = {pending:'待审核',approved:'已明确批准',rejected:'已退回',staged:'已生成待安装版本',installed:'已安装到本地',rolled_back:'已回滚本地安装'} as const;
export type NativeReviewSummary = {id:string;version:number;status:keyof typeof NATIVE_REVIEW_LABELS;storyId:string;readerId:string;title:string;author:string;note:string;changes:number;createdAt:string;updatedAt:string;fixture:boolean};
export type NativeReviewRecord = Omit<NativeReviewSummary,'storyId'|'changes'> & {
  patch:NativeTranslationPatch;patchSha256:string;targets:Array<{key:string;field:string;target:NativeEditTarget;speakerReason:string;pairing?:string;originalJapanese?:{text:string;speaker:string}|null}>;
  decision:null|{action:string;actor:string;note:string;at:string;explicitLocalAction:true;identityVerified:false;fixture:boolean};
  stage:null|{directory:string;revision:string;parentRevision:string|null};lastError:null|{code:string;message:string;action:string;at:string};
  events:Array<{sequence:number;operationId:string;action:string;actor:string;at:string;outcome:string;error?:string;fixture:boolean}>;
  humanAccepted:false;remotePublished:false;
};
export async function nativeReviewRequest<T>(url:string,method='GET',payload?:unknown,signal?:AbortSignal):Promise<T>{
  const response=await fetch(url,{method,cache:'no-store',signal,headers:payload===undefined?undefined:{'Content-Type':'application/json','X-Native-Review-Intent':'local'},body:payload===undefined?undefined:JSON.stringify(payload)});
  const value=await response.json();if(!response.ok)throw Error(`${value.code??response.status}: ${value.error??'本地操作失败'}`);return value as T;
}
