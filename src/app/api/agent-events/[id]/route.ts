import { NextRequest } from 'next/server';
import { sseSubscribe } from '@/lib/agent/events';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) {
    return new Response('Chat ID required', { status: 400 });
  }
  return sseSubscribe(req, id);
}