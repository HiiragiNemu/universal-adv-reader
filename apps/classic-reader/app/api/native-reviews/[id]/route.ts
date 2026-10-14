import { nativeReviewApi } from '@/lib/native-review-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return nativeReviewApi(request,(await context.params).id); }
export async function PATCH(request: Request, context: Context) { return nativeReviewApi(request,(await context.params).id); }
