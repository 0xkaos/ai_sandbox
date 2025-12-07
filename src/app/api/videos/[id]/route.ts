import { NextRequest } from 'next/server';
import { getVideo } from '@/lib/db/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return new Response('Missing id', { status: 400 });

  const video = await getVideo(id);
  if (!video) return new Response('Not found', { status: 404 });

  const headers: Record<string, string> = {
    'Content-Type': video.contentType || 'video/mp4',
    'Cache-Control': 'public, max-age=31536000, immutable',
  };
  if (video.sizeBytes) headers['Content-Length'] = String(video.sizeBytes);

  // Response expects a typed array/Blob; Buffer extends Uint8Array so this preserves the bytes.
  const body = new Uint8Array(video.data);
  return new Response(body, { status: 200, headers });
}
