import { db } from '@/lib/db';
import { chats, messages, users } from '@/lib/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { unstable_noStore as noStore } from 'next/cache';

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
