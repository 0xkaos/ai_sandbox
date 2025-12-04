import { db } from '@/lib/db';
import { chats, messages } from '@/lib/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { Message } from '@ai-sdk/react';

export async function getChats(userId: string) {
  return await db
    .select()
    .from(chats)
    .where(eq(chats.userId, userId))
    .orderBy(desc(chats.updatedAt));
}

export async function getChat(chatId: string, userId: string) {
  const chat = await db
    .select()
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
    .limit(1);
    
  return chat[0];
}

export async function getChatMessages(chatId: string) {
  return await db
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(messages.createdAt);
}

export async function createChat(userId: string, title: string, id?: string) {
  const [newChat] = await db
    .insert(chats)
    .values({
      id: id, // Optional, will auto-generate if undefined
      userId,
      title,
    })
    .returning();
  return newChat;
}

export async function saveMessage(chatId: string, message: Message) {
  await db.insert(messages).values({
    id: message.id,
    chatId,
    role: message.role as 'user' | 'assistant' | 'system' | 'data',
    content: message.content,
    toolInvocations: message.toolInvocations || null,
    createdAt: message.createdAt || new Date(),
  });
}

export async function deleteChat(chatId: string, userId: string) {
  await db
    .delete(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)));
}
