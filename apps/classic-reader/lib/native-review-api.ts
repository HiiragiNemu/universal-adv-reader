import { createNativeReviewStore, NativeReviewError } from '../../../tools/native-review-store.mjs';

const headers = { 'Cache-Control': 'no-store' };
const MAX_BYTES = 2 * 1024 * 1024;
function localRequest(request: Request, write: boolean) {
  const url = new URL(request.url), origin = request.headers.get('origin');
  // Next dev normalizes the internal Request URL; the validated Host retains
  // the exact loopback origin used by the browser (localhost vs 127.0.0.1).
  const external = new URL(url.protocol+'//'+(request.headers.get('host')??url.host));
  if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)
    || !['127.0.0.1','localhost','[::1]'].includes(external.hostname)
    || request.headers.get('x-forwarded-for')?.split(',').some(ip => !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip.trim()))
    || (origin !== null && origin !== external.origin)
    || request.headers.get('sec-fetch-site') === 'cross-site'
    || (write && (origin !== external.origin || request.headers.get('x-native-review-intent') !== 'local')))
    throw new NativeReviewError('LOCAL_ONLY','此接口仅接受本机同源的明确操作',403);
}
async function body(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new NativeReviewError('JSON','请提交 JSON',415);
  if (Number(request.headers.get('content-length')) > MAX_BYTES) throw new NativeReviewError('SIZE','补丁超过 2 MiB',413);
  if (!request.body) throw new NativeReviewError('JSON','请求内容为空',400);
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>MAX_BYTES){await reader.cancel();throw new NativeReviewError('SIZE','补丁超过 2 MiB',413);}chunks.push(r.value);}
  const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));}catch{throw new NativeReviewError('JSON','JSON 编码或格式错误',400);}
}
export function createNativeReviewApi(store = createNativeReviewStore()) {
  return async (request: Request, id?: string): Promise<Response> => {
    try {
      const write=request.method!=='GET';localRequest(request,write);
      if(request.method==='GET')return Response.json(id?{record:await store.read(id)}:{items:await store.list(),mode:'loopback-local',remotePublished:false},{headers});
      if(request.method==='POST'&&!id)return Response.json({record:await store.submit(await body(request))},{status:201,headers});
      if(request.method==='PATCH'&&id)return Response.json({record:await store.act(id,await body(request))},{headers});
      return Response.json({error:'操作方法错误'},{status:405,headers});
    }catch(error){const e=error as Error & {code?:string;status?:number};return Response.json({error:e.message,code:e.code??'LOCAL_REVIEW_FAILED'},{status:e.status??500,headers});}
  };
}
export const nativeReviewApi = createNativeReviewApi();
