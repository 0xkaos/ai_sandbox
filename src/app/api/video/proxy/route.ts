import { NextResponse } from 'next/server';

const ALLOWED_HOSTS = ['replicate.delivery', 'replicate.com'];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rawUrl = searchParams.get('url');

  if (!rawUrl) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch (err) {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
  }

  const allowed = ALLOWED_HOSTS.some((host) => target.hostname === host || target.hostname.endsWith(`.${host}`));
  if (!allowed) {
    return NextResponse.json({ error: 'Host not allowed' }, { status: 403 });
  }

  const upstream = await fetch(target.toString(), {
    headers: {
      // Explicitly ask for binary video where possible
      Accept: 'video/mp4,video/webm,video/*;q=0.9,*/*;q=0.8',
    },
  });

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: 'Upstream fetch failed' }, { status: 502 });
  }

  const contentType = upstream.headers.get('content-type') || 'video/mp4';
  const contentLength = upstream.headers.get('content-length');
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
  };
  if (contentLength) headers['Content-Length'] = contentLength;

  return new Response(upstream.body, { status: 200, headers });
}
