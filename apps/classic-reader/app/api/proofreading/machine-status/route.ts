import { loadCurrentGenericProgress } from '@/lib/generic-progress-server';
import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

import { sourceUnverifiedSystemSummary } from '@/lib/machine-translation-review';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

async function retainedReaderGET() {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const status = await sourceUnverifiedSystemSummary(env.SUBMISSIONS_KV);
    return NextResponse.json(
      {
        version: 1,
        ...status,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error('Failed to read Magia Record source-review state', error);
    return NextResponse.json(
      { error: '魔法纪录来源待核验状态暂时不可用' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

// Generic runtime exports: original review implementation remains above.
export const dynamic = 'force-dynamic';
export async function GET() {
  try { return Response.json(await loadCurrentGenericProgress(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { console.error('Generic progress source mismatch', error); return Response.json({error:'本地原生进度暂不可用，请检查目录、事件对应与修订版本。'}, {status:503,headers:{'Cache-Control':'no-store'}}); }
}
