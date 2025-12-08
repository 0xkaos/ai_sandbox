import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { videos } from '@/lib/db/schema';
import { ensureChat, ensureUser } from '@/lib/db/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Debug helper: fetches a real video URL and stores it in Postgres to validate the end-to-end pipeline.
// Usage from browser console (must supply a sourceUrl that is directly fetchable):
//   fetch('/api/debug/video-test?sourceUrl=https://example.com/video.mp4').then(r => r.json())
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sourceUrl = url.searchParams.get('sourceUrl');
    if (!sourceUrl) {
      return NextResponse.json({ error: 'Missing required query param: sourceUrl' }, { status: 400 });
    }

    const resp = await fetch(sourceUrl, { redirect: 'follow' });
    if (!resp.ok || !resp.body) {
      return NextResponse.json({ error: `Failed to fetch source ${resp.status}` }, { status: 502 });
    }

    const arr = await resp.arrayBuffer();
    const buffer = Buffer.from(arr);
    const contentType = resp.headers.get('content-type') ?? 'video/mp4';
    const len = resp.headers.get('content-length');
    const sizeBytes = len ? Number(len) : buffer.byteLength;

    const id = randomUUID();
    const chatId = url.searchParams.get('chatId') || 'debug-chat';
    const userId = url.searchParams.get('userId') || 'debug-user';

    await ensureUser({ id: userId, email: `${userId}@example.com`, name: 'Debug User' });
    await ensureChat({ id: chatId, userId, title: 'Debug Chat' });

    await db.insert(videos).values({
      id,
      chatId,
      userId,
      sourceUrl,
      contentType,
      sizeBytes,
      data: buffer,
    });

    return NextResponse.json({
      id,
      storedUrl: `/api/videos/${id}`,
      contentType,
      sizeBytes,
      sourceUrl,
    });
  } catch (err) {
    console.error('[debug-video-test] error', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
