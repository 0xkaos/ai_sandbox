import { NextRequest, NextResponse } from 'next/server';
import { getCachedImage } from '@/lib/images/cache';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = getCachedImage(id);
  if (!entry) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = new Uint8Array(entry.data);

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': entry.contentType,
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
