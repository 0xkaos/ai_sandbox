import { NextResponse } from 'next/server';
import Replicate from 'replicate';
import { cacheVideoFromUrl, ensureChat, ensureUser } from '@/lib/db/actions';
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Directly call Replicate T2V and store the resulting video, bypassing the agent/tool loop.
// POST body: { prompt: string, duration?: 5|10, size?: '1280*720'|'720*1280'|'1024*1024', negativePrompt?: string, enablePromptExpansion?: boolean, chatId?: string, userId?: string, store?: boolean, timeoutMs?: number }
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const prompt: string = body?.prompt;
    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Missing prompt' }, { status: 400 });
    }

    const duration: 5 | 10 = body?.duration === 10 ? 10 : 5;
    const size: '1280*720' | '720*1280' | '1024*1024' = ['720*1280', '1024*1024'].includes(body?.size) ? body.size : '1280*720';
    const negativePrompt: string = typeof body?.negativePrompt === 'string' ? body.negativePrompt : '';
    const enablePromptExpansion: boolean = body?.enablePromptExpansion !== false;
    const shouldStore: boolean = body?.store !== false;
    const timeoutMs = clampTimeout(body?.timeoutMs);

    // Resolve user/chat: prefer session, then body, fallback debug values.
    const session = await auth().catch(() => null);
    const userId = (session?.user?.id as string) || (typeof body?.userId === 'string' ? body.userId : 'debug-user');
    const chatId = typeof body?.chatId === 'string' ? body.chatId : 'debug-chat';

    // Ensure user exists if session is available or userId provided.
    try {
      await ensureUser({ id: userId, email: session?.user?.email || `${userId}@example.com`, name: session?.user?.name });
    } catch (err) {
      console.warn('[video-direct] ensureUser failed, continuing', err);
    }

    try {
      await ensureChat({ id: chatId, userId, title: 'Debug Chat' });
    } catch (err) {
      console.warn('[video-direct] ensureChat failed, continuing', err);
    }

    const replicateApiKey = process.env.REPLICATE_API_KEY;
    if (!replicateApiKey) {
      return NextResponse.json({ error: 'Missing REPLICATE_API_KEY' }, { status: 500 });
    }

    const client = new Replicate({ auth: replicateApiKey });
    const input = buildPayload({ prompt, duration, size, negativePrompt, enablePromptExpansion });

    const output = await runWithTimeout(
      () => client.run('wan-video/wan-2.5-t2v', { input }),
      timeoutMs,
      'Replicate call timed out'
    );
    const videoUrl = resolveOutputUrl(output);
    if (!videoUrl) {
      return NextResponse.json({ error: 'Replicate did not return a video URL', output }, { status: 502 });
    }

    let stored;
    if (shouldStore) {
      stored = await cacheVideoFromUrl({ userId, chatId, sourceUrl: videoUrl });
    }

    return NextResponse.json({
      videoUrl,
      output,
      stored,
      chatId,
      userId,
    });
  } catch (err) {
    console.error('[video-direct] error', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

async function runWithTimeout<T>(fn: () => Promise<T>, ms: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout;
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timeout));
}

function buildPayload(input: {
  prompt: string;
  duration: 5 | 10;
  size: '1280*720' | '720*1280' | '1024*1024';
  negativePrompt: string;
  enablePromptExpansion: boolean;
}) {
  const payload: Record<string, unknown> = {
    prompt: input.prompt,
    duration: input.duration,
    size: input.size,
    negative_prompt: input.negativePrompt,
    enable_prompt_expansion: input.enablePromptExpansion,
  };

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined || payload[key] === null) {
      delete payload[key];
    }
  });

  return payload;
}

function resolveOutputUrl(output: unknown): string | null {
  const candidates: string[] = [];

  const consider = (value: unknown) => {
    if (typeof value === 'string' && value.startsWith('http')) {
      candidates.push(value);
    }
  };

  if (typeof output === 'string') consider(output);

  if (output && typeof output === 'object') {
    consider((output as any).url);
    consider((output as any).output);
    const nested = findHttpUrlDeep((output as any).output ?? output);
    if (nested) consider(nested);
  }

  if (Array.isArray(output)) {
    for (const value of output) {
      const nested = findHttpUrlDeep(value);
      if (nested) consider(nested);
    }
  }

  const preferVideoExt = candidates.find((c) => /(mp4|webm|mov|mkv|m4v)(\?|$)/i.test(c));
  if (preferVideoExt) return preferVideoExt;
  return candidates[0] ?? null;
}

function findHttpUrlDeep(value: unknown, depth = 0): string | null {
  if (depth > 4 || value === null || value === undefined) return null;
  if (typeof value === 'string') return value.startsWith('http') ? value : null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const url = findHttpUrlDeep(entry, depth + 1);
      if (url) return url;
    }
    return null;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.url === 'string' && obj.url.startsWith('http')) return obj.url;
    if (typeof obj.output === 'string' && obj.output.startsWith('http')) return obj.output;
    if (Array.isArray(obj.output)) {
      const url = findHttpUrlDeep(obj.output, depth + 1);
      if (url) return url;
    }
    if (Array.isArray(obj.files)) {
      const url = findHttpUrlDeep(obj.files, depth + 1);
      if (url) return url;
    }
    for (const val of Object.values(obj)) {
      const url = findHttpUrlDeep(val, depth + 1);
      if (url) return url;
    }
  }
  return null;
}

function clampTimeout(raw: unknown) {
  if (typeof raw !== 'number' || Number.isNaN(raw)) return 65000;
  return Math.min(Math.max(raw, 10000), 85000); // enforce 10s-85s window; higher risks Vercel timeout
}
