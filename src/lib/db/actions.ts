import { db } from '@/lib/db';
import { chats, messages, users, videos } from '@/lib/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { unstable_noStore as noStore } from 'next/cache';
import { randomUUID } from 'crypto';

export async function ensureUser(user: { id: string; email: string; name?: string | null }) {
  const existingUser = await db
    .select()
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  if (existingUser.length === 0) {
    // Check by email
    const userByEmail = await db
      .select()
      .from(users)
      .where(eq(users.email, user.email))
      .limit(1);
      
    if (userByEmail.length > 0) {
      return userByEmail[0].id;
    }
    
    // Create new user
    await db.insert(users).values({
      id: user.id,
      email: user.email,
      name: user.name || 'Anonymous',
    });
    return user.id;
  }
  
  return existingUser[0].id;
}

export async function getChats(userId: string) {
  noStore();
  return await db
    .select()
    .from(chats)
    .where(eq(chats.userId, userId))
    .orderBy(desc(chats.updatedAt));
}

export async function getChat(chatId: string, userId: string) {
  noStore();
  const chat = await db
    .select()
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
    .limit(1);
    
  return chat[0];
}

export async function getChatMessages(chatId: string) {
  noStore();
  return await db
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(messages.createdAt);
}

export async function createChat(
  userId: string,
  title: string,
  id?: string,
  provider: string = 'openai',
  model: string = 'gpt-4o'
) {
  const [newChat] = await db
    .insert(chats)
    .values({
      id: id || crypto.randomUUID(),
      userId,
      title,
      provider,
      model,
    })
    .returning();
  return newChat;
}

export async function saveMessage(chatId: string, message: { id: string; role: string; content?: string | any[]; parts?: any[]; toolInvocations?: any; createdAt?: Date }) {
  let content = '';
  
  if (typeof message.content === 'string') {
    content = message.content;
  } else if (Array.isArray(message.content)) {
    content = message.content
      .filter((part: any) => part.type === 'text' || part.text)
      .map((part: any) => part.text || '')
      .join('');
  } else if (Array.isArray(message.parts)) {
    content = message.parts
      .filter((part: any) => part.type === 'text' || part.text)
      .map((part: any) => part.text || '')
      .join('');
  }

  await db.insert(messages).values({
    id: message.id,
    chatId,
    role: message.role as 'user' | 'assistant' | 'system' | 'data',
    content,
    toolInvocations: message.toolInvocations || null,
    createdAt: message.createdAt || new Date(),
  });
}

export async function cacheVideoFromUrl(params: { userId: string; chatId: string; sourceUrl: string }) {
  const { userId, chatId, sourceUrl } = params;
  const id = randomUUID();

  const response = await fetch(sourceUrl, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to fetch video (${response.status})`);
  }

  const contentType = response.headers.get('content-type') || undefined;
  const sizeHeader = response.headers.get('content-length');
  const sizeBytes = sizeHeader ? Number(sizeHeader) : undefined;
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  await db.insert(videos).values({
    id,
    chatId,
    userId,
    sourceUrl,
    contentType,
    sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
    data: buffer,
  });

  return { id, contentType, sizeBytes, storedUrl: `/api/videos/${id}` };
}

export async function getVideo(id: string) {
  const result = await db.select().from(videos).where(eq(videos.id, id)).limit(1);
  return result[0];
}

export function extractVideoUrlsFromToolInvocations(invocations: any): string[] {
  if (!Array.isArray(invocations)) return [];
  const urls: string[] = [];

  for (const invocation of invocations) {
    const result = invocation?.result;
    if (!result) continue;

    let payload: any = result;
    if (typeof result === 'string') {
      try {
        payload = JSON.parse(result);
      } catch {
        if (typeof result === 'string' && result.startsWith('http')) {
          urls.push(result);
        }
        continue;
      }
    }

    if (Array.isArray(payload?.videos)) {
      for (const vid of payload.videos) {
        const candidate =
          typeof vid === 'string'
            ? vid
            : typeof vid === 'object'
            ? (typeof (vid as any).videoUrl === 'string'
                ? (vid as any).videoUrl
                : typeof (vid as any).url === 'string'
                ? (vid as any).url
                : null)
            : null;
        if (candidate && candidate.startsWith('http')) {
          urls.push(candidate);
        }
      }
    }

    if (payload && typeof payload === 'object') {
      const candidate =
        typeof (payload as any).videoUrl === 'string'
          ? (payload as any).videoUrl
          : typeof (payload as any).video === 'string'
          ? (payload as any).video
          : Array.isArray((payload as any).output)
          ? (payload as any).output.find((v: unknown) => typeof v === 'string' && v.startsWith('http'))
          : null;
      if (candidate && candidate.startsWith('http')) {
        urls.push(candidate);
      }
    }
  }

  return urls;
}

export async function deleteChat(chatId: string, userId: string) {
  await db
    .delete(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)));
}

export async function updateChatProvider(chatId: string, userId: string, provider: string, model: string) {
  const [updated] = await db
    .update(chats)
    .set({ provider, model, updatedAt: new Date() })
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
    .returning();
  return updated;
}
