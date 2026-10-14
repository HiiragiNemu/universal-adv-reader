import { nativeReviewApi } from '@/lib/native-review-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return nativeReviewApi(request); }
export function POST(request: Request) { return nativeReviewApi(request); }
